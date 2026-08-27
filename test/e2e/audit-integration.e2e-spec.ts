import { createBasePrisma, createTables, dropTables } from './setup-helpers';
import { Prisma } from '../generated/client/client';
import { prismaDmmf } from './prisma-dmmf';
import { createPrismaSoftDeleteExtension } from '../../src/prisma/soft-delete-extension';
import { CascadeHandler } from '../../src/prisma/cascade-handler';
import { SoftDeleteService } from '../../src/services/soft-delete.service';
import { createAuditExtension, applyAuditTableSchema } from '@nestarc/audit-log';
import { createPrismaTenancyExtension, TenancyContext } from '@nestarc/tenancy';

const trackedModels = ['User', 'Post', 'Comment', 'AccessKey'];
const databaseMapping = {
  User: { tableName: 'users' },
  Post: { tableName: 'posts' },
  Comment: { tableName: 'comments' },
  AccessKey: { tableName: 'access_keys', primaryKeyColumn: 'access_token' },
};
const primaryKey = { AccessKey: 'token' };
const cascade = { User: ['Post'], Post: ['Comment'] };
const moduleOptions = {
  softDeleteModels: trackedModels,
  deletedAtField: 'deletedAt',
  deletedByField: 'deletedBy',
  cascade,
  dmmf: prismaDmmf,
  prismaServiceToken: 'PRISMA',
  auditLifecycle: 'atomic-required' as const,
  auditMaxBatchRecords: 10,
};

describe('tenancy + audit-log + soft-delete atomic integration E2E', () => {
  const base = createBasePrisma();
  const tenancyContext = new TenancyContext();
  const tenancyService = {
    getCurrentTenant: () => tenancyContext.getTenantId(),
    isTenantBypassed: () => tenancyContext.isBypassed(),
  };
  const tenancy = createPrismaTenancyExtension(tenancyService as any, {
    interactiveTransactionSupport: true,
    failClosed: true,
  });
  const audit = createAuditExtension({
    consistency: 'atomic-required',
    trackedModels,
    tenantRequired: true,
    maxBatchRecords: moduleOptions.auditMaxBatchRecords,
    databaseMapping,
    primaryKey,
    prismaModule: { Prisma },
  });
  const softDelete = createPrismaSoftDeleteExtension(moduleOptions);
  const client: any = base.$extends(tenancy).$extends(audit).$extends(softDelete);
  const bestEffortClient: any = base
    .$extends(tenancy)
    .$extends(
      createAuditExtension({
        consistency: 'best-effort',
        trackedModels,
        databaseMapping,
        prismaModule: { Prisma },
      }),
    )
    .$extends(softDelete);
  const cascadeHandler = new CascadeHandler({
    cascade,
    deletedAtField: 'deletedAt',
    deletedByField: 'deletedBy',
    maxCascadeDepth: 3,
    dmmf: prismaDmmf,
  });
  const service = new SoftDeleteService(moduleOptions, client, cascadeHandler, null);

  const withTenantAuditTransaction = <T>(callback: (tx: any) => Promise<T>): Promise<T> =>
    tenancyContext.run('tenant-1', () => client.withAuditTransaction(callback));

  beforeAll(async () => {
    await base.$connect();
    await createTables(base);
  });

  beforeEach(async () => {
    await base.$executeRawUnsafe('DROP TABLE IF EXISTS audit_logs CASCADE');
    await applyAuditTableSchema(base as any);
    await base.comment.deleteMany();
    await base.post.deleteMany();
    await base.user.deleteMany();
    await base.accessKey.deleteMany();
  });

  afterAll(async () => {
    await base.$executeRawUnsafe('DROP TABLE IF EXISTS audit_logs CASCADE');
    await dropTables(base);
    await base.$disconnect();
  });

  it('commits soft-delete and audit together with deterministic action, diff, and tenant', async () => {
    const user = await base.user.create({
      data: { email: 'commit@test.dev', name: 'Commit' },
    });

    await withTenantAuditTransaction((tx: any) => tx.user.delete({ where: { id: user.id } }));

    const [stored] = await base.$queryRawUnsafe<any[]>(
      'SELECT action, tenant_id, target_id, changes, metadata FROM audit_logs',
    );
    const row = await base.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(stored.action).toBe('User.softDeleted');
    expect(stored.tenant_id).toBe('tenant-1');
    expect(stored.target_id).toBe(user.id);
    expect(stored.changes.deletedAt.before).toBeNull();
    expect(stored.changes.deletedAt.after).not.toBeNull();
    expect(stored.metadata).toMatchObject({
      auditKind: 'record',
      lifecycle: 'soft-delete',
      lifecycleOperation: 'delete',
    });
  });

  it('fails closed before mutation outside withAuditTransaction', async () => {
    const user = await base.user.create({
      data: { email: 'outside-tx@test.dev', name: 'Outside transaction' },
    });

    await expect(
      tenancyContext.run(
        'tenant-1',
        async () => await client.user.delete({ where: { id: user.id } }),
      ),
    ).rejects.toThrow('atomic-required');

    expect((await base.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it('rejects a best-effort audit client before the lifecycle mutation', async () => {
    const user = await base.user.create({
      data: { email: 'best-effort@test.dev', name: 'Best effort' },
    });

    await expect(
      tenancyContext.run('tenant-1', () =>
        bestEffortClient.withAuditTransaction((tx: any) =>
          tx.user.delete({ where: { id: user.id } }),
        ),
      ),
    ).rejects.toThrow('requires audit-log consistency: "atomic-required"');

    expect((await base.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it('rolls back both rows and rejects repeated soft-delete without extra evidence', async () => {
    const user = await base.user.create({
      data: { email: 'rollback@test.dev', name: 'Rollback' },
    });

    await expect(
      withTenantAuditTransaction(async (tx: any) => {
        await tx.user.delete({ where: { id: user.id } });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    expect((await base.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();
    expect(await auditCount()).toBe(0);

    await withTenantAuditTransaction((tx: any) => tx.user.delete({ where: { id: user.id } }));
    await expect(
      withTenantAuditTransaction((tx: any) => tx.user.delete({ where: { id: user.id } })),
    ).rejects.toThrow();
    expect(await auditCount()).toBe(1);
  });

  it('audits restore and purge atomically and rejects repeated restore', async () => {
    const user = await base.user.create({
      data: { email: 'lifecycle@test.dev', name: 'Lifecycle' },
    });
    await withTenantAuditTransaction((tx: any) => tx.user.delete({ where: { id: user.id } }));
    await expect(
      withTenantAuditTransaction(async () => {
        await service.restore('User', { id: user.id });
        throw new Error('restore rollback');
      }),
    ).rejects.toThrow('restore rollback');
    expect(
      (await base.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt,
    ).not.toBeNull();
    expect(await auditCount()).toBe(1);
    await withTenantAuditTransaction(() => service.restore('User', { id: user.id }));
    await expect(
      withTenantAuditTransaction(() => service.restore('User', { id: user.id })),
    ).rejects.toThrow('Record not found');
    await withTenantAuditTransaction(() => service.forceDelete('User', { id: user.id }));

    const rows = await base.$queryRawUnsafe<any[]>(
      'SELECT action, changes, metadata FROM audit_logs ORDER BY created_at, id',
    );
    expect(rows.map((row) => row.action)).toEqual([
      'User.softDeleted',
      'User.restored',
      'User.purged',
    ]);
    expect(rows[1].changes.deletedAt.after).toBeNull();
    expect(rows[2].metadata.lifecycleOperation).toBe('forceDelete');
    expect(await base.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it.each([
    {
      operation: 'forceDelete',
      purge: async (userId: string) => service.forceDelete('User', { id: userId }),
    },
    {
      operation: 'purge',
      purge: async (userId: string) =>
        service.purge('User', {
          olderThan: new Date(Date.now() + 60_000),
          where: { id: userId },
        }),
    },
  ])(
    'keeps $operation audit evidence after a caught repeated soft-delete in one transaction',
    async ({ operation, purge }) => {
      const user = await base.user.create({
        data: { email: `caught-${operation}@test.dev`, name: 'Caught lifecycle failure' },
      });

      await withTenantAuditTransaction(async (tx: any) => {
        await tx.user.delete({ where: { id: user.id } });
        try {
          await tx.user.delete({ where: { id: user.id } });
          throw new Error('repeated soft-delete unexpectedly succeeded');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).not.toBe('repeated soft-delete unexpectedly succeeded');
        }
        await purge(user.id);
      });

      expect(await base.user.findUnique({ where: { id: user.id } })).toBeNull();
      const rows = await base.$queryRawUnsafe<Array<{ action: string; metadata: any }>>(
        'SELECT action, metadata FROM audit_logs ORDER BY created_at, id',
      );
      expect(rows.map((row) => row.action).sort()).toEqual(['User.purged', 'User.softDeleted']);
      expect(rows.find((row) => row.action === 'User.purged')?.metadata.lifecycleOperation).toBe(
        operation,
      );
    },
  );

  it('composes custom primary-key and database mappings through the public bridge', async () => {
    const token = 'mapped-access-key';
    await base.accessKey.create({ data: { token, label: 'Mapped key' } });

    await withTenantAuditTransaction((tx: any) => tx.accessKey.delete({ where: { token } }));

    const stored = await base.accessKey.findUniqueOrThrow({ where: { token } });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    const [auditRow] = await base.$queryRawUnsafe<
      Array<{ action: string; target_id: string; changes: any }>
    >(
      `SELECT action, target_id, changes
       FROM audit_logs
       WHERE target_type = 'AccessKey'`,
    );
    expect(auditRow.action).toBe('AccessKey.softDeleted');
    expect(auditRow.target_id).toBe(token);
    expect(auditRow.changes.deletedAt.before).toBeNull();
    expect(auditRow.changes.deletedAt.after).not.toBeNull();
  });

  it('purges matching rows as record-level Model.purged evidence', async () => {
    const olderThan = new Date('2026-08-21T00:00:00.000Z');
    await base.user.createMany({
      data: [
        { email: 'purge-1@test.dev', name: 'Purge', deletedAt: new Date('2026-01-01') },
        { email: 'purge-2@test.dev', name: 'Purge', deletedAt: new Date('2026-01-02') },
      ],
    });

    const result = await withTenantAuditTransaction(() =>
      service.purge('User', { olderThan, where: { name: 'Purge' } }),
    );

    expect(result.count).toBe(2);
    const rows = await base.$queryRawUnsafe<any[]>(
      'SELECT action, metadata FROM audit_logs ORDER BY target_id',
    );
    expect(rows.map((row) => row.action)).toEqual(['User.purged', 'User.purged']);
    expect(rows.every((row) => row.metadata.lifecycleOperation === 'purge')).toBe(true);
  });

  it('restores bulk rows as record-level evidence', async () => {
    await base.user.createMany({
      data: [
        {
          email: 'restore-many-1@test.dev',
          name: 'Restore Many',
          deletedAt: new Date('2026-01-01'),
        },
        {
          email: 'restore-many-2@test.dev',
          name: 'Restore Many',
          deletedAt: new Date('2026-01-02'),
        },
      ],
    });

    const result = await withTenantAuditTransaction(() =>
      service.restoreMany('User', { where: { name: 'Restore Many' } }),
    );

    expect(result.count).toBe(2);
    expect(
      await base.user.count({
        where: { name: 'Restore Many', deletedAt: null },
      }),
    ).toBe(2);
    const rows = await base.$queryRawUnsafe<any[]>(
      'SELECT action, metadata FROM audit_logs ORDER BY target_id',
    );
    expect(rows.map((row) => row.action)).toEqual(['User.restored', 'User.restored']);
    expect(rows.every((row) => row.metadata.lifecycleOperation === 'restoreMany')).toBe(true);
  });

  it('records cascade delete and restore per row in the same transaction', async () => {
    const user = await base.user.create({
      data: {
        email: 'cascade@test.dev',
        name: 'Cascade',
        posts: {
          create: {
            title: 'Post',
            comments: { create: { content: 'Comment' } },
          },
        },
      },
      include: { posts: { include: { comments: true } } },
    });

    await withTenantAuditTransaction((tx: any) => tx.user.delete({ where: { id: user.id } }));
    await withTenantAuditTransaction(() => service.restore('User', { id: user.id }));

    const rows = await base.$queryRawUnsafe<any[]>(
      'SELECT action, metadata FROM audit_logs ORDER BY created_at, id',
    );
    expect(rows.map((row) => row.action).sort()).toEqual([
      'Comment.restored',
      'Comment.softDeleted',
      'Post.restored',
      'Post.softDeleted',
      'User.restored',
      'User.softDeleted',
    ]);
    expect(rows.filter((row) => row.metadata.lifecycleOperation === 'cascadeDelete')).toHaveLength(
      2,
    );
    expect(rows.filter((row) => row.metadata.lifecycleOperation === 'cascadeRestore')).toHaveLength(
      2,
    );
  });

  it('rolls back cascaded business rows and audit rows together', async () => {
    const user = await base.user.create({
      data: {
        email: 'cascade-rollback@test.dev',
        name: 'Cascade rollback',
        posts: {
          create: {
            title: 'Rollback post',
            comments: { create: { content: 'Rollback comment' } },
          },
        },
      },
      include: { posts: { include: { comments: true } } },
    });

    await expect(
      withTenantAuditTransaction(async (tx: any) => {
        await tx.user.delete({ where: { id: user.id } });
        throw new Error('rollback cascade');
      }),
    ).rejects.toThrow('rollback cascade');

    expect((await base.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();
    expect(
      (await base.post.findUniqueOrThrow({ where: { id: user.posts[0].id } })).deletedAt,
    ).toBeNull();
    expect(
      (
        await base.comment.findUniqueOrThrow({
          where: { id: user.posts[0].comments[0].id },
        })
      ).deletedAt,
    ).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it('audits bulk soft-delete per record and rolls the whole batch back on later failure', async () => {
    await base.user.createMany({
      data: [
        { email: 'bulk-1@test.dev', name: 'Bulk' },
        { email: 'bulk-2@test.dev', name: 'Bulk' },
      ],
    });

    await expect(
      withTenantAuditTransaction(async (tx: any) => {
        const result = await tx.user.deleteMany({ where: { name: 'Bulk' } });
        expect(result.count).toBe(2);
        throw new Error('later failure');
      }),
    ).rejects.toThrow('later failure');
    expect(await base.user.count({ where: { deletedAt: { not: null } } })).toBe(0);
    expect(await auditCount()).toBe(0);

    await withTenantAuditTransaction((tx: any) => tx.user.deleteMany({ where: { name: 'Bulk' } }));
    const actions = await base.$queryRawUnsafe<Array<{ action: string }>>(
      'SELECT action FROM audit_logs ORDER BY target_id',
    );
    expect(actions.map((row) => row.action)).toEqual(['User.softDeleted', 'User.softDeleted']);
  });

  it('rejects an over-cap bulk mutation before changing rows', async () => {
    await base.user.createMany({
      data: [
        { email: 'cap-1@test.dev', name: 'Over cap' },
        { email: 'cap-2@test.dev', name: 'Over cap' },
      ],
    });
    const cappedAudit = createAuditExtension({
      consistency: 'atomic-required',
      trackedModels,
      tenantRequired: true,
      maxBatchRecords: moduleOptions.auditMaxBatchRecords,
      databaseMapping,
      primaryKey,
      prismaModule: { Prisma },
    });
    const cappedSoftDelete = createPrismaSoftDeleteExtension({
      ...moduleOptions,
      auditMaxBatchRecords: 1,
    });
    const cappedClient: any = base
      .$extends(tenancy)
      .$extends(cappedAudit)
      .$extends(cappedSoftDelete);

    await expect(
      tenancyContext.run('tenant-1', () =>
        cappedClient.withAuditTransaction((tx: any) =>
          tx.user.deleteMany({ where: { name: 'Over cap' } }),
        ),
      ),
    ).rejects.toThrow('exceeds auditMaxBatchRecords (1)');

    expect(
      await base.user.count({
        where: { name: 'Over cap', deletedAt: { not: null } },
      }),
    ).toBe(0);
    expect(await auditCount()).toBe(0);
  });

  async function auditCount(): Promise<number> {
    const [row] = await base.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*)::bigint AS count FROM audit_logs',
    );
    return Number(row.count);
  }
});
