# v0.5.0 Adoption Hardening Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first independently releasable slice of the v0.5.0 design: stronger release gates plus an active-row unique constraint recipe with PostgreSQL proof.

**Status:** Implemented as part of the broader v0.5.0 adoption-hardening work.

**Architecture:** Keep runtime behavior unchanged except for already-landed active-only `deleteMany` behavior. Add documentation under `docs/recipes`, link it from README, add one PostgreSQL E2E spec that proves the recommended partial unique index works with the Prisma extension, and make release CI verify package contents before publish.

**Tech Stack:** TypeScript, Vitest E2E, PostgreSQL raw SQL fixtures, Prisma Client, GitHub Actions, Markdown docs.

---

## File Structure

- Modify `.github/workflows/release.yml`
  - Ensure release publish runs lint, unit tests, E2E tests, build, and `npm pack --dry-run`.
- Create `docs/recipes/unique-constraints.md`
  - Owns active-row unique constraint recipes for PostgreSQL, SQLite, and MySQL.
- Modify `README.md`
  - Links the recipe from Quick Start, Unique Constraint Strategy, and troubleshooting.
- Create `test/e2e/unique-constraints.e2e-spec.ts`
  - Proves PostgreSQL partial unique index allows reusing an email after soft-delete while preventing duplicate active emails.
- Modify `CHANGELOG.md`
  - Adds a `0.5.0` draft entry for the phase 1 changes.

---

### Task 1: Harden Release Package Verification

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Update release workflow**

Add a package verification step after build and before publish:

```yaml
      - name: Verify Package Contents
        run: npm pack --dry-run
```

The relevant release sequence should be:

```yaml
      - name: Lint
        run: npm run lint

      - name: Unit Tests
        run: npm test

      - name: E2E Tests
        run: npm run test:e2e
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/soft_delete_test

      - name: Build
        run: npm run build

      - name: Verify Package Contents
        run: npm pack --dry-run

      - name: Publish
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Verify workflow text**

Run:

```bash
sed -n '35,65p' .github/workflows/release.yml
```

Expected: the output contains `Lint`, `Unit Tests`, `E2E Tests`, `Build`, `Verify Package Contents`, and `Publish` in that order.

---

### Task 2: Add Unique Constraint Recipe Documentation

**Files:**
- Create: `docs/recipes/unique-constraints.md`

- [ ] **Step 1: Create the recipe**

Create `docs/recipes/unique-constraints.md` with this structure:

```markdown
# Active-Row Unique Constraints

Soft-deleted rows still participate in normal database unique constraints. If a
row with `email = "a@example.com"` is soft-deleted, a plain unique constraint on
`email` can still block a new active row from using the same value.

The portable rule is: keep Prisma's model field for type safety, but enforce
"unique among active rows" with database-specific DDL.

## Why Not `@@unique([email, deletedAt])`

Do not rely on `@@unique([email, deletedAt])` to mean "unique while active".
Many databases treat `NULL` values as distinct. Because active rows all have
`deletedAt = NULL`, a composite unique constraint can allow duplicate active
emails instead of preventing them.

## PostgreSQL

```sql
CREATE UNIQUE INDEX users_email_active_unique
  ON "User" ("email")
  WHERE "deletedAt" IS NULL;
```

For mapped snake_case tables:

```sql
CREATE UNIQUE INDEX users_email_active_unique
  ON users (email)
  WHERE deleted_at IS NULL;
```

## SQLite

```sql
CREATE UNIQUE INDEX users_email_active_unique
  ON User (email)
  WHERE deletedAt IS NULL;
```

## MySQL

Use a generated column that is populated only for active rows:

```sql
ALTER TABLE users
  ADD active_email VARCHAR(255)
    GENERATED ALWAYS AS (
      CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
    ) STORED,
  ADD UNIQUE INDEX users_active_email_unique (active_email);
```

## Prisma Migration Pattern

Keep the Prisma field on the model, then add the active-row unique index in a
SQL migration. Prisma schema syntax cannot express every partial or functional
index strategy across databases.

## Test Checklist

1. Create an active row with the unique value.
2. Verify a second active row with the same value is rejected.
3. Soft-delete the first row.
4. Verify a new active row with the same value can be created.
5. Verify normal active-only reads return one active row.
```

- [ ] **Step 2: Verify recipe has no placeholders**

Run:

```bash
rg -n "TBD|TODO|FIXME|placeholder" docs/recipes/unique-constraints.md
```

Expected: no matches.

---

### Task 3: Add PostgreSQL E2E Proof For Active Unique Index

**Files:**
- Create: `test/e2e/unique-constraints.e2e-spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `test/e2e/unique-constraints.e2e-spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaSoftDeleteExtension } from '../../src';
import {
  cleanData,
  createBasePrisma,
  createTables,
  dropTables,
} from './setup-helpers';

describe('active-row unique constraints (e2e)', () => {
  let basePrisma: ReturnType<typeof createBasePrisma>;
  let prisma: ReturnType<typeof createBasePrisma> extends infer T
    ? T & { client?: any }
    : never;
  let client: any;

  beforeAll(async () => {
    basePrisma = createBasePrisma();
    await dropTables(basePrisma);
    await createTables(basePrisma);

    await basePrisma.$executeRawUnsafe(
      'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key',
    );
    await basePrisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS users_email_active_unique',
    );
    await basePrisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX users_email_active_unique ON users (email) WHERE deleted_at IS NULL',
    );

    client = basePrisma.$extends(
      createPrismaSoftDeleteExtension({
        softDeleteModels: ['User'],
        deletedAtField: 'deleted_at',
      }),
    );
  });

  beforeEach(async () => {
    await cleanData(basePrisma);
  });

  afterAll(async () => {
    await basePrisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS users_email_active_unique',
    );
    await dropTables(basePrisma);
    await basePrisma.$disconnect();
  });

  it('allows reusing a unique value after the original row is soft-deleted', async () => {
    const email = 'reuse@example.com';

    const first = await client.user.create({
      data: {
        email,
        name: 'First User',
      },
    });

    await expect(
      client.user.create({
        data: {
          email,
          name: 'Duplicate Active User',
        },
      }),
    ).rejects.toThrow();

    await client.user.delete({
      where: {
        id: first.id,
      },
    });

    const second = await client.user.create({
      data: {
        email,
        name: 'Second Active User',
      },
    });

    const activeUsers = await client.user.findMany({
      where: {
        email,
      },
    });

    const allRows = await basePrisma.user.findMany({
      where: {
        email,
      },
      orderBy: {
        name: 'asc',
      },
    });

    expect(second.id).not.toBe(first.id);
    expect(activeUsers).toHaveLength(1);
    expect(activeUsers[0].id).toBe(second.id);
    expect(allRows).toHaveLength(2);
    expect(allRows.find((row) => row.id === first.id)?.deleted_at).toBeInstanceOf(Date);
    expect(allRows.find((row) => row.id === second.id)?.deleted_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused E2E test to verify it fails or compile-errors for the new file only if the implementation fixture needs adjustment**

Run:

```bash
docker compose up -d
npm run test:e2e -- test/e2e/unique-constraints.e2e-spec.ts
```

Expected before adjustment: the test may fail if TypeScript types or table
constraint names need to match generated Prisma output. Fix only the test
fixture, not production code.

- [ ] **Step 3: Adjust the E2E test fixture minimally**

If the focused E2E fails because `npm run test:e2e -- path` does not pass the
path through Vitest, run the full E2E command instead:

```bash
npm run test:e2e
```

If the generated Prisma client exposes `deleted_at` as `deleted_at`, keep the
field names as shown. If it exposes camelCase names, update only the assertions
and extension option to match `deletedAt`.

- [ ] **Step 4: Verify E2E passes**

Run:

```bash
npm run test:e2e
docker compose down
```

Expected: all E2E specs pass.

---

### Task 4: Link Recipe From README And Update Release Notes

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README Unique Constraint Strategy**

In `README.md`, replace the inline-only Unique Constraint Strategy section with
a short summary that links to `docs/recipes/unique-constraints.md` and retains
the PostgreSQL example.

Required text:

```markdown
For full PostgreSQL, SQLite, and MySQL recipes, see
[`docs/recipes/unique-constraints.md`](docs/recipes/unique-constraints.md).
```

- [ ] **Step 2: Add Quick Start warning**

After the Prisma schema example in Quick Start, add:

```markdown
If a soft-deleted model has values that must be unique among active rows, add an
active-row unique index in your database migration. A plain `@unique` still
counts soft-deleted rows. See [Unique Constraint Strategy](#unique-constraint-strategy).
```

- [ ] **Step 3: Add CHANGELOG 0.5.0 draft entry**

Add this entry above `0.4.0`:

```markdown
## [0.5.0] - Unreleased

### Added

- Active-row unique constraint recipe for PostgreSQL, SQLite, and MySQL.
- PostgreSQL E2E proof that a partial unique index permits value reuse after
  soft-delete while rejecting duplicate active rows.
- Release package verification with `npm pack --dry-run`.

### Fixed

- Release workflow now runs lint before publishing.
- `deleteMany` soft-delete updates now target active rows only so already
  soft-deleted rows do not get a new deletion timestamp.
```

- [ ] **Step 4: Verify docs references**

Run:

```bash
rg -n "unique-constraints|0.5.0|npm pack --dry-run|deleteMany" README.md CHANGELOG.md docs/recipes/unique-constraints.md .github/workflows/release.yml
```

Expected: output includes the recipe link, changelog entry, and release workflow
package verification step.

---

### Task 5: Final Phase 1 Verification

**Files:**
- All files changed in Tasks 1-4.

- [ ] **Step 1: Run static and unit verification**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run PostgreSQL E2E verification**

Run:

```bash
docker compose up -d
npm run test:e2e
docker compose down
```

Expected: all E2E specs exit 0 and the compose services are stopped afterward.

- [ ] **Step 3: Run package verification**

Run:

```bash
npm pack --dry-run
```

Expected: package preview includes `dist`, README, CHANGELOG, LICENSE, and no
source-only test files.

- [ ] **Step 4: Review worktree**

Run:

```bash
git status --short
git diff --stat
```

Expected: only planned files are changed.
