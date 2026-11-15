// This fixture is copied into a clean consumer and runs against installed tarballs.
// DATABASE_URL must name a disposable test database with permission to create roles.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import generated from './generated/index.js';
import { createAuditExtension, getAuditTableStatements } from '@nestarc/audit-log';
import { createPrismaSoftDeleteExtension, SoftDeleteService } from '@nestarc/soft-delete';
import { TenancyContext, TenancyService, tenancyTransactionCallback } from '@nestarc/tenancy';

assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the packed PostgreSQL consumer');
assert.equal(typeof tenancyTransactionCallback, 'function');
const { Prisma, PrismaClient } = generated;
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`;
const schema = `sd_lifecycle_${suffix}`;
const role = `sd_lifecycle_app_${suffix}`;
const password = randomBytes(24).toString('hex');
const appUrl = new URL(process.env.DATABASE_URL);
appUrl.username = role;
appUrl.password = password;
appUrl.searchParams.delete('schema');
const admin = new Client({ connectionString: process.env.DATABASE_URL });
const base = new PrismaClient({
  adapter: new PrismaPg({ connectionString: appUrl.toString(), max: 4 }, { schema }),
});
const context = new TenancyContext();
const tenancy = new TenancyService(context);
const options = {
  softDeleteModels: ['Document'],
  auditLifecycle: 'atomic-required',
  auditMaxBatchRecords: 10,
  dmmf: Prisma.dmmf,
};
const client = base
  .$extends(
    createAuditExtension({
      consistency: 'atomic-required',
      trackedModels: ['Document'],
      tableName: `${schema}.audit_logs`,
      databaseMapping: { Document: { tableName: 'documents', schema } },
      maxBatchRecords: options.auditMaxBatchRecords,
      tenantRequired: true,
      tenantResolver: () => tenancy.getCurrentTenantOrThrow(),
      prismaModule: { Prisma },
    }),
  )
  .$extends(createPrismaSoftDeleteExtension(options));
const service = new SoftDeleteService(options, client, null, null);
const transact = (tenant, work) =>
  context.run(tenant, () => client.withAuditTransaction(tenancyTransactionCallback(tenancy, work)));
const seed = (id, tenant) =>
  admin.query(`INSERT INTO ${schema}.documents (id, tenant_id) VALUES ($1, $2)`, [id, tenant]);
const document = async (id) =>
  (
    await admin.query(`SELECT id, tenant_id, deleted_at FROM ${schema}.documents WHERE id = $1`, [
      id,
    ])
  ).rows[0];
const audits = async (id) =>
  (
    await admin.query(
      `SELECT tenant_id, target_id, action FROM ${schema}.audit_logs
   WHERE target_id = $1 ORDER BY action`,
      [id],
    )
  ).rows;
let passed = 0;
const check = async (name, work) => {
  await work();
  passed += 1;
  console.log(`PASS packed audit lifecycle: ${name}`);
};
// Both callbacks enter before either mutates, proving overlapping connections.
const concurrentTransactions = async (work) => {
  let entered = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  await Promise.all(
    ['A', 'B'].map((tenant) =>
      transact(tenant, async (tx) => {
        entered += 1;
        if (entered === 2) release();
        await ready;
        const [setting] =
          await tx.$queryRaw`SELECT current_setting('app.current_tenant') AS tenant`;
        assert.equal(setting.tenant, tenant);
        await work(tenant, tx);
      }),
    ),
  );
};

let roleCreated = false;
let schemaCreated = false;
await admin.connect();
try {
  // Identifiers and password contain only generated [a-z0-9_] / hex characters.
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  roleCreated = true;
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await admin.query(`CREATE TABLE ${schema}.documents (
    id text PRIMARY KEY, tenant_id text NOT NULL, deleted_at timestamptz
  )`);
  for (const statement of getAuditTableStatements({ tableName: `${schema}.audit_logs` })) {
    await admin.query(statement);
  }
  await admin.query(`ALTER TABLE ${schema}.documents ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${schema}.documents FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY documents_by_tenant ON ${schema}.documents TO ${role}
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true))`);
  await admin.query(`ALTER TABLE ${schema}.audit_logs ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${schema}.audit_logs FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY audit_by_tenant ON ${schema}.audit_logs FOR INSERT TO ${role}
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true))`);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await admin.query(`GRANT SELECT, UPDATE, DELETE ON ${schema}.documents TO ${role}`);
  await admin.query(`GRANT INSERT ON ${schema}.audit_logs TO ${role}`);
  await admin.query(`ALTER TABLE ${schema}.audit_logs ADD CONSTRAINT reject_fixture_audit
    CHECK (target_id <> 'audit-failure')`);
  await base.$connect();

  await check('uses a non-owner role without RLS bypass', async () => {
    const [actual] = await base.$queryRaw`
      SELECT current_user::text AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    assert.equal(actual.name, role);
    assert.equal(actual.rolsuper, false);
    assert.equal(actual.rolbypassrls, false);
    await seed('a', 'A');
    await seed('b', 'B');
    assert.deepEqual(await base.document.findMany(), []);
  });

  await check('rejects root clients and missing tenants before calling business work', async () => {
    let calls = 0;
    const work = async () => {
      calls += 1;
    };
    for (const root of [base, client]) {
      await context.run('A', () =>
        assert.rejects(tenancyTransactionCallback(tenancy, work)(root), /transaction client/i),
      );
    }
    await assert.rejects(
      client.withAuditTransaction(tenancyTransactionCallback(tenancy, work)),
      /No tenant context available/,
    );
    assert.equal(calls, 0);
    assert.equal((await document('a')).deleted_at, null);
    assert.deepEqual(await audits('a'), []);
  });

  await check('rejects changing a tenant on the same transaction connection', async () => {
    let calls = 0;
    await transact('A', async (tx) => {
      await context.run('B', () =>
        assert.rejects(
          tenancyTransactionCallback(tenancy, async () => {
            calls += 1;
          })(tx),
          /another tenant/i,
        ),
      );
      const [setting] = await tx.$queryRaw`SELECT current_setting('app.current_tenant') AS tenant`;
      assert.equal(setting.tenant, 'A');
      assert.deepEqual(
        (await tx.document.findMany()).map((row) => row.id),
        ['a'],
      );
    });
    assert.equal(calls, 0);
  });

  await check('commits concurrent tenant-scoped deletes and matching audit evidence', async () => {
    await concurrentTransactions(async (tenant, tx) => {
      const id = tenant.toLowerCase();
      assert.deepEqual(
        (await tx.document.findMany()).map((row) => row.id),
        [id],
      );
      await tx.document.delete({ where: { id } });
    });
    for (const [id, tenant] of [
      ['a', 'A'],
      ['b', 'B'],
    ]) {
      assert.ok((await document(id)).deleted_at instanceof Date);
      assert.deepEqual(await audits(id), [
        { tenant_id: tenant, target_id: id, action: 'Document.softDeleted' },
      ]);
    }
  });

  await check('isolates restore and purge, including concurrent service calls', async () => {
    await assert.rejects(
      transact('A', () => service.restore('Document', { id: 'b' })),
      /not found/i,
    );
    assert.ok((await document('b')).deleted_at instanceof Date);
    assert.equal((await audits('b')).length, 1);
    await concurrentTransactions((tenant) =>
      service.restore('Document', { id: tenant.toLowerCase() }),
    );
    assert.equal((await document('a')).deleted_at, null);
    assert.equal((await document('b')).deleted_at, null);
    await assert.rejects(
      transact('A', () => service.forceDelete('Document', { id: 'b' })),
      /not found/i,
    );
    assert.ok(await document('b'));
    assert.equal((await audits('b')).length, 2);
    await concurrentTransactions((tenant) =>
      service.forceDelete('Document', { id: tenant.toLowerCase() }),
    );
    for (const [id, tenant] of [
      ['a', 'A'],
      ['b', 'B'],
    ]) {
      assert.equal(await document(id), undefined);
      assert.deepEqual(
        await audits(id),
        ['Document.purged', 'Document.restored', 'Document.softDeleted'].map((action) => ({
          tenant_id: tenant,
          target_id: id,
          action,
        })),
      );
    }
  });

  await check('rejects lifecycle writes outside the audit transaction', async () => {
    await seed('outside-transaction', 'A');
    await assert.rejects(
      context.run('A', () => client.document.delete({ where: { id: 'outside-transaction' } })),
      /atomic-required|withAuditTransaction/i,
    );
    assert.equal((await document('outside-transaction')).deleted_at, null);
    assert.deepEqual(await audits('outside-transaction'), []);
  });

  await check('rolls back business and audit rows after a user callback error', async () => {
    await seed('callback-failure', 'A');
    await assert.rejects(
      transact('A', async (tx) => {
        await tx.document.delete({ where: { id: 'callback-failure' } });
        throw new Error('intentional callback failure');
      }),
      /intentional callback failure/,
    );
    assert.equal((await document('callback-failure')).deleted_at, null);
    assert.deepEqual(await audits('callback-failure'), []);
  });

  await check(
    'rolls back successful earlier writes when the database rejects an audit INSERT',
    async () => {
      await seed('before-audit-failure', 'A');
      await seed('audit-failure', 'A');
      await assert.rejects(
        transact('A', async (tx) => {
          await tx.document.delete({ where: { id: 'before-audit-failure' } });
          await tx.document.delete({ where: { id: 'audit-failure' } });
        }),
        /reject_fixture_audit/,
      );
      for (const id of ['before-audit-failure', 'audit-failure']) {
        assert.equal((await document(id)).deleted_at, null);
        assert.deepEqual(await audits(id), []);
      }
    },
  );

  await check('cannot commit when the callback catches an audit INSERT failure', async () => {
    let caught = false;
    await assert.rejects(
      transact('A', async (tx) => {
        await tx.document.delete({ where: { id: 'before-audit-failure' } });
        try {
          await tx.document.delete({ where: { id: 'audit-failure' } });
        } catch (error) {
          assert.match(error.message, /reject_fixture_audit/);
          caught = true;
        }
      }),
      /reject_fixture_audit/,
    );
    assert.equal(caught, true);
    for (const id of ['before-audit-failure', 'audit-failure']) {
      assert.equal((await document(id)).deleted_at, null);
      assert.deepEqual(await audits(id), []);
    }
  });
  console.log(
    JSON.stringify({ packedAuditLifecycleChecks: passed, prisma: Prisma.prismaVersion.client }),
  );
} finally {
  await base.$disconnect();
  try {
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    if (roleCreated) await admin.query(`DROP ROLE ${role}`);
  } finally {
    await admin.end();
  }
}
