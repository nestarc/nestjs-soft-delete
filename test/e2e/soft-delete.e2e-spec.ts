/**
 * E2E tests for @nestarc/soft-delete Prisma extension.
 *
 * Prerequisites:
 *   1. docker-compose up -d  (PostgreSQL on localhost:5432)
 *   2. DATABASE_URL=postgresql://test:test@localhost:5432/soft_delete_test
 *   3. npx prisma generate --schema=test/prisma/schema.prisma
 *   4. npx vitest run --config vitest.e2e.config.ts
 *
 * These tests use raw SQL for table setup/teardown so they work
 * without running prisma migrate.
 */
import { PrismaClient } from '../generated/client';
import { createPrismaSoftDeleteExtension } from '../../src/prisma/soft-delete-extension';
import { SoftDeleteContext } from '../../src/services/soft-delete-context';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/soft_delete_test';

// ── Raw SQL helpers ──────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT
  );

  CREATE TABLE IF NOT EXISTS posts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,
    author_id  UUID NOT NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content    TEXT NOT NULL,
    post_id    UUID NOT NULL REFERENCES posts(id),
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token      TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const DROP_TABLES_SQL = `
  DROP TABLE IF EXISTS comments CASCADE;
  DROP TABLE IF EXISTS posts CASCADE;
  DROP TABLE IF EXISTS sessions CASCADE;
  DROP TABLE IF EXISTS users CASCADE;
`;

// ── Setup ────────────────────────────────────────────────────────────

let basePrisma: PrismaClient;
let prisma: ReturnType<typeof extendClient>;

function extendClient(client: PrismaClient) {
  const extension = createPrismaSoftDeleteExtension({
    softDeleteModels: ['User', 'Post', 'Comment'],
    deletedAtField: 'deletedAt',
    deletedByField: 'deletedBy',
  });
  return client.$extends(extension);
}

beforeAll(async () => {
  basePrisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  await basePrisma.$connect();
  await basePrisma.$executeRawUnsafe(CREATE_TABLES_SQL);
  prisma = extendClient(basePrisma);
});

afterAll(async () => {
  await basePrisma.$executeRawUnsafe(DROP_TABLES_SQL);
  await basePrisma.$disconnect();
});

beforeEach(async () => {
  // Clean data between tests (order matters for FK constraints)
  await basePrisma.$executeRawUnsafe('DELETE FROM comments');
  await basePrisma.$executeRawUnsafe('DELETE FROM posts');
  await basePrisma.$executeRawUnsafe('DELETE FROM sessions');
  await basePrisma.$executeRawUnsafe('DELETE FROM users');
});

// ── Tests ────────────────────────────────────────────────────────────

describe('Soft-delete E2E with PostgreSQL', () => {
  // ── 1. Soft delete ────────────────────────────────────────────────

  describe('soft delete', () => {
    it('should set deletedAt timestamp instead of physically deleting', async () => {
      const user = await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });

      const deleted = await prisma.user.delete({
        where: { id: user.id },
      });

      expect(deleted.deletedAt).toBeInstanceOf(Date);

      // The row should still exist in the database
      const raw = await basePrisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM users WHERE id = $1`,
        user.id,
      );
      expect(raw).toHaveLength(1);
      expect(raw[0].deleted_at).toBeTruthy();
    });

    it('should exclude soft-deleted records from findMany', async () => {
      await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });
      const bob = await prisma.user.create({
        data: { email: 'bob@test.com', name: 'Bob' },
      });

      await prisma.user.delete({ where: { id: bob.id } });

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('alice@test.com');
    });
  });

  // ── 2. Query filtering ───────────────────────────────────────────

  describe('query filtering', () => {
    it('should exclude soft-deleted records from count', async () => {
      await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });
      const bob = await prisma.user.create({
        data: { email: 'bob@test.com', name: 'Bob' },
      });

      await prisma.user.delete({ where: { id: bob.id } });

      const count = await prisma.user.count();
      expect(count).toBe(1);
    });

    it('should exclude soft-deleted records from findFirst', async () => {
      const alice = await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });
      await prisma.user.delete({ where: { id: alice.id } });

      const found = await prisma.user.findFirst({
        where: { email: 'alice@test.com' },
      });
      expect(found).toBeNull();
    });
  });

  // ── 3. withDeleted context ───────────────────────────────────────

  describe('withDeleted context', () => {
    it('should include soft-deleted records when withDeleted is active', async () => {
      await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });
      const bob = await prisma.user.create({
        data: { email: 'bob@test.com', name: 'Bob' },
      });

      await prisma.user.delete({ where: { id: bob.id } });

      const users = await SoftDeleteContext.run(
        { filterMode: 'withDeleted', skipSoftDelete: false },
        () => prisma.user.findMany(),
      );

      expect(users).toHaveLength(2);
    });
  });

  // ── 4. onlyDeleted context ──────────────────────────────────────

  describe('onlyDeleted context', () => {
    it('should return only soft-deleted records when onlyDeleted is active', async () => {
      await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });
      const bob = await prisma.user.create({
        data: { email: 'bob@test.com', name: 'Bob' },
      });

      await prisma.user.delete({ where: { id: bob.id } });

      const users = await SoftDeleteContext.run(
        { filterMode: 'onlyDeleted', skipSoftDelete: false },
        () => prisma.user.findMany(),
      );

      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('bob@test.com');
      expect(users[0].deletedAt).toBeInstanceOf(Date);
    });
  });

  // ── 5. Non-soft-delete model passthrough ─────────────────────────

  describe('non-soft-delete model passthrough', () => {
    it('should physically delete Session records (not in softDeleteModels)', async () => {
      const session = await prisma.session.create({
        data: { token: 'abc-123' },
      });

      await prisma.session.delete({ where: { id: session.id } });

      // Row should be gone from the database entirely
      const raw = await basePrisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM sessions WHERE id = $1`,
        session.id,
      );
      expect(raw).toHaveLength(0);
    });
  });

  // ── 6. deletedBy with actorId ────────────────────────────────────

  describe('deletedBy with actorId', () => {
    it('should set deletedBy field when actorId is in context', async () => {
      const user = await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });

      const deleted = await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-user-1' },
        () => prisma.user.delete({ where: { id: user.id } }),
      );

      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(deleted.deletedBy).toBe('admin-user-1');
    });

    it('should leave deletedBy null when no actorId in context', async () => {
      const user = await prisma.user.create({
        data: { email: 'bob@test.com', name: 'Bob' },
      });

      const deleted = await prisma.user.delete({
        where: { id: user.id },
      });

      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(deleted.deletedBy).toBeNull();
    });
  });

  // ── 7. deleteMany ────────────────────────────────────────────────

  describe('deleteMany', () => {
    it('should convert deleteMany to updateMany setting deletedAt', async () => {
      await prisma.user.create({
        data: { email: 'alice@test.com', name: 'Alice' },
      });
      await prisma.user.create({
        data: { email: 'bob@test.com', name: 'Bob' },
      });
      await prisma.user.create({
        data: { email: 'charlie@test.com', name: 'Charlie' },
      });

      const result = await prisma.user.deleteMany({
        where: { name: { in: ['Alice', 'Bob'] } },
      });

      expect(result.count).toBe(2);

      // Soft-deleted records hidden from default queries
      const visibleUsers = await prisma.user.findMany();
      expect(visibleUsers).toHaveLength(1);
      expect(visibleUsers[0].name).toBe('Charlie');

      // But still in the database
      const allRows = await basePrisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM users ORDER BY name`,
      );
      expect(allRows).toHaveLength(3);
      expect(allRows.filter((r: any) => r.deleted_at !== null)).toHaveLength(2);
    });
  });
});
