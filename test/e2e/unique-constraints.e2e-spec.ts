import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaSoftDeleteExtension } from '../../src';
import {
  cleanData,
  createBasePrisma,
  createTables,
  dropTables,
} from './setup-helpers';

describe('active-row unique constraints (e2e)', () => {
  let basePrisma: ReturnType<typeof createBasePrisma>;
  let client: any;

  beforeAll(async () => {
    basePrisma = createBasePrisma();
    await dropTables(basePrisma);
    await createTables(basePrisma);

    await basePrisma.$executeRawUnsafe(
      'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key',
    );
    await basePrisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS users_email_active_unique',
    );
    await basePrisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX users_email_active_unique ON users (email) WHERE deleted_at IS NULL',
    );

    client = basePrisma.$extends(
      createPrismaSoftDeleteExtension({
        softDeleteModels: ['User'],
        deletedAtField: 'deletedAt',
      }),
    );
  });

  beforeEach(async () => {
    await cleanData(basePrisma);
  });

  afterAll(async () => {
    await basePrisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS users_email_active_unique',
    );
    await dropTables(basePrisma);
    await basePrisma.$disconnect();
  });

  it('allows reusing a unique value after the original row is soft-deleted', async () => {
    const email = 'reuse@example.com';

    const first = await client.user.create({
      data: {
        email,
        name: 'First User',
      },
    });

    await expect(
      client.user.create({
        data: {
          email,
          name: 'Duplicate Active User',
        },
      }),
    ).rejects.toThrow();

    await client.user.delete({
      where: {
        id: first.id,
      },
    });

    const second = await client.user.create({
      data: {
        email,
        name: 'Second Active User',
      },
    });

    const activeUsers = await client.user.findMany({
      where: {
        email,
      },
    });

    const allRows = await basePrisma.user.findMany({
      where: {
        email,
      },
      orderBy: {
        name: 'asc',
      },
    });

    expect(second.id).not.toBe(first.id);
    expect(activeUsers).toHaveLength(1);
    expect(activeUsers[0].id).toBe(second.id);
    expect(allRows).toHaveLength(2);
    expect(allRows.find((row) => row.id === first.id)?.deletedAt).toBeInstanceOf(Date);
    expect(allRows.find((row) => row.id === second.id)?.deletedAt).toBeNull();
  });
});
