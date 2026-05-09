/**
 * Shared e2e test helpers.
 *
 * Manages PostgreSQL connection, table lifecycle, and per-test cleanup
 * for all *.e2e-spec.ts files. Uses raw SQL so tests work without
 * running prisma migrate.
 */
import type { DynamicModule, Provider } from '@nestjs/common';
import { PrismaClient } from '../generated/client';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/soft_delete_test';

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,
    author_id  UUID NOT NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content    TEXT NOT NULL,
    post_id    UUID NOT NULL REFERENCES posts(id),
    deleted_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token      TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

const DROP_TABLES = [
  'DROP TABLE IF EXISTS comments CASCADE',
  'DROP TABLE IF EXISTS posts CASCADE',
  'DROP TABLE IF EXISTS sessions CASCADE',
  'DROP TABLE IF EXISTS users CASCADE',
];

const CLEAN_TABLES = [
  'DELETE FROM comments',
  'DELETE FROM posts',
  'DELETE FROM sessions',
  'DELETE FROM users',
];

export async function createTables(prisma: PrismaClient): Promise<void> {
  for (const sql of CREATE_TABLES) {
    await prisma.$executeRawUnsafe(sql);
  }
}

export async function dropTables(prisma: PrismaClient): Promise<void> {
  for (const sql of DROP_TABLES) {
    await prisma.$executeRawUnsafe(sql);
  }
}

export async function cleanData(prisma: PrismaClient): Promise<void> {
  for (const sql of CLEAN_TABLES) {
    await prisma.$executeRawUnsafe(sql);
  }
}

export function createBasePrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: DATABASE_URL });
}

class E2eProviderModule {}

function providerToken(provider: Provider): unknown {
  return typeof provider === 'function' ? provider : provider.provide;
}

export function createE2eProviderModule(
  providers: Provider[],
  imports: NonNullable<DynamicModule['imports']> = [],
): DynamicModule {
  return {
    module: E2eProviderModule,
    global: true,
    imports,
    providers,
    exports: providers.map(providerToken),
  };
}
