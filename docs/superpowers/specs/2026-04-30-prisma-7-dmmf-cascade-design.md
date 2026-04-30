# Prisma 7 DMMF Cascade Compatibility Design

## Context

GitHub issue #1 reports that cascade soft-delete fails with Prisma 7 because
the package resolves relation metadata through `Prisma.dmmf`. Prisma 7's default
client generation flow no longer exposes that runtime metadata in the same way,
so cascade relation resolution can fail before the package has enough metadata
to find the child model foreign key.

The current implementation uses DMMF in two places:

- `createPrismaSoftDeleteExtension()` passes `(Prisma as any).dmmf` into the
  query handler builder.
- `SoftDeleteModule` creates `CascadeHandler` with `(Prisma as any).dmmf`.

The package currently declares `@prisma/client` peer support for Prisma 5 and 6,
not Prisma 7. This change should improve the Prisma 7 path without breaking the
existing Prisma 5/6 behavior.

## Goals

- Keep existing Prisma 5/6 users working without configuration changes.
- Allow Prisma 7 users to use cascade by passing DMMF metadata explicitly.
- Fail early with a clear cascade configuration error when cascade is enabled
  but DMMF metadata is unavailable.
- Avoid adding `@prisma/internals` as a runtime dependency of this package.
- Keep non-cascade soft-delete behavior independent from DMMF.

## Non-Goals

- Do not declare broad Prisma 7 peer support as part of this change unless the
  package is tested against Prisma 7 separately.
- Do not auto-load or parse the user's Prisma schema inside this package.
- Do not change the cascade map format or relation lookup semantics beyond DMMF
  resolution and validation.

## Public API

Add a minimal DMMF-like option to both configuration surfaces:

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

```ts
export interface SoftDeleteExtensionOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  eventEmitter?: { emitSoftDeleted: (event: any) => void } | null;
  dmmf?: PrismaDmmfLike;
}
```

```ts
export interface SoftDeleteModuleOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  actorExtractor?: (req: any) => string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  prismaServiceToken: any;
  enableEvents?: boolean;
  dmmf?: PrismaDmmfLike;
}
```

## DMMF Resolution

Create one internal helper that resolves DMMF consistently:

```ts
function resolveCascadeDmmf(
  optionsDmmf: PrismaDmmfLike | undefined,
  fallbackDmmf?: PrismaDmmfLike,
): PrismaDmmfLike | undefined {
  return optionsDmmf ?? fallbackDmmf ?? (Prisma as any).dmmf;
}
```

When cascade is not configured, skip DMMF resolution and do not require the
option. When cascade is configured, use this priority order:

1. `options.dmmf`
2. explicit internal fallback DMMF passed to `_buildSoftDeleteQueryHandlers()`
3. `(Prisma as any).dmmf`
4. throw `CascadeDmmfMissingError`

This preserves current Prisma 5/6 behavior while giving Prisma 7 users an
explicit escape hatch.

Keep `_buildSoftDeleteQueryHandlers(options, dmmf?)` source-compatible because
the package already exports it for unit testing. The second argument remains an
internal/test fallback, while `options.dmmf` is the user-facing API.

## Error Handling

Add a dedicated error:

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

This error should be thrown during cascade handler construction, before any
query operation attempts relation lookup. It should not replace
`CascadeRelationNotFoundError`; that error remains correct when DMMF exists but
does not contain the configured parent-child relation.

## Usage Examples

Standalone extension:

```ts
const prisma = new PrismaClient().$extends(
  createPrismaSoftDeleteExtension({
    softDeleteModels: ['User', 'Post'],
    cascade: {
      User: ['Post'],
    },
    dmmf,
  }),
);
```

NestJS module:

```ts
SoftDeleteModule.forRoot({
  prismaServiceToken: PrismaService,
  softDeleteModels: ['User', 'Post'],
  cascade: {
    User: ['Post'],
  },
  dmmf,
});
```

The README can show `@prisma/internals` only as an application-side example for
users who choose that approach. The package itself should not depend on it.

## Tests

Add focused tests for:

- `createPrismaSoftDeleteExtension()` or its handler builder uses
  `options.dmmf` when cascade is configured.
- existing fallback to `(Prisma as any).dmmf` still works when `options.dmmf` is
  absent.
- cascade configured with no available DMMF throws `CascadeDmmfMissingError`.
- no cascade configured with no available DMMF does not throw.
- `SoftDeleteModule` passes `options.dmmf` into `CascadeHandler`.

Existing cascade behavior tests should continue to verify foreign key lookup,
primary key lookup, soft-delete cascade, restore cascade, and max depth.

## Documentation

Update README sections for:

- `SoftDeleteExtensionOptions`
- `SoftDeleteModuleOptions` or Quick Start cascade notes
- Prisma 7 cascade note explaining that DMMF must be passed explicitly

The documentation should state that Prisma 7 support is limited to this explicit
DMMF path until the package is fully tested and peer dependencies are updated.

## Release Notes

This is a backwards-compatible API addition:

- Prisma 5/6 users keep the existing zero-config cascade behavior.
- Prisma 7 users can opt into cascade by providing DMMF.
- Misconfigured cascade fails with a clear error instead of a misleading
  relation-not-found error.
