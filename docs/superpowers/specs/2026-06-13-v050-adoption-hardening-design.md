# @nestarc/soft-delete v0.5.0 Adoption and Operational Hardening Design

Date: 2026-06-13
Status: Implemented

## Context

`@nestarc/soft-delete` is a NestJS-first soft-delete toolkit for Prisma. The
package identity is not a general ORM abstraction and not a NestJS architecture
pattern. The runtime mechanism is a Prisma client extension; the product
differentiator is the NestJS integration layer around it: dynamic module
registration, route decorators, request-scoped filter context, lifecycle events,
actor tracking, cascade support, purge, and testing helpers.

Version 0.4.0 already covers the base soft-delete workflow:

- `delete` and `deleteMany` are rewritten to timestamp updates.
- top-level read operations exclude soft-deleted records by default.
- `@WithDeleted`, `@OnlyDeleted`, and `@SkipSoftDelete` control request-scoped
  filter behavior.
- cascade soft-delete and timestamp-matched cascade restore are available when
  DMMF metadata is present.
- events, purge, actor tracking, dual ESM/CJS builds, and PostgreSQL E2E tests
  exist.

The 0.5.0 release should therefore avoid broad reinvention. Its purpose is to
make the package easier to adopt in real NestJS + Prisma services and to close
the highest-evidence gaps that remain after 0.4.0.

## Demand Signals

The demand research for this release points to four recurring user problems:

1. Users forget to add `deletedAt: null` to every Prisma query and want default
   active-only behavior.
2. Users expect relation reads and cascade behavior to respect soft-delete
   semantics, especially for parent-child business objects.
3. Users hit unique constraint conflicts because soft-deleted rows keep claiming
   values such as email, slug, or custom domain.
4. Users want restore and bulk operations to be observable enough for audit,
   support, and retention workflows.

Current public ecosystem signals also show that Prisma soft-delete demand is
real while this package is still early in adoption. During the 2026-06-06 to
2026-06-12 npm window, `prisma-extension-soft-delete` had 18,991 downloads and
the deprecated `prisma-soft-delete-middleware` still had 9,519 downloads, while
`@nestarc/soft-delete` had 13. GitHub public search on 2026-06-13 found 1,116
issues for `soft delete prisma`, 211 for `soft delete cascade prisma`, and 294
for `soft delete unique prisma`.

## Goals

- Preserve the package identity: NestJS-first Prisma soft-delete toolkit.
- Reduce adoption risk by strengthening release, compatibility, and packaging
  gates.
- Provide concrete guidance and validation for active-row unique constraints.
- Add a narrow relation-aware read-control MVP for to-many Prisma relation
  reads.
- Improve restore and bulk operation ergonomics without replacing the existing
  service model.
- Keep all new behavior backwards-compatible by default.

## Non-Goals

- Do not introduce a TypeORM, Sequelize, or database-agnostic ORM abstraction.
- Do not generate admin UI, trash UI, or full CRUD controllers.
- Do not claim broad Prisma 7 peer support until Prisma 7 is tested in CI.
- Do not implement full nested Prisma write interception. Prisma client query
  extensions do not reliably cover nested writes in the same way as top-level
  operations.
- Do not make cascade operations fully transactional in 0.5.0. That needs a
  separate design because Prisma transaction styles affect public usage.
- Do not add a CLI or migration generator unless a later design justifies the
  maintenance cost.

## Recommended Scope

The release consists of five workstreams:

1. Compatibility and release hardening.
2. Unique constraint recipe toolkit.
3. Relation-aware read-control MVP.
4. Restore and bulk-operation ergonomics.
5. Documentation, examples, and release metadata.

These workstreams are intentionally ordered from low-risk adoption work to
higher-risk runtime behavior. If the release needs to be cut smaller, ship
workstreams 1, 2, and 5 first.

## Design Principles

- Default behavior remains compatible with 0.4.x unless a bug fix is already
  documented as a behavior correction.
- Runtime options are opt-in when they can change query shape.
- Public APIs use the current naming style: direct NestJS decorators, module
  options, `SoftDeleteService` methods, and small exported types.
- Metadata-dependent features fail early with explicit errors when required
  DMMF metadata is missing.
- Documentation must describe unsupported cases as clearly as supported cases.

## Workstream 1: Compatibility and Release Hardening

### Problem

The package peer range promises NestJS 10/11 and Prisma 5/6, but the default dev
dependency set only exercises one current dependency combination. A user choosing
the older end of the supported peer range should not be the first person to test
that combination.

### Design

Add a compatibility verification path that installs and tests representative
peer dependency combinations:

| Axis | Values |
|------|--------|
| Node.js | 20, 22 |
| NestJS | 10, 11 |
| Prisma | 5, 6 |

The normal CI can keep the current fast path. Add either a separate
compatibility workflow or a matrix job that runs a smaller smoke suite for the
oldest and newest supported combinations:

- NestJS 10 + Prisma 5 + Node 20
- NestJS 11 + Prisma 6 + Node 22

The smoke suite must run at least:

- `npm run lint`
- `npm test`
- `npm run build`
- a PostgreSQL E2E smoke that covers extension setup, soft-delete, restore, and
  cascade when the dependency combination supports it

Release workflow gates must be at least as strict as CI:

- install
- lint
- unit tests
- PostgreSQL E2E
- build
- package verification with `npm pack --dry-run`
- publish

### Acceptance Criteria

- The repository has a documented command or workflow that proves the supported
  peer range is tested.
- The release workflow cannot publish without lint, unit tests, E2E tests, and
  build passing.
- `npm pack --dry-run` output is checked in release CI so missing files in the
  package surface before publish.
- README states the tested compatibility matrix separately from the peer range.

## Workstream 2: Unique Constraint Recipe Toolkit

### Problem

Soft-deleted rows still participate in normal unique constraints. A user who
soft-deletes `User.email = "a@example.com"` may still be blocked from creating a
new active user with that email. Prisma schema syntax cannot express every
database-specific active-row unique constraint strategy.

### Design

Keep unique constraint handling as a documentation and validation toolkit in
0.5.0, not as a runtime generator.

Add `docs/recipes/unique-constraints.md` with database-specific recipes:

- PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX users_email_active_unique
  ON "User" ("email")
  WHERE "deletedAt" IS NULL;
```

- SQLite partial unique index:

```sql
CREATE UNIQUE INDEX users_email_active_unique
  ON User (email)
  WHERE deletedAt IS NULL;
```

- MySQL generated-column strategy:

```sql
ALTER TABLE users
  ADD active_email VARCHAR(255)
    GENERATED ALWAYS AS (
      CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
    ) STORED,
  ADD UNIQUE INDEX users_active_email_unique (active_email);
```

The recipe must also explain why `@@unique([email, deletedAt])` is not a safe
portable solution: databases commonly treat `NULL` values as distinct, which can
allow duplicate active rows.

Add a PostgreSQL E2E fixture that proves the recommended partial unique index:

1. Create an active user with an email.
2. Attempt to create another active user with the same email and observe the
   database rejection.
3. Soft-delete the first user.
4. Create a new active user with the same email.
5. Assert both rows exist, but only one active row owns the email.

### Acceptance Criteria

- README links to the unique constraint recipe from the Quick Start,
  Troubleshooting, and API/reference area.
- PostgreSQL E2E proves the partial-index recipe works with this package.
- The docs include clear recipes for PostgreSQL, SQLite, and MySQL.
- No runtime migration generator is added in 0.5.0.

## Workstream 3: Relation-Aware Read-Control MVP

### Problem

Top-level read filtering is solved, but relation reads remain a major source of
user confusion. Users often expect `include: { posts: true }` to exclude
soft-deleted posts when `Post` is a soft-delete model. They also need an escape
hatch to include deleted children for admin or trash views.

### Scope Boundaries

0.5.0 supports only to-many relation read filtering in Prisma `include` and
`select` trees. It does not support to-one relation filtering because Prisma
does not allow `where` on to-one includes in the same shape. It also does not
intercept nested writes.

### Public API

Add an opt-in extension/module option:

```ts
interface RelationFilterOptions {
  enabled?: boolean;
  maxDepth?: number;
}

interface SoftDeleteExtensionOptions {
  relationFilters?: boolean | RelationFilterOptions;
}

interface SoftDeleteModuleOptions {
  relationFilters?: boolean | RelationFilterOptions;
}
```

Default: `false`.

When enabled, relation-aware filtering applies the same filter mode as the
current `SoftDeleteContext` to to-many relation reads:

- default mode: inject `deletedAt: null`
- `withDeleted` mode: do not inject a relation filter
- `onlyDeleted` mode: inject `deletedAt: { not: null }`
- skipped mode: do not inject any relation filter

Add a route decorator for the most common admin escape hatch:

```ts
@WithDeletedRelations('posts', 'posts.comments')
```

The decorator keeps the root query in normal default mode while allowing deleted
records for the listed relation paths. Paths are dot-separated relation field
names. Paths are exact: `posts` does not automatically include
`posts.comments`.

### Metadata Requirements

Relation filtering requires model relation metadata. Extend `PrismaDmmfLike`
with `isList?: boolean` so the package can identify to-many relation fields:

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
        isList?: boolean;
        relationFromFields?: string[];
      }>;
    }>;
  };
}
```

When `relationFilters` is enabled and DMMF metadata is unavailable, module or
extension construction must fail early with a metadata error that says relation
filters require DMMF. Reuse a generalized metadata error if the implementation
introduces one; otherwise add a dedicated `RelationDmmfMissingError`.

### Internal Design

Add a helper such as `applyRelationReadFilters(args, model, context, metadata)`.
The helper recursively walks `include` and `select` entries:

1. Resolve the current Prisma model definition from DMMF.
2. For each included/selected field, identify relation fields where
   `kind === 'object'`.
3. Skip fields that are not to-many relations.
4. Skip child models that are not listed in `softDeleteModels`.
5. Convert `true` relation selections into an object form when a filter must be
   injected.
6. Merge the relation `where` with the soft-delete filter.
7. Recurse into nested `include` and `select` until `maxDepth`.
8. Skip exact relation paths listed by `@WithDeletedRelations`.

If the user already provides a `where.deletedAt` on a relation, the package
follows existing top-level semantics: the current soft-delete filter wins unless
the relation path is explicitly allowed with `@WithDeletedRelations`.

### Examples

Default relation filtering:

```ts
await prisma.user.findMany({
  include: {
    posts: true,
  },
});
```

When `relationFilters: true`, the package sends Prisma an equivalent shape:

```ts
await prisma.user.findMany({
  where: { deletedAt: null },
  include: {
    posts: {
      where: { deletedAt: null },
    },
  },
});
```

Admin route that includes deleted posts but keeps active users at the root:

```ts
@Get('users/:id/posts')
@WithDeletedRelations('posts')
findUserWithPosts() {
  return this.prisma.client.user.findFirst({
    where: { id },
    include: { posts: true },
  });
}
```

### Acceptance Criteria

- Relation filtering is off by default.
- When enabled, to-many relation includes/selects for soft-delete models are
  filtered by default.
- `@WithDeletedRelations` can include deleted rows for exact relation paths
  without switching the root query to `withDeleted`.
- To-one relation limitations are documented and covered by tests.
- Missing DMMF with relation filters enabled fails during construction, not at
  an arbitrary query later.

## Workstream 4: Restore and Bulk-Operation Ergonomics

### Problem

Single-record restore exists, but teams often build admin trash views and bulk
operations. They need a service API that can restore multiple records and an
event payload that gives downstream listeners enough information to audit bulk
changes.

### Public API

Add `restoreMany` to `SoftDeleteService`:

```ts
interface RestoreManyOptions {
  where?: Record<string, any>;
}

class SoftDeleteService {
  restoreMany(
    model: string,
    options?: RestoreManyOptions,
  ): Promise<{ count: number }>;
}
```

Semantics:

- Only soft-deleted records are restored.
- `deletedAtField` is set to `null`.
- `deletedByField`, when configured, is set to `null`.
- The method runs in a `withDeleted` context so it can find deleted rows.
- If cascade is configured, it captures each matching row's primary key and
  original `deletedAt` before the bulk update, then calls cascade restore per
  row.
- It returns the count from the parent model update.

Add optional `count` fields to event payloads where the operation can know it:

```ts
class SoftDeletedEvent {
  readonly count?: number;
}

class RestoredEvent {
  readonly count?: number;
}
```

Existing event constructor arguments remain source-compatible by adding optional
parameters at the end. Single-record operations can use `count: 1`; bulk
operations use the affected count.

Do not add separate `SoftDeletedManyEvent` or `RestoredManyEvent` in 0.5.0.
Keeping the event names stable makes adoption easier for current listeners.

### Documentation

Add examples for:

- trash list with `onlyDeleted`
- restoring one record
- restoring many records by filter
- admin route that restores selected IDs
- event listener that logs `count`

### Acceptance Criteria

- `restoreMany` restores only deleted parent rows.
- `restoreMany` clears `deletedByField` when configured.
- `restoreMany` performs timestamp-matched cascade restore for each matching
  parent row when cascade is configured.
- `RestoredEvent` includes `count` for `restoreMany`.
- Existing `restore` behavior remains source-compatible.

## Workstream 5: Documentation and Release Metadata

### README Updates

Update README sections in this order:

1. Positioning summary: keep "NestJS-first soft-delete toolkit for Prisma".
2. Compatibility matrix: tested NestJS, Prisma, Node combinations.
3. Quick Start: mention extended client, active unique constraints, and relation
   filters being opt-in.
4. Configuration: document `relationFilters`.
5. Decorators: document `@WithDeletedRelations`.
6. Cascade Configuration: retain explicit DMMF guidance.
7. Unique Constraint Strategy: link to the full recipe document.
8. Restore and Bulk Operations: add `restoreMany`.
9. Events: document optional `count`.
10. FAQ: add to-one relation limitation and active-row unique index guidance.

### Changelog and Versioning

Add a `0.5.0` changelog entry with:

- Added: relation-aware to-many read filters behind `relationFilters`.
- Added: `@WithDeletedRelations`.
- Added: `restoreMany`.
- Added: event `count` metadata.
- Added: unique constraint recipe and PostgreSQL E2E proof.
- Changed: release/compatibility gates.
- Fixed: any already-landed 0.5.0 behavior fixes, including active-only
  `deleteMany` updates if included in the release branch.

Set `package.json` to `0.5.0` only when implementation and release validation
are complete.

## Testing Strategy

### Unit Tests

- `SoftDeleteContext` stores and reads relation path metadata.
- `@WithDeletedRelations` writes the expected route metadata.
- `SoftDeleteFilterInterceptor` passes relation path metadata into context.
- relation filter helper handles:
  - include `true`
  - include object with existing `where`
  - nested to-many include
  - `select` relation
  - skipped exact path
  - max depth
  - non-soft-delete child model
  - to-one relation skip
- missing DMMF with relation filters enabled throws a clear error.
- `restoreMany` builds the right update payload and emits count metadata.
- event classes remain source-compatible with existing constructor call shapes.

### E2E Tests

- default top-level soft-delete behavior still works.
- relation filters are off by default.
- relation filters exclude deleted to-many children when enabled.
- `@WithDeletedRelations` includes deleted children for the listed path.
- to-one relation limitation is documented by test or fixture behavior.
- PostgreSQL partial unique index recipe permits email reuse after soft-delete.
- `restoreMany` restores deleted parent rows and cascaded child rows.

### Release Verification

Before tagging 0.5.0, run:

```bash
npm run lint
npm test
npm run build
docker compose up -d
npm run test:e2e
docker compose down
npm pack --dry-run
```

The release workflow must run the same core gates automatically.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Relation filtering changes query shape unexpectedly | Keep it off by default and document the option prominently. |
| DMMF metadata is unavailable | Fail early when `relationFilters` is enabled and no DMMF exists. |
| To-one relations cannot be filtered | Skip to-one relations and document the Prisma limitation. |
| Event payload changes break listeners | Add optional fields only; do not rename event names or required constructor args. |
| `restoreMany` cascade is expensive | Use existing `maxCascadeDepth`; document that bulk cascade restore can issue multiple Prisma calls. |
| Compatibility matrix slows CI | Keep full matrix in scheduled/release workflow if PR latency becomes high. |

## Rollout Plan

1. Land compatibility/release hardening and documentation skeleton.
2. Add unique constraint recipe and PostgreSQL E2E proof.
3. Add relation metadata plumbing and relation filter helper behind the disabled
   default option.
4. Add `@WithDeletedRelations` and interceptor/context wiring.
5. Add `restoreMany` and event count metadata.
6. Update README, CHANGELOG, and package metadata.
7. Run full release verification and publish 0.5.0.

## Open Questions

- Should compatibility matrix run on every PR or only on release/scheduled
  workflows? Recommendation: oldest/newest smoke on PR, full matrix on release.
- Should `relationFilters: true` eventually become the default in a major
  release? Recommendation: keep it opt-in through all 0.x releases.
- Should Prisma 7 enter the peer range in 0.5.0? Recommendation: only if a
  Prisma 7 compatibility job is added and passes with explicit DMMF usage.
