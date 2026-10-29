import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  // Root and /testing must share class tokens and the AsyncLocalStorage instance.
  splitting: true,
  sourcemap: true,
  clean: true,
  external: [
    '@nestjs/common',
    '@nestjs/core',
    '@prisma/client',
    '@prisma/client/extension',
    'reflect-metadata',
    'rxjs',
    '@nestarc/tenancy',
    '@nestarc/audit-log',
    '@nestjs/event-emitter',
  ],
});
