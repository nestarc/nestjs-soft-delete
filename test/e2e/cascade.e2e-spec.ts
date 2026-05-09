/**
 * E2E tests for cascade soft-delete and cascade restore.
 *
 * Verifies:
 *   - Multi-level cascade soft-delete (User → Post → Comment)
 *   - All cascaded rows share the parent's deletedAt timestamp
 *   - maxCascadeDepth bounds recursion
 *   - Cascade restore uses ±1s timestamp matching
 *   - Children deleted outside the ±1s window are NOT restored
 *   - Pre-existing soft-deleted children are not re-cascaded
 *   - deleteMany also triggers cascade
 *
 * Prerequisites: see setup-helpers.ts.
 */
import { Prisma, PrismaClient } from '../generated/client';
import { createPrismaSoftDeleteExtension } from '../../src/prisma/soft-delete-extension';
import {
  cleanData,
  createBasePrisma,
  createTables,
  dropTables,
} from './setup-helpers';

const prismaDmmf = (Prisma as any).dmmf;

function extendClient(
  client: PrismaClient,
  cascade: Record<string, string[]>,
  maxCascadeDepth?: number,
) {
  return client.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post', 'Comment'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
      cascade,
      maxCascadeDepth,
      dmmf: prismaDmmf,
    }),
  );
}

let basePrisma: PrismaClient;
let prisma: ReturnType<typeof extendClient>;

beforeAll(async () => {
  basePrisma = createBasePrisma();
  await basePrisma.$connect();
  await createTables(basePrisma);
  prisma = extendClient(basePrisma, {
    User: ['Post'],
    Post: ['Comment'],
  });
});

afterAll(async () => {
  await dropTables(basePrisma);
  await basePrisma.$disconnect();
});

beforeEach(async () => {
  await cleanData(basePrisma);
});

async function createTree(): Promise<{
  user: { id: string };
  post1: { id: string };
  post2: { id: string };
  comment1a: { id: string };
  comment1b: { id: string };
  comment2: { id: string };
}> {
  const user = await prisma.user.create({
    data: { email: 'alice@test.com', name: 'Alice' },
  });
  const post1 = await prisma.post.create({
    data: { title: 'Post 1', authorId: user.id },
  });
  const post2 = await prisma.post.create({
    data: { title: 'Post 2', authorId: user.id },
  });
  const comment1a = await prisma.comment.create({
    data: { content: '1a', postId: post1.id },
  });
  const comment1b = await prisma.comment.create({
    data: { content: '1b', postId: post1.id },
  });
  const comment2 = await prisma.comment.create({
    data: { content: '2', postId: post2.id },
  });
  return { user, post1, post2, comment1a, comment1b, comment2 };
}

async function rawDeletedAt(table: string, id: string): Promise<Date | null> {
  const rows = await basePrisma.$queryRawUnsafe<{ deleted_at: Date | null }[]>(
    `SELECT deleted_at FROM ${table} WHERE id = $1::uuid`,
    id,
  );
  return rows[0]?.deleted_at ?? null;
}

describe('Cascade soft-delete E2E', () => {
  describe('cascadeSoftDelete', () => {
    it('cascades to direct children when User is deleted', async () => {
      const tree = await createTree();

      const deleted = await prisma.user.delete({ where: { id: tree.user.id } });
      expect(deleted.deletedAt).toBeInstanceOf(Date);

      const post1At = await rawDeletedAt('posts', tree.post1.id);
      const post2At = await rawDeletedAt('posts', tree.post2.id);
      expect(post1At).toBeInstanceOf(Date);
      expect(post2At).toBeInstanceOf(Date);
    });

    it('cascades through multiple levels (User → Post → Comment)', async () => {
      const tree = await createTree();

      await prisma.user.delete({ where: { id: tree.user.id } });

      for (const id of [tree.comment1a.id, tree.comment1b.id, tree.comment2.id]) {
        const at = await rawDeletedAt('comments', id);
        expect(at).toBeInstanceOf(Date);
      }
    });

    it('uses the same deletedAt timestamp across the cascade tree', async () => {
      const tree = await createTree();

      const deleted = await prisma.user.delete({ where: { id: tree.user.id } });
      const userAt = deleted.deletedAt!;

      const ids = [
        ['posts', tree.post1.id],
        ['posts', tree.post2.id],
        ['comments', tree.comment1a.id],
        ['comments', tree.comment1b.id],
        ['comments', tree.comment2.id],
      ] as const;

      for (const [table, id] of ids) {
        const at = await rawDeletedAt(table, id);
        expect(at?.getTime()).toBe(userAt.getTime());
      }
    });

    it('does not re-cascade rows that are already soft-deleted', async () => {
      const tree = await createTree();

      // Soft-delete a single post BEFORE cascading from User
      const oldDeletedAt = new Date(Date.now() - 60_000);
      await basePrisma.$executeRawUnsafe(
        `UPDATE posts SET deleted_at = $1 WHERE id = $2::uuid`,
        oldDeletedAt,
        tree.post1.id,
      );

      // Now soft-delete the User — cascade should NOT touch post1's existing timestamp
      await prisma.user.delete({ where: { id: tree.user.id } });

      const post1At = await rawDeletedAt('posts', tree.post1.id);
      expect(post1At?.getTime()).toBe(oldDeletedAt.getTime());

      const post2At = await rawDeletedAt('posts', tree.post2.id);
      expect(post2At?.getTime()).not.toBe(oldDeletedAt.getTime());
    });

    it('respects maxCascadeDepth=1 by stopping after first level', async () => {
      const shallow = extendClient(
        basePrisma,
        { User: ['Post'], Post: ['Comment'] },
        1,
      );

      const tree = await createTree();
      await shallow.user.delete({ where: { id: tree.user.id } });

      // Posts should be soft-deleted (depth 0 → cascade to depth 1 children)
      expect(await rawDeletedAt('posts', tree.post1.id)).toBeInstanceOf(Date);

      // Comments should NOT be (depth 1 recursion checks depth >= 1 → returns)
      expect(await rawDeletedAt('comments', tree.comment1a.id)).toBeNull();
      expect(await rawDeletedAt('comments', tree.comment1b.id)).toBeNull();
    });

    it('cascades for deleteMany as well', async () => {
      const user1 = await prisma.user.create({
        data: { email: 'u1@test.com', name: 'U1' },
      });
      const user2 = await prisma.user.create({
        data: { email: 'u2@test.com', name: 'U2' },
      });
      const post1 = await prisma.post.create({
        data: { title: 'P1', authorId: user1.id },
      });
      const post2 = await prisma.post.create({
        data: { title: 'P2', authorId: user2.id },
      });

      const result = await prisma.user.deleteMany({
        where: { name: { in: ['U1', 'U2'] } },
      });
      expect(result.count).toBe(2);

      expect(await rawDeletedAt('posts', post1.id)).toBeInstanceOf(Date);
      expect(await rawDeletedAt('posts', post2.id)).toBeInstanceOf(Date);
    });
  });

});

// cascadeRestore is covered end-to-end via SoftDeleteService.restore() in
// purge.e2e-spec.ts, including the timestamp window boundary.
