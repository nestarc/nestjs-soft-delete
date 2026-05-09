/**
 * E2E tests for SoftDeleteService.purge() and SoftDeleteService.restore() / forceDelete().
 *
 * Verifies, against a real PostgreSQL database:
 *   - purge() permanently removes soft-deleted rows older than `olderThan`
 *   - active rows (deletedAt IS NULL) are never purged
 *   - extra `where` is combined with the deletedAt filter
 *   - count return value matches actual rows removed
 *   - restore() un-sets deletedAt and deletedBy
 *   - cascade restore reaches children deleted in the same cascade
 *
 * Prerequisites: see setup-helpers.ts.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '../generated/client';
import { createPrismaSoftDeleteExtension } from '../../src/prisma/soft-delete-extension';
import { SoftDeleteModule } from '../../src/soft-delete.module';
import { SoftDeleteService } from '../../src/services/soft-delete.service';
import {
  cleanData,
  createBasePrisma,
  createE2eProviderModule,
  createTables,
  dropTables,
} from './setup-helpers';

const PRISMA_TOKEN = 'PRISMA_CLIENT';
const prismaDmmf = (Prisma as any).dmmf;

let basePrisma: PrismaClient;
let prisma: ReturnType<typeof extendClient>;
let module: TestingModule;
let softDelete: SoftDeleteService;

function extendClient(client: PrismaClient) {
  return client.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post', 'Comment'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
      cascade: { User: ['Post'], Post: ['Comment'] },
      dmmf: prismaDmmf,
    }),
  );
}

beforeAll(async () => {
  basePrisma = createBasePrisma();
  await basePrisma.$connect();
  await createTables(basePrisma);
  prisma = extendClient(basePrisma);

  const providerModule = createE2eProviderModule([
    { provide: PRISMA_TOKEN, useFactory: () => prisma },
  ]);

  module = await Test.createTestingModule({
    imports: [
      providerModule,
      SoftDeleteModule.forRootAsync({
        imports: [providerModule],
        prismaServiceToken: PRISMA_TOKEN,
        useFactory: () => ({
          softDeleteModels: ['User', 'Post', 'Comment'],
          deletedAtField: 'deletedAt',
          deletedByField: 'deletedBy',
          cascade: { User: ['Post'], Post: ['Comment'] },
          prismaServiceToken: PRISMA_TOKEN,
          dmmf: prismaDmmf,
        }),
      }),
    ],
  }).compile();

  softDelete = module.get(SoftDeleteService);
});

afterAll(async () => {
  await module?.close();
  await dropTables(basePrisma);
  await basePrisma.$disconnect();
});

beforeEach(async () => {
  await cleanData(basePrisma);
});

async function rawCount(table: string): Promise<number> {
  const rows = await basePrisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM ${table}`,
  );
  return Number(rows[0].count);
}

async function rawDeletedAt(table: string, id: string): Promise<Date | null> {
  const rows = await basePrisma.$queryRawUnsafe<{ deleted_at: Date | null }[]>(
    `SELECT deleted_at FROM ${table} WHERE id = $1::uuid`,
    id,
  );
  return rows[0]?.deleted_at ?? null;
}

describe('SoftDeleteService E2E', () => {
  describe('purge', () => {
    it('hard-deletes soft-deleted rows older than the cutoff', async () => {
      const oldUser = await prisma.user.create({
        data: { email: 'old@test.com', name: 'Old' },
      });
      const newUser = await prisma.user.create({
        data: { email: 'new@test.com', name: 'New' },
      });
      const activeUser = await prisma.user.create({
        data: { email: 'active@test.com', name: 'Active' },
      });

      // Soft-delete with a backdated timestamp by direct SQL — bypasses extension
      const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days
      await basePrisma.$executeRawUnsafe(
        `UPDATE users SET deleted_at = $1 WHERE id = $2::uuid`,
        longAgo,
        oldUser.id,
      );
      // newUser was soft-deleted 1 day ago — within retention
      const recently = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      await basePrisma.$executeRawUnsafe(
        `UPDATE users SET deleted_at = $1 WHERE id = $2::uuid`,
        recently,
        newUser.id,
      );

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
      const result = await softDelete.purge('User', { olderThan: cutoff });

      expect(result.count).toBe(1);

      // oldUser is gone, newUser still soft-deleted, activeUser untouched
      expect(await rawDeletedAt('users', oldUser.id)).toBeNull();
      const oldExists = await basePrisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM users WHERE id = $1::uuid`,
        oldUser.id,
      );
      expect(oldExists).toHaveLength(0);

      const newRow = await rawDeletedAt('users', newUser.id);
      expect(newRow?.getTime()).toBe(recently.getTime());

      const activeRow = await rawDeletedAt('users', activeUser.id);
      expect(activeRow).toBeNull();
    });

    it('never touches active rows (deletedAt IS NULL)', async () => {
      await prisma.user.create({ data: { email: 'a@test.com', name: 'A' } });
      await prisma.user.create({ data: { email: 'b@test.com', name: 'B' } });

      const future = new Date(Date.now() + 60 * 60 * 1000);
      const result = await softDelete.purge('User', { olderThan: future });

      expect(result.count).toBe(0);
      expect(await rawCount('users')).toBe(2);
    });

    it('combines an extra `where` clause with the deletedAt filter', async () => {
      const u1 = await prisma.user.create({
        data: { email: 'guest1@test.com', name: 'guest' },
      });
      const u2 = await prisma.user.create({
        data: { email: 'admin@test.com', name: 'admin' },
      });

      const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      await basePrisma.$executeRawUnsafe(
        `UPDATE users SET deleted_at = $1 WHERE id IN ($2::uuid, $3::uuid)`,
        longAgo,
        u1.id,
        u2.id,
      );

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await softDelete.purge('User', {
        olderThan: cutoff,
        where: { name: 'guest' },
      });

      expect(result.count).toBe(1);

      // admin still soft-deleted
      const adminRow = await rawDeletedAt('users', u2.id);
      expect(adminRow?.getTime()).toBe(longAgo.getTime());
    });

    it('returns count: 0 when nothing matches', async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await softDelete.purge('User', { olderThan: cutoff });
      expect(result.count).toBe(0);
    });
  });

  describe('restore', () => {
    it('clears deletedAt and deletedBy, returning the active row', async () => {
      const user = await prisma.user.create({
        data: { email: 'r@test.com', name: 'R' },
      });
      await prisma.user.delete({ where: { id: user.id } });

      const restored = await softDelete.restore('User', { id: user.id });
      expect(restored.deletedAt).toBeNull();
      expect(restored.deletedBy).toBeNull();

      const found = await prisma.user.findUnique({ where: { id: user.id } });
      expect(found?.deletedAt).toBeNull();
    });

    it('cascade-restores children that were deleted by the same cascade', async () => {
      const user = await prisma.user.create({
        data: { email: 'rc@test.com', name: 'RC' },
      });
      const post = await prisma.post.create({
        data: { title: 'p', authorId: user.id },
      });
      const comment = await prisma.comment.create({
        data: { content: 'c', postId: post.id },
      });

      await prisma.user.delete({ where: { id: user.id } });
      // sanity: cascade soft-delete worked
      expect(await rawDeletedAt('posts', post.id)).toBeInstanceOf(Date);
      expect(await rawDeletedAt('comments', comment.id)).toBeInstanceOf(Date);

      await softDelete.restore('User', { id: user.id });

      expect(await rawDeletedAt('users', user.id)).toBeNull();
      expect(await rawDeletedAt('posts', post.id)).toBeNull();
      expect(await rawDeletedAt('comments', comment.id)).toBeNull();
    });

    it('does not cascade-restore children deleted outside the parent timestamp window', async () => {
      const user = await prisma.user.create({
        data: { email: 'window@test.com', name: 'Window' },
      });
      const post = await prisma.post.create({
        data: { title: 'old deletion', authorId: user.id },
      });

      const oldDeletedAt = new Date(Date.now() - 60_000);
      await basePrisma.$executeRawUnsafe(
        `UPDATE posts SET deleted_at = $1 WHERE id = $2::uuid`,
        oldDeletedAt,
        post.id,
      );

      await prisma.user.delete({ where: { id: user.id } });
      await softDelete.restore('User', { id: user.id });

      expect(await rawDeletedAt('users', user.id)).toBeNull();
      expect((await rawDeletedAt('posts', post.id))?.getTime()).toBe(
        oldDeletedAt.getTime(),
      );
    });

    it('throws when the record is not found', async () => {
      await expect(
        softDelete.restore('User', {
          id: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(/not found/i);
    });
  });
});
