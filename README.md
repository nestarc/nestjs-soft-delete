# @nestarc/soft-delete

[![npm version](https://img.shields.io/npm/v/@nestarc/soft-delete.svg)](https://www.npmjs.com/package/@nestarc/soft-delete)
[![npm downloads](https://img.shields.io/npm/dm/@nestarc/soft-delete.svg)](https://www.npmjs.com/package/@nestarc/soft-delete)
[![CI](https://github.com/nestarc/nestjs-soft-delete/actions/workflows/ci.yml/badge.svg)](https://github.com/nestarc/nestjs-soft-delete/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-nestarc.dev-blue.svg)](https://nestarc.dev/packages/soft-delete/)

Prisma soft-delete extension for NestJS. Automatically intercepts delete operations, filters deleted records from queries, and supports cascade soft-delete, restore, purge, events, and more.
[![license](https://img.shields.io/npm/l/@nestarc/soft-delete.svg)](https://github.com/nestarc/nestjs-soft-delete/blob/main/LICENSE)

---

## Features

- Automatic soft-delete: `delete` and `deleteMany` become `update`/`updateMany` setting `deletedAt`
- Transparent query filtering: `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy` all exclude soft-deleted rows by default
- Cascade soft-delete and restore across related models
- `restore()`, `forceDelete()`, and `purge()` operations on `SoftDeleteService`
- Route-decorator control: `@WithDeleted()`, `@OnlyDeleted()`, `@SkipSoftDelete()`
- Optional actor tracking via `deletedByField` and `actorExtractor`
- Lifecycle events (`SoftDeletedEvent`, `RestoredEvent`, `PurgedEvent`) via `@nestjs/event-emitter`
- Testing utilities: `TestSoftDeleteModule`, `expectSoftDeleted`, `expectNotSoftDeleted`, `expectCascadeSoftDeleted`
- Standalone Prisma extension (`createPrismaSoftDeleteExtension`) for use without NestJS
- Global module — register once, use everywhere

---

## Installation

```bash
npm install @nestarc/soft-delete
# or
yarn add @nestarc/soft-delete
# or
pnpm add @nestarc/soft-delete
```

**Required peer dependencies** (install if not already present):

```bash
npm install @nestjs/common @nestjs/core @prisma/client reflect-metadata rxjs
```

**Optional peer dependencies:**

```bash
# For lifecycle events
npm install @nestjs/event-emitter

# For scheduled purge jobs
npm install @nestjs/schedule
```

---

## Quick Start

### 1. Prisma schema

Add `deletedAt` (and optionally `deletedBy`) to every model you want to soft-delete:

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  deletedAt DateTime?
  deletedBy String?
}
```

### 2. Set up PrismaService

Apply the soft-delete extension in your `PrismaService`. This is what intercepts `delete()` calls and injects query filters:

```typescript
// prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaSoftDeleteExtension } from '@nestarc/soft-delete';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private _extended: ReturnType<typeof this.$extends>;

  constructor() {
    super();
    this._extended = this.$extends(
      createPrismaSoftDeleteExtension({
        softDeleteModels: ['User', 'Post'],
        deletedAtField: 'deletedAt',
        deletedByField: 'deletedBy',
        cascade: { User: ['Post'] },
      }),
    );
  }

  // Expose the extended client for all queries
  get client() {
    return this._extended;
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```

> **Important:** Use `prisma.client.user.delete()` (the extended client) for soft-delete behavior.
> Direct `prisma.user.delete()` calls bypass the extension and perform hard deletes.

### 3. Register the module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { SoftDeleteModule } from '@nestarc/soft-delete';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    SoftDeleteModule.forRoot({
      softDeleteModels: ['User', 'Post'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
      actorExtractor: (req) => req.user?.id ?? null,
      prismaServiceToken: PrismaService,
    }),
  ],
  providers: [PrismaService],
})
export class AppModule {}
```

`SoftDeleteModule` is global — you do not need to import it in feature modules.

### 4. Use in a controller

```typescript
// users.controller.ts
import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SoftDeleteService, WithDeleted } from '@nestarc/soft-delete';
import { PrismaService } from './prisma.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly softDelete: SoftDeleteService,
  ) {}

  // Soft-deletes the user (sets deletedAt) via the extended client
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.client.user.delete({ where: { id: +id } });
  }

  // Normal findMany — deleted users are automatically excluded
  @Get()
  findAll() {
    return this.prisma.client.user.findMany();
  }

  // Include soft-deleted users in results
  @Get('all')
  @WithDeleted()
  findAllIncludingDeleted() {
    return this.prisma.client.user.findMany();
  }

  // Restore a soft-deleted user
  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.softDelete.restore('User', { id: +id });
  }
}
```

---

## Configuration

All options for `SoftDeleteModule.forRoot()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `softDeleteModels` | `string[]` | — | **Required.** Model names to enable soft-delete for. |
| `deletedAtField` | `string` | `'deletedAt'` | Prisma field that stores the soft-delete timestamp. |
| `deletedByField` | `string \| null` | `null` | Prisma field to store the actor ID who deleted the record. |
| `actorExtractor` | `(req: any) => string \| null` | `undefined` | Function to extract the actor ID from the incoming request. |
| `cascade` | `Record<string, string[]>` | `undefined` | Parent-to-children cascade map (see Cascade section). |
| `maxCascadeDepth` | `number` | `3` | Maximum depth for recursive cascade operations. |
| `prismaServiceToken` | `any` | — | **Required.** DI token of your `PrismaService`. |
| `enableEvents` | `boolean` | `false` | Emit lifecycle events. Requires `@nestjs/event-emitter`. |

### Async registration

```typescript
SoftDeleteModule.forRootAsync({
  imports: [ConfigModule],
  prismaServiceToken: PrismaService,
  useFactory: (config: ConfigService) => ({
    softDeleteModels: config.get('SOFT_DELETE_MODELS').split(','),
    deletedAtField: 'deletedAt',
    prismaServiceToken: PrismaService,
  }),
  inject: [ConfigService],
});
```

---

## Decorators

Apply to controller route handlers to change the filter mode for that request.

### `@WithDeleted()`

Include soft-deleted records alongside active ones.

```typescript
@Get('trash-and-active')
@WithDeleted()
findAll() {
  return this.prisma.client.post.findMany();
}
```

### `@OnlyDeleted()`

Return only soft-deleted records.

```typescript
@Get('trash')
@OnlyDeleted()
findTrashed() {
  return this.prisma.client.post.findMany();
}
```

### `@SkipSoftDelete()`

Bypass soft-delete logic entirely — `delete` performs a real hard-delete.

```typescript
@Delete(':id/hard')
@SkipSoftDelete()
hardDelete(@Param('id') id: string) {
  return this.prisma.client.post.delete({ where: { id: +id } });
}
```

---

## Cascade Configuration

Define parent-to-children relationships to automatically cascade soft-delete and restore operations.

```typescript
SoftDeleteModule.forRoot({
  softDeleteModels: ['User', 'Post', 'Comment'],
  cascade: {
    User: ['Post'],
    Post: ['Comment'],
  },
  maxCascadeDepth: 3,
  prismaServiceToken: PrismaService,
});
```

When a `User` is soft-deleted, all their `Post` records are soft-deleted automatically, and each post's `Comment` records are soft-deleted as well. Restoring the `User` reverses the entire tree up to `maxCascadeDepth` levels deep.

---

## Events

Enable events and install `@nestjs/event-emitter`:

```bash
npm install @nestjs/event-emitter
```

```typescript
// app.module.ts
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    SoftDeleteModule.forRoot({
      softDeleteModels: ['User', 'Post'],
      enableEvents: true,
      prismaServiceToken: PrismaService,
    }),
  ],
})
export class AppModule {}
```

Listen to events with `@OnEvent()`:

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SoftDeletedEvent, RestoredEvent, PurgedEvent } from '@nestarc/soft-delete';

@Injectable()
export class AuditListener {
  @OnEvent(SoftDeletedEvent.EVENT_NAME)
  onDeleted(event: SoftDeletedEvent) {
    console.log(`${event.model} soft-deleted by ${event.actorId} at ${event.deletedAt}`);
  }

  @OnEvent(RestoredEvent.EVENT_NAME)
  onRestored(event: RestoredEvent) {
    console.log(`${event.model} restored by ${event.actorId}`);
  }

  @OnEvent(PurgedEvent.EVENT_NAME)
  onPurged(event: PurgedEvent) {
    console.log(`${event.count} ${event.model} records purged (older than ${event.olderThan})`);
  }
}
```

| Event class | `EVENT_NAME` | Payload fields |
|---|---|---|
| `SoftDeletedEvent` | `soft-delete.deleted` | `model`, `where`, `deletedAt`, `actorId` |
| `RestoredEvent` | `soft-delete.restored` | `model`, `where`, `actorId` |
| `PurgedEvent` | `soft-delete.purged` | `model`, `count`, `olderThan` |

---

## Purge (Scheduled Hard-Delete)

Use `SoftDeleteService.purge()` with `@nestjs/schedule` to permanently remove old soft-deleted records on a schedule.

```bash
npm install @nestjs/schedule
```

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SoftDeleteService } from '@nestarc/soft-delete';

@Injectable()
export class PurgeService {
  constructor(private readonly softDelete: SoftDeleteService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeOldRecords() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const users = await this.softDelete.purge('User', { olderThan: thirtyDaysAgo });
    const posts = await this.softDelete.purge('Post', { olderThan: thirtyDaysAgo });

    console.log(`Purged ${users.count} users, ${posts.count} posts`);
  }
}
```

`purge()` also accepts an optional `where` for additional filtering:

```typescript
await this.softDelete.purge('Post', {
  olderThan: thirtyDaysAgo,
  where: { authorId: userId },
});
```

---

## Testing

Import `TestSoftDeleteModule` from `@nestarc/soft-delete/testing` in your unit or integration tests.

```typescript
import { Test } from '@nestjs/testing';
import { TestSoftDeleteModule, expectSoftDeleted, expectNotSoftDeleted, expectCascadeSoftDeleted } from '@nestarc/soft-delete/testing';
import { SoftDeleteService } from '@nestarc/soft-delete';
import { createPrismaSoftDeleteExtension } from '@nestarc/soft-delete';
import { PrismaClient } from '@prisma/client';

describe('UsersService', () => {
  let softDelete: SoftDeleteService;
  let prisma: any; // your extended PrismaClient in tests

  beforeAll(async () => {
    prisma = new PrismaClient().$extends(
      createPrismaSoftDeleteExtension({ softDeleteModels: ['User', 'Post'] }),
    );

    const module = await Test.createTestingModule({
      imports: [
        TestSoftDeleteModule.register(
          { softDeleteModels: ['User', 'Post'] },
          prisma,
        ),
      ],
    }).compile();

    softDelete = module.get(SoftDeleteService);
  });

  it('soft-deletes a user', async () => {
    await prisma.user.delete({ where: { id: 1 } });
    await expectSoftDeleted(prisma.user, { id: 1 });
  });

  it('restores a user', async () => {
    await softDelete.restore('User', { id: 1 });
    await expectNotSoftDeleted(prisma.user, { id: 1 });
  });

  it('cascades soft-delete to posts', async () => {
    await prisma.user.delete({ where: { id: 2 } });
    await expectCascadeSoftDeleted(prisma, 'User', { id: 2 }, ['Post']);
  });
});
```

### Assertion helpers

| Helper | Description |
|---|---|
| `expectSoftDeleted(delegate, where, deletedAtField?)` | Asserts the record exists and `deletedAt` is non-null. |
| `expectNotSoftDeleted(delegate, where, deletedAtField?)` | Asserts the record exists and `deletedAt` is null. |
| `expectCascadeSoftDeleted(prisma, parentModel, where, childModels, deletedAtField?)` | Asserts the parent and all listed child models have soft-deleted records. |

---

## Unique Constraint Strategy

Standard `@unique` constraints break when multiple soft-deleted rows share the same value (e.g. two deleted users with the same email). Use a composite unique constraint that includes `deletedAt`:

```prisma
model User {
  id        Int       @id @default(autoincrement())
  email     String
  deletedAt DateTime?

  @@unique([email, deletedAt])
}
```

This allows multiple soft-deleted rows with the same email while still enforcing uniqueness among active records (where `deletedAt IS NULL`). Note that this works in most databases because `NULL` values are treated as distinct in unique indexes. Verify this behaviour for your specific database engine.

---

## Standalone Usage

Use `createPrismaSoftDeleteExtension()` without NestJS — useful in scripts, tests, or non-NestJS projects:

```typescript
import { PrismaClient } from '@prisma/client';
import { createPrismaSoftDeleteExtension } from '@nestarc/soft-delete';

const prisma = new PrismaClient().$extends(
  createPrismaSoftDeleteExtension({
    softDeleteModels: ['User', 'Post', 'Comment'],
    deletedAtField: 'deletedAt',
    deletedByField: 'deletedBy',
    cascade: {
      User: ['Post'],
      Post: ['Comment'],
    },
    maxCascadeDepth: 3,
  }),
);

// delete is now a soft-delete
await prisma.user.delete({ where: { id: 1 } });

// findMany automatically excludes soft-deleted rows
const activeUsers = await prisma.user.findMany();
```

### `SoftDeleteExtensionOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `softDeleteModels` | `string[]` | — | **Required.** Models to enable soft-delete for. |
| `deletedAtField` | `string` | `'deletedAt'` | Field that stores the soft-delete timestamp. |
| `deletedByField` | `string \| null` | `null` | Field to store actor ID. |
| `cascade` | `Record<string, string[]>` | `undefined` | Parent-to-children cascade map. |
| `maxCascadeDepth` | `number` | `3` | Maximum cascade depth. |
| `eventEmitter` | `{ emitSoftDeleted: (event) => void } \| null` | `null` | Optional custom event emitter. |

---

## Performance

Measured with PostgreSQL 15, Prisma 6, 500 rows, 300 iterations on Apple Silicon:

| Scenario | Avg | P50 | P95 | P99 |
|----------|-----|-----|-----|-----|
| findMany — no extension (500 rows) | 3.11ms | 2.43ms | 5.78ms | 11.40ms |
| **findMany — with soft-delete filter** (250 rows) | **2.01ms** | **1.61ms** | **4.44ms** | **7.48ms** |
| delete — hard delete (baseline) | 0.53ms | 0.52ms | 0.68ms | 0.77ms |
| **delete — soft delete** | **0.54ms** | **0.53ms** | **0.69ms** | **0.77ms** |
| **cascade (User → 3 Posts → 6 Comments)** | **0.56ms** | **0.56ms** | **0.72ms** | **0.76ms** |

Filter overhead: **-35%** (faster — fewer rows returned). Soft delete vs hard delete: **identical**.

> Reproduce: `docker compose up -d && npm run bench`

## API Reference

### `@nestarc/soft-delete`

| Export | Kind | Description |
|---|---|---|
| `SoftDeleteModule` | Module | NestJS dynamic module. Use `.forRoot()` or `.forRootAsync()`. |
| `SoftDeleteService` | Service | `restore()`, `forceDelete()`, `purge()`, `withDeleted()`, `onlyDeleted()`. |
| `SoftDeleteContext` | Service | AsyncLocalStorage context for filter mode. |
| `createPrismaSoftDeleteExtension` | Function | Creates a Prisma client extension for standalone use. |
| `WithDeleted` | Decorator | Include soft-deleted records in the route handler's queries. |
| `OnlyDeleted` | Decorator | Return only soft-deleted records in the route handler's queries. |
| `SkipSoftDelete` | Decorator | Bypass soft-delete logic in the route handler. |
| `SoftDeleteFilterInterceptor` | Interceptor | Reads route metadata and sets the `SoftDeleteContext`. Auto-registered. |
| `SoftDeletedEvent` | Class | Event emitted after a soft-delete. `EVENT_NAME = 'soft-delete.deleted'`. |
| `RestoredEvent` | Class | Event emitted after a restore. `EVENT_NAME = 'soft-delete.restored'`. |
| `PurgedEvent` | Class | Event emitted after a purge. `EVENT_NAME = 'soft-delete.purged'`. |
| `SoftDeleteEventEmitter` | Service | Internal emitter; exposed for advanced use. |
| `SoftDeleteFieldMissingError` | Error | Thrown when `deletedAt` field is missing from the model. |
| `CascadeRelationNotFoundError` | Error | Thrown when a cascade relation cannot be resolved. |
| `SoftDeleteModuleOptions` | Interface | Options for `forRoot()`. |
| `SoftDeleteModuleAsyncOptions` | Interface | Options for `forRootAsync()`. |
| `SoftDeleteExtensionOptions` | Interface | Options for `createPrismaSoftDeleteExtension()`. |

### `@nestarc/soft-delete/testing`

| Export | Kind | Description |
|---|---|---|
| `TestSoftDeleteModule` | Module | Lightweight test module. Use `.register(options, prisma?)`. |
| `expectSoftDeleted` | Function | Assert a record is soft-deleted. |
| `expectNotSoftDeleted` | Function | Assert a record is not soft-deleted. |
| `expectCascadeSoftDeleted` | Function | Assert a parent and its children are all soft-deleted. |

---

## License

MIT
