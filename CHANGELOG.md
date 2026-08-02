# Changelog

All notable changes to `@nestarc/soft-delete` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-08-02

### Added

- Active-row unique constraint recipe for PostgreSQL, SQLite, and MySQL.
- PostgreSQL E2E proof that a partial unique index permits value reuse after soft-delete while rejecting duplicate active rows.
- Release package verification with `npm pack --dry-run`.
- Compatibility workflow for NestJS 10 + Prisma 5 on Node 20 and NestJS 11 + Prisma 6 on Node 22.
- Opt-in `relationFilters` support for to-many Prisma `include` / `select` trees.
- `@WithDeletedRelations(...paths)` decorator for relation-specific deleted-row inclusion.
- `RelationDmmfMissingError` for relation filters enabled without Prisma DMMF metadata.
- `SoftDeleteService.restoreMany()` bulk restore API with cascade restore support.
- Optional `count` payloads on `SoftDeletedEvent` and `RestoredEvent` for bulk operations.
- PostgreSQL E2E coverage for relation filters and bulk restore behavior.
- Prisma 7 compatibility coverage using the `prisma-client` generator, Prisma Config, and the PostgreSQL driver adapter.
- Prisma 7 added to the published peer dependency range and compatibility workflow.

### Changed

- Release workflow now publishes through npm trusted publishing with GitHub OIDC instead of a long-lived `NPM_TOKEN`.
- Prisma 7 is now the primary development, generated-client, and PostgreSQL E2E target.
- Shared extension creation now imports from `@prisma/client/extension`, decoupling the package from a consumer's generated client output.
- Cascade and relation filters now require explicit `dmmf` metadata instead of relying on generated-client runtime metadata.

### Fixed

- Release workflow now runs lint before publishing.
- `deleteMany` soft-delete updates now target active rows only so already soft-deleted rows do not get a new deletion timestamp.

## [0.4.0] - 2026-05-10

### Added

- PostgreSQL-backed E2E coverage for cascade soft-delete, cascade restore, purge, lifecycle events, and full NestJS HTTP integration.
- Release workflow E2E gate so tagged npm publishes run the same PostgreSQL integration suite before publishing.
- Cascade restore E2E coverage for children deleted outside the parent timestamp window.

### Fixed

- `SoftDeleteService.restore()` now runs cascade restore in a `withDeleted` context so nested soft-deleted descendants can be found and restored.
- NestJS integration now uses explicit injection metadata for `SoftDeleteFilterInterceptor` and the optional `SoftDeleteEventEmitter`, improving reliability in build/test environments where reflected constructor metadata is not available.
- E2E tests now run test files serially to avoid shared PostgreSQL table setup/teardown races.
- NestJS E2E modules now provide Prisma and EventEmitter dependencies through imported provider modules, matching how `SoftDeleteModule.forRootAsync()` resolves providers.

## [0.3.0] - 2026-05-01

### Added

- `dmmf` option for `SoftDeleteModuleOptions` and `SoftDeleteExtensionOptions`, enabling explicit cascade metadata injection for Prisma versions that do not expose `Prisma.dmmf`.
- `CascadeDmmfMissingError`, thrown when cascade is configured but DMMF metadata is unavailable.

### Fixed

- Cascade setup now fails early with a clear DMMF configuration error instead of silently disabling cascade when metadata is missing.

## [0.2.0] - 2026-04-05

### Added

- **Event system** — lifecycle events emitted on soft-delete, restore, and purge operations
  - `SoftDeletedEvent` (`soft-delete.deleted`) — emitted after `delete()` / `deleteMany()` interception
  - `RestoredEvent` (`soft-delete.restored`) — emitted after `SoftDeleteService.restore()`
  - `PurgedEvent` (`soft-delete.purged`) — emitted after `SoftDeleteService.purge()` when count > 0
  - `SoftDeleteEventEmitter` — wrapper with graceful degradation when `@nestjs/event-emitter` is not installed
  - `enableEvents` option in `SoftDeleteModuleOptions` to opt in
- **Purge API** — `SoftDeleteService.purge(model, { olderThan, where? })` permanently deletes soft-deleted records older than a given date
- **CascadeHandler module registration** — `CascadeHandler` is now registered as a factory provider in `SoftDeleteModule`, enabling cascade restore via `SoftDeleteService.restore()` in NestJS DI context
- Comprehensive README with Quick Start, Configuration, Decorators, Cascade, Events, Purge, Testing, Unique Constraint Strategy, Standalone Usage, and API Reference sections
- `@nestjs/event-emitter` as optional peer dependency

### Fixed

- `RestoredEvent` now includes `actorId` from `SoftDeleteContext` (was previously omitted)
- `SoftDeleteService.restore()` uses dynamic PK field via `CascadeHandler.findPrimaryKey()` instead of hardcoded `record.id`
- README Quick Start includes PrismaService setup step with `createPrismaSoftDeleteExtension()`

## [0.1.0] - 2026-04-05

### Added

- Initial release
- Prisma client extension via `createPrismaSoftDeleteExtension()` — intercepts `delete`/`deleteMany` as soft-delete updates
- Automatic query filtering on `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy` (excludes soft-deleted records by default)
- `SoftDeleteModule` with `forRoot()` and `forRootAsync()` registration
- `SoftDeleteService` with `restore()`, `forceDelete()`, `withDeleted()`, `onlyDeleted()` methods
- `SoftDeleteContext` — AsyncLocalStorage-based context propagation across Prisma async chains
- Decorators: `@WithDeleted()`, `@OnlyDeleted()`, `@SkipSoftDelete()`
- `SoftDeleteFilterInterceptor` — maps decorator metadata to context
- `SoftDeleteActorMiddleware` — extracts actor ID from request via `actorExtractor`
- Cascade soft-delete and restore via `CascadeHandler` (DMMF-based FK resolution)
- Configurable field names (`deletedAtField`, `deletedByField`)
- Testing utilities: `TestSoftDeleteModule`, `expectSoftDeleted`, `expectNotSoftDeleted`, `expectCascadeSoftDeleted`
- Dual CJS/ESM build with TypeScript declarations
- CI/CD: GitHub Actions for lint, test, build, and npm release
