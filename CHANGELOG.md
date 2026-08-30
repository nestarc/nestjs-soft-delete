# Changelog

All notable changes to `@nestarc/soft-delete` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.2] - 2026-08-30

### Changed

- Extend the optional `@nestarc/tenancy` peer range to `^0.15.0 || ^0.16.0` after
  strict packed-candidate installation and PostgreSQL composition coverage.
- Add a reusable candidate runner and exact Node.js 22.13/current 24 workflow so
  tenancy's 0.16 runtime floor is verified without force or legacy peer bypasses.

## [0.7.1] - 2026-08-28

### Changed

- Extend the optional `@nestarc/audit-log` peer range to `^0.4.1 || ^0.5.0`. Both lines use the
  same fail-closed atomic lifecycle capability handshake; no soft-delete runtime behavior changes.

## [0.7.0] - 2026-08-27

### Added

- Opt-in `auditLifecycle: 'atomic-required'` integration with `@nestarc/audit-log`, using the fixed
  tenancy → audit-log → soft-delete extension order and `withAuditTransaction()`.
- Deterministic record actions: `Model.softDeleted`, `Model.restored`, and `Model.purged`, with
  record-level cascade and bulk metadata.
- `auditMaxBatchRecords` fail-closed cap for atomic `deleteMany` and `restoreMany` conversion.
- PostgreSQL cross-package E2E coverage for commit/rollback, repeated operations, restore,
  force-delete/purge, cascade, bulk mutation, cap overflow, and tenant metadata against published
  `@nestarc/audit-log@0.4.1` and `@nestarc/tenancy@0.15.0` packages.
- Real optional peer contracts for audit-log, tenancy, and event-emitter integrations.

### Changed

- Single delete and restore require the row to be active/deleted respectively, making repeated
  lifecycle operations fail without producing misleading evidence.

### Fixed

- Preserve state, relation, and timestamp predicates between lifecycle pre-reads and mutations so
  concurrent or repeated bulk/cascade work fails closed instead of emitting misleading evidence.
- Guard restore and cascade-restore mutations with the exact captured deletion timestamp, closing
  restore/re-delete ABA races.
- Resolve custom primary keys from DMMF for audited bulk operations without cascade configuration.
- Validate lifecycle options on both Prisma extension and NestJS service paths.
- Require audit-log 0.4.1's atomic capability handshake, rejecting legacy and best-effort clients
  before a lifecycle mutation runs.
- Emit bulk lifecycle notifications after leaving the audit lifecycle context.

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
