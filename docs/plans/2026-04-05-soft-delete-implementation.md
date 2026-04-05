# @nestarc/soft-delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** NestJS + Prisma + PostgreSQL 환경을 위한 소프트 삭제 모듈 구현. Prisma extension으로 delete를 자동 인터셉트하고, 모든 조회에서 삭제된 레코드를 필터링하며, cascade soft-delete/restore를 지원한다.

**Architecture:** Bottom-up 접근. 먼저 NestJS 의존 없이 동작하는 순수 Prisma extension 코어를 구현하고, 그 위에 NestJS DynamicModule, 데코레이터, 인터셉터 레이어를 쌓는다. AsyncLocalStorage로 요청 스코프 filter mode를 관리한다.

**Tech Stack:** TypeScript, NestJS 10/11, Prisma 5/6, PostgreSQL, tsup (build), vitest (test), Docker (E2E)

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.prettierrc`
- Create: `.eslintrc.js`

**Step 1: Initialize package.json**

```json
{
  "name": "@nestarc/soft-delete",
  "version": "0.1.0",
  "description": "Prisma soft-delete extension for NestJS with automatic query filtering, cascade support, and restore API",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "import": "./dist/testing/index.mjs",
      "require": "./dist/testing/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "lint": "eslint \"src/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\""
  },
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@nestarc/tenancy": { "optional": true },
    "@nestarc/audit-log": { "optional": true }
  },
  "devDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@prisma/client": "^6.0.0",
    "prisma": "^6.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "typescript": "^5.7.0",
    "tsup": "^8.0.0",
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "prettier": "^3.0.0"
  },
  "files": ["dist"],
  "license": "MIT"
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "moduleResolution": "node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "resolveJsonModule": true,
    "incremental": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts", "**/*.test.ts"]
}
```

**Step 3: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts", "**/*.test.ts", "**/*.e2e-spec.ts"]
}
```

**Step 4: Create tsup.config.ts**

```typescript
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
```

**Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/testing/**'],
    },
  },
});
```

**Step 6: Create .prettierrc**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

**Step 7: Install dependencies**

Run: `npm install`
Expected: node_modules created, no errors

**Step 8: Verify build setup**

Create a placeholder `src/index.ts`:
```typescript
export const VERSION = '0.1.0';
```

Run: `npx tsup`
Expected: dist/ generated with index.js, index.mjs, index.d.ts

**Step 9: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json tsup.config.ts vitest.config.ts .prettierrc src/index.ts
git commit -m "chore: scaffold project with npm, tsup, vitest"
```

---

## Task 2: Interfaces & Constants

**Files:**
- Create: `src/soft-delete.constants.ts`
- Create: `src/interfaces/soft-delete-options.interface.ts`
- Create: `src/interfaces/soft-delete-context.interface.ts`

**Step 1: Create constants**

```typescript
// src/soft-delete.constants.ts
export const SOFT_DELETE_MODULE_OPTIONS = Symbol('SOFT_DELETE_MODULE_OPTIONS');
export const WITH_DELETED_KEY = 'SOFT_DELETE_WITH_DELETED';
export const ONLY_DELETED_KEY = 'SOFT_DELETE_ONLY_DELETED';
export const SKIP_SOFT_DELETE_KEY = 'SOFT_DELETE_SKIP';
export const DEFAULT_DELETED_AT_FIELD = 'deletedAt';
export const DEFAULT_MAX_CASCADE_DEPTH = 3;
```

**Step 2: Create options interface**

```typescript
// src/interfaces/soft-delete-options.interface.ts
import { ModuleMetadata, Type } from '@nestjs/common';

export interface SoftDeleteModuleOptions {
  /** Models to apply soft-delete (whitelist) */
  softDeleteModels: string[];

  /** Name of the deletedAt field (default: 'deletedAt') */
  deletedAtField?: string;

  /** Name of the deletedBy field (optional, null = disabled) */
  deletedByField?: string | null;

  /** Extract actor ID from request (required when deletedByField is set) */
  actorExtractor?: (req: any) => string | null;

  /** Cascade soft-delete relations: { ParentModel: ['ChildModel1', 'ChildModel2'] } */
  cascade?: Record<string, string[]>;

  /** Maximum cascade depth (default: 3) */
  maxCascadeDepth?: number;
}

export interface SoftDeleteModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: any[]) => Promise<SoftDeleteModuleOptions> | SoftDeleteModuleOptions;
  inject?: any[];
}

/** Options for standalone Prisma extension (no NestJS) */
export interface SoftDeleteExtensionOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
}
```

**Step 3: Create context interface**

```typescript
// src/interfaces/soft-delete-context.interface.ts
export type SoftDeleteFilterMode = 'default' | 'withDeleted' | 'onlyDeleted';

export interface SoftDeleteStore {
  filterMode: SoftDeleteFilterMode;
  skipSoftDelete: boolean;
  actorId?: string | null;
}
```

**Step 4: Commit**

```bash
git add src/soft-delete.constants.ts src/interfaces/
git commit -m "feat: add interfaces and constants for soft-delete module"
```

---

## Task 3: SoftDeleteContext (AsyncLocalStorage)

**Files:**
- Create: `src/services/soft-delete-context.ts`
- Create: `src/services/soft-delete-context.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/services/soft-delete-context.spec.ts
import { describe, it, expect } from 'vitest';
import { SoftDeleteContext } from './soft-delete-context';

describe('SoftDeleteContext', () => {
  it('should return "default" filter mode when no context is set', () => {
    expect(SoftDeleteContext.getFilterMode()).toBe('default');
  });

  it('should return false for isSkipped when no context is set', () => {
    expect(SoftDeleteContext.isSkipped()).toBe(false);
  });

  it('should set and get filter mode within run()', () => {
    SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('withDeleted');
      },
    );
  });

  it('should set and get onlyDeleted filter mode', () => {
    SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('onlyDeleted');
      },
    );
  });

  it('should set and get skipSoftDelete flag', () => {
    SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: true },
      () => {
        expect(SoftDeleteContext.isSkipped()).toBe(true);
      },
    );
  });

  it('should store and retrieve actorId', () => {
    SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: false, actorId: 'user-123' },
      () => {
        expect(SoftDeleteContext.getActorId()).toBe('user-123');
      },
    );
  });

  it('should return null actorId when not set', () => {
    expect(SoftDeleteContext.getActorId()).toBeNull();
  });

  it('should isolate contexts between nested runs', () => {
    SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('withDeleted');

        SoftDeleteContext.run(
          { filterMode: 'onlyDeleted', skipSoftDelete: true },
          () => {
            expect(SoftDeleteContext.getFilterMode()).toBe('onlyDeleted');
            expect(SoftDeleteContext.isSkipped()).toBe(true);
          },
        );

        // Outer context restored
        expect(SoftDeleteContext.getFilterMode()).toBe('withDeleted');
        expect(SoftDeleteContext.isSkipped()).toBe(false);
      },
    );
  });

  it('should support async callbacks', async () => {
    const result = await SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      async () => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));
        return SoftDeleteContext.getFilterMode();
      },
    );
    expect(result).toBe('withDeleted');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/soft-delete-context.spec.ts`
Expected: FAIL — module not found

**Step 3: Implement SoftDeleteContext**

```typescript
// src/services/soft-delete-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SoftDeleteFilterMode, SoftDeleteStore } from '../interfaces/soft-delete-context.interface';

export class SoftDeleteContext {
  private static storage = new AsyncLocalStorage<SoftDeleteStore>();

  static run<T>(store: SoftDeleteStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  static getFilterMode(): SoftDeleteFilterMode {
    return this.storage.getStore()?.filterMode ?? 'default';
  }

  static isSkipped(): boolean {
    return this.storage.getStore()?.skipSoftDelete ?? false;
  }

  static getActorId(): string | null {
    return this.storage.getStore()?.actorId ?? null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/soft-delete-context.spec.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/services/soft-delete-context.ts src/services/soft-delete-context.spec.ts
git commit -m "feat: implement SoftDeleteContext with AsyncLocalStorage"
```

---

## Task 4: Error Classes

**Files:**
- Create: `src/errors/soft-delete-field-missing.error.ts`
- Create: `src/errors/cascade-relation-not-found.error.ts`
- Create: `src/errors/soft-delete-errors.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/errors/soft-delete-errors.spec.ts
import { describe, it, expect } from 'vitest';
import { SoftDeleteFieldMissingError } from './soft-delete-field-missing.error';
import { CascadeRelationNotFoundError } from './cascade-relation-not-found.error';

describe('SoftDeleteFieldMissingError', () => {
  it('should include model name and field name in message', () => {
    const error = new SoftDeleteFieldMissingError('User', 'deletedAt');
    expect(error.message).toContain('User');
    expect(error.message).toContain('deletedAt');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('CascadeRelationNotFoundError', () => {
  it('should include parent and child model names in message', () => {
    const error = new CascadeRelationNotFoundError('User', 'Post');
    expect(error.message).toContain('User');
    expect(error.message).toContain('Post');
    expect(error).toBeInstanceOf(Error);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/errors/soft-delete-errors.spec.ts`
Expected: FAIL

**Step 3: Implement error classes**

```typescript
// src/errors/soft-delete-field-missing.error.ts
export class SoftDeleteFieldMissingError extends Error {
  constructor(model: string, field: string) {
    super(
      `Model "${model}" is listed in softDeleteModels but does not have a "${field}" field. ` +
      `Add "${field} DateTime? @map("${field.replace(/([A-Z])/g, '_$1').toLowerCase()}")" to your Prisma schema.`,
    );
    this.name = 'SoftDeleteFieldMissingError';
  }
}
```

```typescript
// src/errors/cascade-relation-not-found.error.ts
export class CascadeRelationNotFoundError extends Error {
  constructor(parent: string, child: string) {
    super(
      `Cannot find a relation from "${child}" to "${parent}" in Prisma DMMF. ` +
      `Ensure "${child}" has a @relation field pointing to "${parent}".`,
    );
    this.name = 'CascadeRelationNotFoundError';
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/errors/soft-delete-errors.spec.ts`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add src/errors/
git commit -m "feat: add SoftDeleteFieldMissingError and CascadeRelationNotFoundError"
```

---

## Task 5: Prisma Soft-Delete Extension — Write Operations

**Files:**
- Create: `src/prisma/soft-delete-extension.ts`
- Create: `src/prisma/soft-delete-extension.spec.ts`

This is the core of the module. We implement it in two parts: write interception (this task) and read filtering (next task).

**Step 1: Write failing tests for delete interception**

```typescript
// src/prisma/soft-delete-extension.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaSoftDeleteExtension } from './soft-delete-extension';
import { SoftDeleteContext } from '../services/soft-delete-context';

// Mock Prisma client structure for testing
function createMockPrismaClient(models: string[]) {
  const operations: Record<string, any> = {};

  // Build a mock that simulates Prisma's $extends behavior
  // We test the extension config functions directly
  const extensionConfig = createPrismaSoftDeleteExtension({
    softDeleteModels: models,
    deletedAtField: 'deletedAt',
  });

  return extensionConfig;
}

describe('createPrismaSoftDeleteExtension — write operations', () => {
  it('should return a valid Prisma extension config object', () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
    });
    expect(ext).toBeDefined();
    expect(ext).toHaveProperty('query');
  });

  it('should intercept delete on soft-delete models and convert to update', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    // Simulate Prisma query callback
    const mockQuery = vi.fn().mockResolvedValue({ id: '1', deletedAt: expect.any(Date) });
    const queryFns = ext.query as any;

    // The extension should define a $allOperations or per-model handler
    // We test the handler function with a mock query
    const args = { where: { id: '1' } };

    // Get the handler for User model delete
    const handler = queryFns.user?.delete ?? queryFns.$allModels?.delete;
    expect(handler).toBeDefined();

    await handler({ model: 'User', operation: 'delete', args, query: mockQuery });

    // Should NOT have called the original delete query
    // Instead should have performed an update with deletedAt
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
        where: { id: '1' },
      }),
    );
  });

  it('should intercept deleteMany on soft-delete models', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue({ count: 3 });
    const queryFns = ext.query as any;

    const handler = queryFns.$allModels?.deleteMany;
    expect(handler).toBeDefined();

    await handler({
      model: 'User',
      operation: 'deleteMany',
      args: { where: { role: 'guest' } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
        where: { role: 'guest' },
      }),
    );
  });

  it('should pass-through delete for non-soft-delete models', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue({ id: '1' });
    const queryFns = ext.query as any;

    const handler = queryFns.$allModels?.delete;

    await handler({
      model: 'Session',
      operation: 'delete',
      args: { where: { id: '1' } },
      query: mockQuery,
    });

    // Should call original query unchanged (no data.deletedAt)
    expect(mockQuery).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('should pass-through when skipSoftDelete context is active', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue({ id: '1' });
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.delete;

    await SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: true },
      async () => {
        await handler({
          model: 'User',
          operation: 'delete',
          args: { where: { id: '1' } },
          query: mockQuery,
        });
      },
    );

    // skipSoftDelete = true → original delete passed through
    expect(mockQuery).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('should include deletedBy when deletedByField is configured and actorId is set', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
    });

    const mockQuery = vi.fn().mockResolvedValue({ id: '1' });
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.delete;

    await SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-1' },
      async () => {
        await handler({
          model: 'User',
          operation: 'delete',
          args: { where: { id: '1' } },
          query: mockQuery,
        });
      },
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedBy: 'admin-1',
        }),
      }),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/prisma/soft-delete-extension.spec.ts`
Expected: FAIL — module not found

**Step 3: Implement soft-delete extension (write operations)**

```typescript
// src/prisma/soft-delete-extension.ts
import { Prisma } from '@prisma/client';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { DEFAULT_DELETED_AT_FIELD, DEFAULT_MAX_CASCADE_DEPTH } from '../soft-delete.constants';
import type { SoftDeleteExtensionOptions } from '../interfaces/soft-delete-options.interface';

export function createPrismaSoftDeleteExtension(options: SoftDeleteExtensionOptions) {
  const {
    softDeleteModels,
    deletedAtField = DEFAULT_DELETED_AT_FIELD,
    deletedByField = null,
    cascade,
    maxCascadeDepth = DEFAULT_MAX_CASCADE_DEPTH,
  } = options;

  const softDeleteModelSet = new Set(softDeleteModels.map((m) => m.toLowerCase()));

  function isSoftDeleteModel(model: string | undefined): boolean {
    if (!model) return false;
    return softDeleteModelSet.has(model.toLowerCase());
  }

  function buildSoftDeleteData(): Record<string, any> {
    const data: Record<string, any> = {
      [deletedAtField]: new Date(),
    };

    if (deletedByField) {
      const actorId = SoftDeleteContext.getActorId();
      if (actorId) {
        data[deletedByField] = actorId;
      }
    }

    return data;
  }

  return Prisma.defineExtension({
    name: 'soft-delete',
    query: {
      $allModels: {
        async delete({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          // Convert delete → update with deletedAt timestamp
          const { where } = args;
          return (query as any)({
            where,
            data: buildSoftDeleteData(),
          });
        },

        async deleteMany({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          // Convert deleteMany → updateMany with deletedAt timestamp
          const { where } = args;
          return (query as any)({
            where,
            data: buildSoftDeleteData(),
          });
        },

        async findMany({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },

        async findFirst({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },

        async findUnique({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },

        async findFirstOrThrow({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },

        async findUniqueOrThrow({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },

        async count({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          if (args) {
            args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          }
          return query(args);
        },

        async aggregate({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },

        async groupBy({ model, args, query }) {
          if (!isSoftDeleteModel(model) || SoftDeleteContext.isSkipped()) {
            return query(args);
          }

          const filterMode = SoftDeleteContext.getFilterMode();
          args.where = applyDeletedFilter(args.where, filterMode, deletedAtField);
          return query(args);
        },
      },
    },
  });
}

function applyDeletedFilter(
  where: Record<string, any> | undefined,
  filterMode: string,
  deletedAtField: string,
): Record<string, any> {
  const existing = where ?? {};

  switch (filterMode) {
    case 'withDeleted':
      return existing; // No filter — include all records
    case 'onlyDeleted':
      return { ...existing, [deletedAtField]: { not: null } };
    case 'default':
    default:
      return { ...existing, [deletedAtField]: null };
  }
}
```

**Important note on testing:** The Prisma `Prisma.defineExtension` wraps the config, so the actual test approach may need to call the inner handler functions. The test above assumes we can access `ext.query.$allModels.delete` directly. If `Prisma.defineExtension` returns an opaque wrapper, we may need to extract the config before wrapping it, or test via integration. Adjust the extension to export the raw config if needed:

```typescript
// Alternative: export both raw config and wrapped extension
export function createSoftDeleteExtensionConfig(options: SoftDeleteExtensionOptions) {
  // ... returns the plain config object
}

export function createPrismaSoftDeleteExtension(options: SoftDeleteExtensionOptions) {
  return Prisma.defineExtension(createSoftDeleteExtensionConfig(options));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/prisma/soft-delete-extension.spec.ts`
Expected: All write operation tests PASS

**Step 5: Commit**

```bash
git add src/prisma/soft-delete-extension.ts src/prisma/soft-delete-extension.spec.ts
git commit -m "feat: implement Prisma soft-delete extension (write + read interception)"
```

---

## Task 6: Prisma Soft-Delete Extension — Read Filter Tests

**Files:**
- Modify: `src/prisma/soft-delete-extension.spec.ts` (add read filter tests)

**Step 1: Add read filter tests to existing spec file**

```typescript
// Append to src/prisma/soft-delete-extension.spec.ts

describe('createPrismaSoftDeleteExtension — read operations', () => {
  it('should add deletedAt: null filter to findMany by default', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue([]);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.findMany;

    await handler({
      model: 'User',
      operation: 'findMany',
      args: { where: { role: 'admin' } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'admin', deletedAt: null },
      }),
    );
  });

  it('should NOT add deletedAt filter when withDeleted context is active', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue([]);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.findMany;

    await SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      async () => {
        await handler({
          model: 'User',
          operation: 'findMany',
          args: { where: { role: 'admin' } },
          query: mockQuery,
        });
      },
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'admin' }, // No deletedAt filter
      }),
    );
  });

  it('should add deletedAt: { not: null } filter when onlyDeleted context is active', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue([]);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.findMany;

    await SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      async () => {
        await handler({
          model: 'User',
          operation: 'findMany',
          args: { where: { role: 'admin' } },
          query: mockQuery,
        });
      },
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'admin', deletedAt: { not: null } },
      }),
    );
  });

  it('should skip filter for non-soft-delete models', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue([]);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.findMany;

    await handler({
      model: 'Session',
      operation: 'findMany',
      args: { where: { active: true } },
      query: mockQuery,
    });

    // No deletedAt filter for non-soft-delete model
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
      }),
    );
  });

  it('should add filter to findFirst', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue(null);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.findFirst;

    await handler({
      model: 'User',
      operation: 'findFirst',
      args: { where: { email: 'test@test.com' } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'test@test.com', deletedAt: null },
      }),
    );
  });

  it('should add filter to count', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue(0);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.count;

    await handler({
      model: 'User',
      operation: 'count',
      args: { where: {} },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      }),
    );
  });

  it('should handle undefined where clause', async () => {
    const ext = createPrismaSoftDeleteExtension({
      softDeleteModels: ['User'],
      deletedAtField: 'deletedAt',
    });

    const mockQuery = vi.fn().mockResolvedValue([]);
    const queryFns = ext.query as any;
    const handler = queryFns.$allModels?.findMany;

    await handler({
      model: 'User',
      operation: 'findMany',
      args: { where: undefined },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      }),
    );
  });
});
```

**Step 2: Run all extension tests**

Run: `npx vitest run src/prisma/soft-delete-extension.spec.ts`
Expected: All tests PASS (write + read)

**Step 3: Commit**

```bash
git add src/prisma/soft-delete-extension.spec.ts
git commit -m "test: add read filter tests for soft-delete extension"
```

---

## Task 7: Cascade Handler

**Files:**
- Create: `src/prisma/cascade-handler.ts`
- Create: `src/prisma/cascade-handler.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/prisma/cascade-handler.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CascadeHandler } from './cascade-handler';

describe('CascadeHandler', () => {
  const mockPrisma: any = {
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    post: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    comment: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  };

  // Mock DMMF structure
  const mockDmmf = {
    datamodel: {
      models: [
        {
          name: 'User',
          fields: [
            { name: 'id', kind: 'scalar', type: 'String' },
            { name: 'posts', kind: 'object', type: 'Post', relationName: 'UserPosts', isList: true },
          ],
        },
        {
          name: 'Post',
          fields: [
            { name: 'id', kind: 'scalar', type: 'String' },
            { name: 'authorId', kind: 'scalar', type: 'String' },
            { name: 'author', kind: 'object', type: 'User', relationName: 'UserPosts', isList: false,
              relationFromFields: ['authorId'], relationToFields: ['id'] },
            { name: 'comments', kind: 'object', type: 'Comment', relationName: 'PostComments', isList: true },
          ],
        },
        {
          name: 'Comment',
          fields: [
            { name: 'id', kind: 'scalar', type: 'String' },
            { name: 'postId', kind: 'scalar', type: 'String' },
            { name: 'post', kind: 'object', type: 'Post', relationName: 'PostComments', isList: false,
              relationFromFields: ['postId'], relationToFields: ['id'] },
          ],
        },
      ],
    },
  };

  let handler: CascadeHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new CascadeHandler({
      cascade: { User: ['Post'], Post: ['Comment'] },
      deletedAtField: 'deletedAt',
      maxCascadeDepth: 3,
      dmmf: mockDmmf as any,
    });
  });

  it('should find FK field from DMMF for parent-child relation', () => {
    const fk = handler.findForeignKey('User', 'Post');
    expect(fk).toBe('authorId');
  });

  it('should find FK field for Post → Comment relation', () => {
    const fk = handler.findForeignKey('Post', 'Comment');
    expect(fk).toBe('postId');
  });

  it('should throw CascadeRelationNotFoundError for missing relation', () => {
    expect(() => handler.findForeignKey('Comment', 'User')).toThrow('CascadeRelationNotFoundError');
  });

  it('should cascade soft-delete from parent to children', async () => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1' }, { id: 'p2' },
    ]);
    mockPrisma.comment.updateMany.mockResolvedValue({ count: 5 });

    const deletedAt = new Date();
    await handler.cascadeSoftDelete(mockPrisma, 'User', 'u1', deletedAt, 0);

    // Should soft-delete posts where authorId = 'u1'
    expect(mockPrisma.post.updateMany).toHaveBeenCalledWith({
      where: { authorId: 'u1', deletedAt: null },
      data: { deletedAt },
    });

    // Should cascade to comments for each post
    expect(mockPrisma.comment.updateMany).toHaveBeenCalled();
  });

  it('should respect maxCascadeDepth', async () => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.post.findMany.mockResolvedValue([]);

    // Start at depth = maxCascadeDepth (should not recurse further)
    await handler.cascadeSoftDelete(mockPrisma, 'User', 'u1', new Date(), 3);

    expect(mockPrisma.post.updateMany).not.toHaveBeenCalled();
  });

  it('should cascade restore with timestamp matching (±1s)', async () => {
    const deletedAt = new Date('2026-04-05T10:00:00.000Z');
    const lowerBound = new Date(deletedAt.getTime() - 1000);
    const upperBound = new Date(deletedAt.getTime() + 1000);

    mockPrisma.post.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    mockPrisma.comment.updateMany.mockResolvedValue({ count: 3 });

    await handler.cascadeRestore(mockPrisma, 'User', 'u1', deletedAt, 0);

    // Should restore posts with matching deletedAt timestamp (±1s)
    expect(mockPrisma.post.updateMany).toHaveBeenCalledWith({
      where: {
        authorId: 'u1',
        deletedAt: { gte: lowerBound, lte: upperBound },
      },
      data: { deletedAt: null },
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/prisma/cascade-handler.spec.ts`
Expected: FAIL

**Step 3: Implement CascadeHandler**

```typescript
// src/prisma/cascade-handler.ts
import { CascadeRelationNotFoundError } from '../errors/cascade-relation-not-found.error';

interface CascadeHandlerOptions {
  cascade: Record<string, string[]>;
  deletedAtField: string;
  deletedByField?: string | null;
  maxCascadeDepth: number;
  dmmf: any; // Prisma.dmmf.datamodel
}

export class CascadeHandler {
  private cascade: Record<string, string[]>;
  private deletedAtField: string;
  private deletedByField: string | null;
  private maxCascadeDepth: number;
  private dmmf: any;
  private fkCache = new Map<string, string>();

  constructor(options: CascadeHandlerOptions) {
    this.cascade = options.cascade;
    this.deletedAtField = options.deletedAtField;
    this.deletedByField = options.deletedByField ?? null;
    this.maxCascadeDepth = options.maxCascadeDepth;
    this.dmmf = options.dmmf;
  }

  findForeignKey(parent: string, child: string): string {
    const cacheKey = `${parent}->${child}`;
    if (this.fkCache.has(cacheKey)) {
      return this.fkCache.get(cacheKey)!;
    }

    const childModel = this.dmmf.datamodel.models.find(
      (m: any) => m.name === child,
    );
    if (!childModel) {
      throw new CascadeRelationNotFoundError(parent, child);
    }

    const relationField = childModel.fields.find(
      (f: any) =>
        f.kind === 'object' &&
        f.type === parent &&
        f.relationFromFields?.length > 0,
    );

    if (!relationField || !relationField.relationFromFields?.[0]) {
      throw new CascadeRelationNotFoundError(parent, child);
    }

    const fk = relationField.relationFromFields[0];
    this.fkCache.set(cacheKey, fk);
    return fk;
  }

  async cascadeSoftDelete(
    prisma: any,
    parentModel: string,
    parentId: string,
    deletedAt: Date,
    depth: number,
  ): Promise<void> {
    if (depth >= this.maxCascadeDepth) return;

    const children = this.cascade[parentModel];
    if (!children?.length) return;

    for (const childModel of children) {
      const fk = this.findForeignKey(parentModel, childModel);
      const modelDelegate = prisma[childModel.charAt(0).toLowerCase() + childModel.slice(1)];

      const data: Record<string, any> = { [this.deletedAtField]: deletedAt };

      await modelDelegate.updateMany({
        where: { [fk]: parentId, [this.deletedAtField]: null },
        data,
      });

      // Find affected children to recurse
      const affectedChildren = await modelDelegate.findMany({
        where: { [fk]: parentId },
        select: { id: true },
      });

      for (const child of affectedChildren) {
        await this.cascadeSoftDelete(prisma, childModel, child.id, deletedAt, depth + 1);
      }
    }
  }

  async cascadeRestore(
    prisma: any,
    parentModel: string,
    parentId: string,
    deletedAt: Date,
    depth: number,
  ): Promise<void> {
    if (depth >= this.maxCascadeDepth) return;

    const children = this.cascade[parentModel];
    if (!children?.length) return;

    // ±1 second tolerance for matching cascade-deleted records
    const lowerBound = new Date(deletedAt.getTime() - 1000);
    const upperBound = new Date(deletedAt.getTime() + 1000);

    for (const childModel of children) {
      const fk = this.findForeignKey(parentModel, childModel);
      const modelDelegate = prisma[childModel.charAt(0).toLowerCase() + childModel.slice(1)];

      // Find affected children before restoring (for recursive cascade)
      const affectedChildren = await modelDelegate.findMany({
        where: {
          [fk]: parentId,
          [this.deletedAtField]: { gte: lowerBound, lte: upperBound },
        },
        select: { id: true, [this.deletedAtField]: true },
      });

      await modelDelegate.updateMany({
        where: {
          [fk]: parentId,
          [this.deletedAtField]: { gte: lowerBound, lte: upperBound },
        },
        data: { [this.deletedAtField]: null },
      });

      // Recurse for each affected child
      for (const child of affectedChildren) {
        await this.cascadeRestore(
          prisma,
          childModel,
          child.id,
          child[this.deletedAtField],
          depth + 1,
        );
      }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/prisma/cascade-handler.spec.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/prisma/cascade-handler.ts src/prisma/cascade-handler.spec.ts
git commit -m "feat: implement CascadeHandler with DMMF-based FK detection"
```

---

## Task 8: SoftDeleteService

**Files:**
- Create: `src/services/soft-delete.service.ts`
- Create: `src/services/soft-delete.service.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/services/soft-delete.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftDeleteService } from './soft-delete.service';
import { SoftDeleteContext } from './soft-delete-context';

describe('SoftDeleteService', () => {
  let service: SoftDeleteService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
      },
    };

    service = new SoftDeleteService(
      {
        softDeleteModels: ['User'],
        deletedAtField: 'deletedAt',
        deletedByField: null,
      },
      mockPrisma,
      null, // cascadeHandler
    );
  });

  describe('restore()', () => {
    it('should restore a soft-deleted record', async () => {
      const deletedRecord = { id: 'u1', deletedAt: new Date(), name: 'John' };
      mockPrisma.user.findFirst.mockResolvedValue(deletedRecord);
      mockPrisma.user.update.mockResolvedValue({ ...deletedRecord, deletedAt: null });

      const result = await service.restore('User', { id: 'u1' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { deletedAt: null },
      });
    });

    it('should throw when record not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.restore('User', { id: 'u1' }))
        .rejects.toThrow('not found');
    });
  });

  describe('forceDelete()', () => {
    it('should perform physical delete using skipSoftDelete context', async () => {
      mockPrisma.user.delete.mockResolvedValue({ id: 'u1' });

      await service.forceDelete('User', { id: 'u1' });

      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'u1' },
      });
    });
  });

  describe('withDeleted()', () => {
    it('should execute callback in withDeleted context', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.withDeleted(async () => {
        const mode = SoftDeleteContext.getFilterMode();
        expect(mode).toBe('withDeleted');
        return mockPrisma.user.findMany();
      });
    });
  });

  describe('onlyDeleted()', () => {
    it('should execute callback in onlyDeleted context', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.onlyDeleted(async () => {
        const mode = SoftDeleteContext.getFilterMode();
        expect(mode).toBe('onlyDeleted');
        return mockPrisma.user.findMany();
      });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/soft-delete.service.spec.ts`
Expected: FAIL

**Step 3: Implement SoftDeleteService**

```typescript
// src/services/soft-delete.service.ts
import { Injectable, Inject, Optional } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS } from '../soft-delete.constants';
import { SoftDeleteContext } from './soft-delete-context';
import { CascadeHandler } from '../prisma/cascade-handler';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

@Injectable()
export class SoftDeleteService {
  private readonly deletedAtField: string;
  private readonly deletedByField: string | null;

  constructor(
    @Inject(SOFT_DELETE_MODULE_OPTIONS)
    private readonly options: SoftDeleteModuleOptions,
    @Inject('PRISMA_SERVICE')
    private readonly prisma: any,
    @Optional()
    private readonly cascadeHandler: CascadeHandler | null,
  ) {
    this.deletedAtField = options.deletedAtField ?? 'deletedAt';
    this.deletedByField = options.deletedByField ?? null;
  }

  private getModelDelegate(model: string): any {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    return this.prisma[key];
  }

  async restore<T = any>(model: string, where: Record<string, any>): Promise<T> {
    // Find the deleted record first (need to look in withDeleted context)
    const record = await SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      () => this.getModelDelegate(model).findFirst({ where }),
    );

    if (!record) {
      throw new Error(`Record not found in "${model}" with conditions: ${JSON.stringify(where)}`);
    }

    const data: Record<string, any> = { [this.deletedAtField]: null };
    if (this.deletedByField) {
      data[this.deletedByField] = null;
    }

    // Restore uses skipSoftDelete to avoid the extension intercepting the update
    const result = await this.getModelDelegate(model).update({
      where,
      data,
    });

    // Cascade restore
    if (this.cascadeHandler && record[this.deletedAtField]) {
      await this.cascadeHandler.cascadeRestore(
        this.prisma,
        model,
        record.id,
        record[this.deletedAtField],
        0,
      );
    }

    return result;
  }

  async forceDelete<T = any>(model: string, where: Record<string, any>): Promise<T> {
    return SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: true },
      () => this.getModelDelegate(model).delete({ where }),
    );
  }

  async withDeleted<T>(callback: () => T | Promise<T>): Promise<T> {
    return SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      callback,
    );
  }

  async onlyDeleted<T>(callback: () => T | Promise<T>): Promise<T> {
    return SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      callback,
    );
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/soft-delete.service.spec.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/services/soft-delete.service.ts src/services/soft-delete.service.spec.ts
git commit -m "feat: implement SoftDeleteService with restore, forceDelete, withDeleted, onlyDeleted"
```

---

## Task 9: Decorators

**Files:**
- Create: `src/decorators/with-deleted.decorator.ts`
- Create: `src/decorators/only-deleted.decorator.ts`
- Create: `src/decorators/skip-soft-delete.decorator.ts`
- Create: `src/decorators/decorators.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/decorators/decorators.spec.ts
import { describe, it, expect } from 'vitest';
import { WithDeleted } from './with-deleted.decorator';
import { OnlyDeleted } from './only-deleted.decorator';
import { SkipSoftDelete } from './skip-soft-delete.decorator';
import { WITH_DELETED_KEY, ONLY_DELETED_KEY, SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';

describe('Decorators', () => {
  describe('@WithDeleted()', () => {
    it('should set WITH_DELETED_KEY metadata on method', () => {
      class TestController {
        @WithDeleted()
        findAll() {}
      }

      const metadata = Reflect.getMetadata(WITH_DELETED_KEY, TestController.prototype.findAll);
      expect(metadata).toBe(true);
    });
  });

  describe('@OnlyDeleted()', () => {
    it('should set ONLY_DELETED_KEY metadata on method', () => {
      class TestController {
        @OnlyDeleted()
        getTrash() {}
      }

      const metadata = Reflect.getMetadata(ONLY_DELETED_KEY, TestController.prototype.getTrash);
      expect(metadata).toBe(true);
    });
  });

  describe('@SkipSoftDelete()', () => {
    it('should set SKIP_SOFT_DELETE_KEY metadata on method', () => {
      class TestController {
        @SkipSoftDelete()
        hardDelete() {}
      }

      const metadata = Reflect.getMetadata(SKIP_SOFT_DELETE_KEY, TestController.prototype.hardDelete);
      expect(metadata).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/decorators/decorators.spec.ts`
Expected: FAIL

**Step 3: Implement decorators**

```typescript
// src/decorators/with-deleted.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { WITH_DELETED_KEY } from '../soft-delete.constants';

export const WithDeleted = () => SetMetadata(WITH_DELETED_KEY, true);
```

```typescript
// src/decorators/only-deleted.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { ONLY_DELETED_KEY } from '../soft-delete.constants';

export const OnlyDeleted = () => SetMetadata(ONLY_DELETED_KEY, true);
```

```typescript
// src/decorators/skip-soft-delete.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';

export const SkipSoftDelete = () => SetMetadata(SKIP_SOFT_DELETE_KEY, true);
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/decorators/decorators.spec.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/decorators/
git commit -m "feat: add @WithDeleted, @OnlyDeleted, @SkipSoftDelete decorators"
```

---

## Task 10: Interceptor

**Files:**
- Create: `src/interceptors/soft-delete-filter.interceptor.ts`
- Create: `src/interceptors/soft-delete-filter.interceptor.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/interceptors/soft-delete-filter.interceptor.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { SoftDeleteFilterInterceptor } from './soft-delete-filter.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { SoftDeleteContext } from '../services/soft-delete-context';

describe('SoftDeleteFilterInterceptor', () => {
  function createMockContext(metadata: Record<string, any> = {}): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  function createMockCallHandler(): CallHandler {
    return {
      handle: () => of('result'),
    };
  }

  it('should set withDeleted context when @WithDeleted metadata is present', (done) => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === 'SOFT_DELETE_WITH_DELETED') return true;
      return undefined;
    });

    const interceptor = new SoftDeleteFilterInterceptor(reflector);
    const context = createMockContext();
    const callHandler = {
      handle: () => {
        const mode = SoftDeleteContext.getFilterMode();
        expect(mode).toBe('withDeleted');
        return of('result');
      },
    };

    interceptor.intercept(context, callHandler).subscribe({
      complete: done,
    });
  });

  it('should set onlyDeleted context when @OnlyDeleted metadata is present', (done) => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === 'SOFT_DELETE_ONLY_DELETED') return true;
      return undefined;
    });

    const interceptor = new SoftDeleteFilterInterceptor(reflector);
    const context = createMockContext();
    const callHandler = {
      handle: () => {
        const mode = SoftDeleteContext.getFilterMode();
        expect(mode).toBe('onlyDeleted');
        return of('result');
      },
    };

    interceptor.intercept(context, callHandler).subscribe({
      complete: done,
    });
  });

  it('should set skipSoftDelete context when @SkipSoftDelete metadata is present', (done) => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === 'SOFT_DELETE_SKIP') return true;
      return undefined;
    });

    const interceptor = new SoftDeleteFilterInterceptor(reflector);
    const context = createMockContext();
    const callHandler = {
      handle: () => {
        expect(SoftDeleteContext.isSkipped()).toBe(true);
        return of('result');
      },
    };

    interceptor.intercept(context, callHandler).subscribe({
      complete: done,
    });
  });

  it('should default to standard mode when no metadata is present', (done) => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const interceptor = new SoftDeleteFilterInterceptor(reflector);
    const context = createMockContext();
    const callHandler = {
      handle: () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('default');
        expect(SoftDeleteContext.isSkipped()).toBe(false);
        return of('result');
      },
    };

    interceptor.intercept(context, callHandler).subscribe({
      complete: done,
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/interceptors/soft-delete-filter.interceptor.spec.ts`
Expected: FAIL

**Step 3: Implement interceptor**

```typescript
// src/interceptors/soft-delete-filter.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { WITH_DELETED_KEY, ONLY_DELETED_KEY, SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';
import type { SoftDeleteFilterMode, SoftDeleteStore } from '../interfaces/soft-delete-context.interface';

@Injectable()
export class SoftDeleteFilterInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const withDeleted = this.reflector.getAllAndOverride<boolean>(WITH_DELETED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const onlyDeleted = this.reflector.getAllAndOverride<boolean>(ONLY_DELETED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const skipSoftDelete = this.reflector.getAllAndOverride<boolean>(SKIP_SOFT_DELETE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    let filterMode: SoftDeleteFilterMode = 'default';
    if (withDeleted) filterMode = 'withDeleted';
    if (onlyDeleted) filterMode = 'onlyDeleted';

    const store: SoftDeleteStore = {
      filterMode,
      skipSoftDelete: skipSoftDelete ?? false,
    };

    return new Observable((subscriber) => {
      SoftDeleteContext.run(store, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/interceptors/soft-delete-filter.interceptor.spec.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/interceptors/
git commit -m "feat: implement SoftDeleteFilterInterceptor for decorator-based context"
```

---

## Task 11: Actor Middleware

**Files:**
- Create: `src/middleware/soft-delete-actor.middleware.ts`
- Create: `src/middleware/soft-delete-actor.middleware.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/middleware/soft-delete-actor.middleware.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { SoftDeleteActorMiddleware } from './soft-delete-actor.middleware';
import { SoftDeleteContext } from '../services/soft-delete-context';

describe('SoftDeleteActorMiddleware', () => {
  it('should extract actorId using actorExtractor and set in context', (done) => {
    const middleware = new SoftDeleteActorMiddleware({
      softDeleteModels: ['User'],
      deletedByField: 'deletedBy',
      actorExtractor: (req: any) => req.user?.id ?? null,
    } as any);

    const req = { user: { id: 'admin-1' } };
    const res = {};
    const next = () => {
      expect(SoftDeleteContext.getActorId()).toBe('admin-1');
      done();
    };

    middleware.use(req as any, res as any, next);
  });

  it('should set null actorId when user is not authenticated', (done) => {
    const middleware = new SoftDeleteActorMiddleware({
      softDeleteModels: ['User'],
      deletedByField: 'deletedBy',
      actorExtractor: (req: any) => req.user?.id ?? null,
    } as any);

    const req = {};
    const res = {};
    const next = () => {
      expect(SoftDeleteContext.getActorId()).toBeNull();
      done();
    };

    middleware.use(req as any, res as any, next);
  });

  it('should skip when deletedByField is not configured', (done) => {
    const middleware = new SoftDeleteActorMiddleware({
      softDeleteModels: ['User'],
    } as any);

    const req = {};
    const res = {};
    const next = () => {
      // Should pass through without setting context
      done();
    };

    middleware.use(req as any, res as any, next);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/middleware/soft-delete-actor.middleware.spec.ts`
Expected: FAIL

**Step 3: Implement middleware**

```typescript
// src/middleware/soft-delete-actor.middleware.ts
import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { SOFT_DELETE_MODULE_OPTIONS } from '../soft-delete.constants';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

@Injectable()
export class SoftDeleteActorMiddleware implements NestMiddleware {
  constructor(
    @Inject(SOFT_DELETE_MODULE_OPTIONS)
    private readonly options: SoftDeleteModuleOptions,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.options.deletedByField || !this.options.actorExtractor) {
      next();
      return;
    }

    const actorId = this.options.actorExtractor(req);

    SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: false, actorId },
      () => next(),
    );
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/middleware/soft-delete-actor.middleware.spec.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/middleware/
git commit -m "feat: implement SoftDeleteActorMiddleware for deletedBy extraction"
```

---

## Task 12: NestJS Dynamic Module

**Files:**
- Create: `src/soft-delete.module.ts`
- Create: `src/soft-delete.module.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/soft-delete.module.spec.ts
import { describe, it, expect } from 'vitest';
import { SoftDeleteModule } from './soft-delete.module';

describe('SoftDeleteModule', () => {
  describe('forRoot()', () => {
    it('should return a DynamicModule with correct module', () => {
      const result = SoftDeleteModule.forRoot({
        softDeleteModels: ['User'],
      });

      expect(result.module).toBe(SoftDeleteModule);
      expect(result.global).toBe(true);
    });

    it('should provide SOFT_DELETE_MODULE_OPTIONS', () => {
      const options = { softDeleteModels: ['User'], deletedAtField: 'deletedAt' };
      const result = SoftDeleteModule.forRoot(options);

      const optionsProvider = result.providers?.find(
        (p: any) => p.provide?.toString() === 'Symbol(SOFT_DELETE_MODULE_OPTIONS)',
      );
      expect(optionsProvider).toBeDefined();
    });

    it('should export SoftDeleteService', () => {
      const result = SoftDeleteModule.forRoot({ softDeleteModels: ['User'] });
      expect(result.exports).toBeDefined();
    });
  });

  describe('forRootAsync()', () => {
    it('should return a DynamicModule', () => {
      const result = SoftDeleteModule.forRootAsync({
        useFactory: () => ({ softDeleteModels: ['User'] }),
      });

      expect(result.module).toBe(SoftDeleteModule);
      expect(result.global).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/soft-delete.module.spec.ts`
Expected: FAIL

**Step 3: Implement module**

```typescript
// src/soft-delete.module.ts
import { DynamicModule, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SOFT_DELETE_MODULE_OPTIONS } from './soft-delete.constants';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import { SoftDeleteActorMiddleware } from './middleware/soft-delete-actor.middleware';
import type {
  SoftDeleteModuleOptions,
  SoftDeleteModuleAsyncOptions,
} from './interfaces/soft-delete-options.interface';

@Module({})
export class SoftDeleteModule implements NestModule {
  static forRoot(options: SoftDeleteModuleOptions): DynamicModule {
    return {
      module: SoftDeleteModule,
      global: true,
      providers: [
        {
          provide: SOFT_DELETE_MODULE_OPTIONS,
          useValue: options,
        },
        SoftDeleteService,
        {
          provide: APP_INTERCEPTOR,
          useClass: SoftDeleteFilterInterceptor,
        },
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: SoftDeleteModuleAsyncOptions): DynamicModule {
    return {
      module: SoftDeleteModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: SOFT_DELETE_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        SoftDeleteService,
        {
          provide: APP_INTERCEPTOR,
          useClass: SoftDeleteFilterInterceptor,
        },
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SoftDeleteActorMiddleware).forRoutes('*');
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/soft-delete.module.spec.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/soft-delete.module.ts src/soft-delete.module.spec.ts
git commit -m "feat: implement SoftDeleteModule with forRoot/forRootAsync"
```

---

## Task 13: Testing Utilities

**Files:**
- Create: `src/testing/test-soft-delete.module.ts`
- Create: `src/testing/expect-soft-deleted.ts`
- Create: `src/testing/index.ts`
- Create: `src/testing/testing.spec.ts`

**Step 1: Write failing tests**

```typescript
// src/testing/testing.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { TestSoftDeleteModule } from './test-soft-delete.module';
import { expectSoftDeleted, expectNotSoftDeleted } from './expect-soft-deleted';

describe('TestSoftDeleteModule', () => {
  it('should return a DynamicModule with default options', () => {
    const result = TestSoftDeleteModule.register({ softDeleteModels: ['User'] });
    expect(result.module).toBe(TestSoftDeleteModule);
  });
});

describe('expectSoftDeleted', () => {
  it('should pass when record has non-null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: '1', deletedAt: new Date() }),
    };

    await expect(
      expectSoftDeleted(mockDelegate, { id: '1' }),
    ).resolves.not.toThrow();
  });

  it('should fail when record has null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: '1', deletedAt: null }),
    };

    await expect(
      expectSoftDeleted(mockDelegate, { id: '1' }),
    ).rejects.toThrow();
  });

  it('should fail when record not found', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue(null),
    };

    await expect(
      expectSoftDeleted(mockDelegate, { id: '1' }),
    ).rejects.toThrow();
  });
});

describe('expectNotSoftDeleted', () => {
  it('should pass when record has null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: '1', deletedAt: null }),
    };

    await expect(
      expectNotSoftDeleted(mockDelegate, { id: '1' }),
    ).resolves.not.toThrow();
  });

  it('should fail when record has non-null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: '1', deletedAt: new Date() }),
    };

    await expect(
      expectNotSoftDeleted(mockDelegate, { id: '1' }),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/testing/testing.spec.ts`
Expected: FAIL

**Step 3: Implement testing utilities**

```typescript
// src/testing/test-soft-delete.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS } from '../soft-delete.constants';
import { SoftDeleteService } from '../services/soft-delete.service';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

@Module({})
export class TestSoftDeleteModule {
  static register(options: Partial<SoftDeleteModuleOptions> & { softDeleteModels: string[] }): DynamicModule {
    const fullOptions: SoftDeleteModuleOptions = {
      deletedAtField: 'deletedAt',
      ...options,
    };

    return {
      module: TestSoftDeleteModule,
      providers: [
        {
          provide: SOFT_DELETE_MODULE_OPTIONS,
          useValue: fullOptions,
        },
        SoftDeleteService,
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }
}
```

```typescript
// src/testing/expect-soft-deleted.ts
import { SoftDeleteContext } from '../services/soft-delete-context';

export async function expectSoftDeleted(
  modelDelegate: any,
  where: Record<string, any>,
  deletedAtField = 'deletedAt',
): Promise<void> {
  const record = await SoftDeleteContext.run(
    { filterMode: 'withDeleted', skipSoftDelete: false },
    () => modelDelegate.findFirst({ where }),
  );

  if (!record) {
    throw new Error(`Expected record to exist (soft-deleted), but it was not found`);
  }

  if (record[deletedAtField] === null || record[deletedAtField] === undefined) {
    throw new Error(
      `Expected record to be soft-deleted (${deletedAtField} should be non-null), but ${deletedAtField} is ${record[deletedAtField]}`,
    );
  }
}

export async function expectNotSoftDeleted(
  modelDelegate: any,
  where: Record<string, any>,
  deletedAtField = 'deletedAt',
): Promise<void> {
  const record = await modelDelegate.findFirst({ where });

  if (!record) {
    throw new Error(`Expected record to exist (not soft-deleted), but it was not found`);
  }

  if (record[deletedAtField] !== null && record[deletedAtField] !== undefined) {
    throw new Error(
      `Expected record to NOT be soft-deleted (${deletedAtField} should be null), but ${deletedAtField} is ${record[deletedAtField]}`,
    );
  }
}

export async function expectCascadeSoftDeleted(
  prisma: any,
  parentModel: string,
  where: Record<string, any>,
  childModels: string[],
  deletedAtField = 'deletedAt',
): Promise<void> {
  // Verify parent is soft-deleted
  const parentKey = parentModel.charAt(0).toLowerCase() + parentModel.slice(1);
  await expectSoftDeleted(prisma[parentKey], where, deletedAtField);

  // Verify each child model has soft-deleted records
  // (This is a simplified check — in production you'd check specific related records)
  for (const childModel of childModels) {
    const childKey = childModel.charAt(0).toLowerCase() + childModel.slice(1);
    const deletedChildren = await SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      () => prisma[childKey].findMany({ where: { [deletedAtField]: { not: null } } }),
    );

    if (deletedChildren.length === 0) {
      throw new Error(
        `Expected "${childModel}" to have cascade soft-deleted records, but found none`,
      );
    }
  }
}
```

```typescript
// src/testing/index.ts
export { TestSoftDeleteModule } from './test-soft-delete.module';
export { expectSoftDeleted, expectNotSoftDeleted, expectCascadeSoftDeleted } from './expect-soft-deleted';
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/testing/testing.spec.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/testing/
git commit -m "feat: add testing utilities (TestSoftDeleteModule, expectSoftDeleted helpers)"
```

---

## Task 14: Barrel Exports

**Files:**
- Modify: `src/index.ts`

**Step 1: Update barrel export**

```typescript
// src/index.ts

// Core Module
export { SoftDeleteModule } from './soft-delete.module';
export type { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions, SoftDeleteExtensionOptions } from './interfaces/soft-delete-options.interface';

// Services
export { SoftDeleteService } from './services/soft-delete.service';
export { SoftDeleteContext } from './services/soft-delete-context';
export type { SoftDeleteFilterMode, SoftDeleteStore } from './interfaces/soft-delete-context.interface';

// Prisma Extension
export { createPrismaSoftDeleteExtension } from './prisma/soft-delete-extension';

// Decorators
export { WithDeleted } from './decorators/with-deleted.decorator';
export { OnlyDeleted } from './decorators/only-deleted.decorator';
export { SkipSoftDelete } from './decorators/skip-soft-delete.decorator';

// Interceptor
export { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';

// Errors
export { SoftDeleteFieldMissingError } from './errors/soft-delete-field-missing.error';
export { CascadeRelationNotFoundError } from './errors/cascade-relation-not-found.error';

// Constants
export { SOFT_DELETE_MODULE_OPTIONS } from './soft-delete.constants';
```

**Step 2: Verify build**

Run: `npx tsup`
Expected: dist/ generated with all exports, no errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add barrel exports for all public API"
```

---

## Task 15: E2E Test Setup

**Files:**
- Create: `docker-compose.yml`
- Create: `test/prisma/schema.prisma`
- Create: `test/e2e/soft-delete.e2e-spec.ts`
- Create: `vitest.e2e.config.ts`

**Step 1: Create docker-compose.yml**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    ports:
      - '5432:5432'
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: soft_delete_test
    tmpfs:
      - /var/lib/postgresql/data
```

**Step 2: Create test Prisma schema**

```prisma
// test/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
  output   = "../generated/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  posts     Post[]
  deletedAt DateTime? @map("deleted_at")
  deletedBy String?   @map("deleted_by")

  @@map("users")
}

model Post {
  id        String    @id @default(uuid())
  title     String
  authorId  String    @map("author_id")
  author    User      @relation(fields: [authorId], references: [id])
  comments  Comment[]
  deletedAt DateTime? @map("deleted_at")

  @@map("posts")
}

model Comment {
  id        String    @id @default(uuid())
  content   String
  postId    String    @map("post_id")
  post      Post      @relation(fields: [postId], references: [id])
  deletedAt DateTime? @map("deleted_at")

  @@map("comments")
}

model Session {
  id        String   @id @default(uuid())
  token     String   @unique
  createdAt DateTime @default(now())

  @@map("sessions")
}
```

**Step 3: Create vitest E2E config**

```typescript
// vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

**Step 4: Create E2E test**

```typescript
// test/e2e/soft-delete.e2e-spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '../generated/client';
import { createPrismaSoftDeleteExtension } from '../../src/prisma/soft-delete-extension';
import { SoftDeleteContext } from '../../src/services/soft-delete-context';

describe('Soft Delete E2E', () => {
  let basePrisma: PrismaClient;
  let prisma: any;

  beforeAll(async () => {
    basePrisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/soft_delete_test',
    });

    prisma = basePrisma.$extends(
      createPrismaSoftDeleteExtension({
        softDeleteModels: ['User', 'Post', 'Comment'],
        deletedAtField: 'deletedAt',
        deletedByField: 'deletedBy',
        cascade: { User: ['Post'], Post: ['Comment'] },
      }),
    );

    // Run migrations or push schema
    await basePrisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        deleted_at TIMESTAMP,
        deleted_by VARCHAR(255)
      );
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        author_id UUID NOT NULL REFERENCES users(id),
        deleted_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content TEXT NOT NULL,
        post_id UUID NOT NULL REFERENCES posts(id),
        deleted_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  });

  beforeEach(async () => {
    await basePrisma.$executeRawUnsafe('DELETE FROM comments');
    await basePrisma.$executeRawUnsafe('DELETE FROM posts');
    await basePrisma.$executeRawUnsafe('DELETE FROM users');
    await basePrisma.$executeRawUnsafe('DELETE FROM sessions');
  });

  afterAll(async () => {
    await basePrisma.$disconnect();
  });

  describe('soft delete', () => {
    it('should convert delete to soft-delete (set deletedAt)', async () => {
      const user = await prisma.user.create({
        data: { email: 'test@test.com', name: 'Test' },
      });

      await prisma.user.delete({ where: { id: user.id } });

      // Should not appear in normal query
      const found = await prisma.user.findFirst({ where: { id: user.id } });
      expect(found).toBeNull();

      // Should appear with withDeleted
      const deleted = await SoftDeleteContext.run(
        { filterMode: 'withDeleted', skipSoftDelete: false },
        () => prisma.user.findFirst({ where: { id: user.id } }),
      );
      expect(deleted).not.toBeNull();
      expect(deleted.deletedAt).not.toBeNull();
    });

    it('should filter soft-deleted records from findMany', async () => {
      await prisma.user.create({ data: { email: 'a@test.com', name: 'A' } });
      const b = await prisma.user.create({ data: { email: 'b@test.com', name: 'B' } });
      await prisma.user.delete({ where: { id: b.id } });

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('a@test.com');
    });

    it('should count only non-deleted records', async () => {
      await prisma.user.create({ data: { email: 'a@test.com', name: 'A' } });
      const b = await prisma.user.create({ data: { email: 'b@test.com', name: 'B' } });
      await prisma.user.delete({ where: { id: b.id } });

      const count = await prisma.user.count();
      expect(count).toBe(1);
    });

    it('should pass-through delete for non-soft-delete model', async () => {
      const session = await prisma.session.create({
        data: { token: 'abc123' },
      });

      await prisma.session.delete({ where: { id: session.id } });

      // Physically deleted — not found even with raw query
      const raw = await basePrisma.session.findUnique({ where: { id: session.id } });
      expect(raw).toBeNull();
    });
  });

  describe('onlyDeleted', () => {
    it('should return only soft-deleted records', async () => {
      await prisma.user.create({ data: { email: 'a@test.com', name: 'A' } });
      const b = await prisma.user.create({ data: { email: 'b@test.com', name: 'B' } });
      await prisma.user.delete({ where: { id: b.id } });

      const trash = await SoftDeleteContext.run(
        { filterMode: 'onlyDeleted', skipSoftDelete: false },
        () => prisma.user.findMany(),
      );
      expect(trash).toHaveLength(1);
      expect(trash[0].email).toBe('b@test.com');
    });
  });

  describe('deletedBy', () => {
    it('should set deletedBy when actorId is provided', async () => {
      const user = await prisma.user.create({
        data: { email: 'test@test.com', name: 'Test' },
      });

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-1' },
        () => prisma.user.delete({ where: { id: user.id } }),
      );

      const deleted = await SoftDeleteContext.run(
        { filterMode: 'withDeleted', skipSoftDelete: false },
        () => prisma.user.findFirst({ where: { id: user.id } }),
      );
      expect(deleted.deletedBy).toBe('admin-1');
    });
  });
});
```

**Step 5: Commit**

```bash
git add docker-compose.yml test/ vitest.e2e.config.ts
git commit -m "test: add E2E test setup with Docker PostgreSQL and Prisma schema"
```

---

## Task 16: Run All Tests & Build Verification

**Step 1: Run unit tests**

Run: `npx vitest run`
Expected: All unit tests PASS

**Step 2: Start PostgreSQL and run E2E tests**

Run: `docker compose up -d && sleep 3 && DATABASE_URL=postgresql://test:test@localhost:5432/soft_delete_test npx vitest run --config vitest.e2e.config.ts`
Expected: All E2E tests PASS

**Step 3: Run build**

Run: `npx tsup`
Expected: dist/ generated with both index and testing/index entry points

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test: verify all tests pass and build succeeds"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Project scaffold | package.json, tsconfig, tsup, vitest |
| 2 | Interfaces & constants | interfaces/, constants |
| 3 | SoftDeleteContext | AsyncLocalStorage wrapper |
| 4 | Error classes | Custom errors |
| 5 | Prisma extension (write) | delete → update interception |
| 6 | Prisma extension (read) | Auto deletedAt filter |
| 7 | Cascade handler | DMMF-based cascade |
| 8 | SoftDeleteService | restore, forceDelete, withDeleted, onlyDeleted |
| 9 | Decorators | @WithDeleted, @OnlyDeleted, @SkipSoftDelete |
| 10 | Interceptor | Decorator → AsyncLocalStorage bridge |
| 11 | Actor middleware | deletedBy extraction |
| 12 | NestJS module | forRoot/forRootAsync |
| 13 | Testing utilities | TestModule, expect helpers |
| 14 | Barrel exports | index.ts |
| 15 | E2E test setup | Docker, Prisma schema, E2E tests |
| 16 | Full verification | All tests + build |
