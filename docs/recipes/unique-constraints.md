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

Use a partial unique index for rows where the soft-delete timestamp is `NULL`:

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

SQLite supports partial indexes with a similar shape:

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
