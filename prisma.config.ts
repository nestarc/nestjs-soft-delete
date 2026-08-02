import { defineConfig } from 'prisma/config';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/soft_delete_test';

export default defineConfig({
  schema: 'test/prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
