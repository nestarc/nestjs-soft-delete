import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    '@nestjs/common',
    '@nestjs/core',
    '@prisma/client',
    'reflect-metadata',
    'rxjs',
    '@nestarc/tenancy',
    '@nestarc/audit-log',
  ],
});
