# @nestarc/soft-delete Implementation Design

Date: 2026-04-05
Status: Approved

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Full v0.1.0 (cascade included) | Design spec covers all features needed |
| Approach | Bottom-up | Core Prisma extension first, NestJS wrapper second |
| Build | npm + tsup | Simple, fast bundling |
| Test framework | vitest | Fast, ESM-native, good Prisma mock support |
| Test strategy | Unit + E2E with Docker | PostgreSQL via docker-compose for E2E |
| Target | ES2022 | AsyncLocalStorage native support |

## Architecture Layers

### Layer 1: Core (no NestJS dependency)

- `SoftDeleteContext` — AsyncLocalStorage for filter mode management
- `createPrismaSoftDeleteExtension()` — Pure function, standalone Prisma extension
- `CascadeHandler` — Cascade soft-delete/restore logic using Prisma DMMF

### Layer 2: NestJS Integration

- `SoftDeleteModule` — DynamicModule (forRoot/forRootAsync)
- `SoftDeleteService` — DI-friendly API: restore(), forceDelete(), withDeleted(), onlyDeleted()
- Decorators: @WithDeleted(), @OnlyDeleted(), @SkipSoftDelete()
- `SoftDeleteFilterInterceptor` — Reads decorator metadata, sets AsyncLocalStorage
- `SoftDeleteActorMiddleware` — Extracts deletedBy actor from request

### Layer 3: Optional Integrations

- `@nestarc/tenancy` — Optional peer dep, try/catch require for graceful degradation
- `@nestarc/audit-log` — Optional peer dep, auto-logs soft_deleted/restored/force_deleted events

### Layer 4: Testing Utilities

- `TestSoftDeleteModule` — Lightweight test module
- `expectSoftDeleted` / `expectNotSoftDeleted` / `expectCascadeSoftDeleted` — Test helpers

## Build Order (Bottom-up)

1. **Project scaffold** — package.json, tsconfig, tsup.config, vitest.config, docker-compose
2. **Interfaces & Constants** — SoftDeleteModuleOptions, SoftDeleteFilterMode, injection tokens
3. **SoftDeleteContext** — AsyncLocalStorage wrapper
4. **Prisma Extension** — Write interception (delete/deleteMany) + Read filtering
5. **CascadeHandler** — DMMF-based FK detection, recursive cascade with depth limit
6. **SoftDeleteService** — restore(), forceDelete(), withDeleted(), onlyDeleted()
7. **NestJS Module** — forRoot/forRootAsync, provider registration
8. **Decorators & Interceptor** — @WithDeleted, @OnlyDeleted, @SkipSoftDelete + interceptor
9. **Error classes** — SoftDeleteFieldMissingError, CascadeRelationNotFoundError
10. **Testing utilities** — TestSoftDeleteModule, test helpers
11. **Barrel export** — index.ts, testing/index.ts
12. **E2E test setup** — docker-compose, Prisma test schema, E2E tests
13. **Optional integrations** — tenancy + audit-log hooks

## File Structure

```
src/
  soft-delete.module.ts
  soft-delete.constants.ts
  interfaces/
    soft-delete-options.interface.ts
    soft-delete-context.interface.ts
  services/
    soft-delete.service.ts
    soft-delete-context.ts
  prisma/
    soft-delete-extension.ts
    cascade-handler.ts
  middleware/
    soft-delete-actor.middleware.ts
  decorators/
    with-deleted.decorator.ts
    only-deleted.decorator.ts
    skip-soft-delete.decorator.ts
  interceptors/
    soft-delete-filter.interceptor.ts
  errors/
    soft-delete-field-missing.error.ts
    cascade-relation-not-found.error.ts
  testing/
    test-soft-delete.module.ts
    expect-soft-deleted.ts
    index.ts
  index.ts
```
