# Prisma 7 DMMF Cascade Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit DMMF injection path for cascade soft-delete so Prisma 7 users can use cascade while Prisma 5/6 users keep the existing fallback behavior.

**Architecture:** Add a minimal `PrismaDmmfLike` public type, a user-facing `dmmf` option on module and extension options, and a small resolver used by both the standalone extension and Nest module provider. Cascade construction requires DMMF only when cascade is configured; missing DMMF fails early with a dedicated error.

**Tech Stack:** TypeScript, NestJS dynamic module providers, Prisma client extension API, Vitest, README/CHANGELOG documentation.

---

## File Structure

- Create `src/errors/cascade-dmmf-missing.error.ts`
  - Defines the dedicated error raised when cascade is configured without DMMF.
- Create `src/prisma/dmmf-resolver.ts`
  - Owns cascade presence detection and DMMF resolution priority.
- Create `src/prisma/dmmf-resolver.spec.ts`
  - Unit tests for DMMF priority and missing-DMMF error.
- Modify `src/interfaces/soft-delete-options.interface.ts`
  - Adds `PrismaDmmfLike`, `dmmf` on `SoftDeleteModuleOptions`, and `dmmf` on `SoftDeleteExtensionOptions`.
- Modify `src/prisma/cascade-handler.ts`
  - Replaces `any` DMMF typing with `PrismaDmmfLike`.
- Modify `src/prisma/soft-delete-extension.ts`
  - Requires resolved DMMF when cascade is configured.
- Modify `src/prisma/soft-delete-extension.spec.ts`
  - Adds option-DMMF priority coverage and missing-DMMF behavior.
- Modify `src/soft-delete.module.ts`
  - Uses the same resolver for Nest module cascade handler construction.
- Modify `src/soft-delete.module.spec.ts`
  - Verifies `options.dmmf` is passed to `CascadeHandler` and missing DMMF throws.
- Modify `src/errors/soft-delete-errors.spec.ts`
  - Adds coverage for `CascadeDmmfMissingError`.
- Modify `src/index.ts`
  - Exports the new error and `PrismaDmmfLike` type.
- Modify `README.md`
  - Documents `dmmf`, Prisma 7 cascade usage, and the new error export.
- Modify `CHANGELOG.md`
  - Adds an Unreleased entry for the backwards-compatible API addition.

---

### Task 1: Add Public DMMF Type And Missing-DMMF Error

**Files:**
- Create: `src/errors/cascade-dmmf-missing.error.ts`
- Modify: `src/interfaces/soft-delete-options.interface.ts`
- Modify: `src/prisma/cascade-handler.ts`
- Modify: `src/errors/soft-delete-errors.spec.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing error test**

Add this import to `src/errors/soft-delete-errors.spec.ts`:

```ts
import { CascadeDmmfMissingError } from './cascade-dmmf-missing.error';
```

Add this test block after the `CascadeRelationNotFoundError` block:

```ts
describe('CascadeDmmfMissingError', () => {
  it('should explain that cascade requires explicit DMMF metadata', () => {
    const error = new CascadeDmmfMissingError();

    expect(error.message).toContain('Cascade soft-delete requires Prisma DMMF metadata');
    expect(error.message).toContain('Prisma 7');
    expect(error.message).toContain('dmmf option');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CascadeDmmfMissingError');
  });
});
```

- [ ] **Step 2: Run the focused error test to verify it fails**

Run:

```bash
npm test -- src/errors/soft-delete-errors.spec.ts
```

Expected: FAIL because `./cascade-dmmf-missing.error` does not exist.

- [ ] **Step 3: Create the error class**

Create `src/errors/cascade-dmmf-missing.error.ts`:

```ts
export class CascadeDmmfMissingError extends Error {
  constructor() {
    super(
      'Cascade soft-delete requires Prisma DMMF metadata, but none was provided. ' +
        'Prisma 7 no longer exposes Prisma.dmmf. Pass DMMF via the dmmf option, ' +
        'or disable cascade.',
    );
    this.name = 'CascadeDmmfMissingError';
  }
}
```

- [ ] **Step 4: Add the public DMMF shape and options**

Update `src/interfaces/soft-delete-options.interface.ts` so the file contains this type before `SoftDeleteModuleOptions`:

```ts
export interface PrismaDmmfLike {
  datamodel: {
    models: Array<{
      name: string;
      fields: Array<{
        name: string;
        kind?: string;
        type?: string;
        isId?: boolean;
        relationFromFields?: string[];
      }>;
    }>;
  };
}
```

Add `dmmf?: PrismaDmmfLike;` to `SoftDeleteModuleOptions`:

```ts
export interface SoftDeleteModuleOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  actorExtractor?: (req: any) => string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  /** DI token for the PrismaService provider in the consumer's module */
  prismaServiceToken: any;
  /** Enable event emission. Requires @nestjs/event-emitter to be installed. Default: false */
  enableEvents?: boolean;
  /** Optional Prisma DMMF metadata. Required for cascade when Prisma.dmmf is unavailable. */
  dmmf?: PrismaDmmfLike;
}
```

Add `dmmf?: PrismaDmmfLike;` to `SoftDeleteExtensionOptions`:

```ts
export interface SoftDeleteExtensionOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  /** Optional event emitter for soft-delete lifecycle events */
  eventEmitter?: { emitSoftDeleted: (event: any) => void } | null;
  /** Optional Prisma DMMF metadata. Required for cascade when Prisma.dmmf is unavailable. */
  dmmf?: PrismaDmmfLike;
}
```

- [ ] **Step 5: Type `CascadeHandler` with the new DMMF shape**

Update the imports and `CascadeHandlerOptions` in `src/prisma/cascade-handler.ts`:

```ts
import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';
import { CascadeRelationNotFoundError } from '../errors/cascade-relation-not-found.error';

export interface CascadeHandlerOptions {
  cascade: Record<string, string[]>;
  deletedAtField: string;
  deletedByField?: string | null;
  maxCascadeDepth: number;
  dmmf: PrismaDmmfLike;
}
```

Update the private property type in the same file:

```ts
private readonly dmmf: PrismaDmmfLike;
```

- [ ] **Step 6: Export the new public symbols**

Update the type export in `src/index.ts`:

```ts
export type {
  PrismaDmmfLike,
  SoftDeleteModuleOptions,
  SoftDeleteModuleAsyncOptions,
  SoftDeleteExtensionOptions,
} from './interfaces/soft-delete-options.interface';
```

Add the new error export near the other error exports:

```ts
export { CascadeDmmfMissingError } from './errors/cascade-dmmf-missing.error';
```

- [ ] **Step 7: Run the focused test to verify it passes**

Run:

```bash
npm test -- src/errors/soft-delete-errors.spec.ts
```

Expected: PASS for all tests in `soft-delete-errors.spec.ts`.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/errors/cascade-dmmf-missing.error.ts src/errors/soft-delete-errors.spec.ts src/interfaces/soft-delete-options.interface.ts src/prisma/cascade-handler.ts src/index.ts
git commit -m "feat: add explicit cascade dmmf option types"
```

---

### Task 2: Add Shared DMMF Resolver

**Files:**
- Create: `src/prisma/dmmf-resolver.ts`
- Create: `src/prisma/dmmf-resolver.spec.ts`

- [ ] **Step 1: Write the failing resolver tests**

Create `src/prisma/dmmf-resolver.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CascadeDmmfMissingError } from '../errors/cascade-dmmf-missing.error';
import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';
import { isCascadeConfigured, requireCascadeDmmf, resolveCascadeDmmf } from './dmmf-resolver';

const optionsDmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'OptionsModel',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
    ],
  },
};

const fallbackDmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'FallbackModel',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
    ],
  },
};

const prismaDmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'PrismaModel',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
    ],
  },
};

describe('isCascadeConfigured', () => {
  it('should return false when cascade is undefined or empty', () => {
    expect(isCascadeConfigured(undefined)).toBe(false);
    expect(isCascadeConfigured({})).toBe(false);
  });

  it('should return true when cascade has at least one parent key', () => {
    expect(isCascadeConfigured({ User: ['Post'] })).toBe(true);
  });
});

describe('resolveCascadeDmmf', () => {
  it('should prefer options dmmf over fallback and Prisma static dmmf', () => {
    const result = resolveCascadeDmmf({
      optionsDmmf,
      fallbackDmmf,
      prismaDmmf,
    });

    expect(result).toBe(optionsDmmf);
  });

  it('should use fallback dmmf when options dmmf is absent', () => {
    const result = resolveCascadeDmmf({
      fallbackDmmf,
      prismaDmmf,
    });

    expect(result).toBe(fallbackDmmf);
  });

  it('should use Prisma static dmmf when explicit sources are absent', () => {
    const result = resolveCascadeDmmf({
      prismaDmmf,
    });

    expect(result).toBe(prismaDmmf);
  });
});

describe('requireCascadeDmmf', () => {
  it('should return the resolved dmmf when one is available', () => {
    expect(requireCascadeDmmf({ optionsDmmf })).toBe(optionsDmmf);
  });

  it('should throw CascadeDmmfMissingError when no dmmf is available', () => {
    expect(() =>
      requireCascadeDmmf({
        optionsDmmf: undefined,
        fallbackDmmf: undefined,
        prismaDmmf: undefined,
      }),
    ).toThrow(CascadeDmmfMissingError);
  });
});
```

- [ ] **Step 2: Run the resolver tests to verify they fail**

Run:

```bash
npm test -- src/prisma/dmmf-resolver.spec.ts
```

Expected: FAIL because `src/prisma/dmmf-resolver.ts` does not exist.

- [ ] **Step 3: Implement the shared resolver**

Create `src/prisma/dmmf-resolver.ts`:

```ts
import { Prisma } from '@prisma/client';
import { CascadeDmmfMissingError } from '../errors/cascade-dmmf-missing.error';
import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';

export interface ResolveCascadeDmmfOptions {
  optionsDmmf?: PrismaDmmfLike;
  fallbackDmmf?: PrismaDmmfLike;
  prismaDmmf?: PrismaDmmfLike;
}

export function isCascadeConfigured(cascade?: Record<string, string[]>): boolean {
  return !!cascade && Object.keys(cascade).length > 0;
}

export function resolveCascadeDmmf({
  optionsDmmf,
  fallbackDmmf,
  prismaDmmf = (Prisma as any).dmmf,
}: ResolveCascadeDmmfOptions): PrismaDmmfLike | undefined {
  return optionsDmmf ?? fallbackDmmf ?? prismaDmmf;
}

export function requireCascadeDmmf(options: ResolveCascadeDmmfOptions): PrismaDmmfLike {
  const dmmf = resolveCascadeDmmf(options);

  if (!dmmf) {
    throw new CascadeDmmfMissingError();
  }

  return dmmf;
}
```

- [ ] **Step 4: Run the resolver tests to verify they pass**

Run:

```bash
npm test -- src/prisma/dmmf-resolver.spec.ts
```

Expected: PASS for all resolver tests.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/prisma/dmmf-resolver.ts src/prisma/dmmf-resolver.spec.ts
git commit -m "feat: resolve cascade dmmf metadata"
```

---

### Task 3: Wire DMMF Resolution Into The Standalone Extension

**Files:**
- Modify: `src/prisma/soft-delete-extension.ts`
- Modify: `src/prisma/soft-delete-extension.spec.ts`

- [ ] **Step 1: Add failing extension cascade tests**

Inside `describe('cascade integration', () => { ... })`, add this DMMF fixture after `cascadeDmmf`:

```ts
const optionsPriorityDmmf = {
  datamodel: {
    models: [
      {
        name: 'User',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
      {
        name: 'Post',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
          { name: 'ownerId', kind: 'scalar', type: 'String' },
          {
            name: 'owner',
            kind: 'object',
            type: 'User',
            relationName: 'UserOwnedPosts',
            relationFromFields: ['ownerId'],
            relationToFields: ['id'],
          },
        ],
      },
    ],
  },
};
```

Replace the existing test named `should NOT trigger cascade when dmmf is not provided` with these two tests:

```ts
it('should prefer options.dmmf over the internal fallback dmmf', async () => {
  const cascadeHandlers = _buildSoftDeleteQueryHandlers(
    {
      ...cascadeOptions,
      dmmf: optionsPriorityDmmf,
    },
    cascadeDmmf,
  );
  const client = createCascadeMockClient();
  const query = createMockQuery();

  await cascadeHandlers.delete({
    model: 'User',
    args: { where: { id: 'user-1' } },
    query,
    client,
  });

  expect(client.post.updateMany).toHaveBeenCalledWith({
    where: {
      ownerId: 'user-1',
      deletedAt: null,
    },
    data: {
      deletedAt: expect.any(Date),
    },
  });
});

it('should throw CascadeDmmfMissingError when cascade is configured and Prisma.dmmf is unavailable', async () => {
  vi.resetModules();
  vi.doMock('@prisma/client', () => ({
    Prisma: {
      defineExtension: vi.fn((extensionFactory: any) => extensionFactory),
    },
  }));

  try {
    const { _buildSoftDeleteQueryHandlers } = await import('./soft-delete-extension');
    const { CascadeDmmfMissingError } = await import('../errors/cascade-dmmf-missing.error');

    expect(() =>
      _buildSoftDeleteQueryHandlers({
        softDeleteModels: ['User', 'Post'],
        cascade: { User: ['Post'] },
      }),
    ).toThrow(CascadeDmmfMissingError);
  } finally {
    vi.doUnmock('@prisma/client');
    vi.resetModules();
  }
});
```

- [ ] **Step 2: Run the focused extension tests to verify they fail**

Run:

```bash
npm test -- src/prisma/soft-delete-extension.spec.ts
```

Expected: FAIL. The priority test fails because `options.dmmf` is not used, or the missing-DMMF test fails because cascade silently disables itself.

- [ ] **Step 3: Implement DMMF resolution in `_buildSoftDeleteQueryHandlers`**

Update imports at the top of `src/prisma/soft-delete-extension.ts`:

```ts
import { Prisma } from '@prisma/client';
import { CascadeHandler } from './cascade-handler';
import { isCascadeConfigured, requireCascadeDmmf } from './dmmf-resolver';
import type { PrismaDmmfLike, SoftDeleteExtensionOptions } from '../interfaces/soft-delete-options.interface';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { DEFAULT_DELETED_AT_FIELD, DEFAULT_MAX_CASCADE_DEPTH } from '../soft-delete.constants';
import { SoftDeletedEvent } from '../events/soft-delete.events';
import { getRegisteredSoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
```

Change the `_buildSoftDeleteQueryHandlers` signature:

```ts
export function _buildSoftDeleteQueryHandlers(
  options: SoftDeleteExtensionOptions,
  dmmf?: PrismaDmmfLike,
): SoftDeleteQueryHandlers {
```

Replace the current cascade handler construction block with:

```ts
let cascadeHandler: CascadeHandler | null = null;
if (isCascadeConfigured(options.cascade)) {
  const cascadeDmmf = requireCascadeDmmf({
    optionsDmmf: options.dmmf,
    fallbackDmmf: dmmf,
  });

  cascadeHandler = new CascadeHandler({
    cascade: options.cascade!,
    deletedAtField,
    deletedByField,
    maxCascadeDepth: options.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH,
    dmmf: cascadeDmmf,
  });
}
```

Keep `createPrismaSoftDeleteExtension()` source-compatible by leaving this call in place:

```ts
const handlers = _buildSoftDeleteQueryHandlers(options, (Prisma as any).dmmf);
```

- [ ] **Step 4: Run the focused extension tests to verify they pass**

Run:

```bash
npm test -- src/prisma/soft-delete-extension.spec.ts
```

Expected: PASS for all tests in `soft-delete-extension.spec.ts`.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/prisma/soft-delete-extension.ts src/prisma/soft-delete-extension.spec.ts
git commit -m "fix: require dmmf for cascade extension"
```

---

### Task 4: Wire DMMF Resolution Into The Nest Module Provider

**Files:**
- Modify: `src/soft-delete.module.ts`
- Modify: `src/soft-delete.module.spec.ts`

- [ ] **Step 1: Add failing module provider tests**

Update the Vitest import in `src/soft-delete.module.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
```

Add this fixture near the existing `options` constant:

```ts
const cascadeDmmf = {
  datamodel: {
    models: [
      {
        name: 'User',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
      {
        name: 'Post',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
          { name: 'ownerId', kind: 'scalar', type: 'String' },
          {
            name: 'owner',
            kind: 'object',
            type: 'User',
            relationFromFields: ['ownerId'],
          },
        ],
      },
    ],
  },
};
```

Replace the test named `should return CascadeHandler when cascade is configured` with:

```ts
it('should return CascadeHandler when cascade is configured with explicit dmmf', () => {
  const cascadeOptions = {
    ...options,
    cascade: { User: ['Post'] },
    dmmf: cascadeDmmf,
  };
  const dynamicModule = SoftDeleteModule.forRoot(cascadeOptions);
  const cascadeProvider = dynamicModule.providers?.find(
    (p: any) => p.provide === CascadeHandler,
  ) as any;

  const result = cascadeProvider.useFactory(cascadeOptions);

  expect(result).toBeInstanceOf(CascadeHandler);
  expect(result.findForeignKey('User', 'Post')).toBe('ownerId');
});
```

Add this test in the same `buildCascadeHandlerProvider` block:

```ts
it('should throw CascadeDmmfMissingError when cascade is configured and Prisma.dmmf is unavailable', async () => {
  vi.resetModules();
  vi.doMock('@prisma/client', () => ({
    Prisma: {},
  }));

  try {
    const { SoftDeleteModule } = await import('./soft-delete.module');
    const { CascadeHandler } = await import('./prisma/cascade-handler');
    const { CascadeDmmfMissingError } = await import('./errors/cascade-dmmf-missing.error');

    const cascadeOptions = {
      ...options,
      cascade: { User: ['Post'] },
    };
    const dynamicModule = SoftDeleteModule.forRoot(cascadeOptions);
    const cascadeProvider = dynamicModule.providers?.find(
      (p: any) => p.provide === CascadeHandler,
    ) as any;

    expect(() => cascadeProvider.useFactory(cascadeOptions)).toThrow(CascadeDmmfMissingError);
  } finally {
    vi.doUnmock('@prisma/client');
    vi.resetModules();
  }
});
```

- [ ] **Step 2: Run the focused module tests to verify they fail**

Run:

```bash
npm test -- src/soft-delete.module.spec.ts
```

Expected: FAIL because `SoftDeleteModule` still ignores `options.dmmf` and does not use `CascadeDmmfMissingError`.

- [ ] **Step 3: Implement module provider DMMF resolution**

Update imports at the top of `src/soft-delete.module.ts`:

```ts
import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from './soft-delete.constants';
import { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions } from './interfaces/soft-delete-options.interface';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import { SoftDeleteActorMiddleware } from './middleware/soft-delete-actor.middleware';
import { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';
import { CascadeHandler } from './prisma/cascade-handler';
import { isCascadeConfigured, requireCascadeDmmf } from './prisma/dmmf-resolver';
import { DEFAULT_DELETED_AT_FIELD, DEFAULT_MAX_CASCADE_DEPTH } from './soft-delete.constants';
```

Replace `buildCascadeHandlerProvider()` with:

```ts
function buildCascadeHandlerProvider() {
  return {
    provide: CascadeHandler,
    useFactory: (options: SoftDeleteModuleOptions) => {
      if (!isCascadeConfigured(options.cascade)) {
        return null;
      }

      const dmmf = requireCascadeDmmf({
        optionsDmmf: options.dmmf,
      });

      return new CascadeHandler({
        cascade: options.cascade!,
        deletedAtField: options.deletedAtField ?? DEFAULT_DELETED_AT_FIELD,
        deletedByField: options.deletedByField,
        maxCascadeDepth: options.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH,
        dmmf,
      });
    },
    inject: [SOFT_DELETE_MODULE_OPTIONS],
  };
}
```

- [ ] **Step 4: Run the focused module tests to verify they pass**

Run:

```bash
npm test -- src/soft-delete.module.spec.ts
```

Expected: PASS for all tests in `soft-delete.module.spec.ts`.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/soft-delete.module.ts src/soft-delete.module.spec.ts
git commit -m "fix: require dmmf for module cascade provider"
```

---

### Task 5: Document Prisma 7 DMMF Injection And Release Notes

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the module option documentation**

In the `Configuration` table in `README.md`, add this row after `maxCascadeDepth`:

```md
| `dmmf` | `PrismaDmmfLike` | `Prisma.dmmf` when available | Explicit Prisma DMMF metadata for cascade relation lookup. Required for cascade when Prisma does not expose `Prisma.dmmf`, including Prisma 7. |
```

- [ ] **Step 2: Add the Prisma 7 cascade note**

After the paragraph ending with `maxCascadeDepth` levels deep. in `README.md`, add:

````md
### Prisma 7 cascade metadata

Cascade relation lookup requires Prisma DMMF metadata. Prisma 5 and 6 expose this through `Prisma.dmmf`, so no extra configuration is required in the default client setup. Prisma 7 does not expose `Prisma.dmmf` in the same way, so pass DMMF explicitly when using cascade:

```typescript
import { readFileSync } from 'node:fs';
import { getDMMF } from '@prisma/internals';
import { SoftDeleteModule } from '@nestarc/soft-delete';
import { PrismaService } from './prisma.service';

const datamodel = readFileSync('prisma/schema.prisma', 'utf8');
const dmmf = await getDMMF({ datamodel });

SoftDeleteModule.forRoot({
  softDeleteModels: ['User', 'Post'],
  cascade: {
    User: ['Post'],
  },
  dmmf,
  prismaServiceToken: PrismaService,
});
```

`@nestarc/soft-delete` does not depend on `@prisma/internals`; install and use it in your application only if you choose this DMMF generation approach. Prisma 7 support is limited to this explicit DMMF path until the package is fully tested against Prisma 7 and peer dependencies are updated.
````

- [ ] **Step 3: Add standalone extension documentation**

In the `Standalone Usage` example in `README.md`, add `dmmf` after `maxCascadeDepth: 3`:

```ts
    maxCascadeDepth: 3,
    dmmf,
```

In the `SoftDeleteExtensionOptions` table in `README.md`, add this row after `maxCascadeDepth`:

```md
| `dmmf` | `PrismaDmmfLike` | `Prisma.dmmf` when available | Explicit Prisma DMMF metadata for cascade relation lookup. Required for cascade when Prisma does not expose `Prisma.dmmf`, including Prisma 7. |
```

- [ ] **Step 4: Update the API reference**

In the README API Reference table, add:

```md
| `CascadeDmmfMissingError` | Error | Thrown when cascade is configured but no Prisma DMMF metadata is available. |
| `PrismaDmmfLike` | Interface | Minimal DMMF shape accepted by the `dmmf` option. |
```

Place `CascadeDmmfMissingError` next to the other errors and `PrismaDmmfLike` next to the option interfaces.

- [ ] **Step 5: Add changelog release notes**

Add this section above `## [0.2.0] - 2026-04-05` in `CHANGELOG.md`:

```md
## [Unreleased]

### Added

- `dmmf` option for `SoftDeleteModuleOptions` and `SoftDeleteExtensionOptions`, enabling explicit cascade metadata injection for Prisma versions that do not expose `Prisma.dmmf`.
- `CascadeDmmfMissingError`, thrown when cascade is configured but DMMF metadata is unavailable.

### Fixed

- Cascade setup now fails early with a clear DMMF configuration error instead of silently disabling cascade when metadata is missing.
```

- [ ] **Step 6: Run documentation and focused code tests**

Run:

```bash
npm test -- src/errors/soft-delete-errors.spec.ts src/prisma/dmmf-resolver.spec.ts src/prisma/soft-delete-extension.spec.ts src/soft-delete.module.spec.ts
```

Expected: PASS for all listed test files.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document prisma 7 dmmf cascade setup"
```

---

### Task 6: Full Verification

**Files:**
- Verify all modified source, tests, docs, and package exports.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 2: Run the build**

Run:

```bash
npm run build
```

Expected: exit code 0 and generated build output under `dist`.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat
git diff
```

Expected: no unstaged changes after the task commits. If `dist` appears because the build generated local artifacts, remove it only if it is ignored or untracked build output; do not remove tracked source or user changes.

- [ ] **Step 4: Confirm package export surface**

Run:

```bash
rg -n "PrismaDmmfLike|CascadeDmmfMissingError|dmmf" src README.md CHANGELOG.md
```

Expected: matches in option interfaces, resolver/handler usage, tests, README, CHANGELOG, and `src/index.ts`.

- [ ] **Step 5: Commit verification-only adjustments if any were required**

If verification required a small source, test, or documentation correction, run:

```bash
git add src/errors/cascade-dmmf-missing.error.ts src/errors/soft-delete-errors.spec.ts src/interfaces/soft-delete-options.interface.ts src/prisma/cascade-handler.ts src/prisma/dmmf-resolver.ts src/prisma/dmmf-resolver.spec.ts src/prisma/soft-delete-extension.ts src/prisma/soft-delete-extension.spec.ts src/soft-delete.module.ts src/soft-delete.module.spec.ts src/index.ts README.md CHANGELOG.md
git commit -m "chore: finalize prisma 7 dmmf cascade support"
```

If verification produced no changes, do not create an empty commit.

---

## Self-Review Checklist

- Spec goal "Prisma 5/6 users keep existing behavior" maps to Task 2 fallback resolution and Task 3 keeping the internal fallback DMMF argument.
- Spec goal "Prisma 7 users pass DMMF explicitly" maps to Task 1 public `dmmf` option, Task 3 extension priority test, Task 4 module provider test, and Task 5 README examples.
- Spec goal "fail early with clear error" maps to Task 1 error class, Task 2 `requireCascadeDmmf`, Task 3 missing-DMMF extension test, and Task 4 missing-DMMF module test.
- Spec non-goal "do not add @prisma/internals runtime dependency" maps to Task 5 documentation wording and no package dependency changes.
- Spec non-goal "do not declare broad Prisma 7 peer support" maps to no `package.json` peer dependency change in this plan.
- Verification is explicit in Task 6 with `npm test`, `npm run build`, diff inspection, and export search.
