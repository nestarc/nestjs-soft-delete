/**
 * Benchmark: Soft-delete extension overhead measurement
 *
 * Compares:
 *   A) findMany — no extension (baseline)
 *   B) findMany — with soft-delete filter (WHERE deleted_at IS NULL)
 *   C) delete — hard delete (baseline)
 *   D) delete — soft delete (UPDATE SET deleted_at)
 *   E) Cascade soft-delete (User → Posts → Comments)
 *
 * Usage:
 *   docker compose up -d
 *   DATABASE_URL=postgresql://test:test@localhost:5432/soft_delete_test \
 *     npx prisma generate --schema=test/prisma/schema.prisma && \
 *     npx ts-node benchmarks/soft-delete-overhead.ts
 */

import { createPrismaSoftDeleteExtension } from '../src/prisma/soft-delete-extension';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://test:test@localhost:5432/soft_delete_test';

const WARMUP = 30;
const ITERATIONS = 300;

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  label: string;
  iterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function analyze(label: string, timings: number[]): BenchResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  return {
    label,
    iterations: sorted.length,
    avgMs: Math.round((total / sorted.length) * 100) / 100,
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

function printResult(r: BenchResult) {
  console.log(`\n${r.label}`);
  console.log(`  Iterations: ${r.iterations}`);
  console.log(
    `  Avg: ${r.avgMs}ms | P50: ${r.p50Ms}ms | P95: ${r.p95Ms}ms | P99: ${r.p99Ms}ms`,
  );
  console.log(`  Min: ${r.minMs}ms | Max: ${r.maxMs}ms`);
}

// ---------------------------------------------------------------------------
// Table setup (same as e2e tests)
// ---------------------------------------------------------------------------

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
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== @nestarc/soft-delete Benchmark ===\n');

  // Dynamic import for generated client
  const { PrismaClient } = require('../test/generated/client');
  const basePrisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  await basePrisma.$connect();

  // Setup tables
  console.log('Setting up database...');
  for (const sql of CREATE_TABLES) {
    await basePrisma.$executeRawUnsafe(sql);
  }

  const softPrisma = basePrisma.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post', 'Comment'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
    }),
  ) as any;

  // Seed: 500 users (half soft-deleted)
  console.log('Seeding 500 users...');
  await basePrisma.$executeRawUnsafe('DELETE FROM comments');
  await basePrisma.$executeRawUnsafe('DELETE FROM posts');
  await basePrisma.$executeRawUnsafe('DELETE FROM users');

  for (let i = 0; i < 500; i++) {
    if (i % 2 === 0) {
      await basePrisma.$executeRawUnsafe(
        `INSERT INTO users (email, name, deleted_at) VALUES ($1, $2, now())`,
        `user-${i}@bench.test`,
        `User ${i}`,
      );
    } else {
      await basePrisma.$executeRawUnsafe(
        `INSERT INTO users (email, name) VALUES ($1, $2)`,
        `user-${i}@bench.test`,
        `User ${i}`,
      );
    }
  }

  // ===================================================================
  // Benchmark A: findMany — no extension (baseline)
  // ===================================================================
  console.log(`\nWarming up A (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await basePrisma.user.findMany();
  }

  console.log(`Running A: findMany without extension (${ITERATIONS} iterations)...`);
  const timingsA: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await basePrisma.user.findMany();
    timingsA.push(performance.now() - start);
  }

  // ===================================================================
  // Benchmark B: findMany — with soft-delete filter
  // ===================================================================
  console.log(`Warming up B (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await softPrisma.user.findMany();
  }

  console.log(`Running B: findMany with soft-delete filter (${ITERATIONS} iterations)...`);
  const timingsB: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await softPrisma.user.findMany();
    timingsB.push(performance.now() - start);
  }

  // ===================================================================
  // Benchmark C & D: delete — hard vs soft
  // ===================================================================
  // Seed fresh users for delete benchmarks
  async function seedForDelete() {
    await basePrisma.$executeRawUnsafe('DELETE FROM comments');
    await basePrisma.$executeRawUnsafe('DELETE FROM posts');
    await basePrisma.$executeRawUnsafe('DELETE FROM users');
    const ids: string[] = [];
    for (let i = 0; i < ITERATIONS + WARMUP; i++) {
      const result: any[] = await basePrisma.$queryRawUnsafe(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        `del-${Date.now()}-${i}@bench.test`,
        `Delete User ${i}`,
      );
      ids.push(result[0].id);
    }
    return ids;
  }

  // C: Hard delete baseline
  let userIds = await seedForDelete();
  console.log(`\nWarming up C (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await basePrisma.user.delete({ where: { id: userIds[i] } });
  }

  console.log(`Running C: hard delete baseline (${ITERATIONS} iterations)...`);
  const timingsC: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await basePrisma.user.delete({ where: { id: userIds[WARMUP + i] } });
    timingsC.push(performance.now() - start);
  }

  // D: Soft delete
  userIds = await seedForDelete();
  console.log(`Warming up D (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await softPrisma.user.delete({ where: { id: userIds[i] } });
  }

  console.log(`Running D: soft delete (${ITERATIONS} iterations)...`);
  const timingsD: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await softPrisma.user.delete({ where: { id: userIds[WARMUP + i] } });
    timingsD.push(performance.now() - start);
  }

  // ===================================================================
  // Benchmark E: Cascade soft-delete (User → Posts → Comments)
  // ===================================================================
  console.log('\nSeeding cascade data...');
  await basePrisma.$executeRawUnsafe('DELETE FROM comments');
  await basePrisma.$executeRawUnsafe('DELETE FROM posts');
  await basePrisma.$executeRawUnsafe('DELETE FROM users');

  const CASCADE_COUNT = 50;
  const cascadeUserIds: string[] = [];

  for (let i = 0; i < CASCADE_COUNT; i++) {
    const userResult: any[] = await basePrisma.$queryRawUnsafe(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      `cascade-${i}@bench.test`,
      `Cascade User ${i}`,
    );
    const userId = userResult[0].id;
    cascadeUserIds.push(userId);

    // 3 posts per user, 2 comments per post
    for (let j = 0; j < 3; j++) {
      const postResult: any[] = await basePrisma.$queryRawUnsafe(
        `INSERT INTO posts (title, author_id) VALUES ($1, $2::uuid) RETURNING id`,
        `Post ${j} by user ${i}`,
        userId,
      );
      for (let k = 0; k < 2; k++) {
        await basePrisma.$executeRawUnsafe(
          `INSERT INTO comments (content, post_id) VALUES ($1, $2::uuid)`,
          `Comment ${k} on post ${j}`,
          postResult[0].id,
        );
      }
    }
  }

  // Recreate extension with cascade config
  const cascadePrisma = basePrisma.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post', 'Comment'],
      deletedAtField: 'deletedAt',
      cascade: {
        User: ['Post'],
        Post: ['Comment'],
      },
    }),
  ) as any;

  console.log(`Running E: cascade soft-delete User→Posts→Comments (${CASCADE_COUNT} iterations)...`);
  const timingsE: number[] = [];
  for (let i = 0; i < CASCADE_COUNT; i++) {
    const start = performance.now();
    await cascadePrisma.user.delete({ where: { id: cascadeUserIds[i] } });
    timingsE.push(performance.now() - start);
  }

  // ===================================================================
  // Results
  // ===================================================================
  const resultA = analyze('A) findMany — no extension (baseline)', timingsA);
  const resultB = analyze('B) findMany — with soft-delete filter', timingsB);
  const resultC = analyze('C) delete — hard delete (baseline)', timingsC);
  const resultD = analyze('D) delete — soft delete', timingsD);
  const resultE = analyze('E) cascade soft-delete (User→3 Posts→6 Comments)', timingsE);

  const filterOverhead = resultB.avgMs - resultA.avgMs;
  const filterPct = ((filterOverhead / resultA.avgMs) * 100).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));

  for (const r of [resultA, resultB, resultC, resultD, resultE]) {
    printResult(r);
  }

  console.log('\n' + '-'.repeat(70));
  console.log(
    `findMany filter overhead (avg): +${filterOverhead.toFixed(2)}ms (+${filterPct}%)`,
  );
  console.log(
    `delete overhead: soft ${resultD.avgMs}ms vs hard ${resultC.avgMs}ms`,
  );
  console.log('-'.repeat(70));

  // Cleanup
  await basePrisma.$executeRawUnsafe('DELETE FROM comments');
  await basePrisma.$executeRawUnsafe('DELETE FROM posts');
  await basePrisma.$executeRawUnsafe('DELETE FROM users');
  await basePrisma.$disconnect();

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
