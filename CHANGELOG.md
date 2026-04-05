# Changelog

All notable changes to `@nestarc/soft-delete` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
