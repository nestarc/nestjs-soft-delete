# v0.2.0: Events, Purge, Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add event emission on soft-delete/restore/purge operations, a scheduled hard-delete (purge) API, and comprehensive README documentation to @nestarc/soft-delete.

**Architecture:** Events use NestJS `@nestjs/event-emitter` as an optional peer dependency with graceful degradation (no-op when absent). Purge adds a `purge()` method to `SoftDeleteService` that permanently deletes records older than a given duration. The Prisma extension emits events after successful delete/deleteMany interceptions, and `SoftDeleteService` emits after restore/purge. All three features are additive — no breaking changes to v0.1.0 API.

**Tech Stack:** NestJS 10/11, Prisma 5/6, TypeScript 5.7, Vitest 3, tsup 8, `@nestjs/event-emitter` (optional peer)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/events/soft-delete.events.ts` | Event payload classes: `SoftDeletedEvent`, `RestoredEvent`, `PurgedEvent` |
| `src/events/soft-delete-event-emitter.ts` | Wrapper service around `EventEmitter2` with graceful no-op fallback |
| `src/events/soft-delete.events.spec.ts` | Unit tests for event payload classes |
| `src/events/soft-delete-event-emitter.spec.ts` | Unit tests for event emitter wrapper |
| `src/services/soft-delete.service.purge.spec.ts` | Unit tests for purge functionality (kept separate from existing spec) |

### Modified files

| File | Changes |
|------|---------|
| `src/soft-delete.constants.ts` | Add `SOFT_DELETE_EVENT_EMITTER` token |
| `src/interfaces/soft-delete-options.interface.ts` | Add `enableEvents?: boolean` to options |
| `src/soft-delete.module.ts` | Register event emitter provider conditionally |
| `src/services/soft-delete.service.ts` | Inject event emitter, add `purge()`, emit events on restore/forceDelete/purge |
| `src/prisma/soft-delete-extension.ts` | Accept optional event emitter, emit after delete/deleteMany |
| `src/index.ts` | Export new event types and emitter |
| `src/testing/test-soft-delete.module.ts` | Support event emitter in test module |
| `src/testing/index.ts` | Export new test utilities if any |
| `package.json` | Add `@nestjs/event-emitter` optional peer dep, bump to 0.2.0 |
| `README.md` | Comprehensive documentation |

---

## Task 1: Event Payload Classes

**Files:**
- Create: `src/events/soft-delete.events.ts`
- Test: `src/events/soft-delete.events.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/events/soft-delete.events.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SoftDeletedEvent, RestoredEvent, PurgedEvent } from './soft-delete.events';

describe('SoftDeletedEvent', () => {
  it('should store model, where, deletedAt, and optional actorId', () => {
    const now = new Date();
    const event = new SoftDeletedEvent('User', { id: '1' }, now, 'admin');

    expect(event.model).toBe('User');
    expect(event.where).toEqual({ id: '1' });
    expect(event.deletedAt).toBe(now);
    expect(event.actorId).toBe('admin');
  });

  it('should default actorId to null', () => {
    const event = new SoftDeletedEvent('User', { id: '1' }, new Date());

    expect(event.actorId).toBeNull();
  });

  it('should have event name constant', () => {
    expect(SoftDeletedEvent.EVENT_NAME).toBe('soft-delete.deleted');
  });
});

describe('RestoredEvent', () => {
  it('should store model, where, and optional actorId', () => {
    const event = new RestoredEvent('User', { id: '1' }, 'admin');

    expect(event.model).toBe('User');
    expect(event.where).toEqual({ id: '1' });
    expect(event.actorId).toBe('admin');
  });

  it('should default actorId to null', () => {
    const event = new RestoredEvent('User', { id: '1' });

    expect(event.actorId).toBeNull();
  });

  it('should have event name constant', () => {
    expect(RestoredEvent.EVENT_NAME).toBe('soft-delete.restored');
  });
});

describe('PurgedEvent', () => {
  it('should store model, count, and olderThan', () => {
    const cutoff = new Date();
    const event = new PurgedEvent('User', 5, cutoff);

    expect(event.model).toBe('User');
    expect(event.count).toBe(5);
    expect(event.olderThan).toBe(cutoff);
  });

  it('should have event name constant', () => {
    expect(PurgedEvent.EVENT_NAME).toBe('soft-delete.purged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/events/soft-delete.events.spec.ts`
Expected: FAIL — module `./soft-delete.events` not found

- [ ] **Step 3: Write minimal implementation**

Create `src/events/soft-delete.events.ts`:

```typescript
export class SoftDeletedEvent {
  static readonly EVENT_NAME = 'soft-delete.deleted' as const;

  constructor(
    public readonly model: string,
    public readonly where: Record<string, unknown>,
    public readonly deletedAt: Date,
    public readonly actorId: string | null = null,
  ) {}
}

export class RestoredEvent {
  static readonly EVENT_NAME = 'soft-delete.restored' as const;

  constructor(
    public readonly model: string,
    public readonly where: Record<string, unknown>,
    public readonly actorId: string | null = null,
  ) {}
}

export class PurgedEvent {
  static readonly EVENT_NAME = 'soft-delete.purged' as const;

  constructor(
    public readonly model: string,
    public readonly count: number,
    public readonly olderThan: Date,
  ) {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/events/soft-delete.events.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/events/soft-delete.events.ts src/events/soft-delete.events.spec.ts
git commit -m "feat(events): add SoftDeletedEvent, RestoredEvent, PurgedEvent payload classes"
```

---

## Task 2: Event Emitter Wrapper (graceful degradation)

**Files:**
- Create: `src/events/soft-delete-event-emitter.ts`
- Test: `src/events/soft-delete-event-emitter.spec.ts`
- Modify: `src/soft-delete.constants.ts`

- [ ] **Step 1: Add constant token**

In `src/soft-delete.constants.ts`, add at the end:

```typescript
export const SOFT_DELETE_EVENT_EMITTER = Symbol('SOFT_DELETE_EVENT_EMITTER');
```

- [ ] **Step 2: Write the failing test**

Create `src/events/soft-delete-event-emitter.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftDeleteEventEmitter } from './soft-delete-event-emitter';
import { SoftDeletedEvent, RestoredEvent, PurgedEvent } from './soft-delete.events';

describe('SoftDeleteEventEmitter', () => {
  describe('with EventEmitter2 available', () => {
    let mockEventEmitter: any;
    let emitter: SoftDeleteEventEmitter;

    beforeEach(() => {
      mockEventEmitter = {
        emit: vi.fn(),
      };
      emitter = new SoftDeleteEventEmitter(mockEventEmitter);
    });

    it('should emit SoftDeletedEvent via EventEmitter2', () => {
      const event = new SoftDeletedEvent('User', { id: '1' }, new Date(), 'admin');

      emitter.emitSoftDeleted(event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SoftDeletedEvent.EVENT_NAME,
        event,
      );
    });

    it('should emit RestoredEvent via EventEmitter2', () => {
      const event = new RestoredEvent('User', { id: '1' });

      emitter.emitRestored(event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        RestoredEvent.EVENT_NAME,
        event,
      );
    });

    it('should emit PurgedEvent via EventEmitter2', () => {
      const event = new PurgedEvent('User', 3, new Date());

      emitter.emitPurged(event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PurgedEvent.EVENT_NAME,
        event,
      );
    });
  });

  describe('without EventEmitter2 (graceful degradation)', () => {
    let emitter: SoftDeleteEventEmitter;

    beforeEach(() => {
      emitter = new SoftDeleteEventEmitter(null);
    });

    it('should not throw when emitting SoftDeletedEvent', () => {
      const event = new SoftDeletedEvent('User', { id: '1' }, new Date());

      expect(() => emitter.emitSoftDeleted(event)).not.toThrow();
    });

    it('should not throw when emitting RestoredEvent', () => {
      const event = new RestoredEvent('User', { id: '1' });

      expect(() => emitter.emitRestored(event)).not.toThrow();
    });

    it('should not throw when emitting PurgedEvent', () => {
      const event = new PurgedEvent('User', 3, new Date());

      expect(() => emitter.emitPurged(event)).not.toThrow();
    });

    it('should report isEnabled as false', () => {
      expect(emitter.isEnabled).toBe(false);
    });
  });

  describe('with EventEmitter2 available', () => {
    it('should report isEnabled as true', () => {
      const emitter = new SoftDeleteEventEmitter({ emit: vi.fn() });

      expect(emitter.isEnabled).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/events/soft-delete-event-emitter.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write minimal implementation**

Create `src/events/soft-delete-event-emitter.ts`:

```typescript
import { Injectable, Optional, Inject } from '@nestjs/common';
import { SoftDeletedEvent } from './soft-delete.events';
import { RestoredEvent } from './soft-delete.events';
import { PurgedEvent } from './soft-delete.events';

/**
 * DI token used to inject the optional EventEmitter2 instance from @nestjs/event-emitter.
 * When the user has not installed @nestjs/event-emitter, this resolves to null
 * and all emit calls become silent no-ops.
 */
const EVENT_EMITTER_TOKEN = 'EventEmitter2';

@Injectable()
export class SoftDeleteEventEmitter {
  constructor(
    @Optional() @Inject(EVENT_EMITTER_TOKEN) private readonly eventEmitter: any | null,
  ) {}

  get isEnabled(): boolean {
    return this.eventEmitter != null;
  }

  emitSoftDeleted(event: SoftDeletedEvent): void {
    this.eventEmitter?.emit(SoftDeletedEvent.EVENT_NAME, event);
  }

  emitRestored(event: RestoredEvent): void {
    this.eventEmitter?.emit(RestoredEvent.EVENT_NAME, event);
  }

  emitPurged(event: PurgedEvent): void {
    this.eventEmitter?.emit(PurgedEvent.EVENT_NAME, event);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/events/soft-delete-event-emitter.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/soft-delete.constants.ts src/events/soft-delete-event-emitter.ts src/events/soft-delete-event-emitter.spec.ts
git commit -m "feat(events): add SoftDeleteEventEmitter with graceful degradation"
```

---

## Task 3: Wire Events into SoftDeleteService (restore + forceDelete)

**Files:**
- Modify: `src/services/soft-delete.service.ts`
- Modify: `src/services/soft-delete.service.spec.ts`

- [ ] **Step 1: Write failing tests for event emission on restore**

Add to `src/services/soft-delete.service.spec.ts` — new `describe` block inside the top-level describe, and update the `beforeEach` and imports:

Update imports at the top:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftDeleteService } from './soft-delete.service';
import { SoftDeleteContext } from './soft-delete-context';
import { SoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
import { RestoredEvent } from '../events/soft-delete.events';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';
```

Update `beforeEach` to add `mockEventEmitter`:

```typescript
let mockEventEmitter: any;

beforeEach(() => {
  // ... existing mockPrisma, mockCascadeHandler ...

  mockEventEmitter = {
    emitSoftDeleted: vi.fn(),
    emitRestored: vi.fn(),
    emitPurged: vi.fn(),
    isEnabled: true,
  };

  service = new SoftDeleteService(defaultOptions, mockPrisma, mockCascadeHandler, mockEventEmitter);
});
```

Update the `serviceNoCascade` creation in the existing test to pass `mockEventEmitter`:

```typescript
const serviceNoCascade = new SoftDeleteService(defaultOptions, mockPrisma, null, mockEventEmitter);
```

Add new test inside `describe('restore()')`:

```typescript
it('should emit RestoredEvent after successful restore', async () => {
  const deletedUser = { id: '1', name: 'Alice', deletedAt: deletedDate };
  const restoredUser = { id: '1', name: 'Alice', deletedAt: null };

  mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
  mockPrisma.user.update.mockResolvedValue(restoredUser);

  await service.restore('User', { id: '1' });

  expect(mockEventEmitter.emitRestored).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'User',
      where: { id: '1' },
    }),
  );
});
```

Add new test for no event emitter scenario:

```typescript
it('should not throw when eventEmitter is null', async () => {
  const serviceNoEvents = new SoftDeleteService(defaultOptions, mockPrisma, mockCascadeHandler, null);
  const deletedUser = { id: '1', deletedAt: deletedDate };
  const restoredUser = { id: '1', deletedAt: null };

  mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
  mockPrisma.user.update.mockResolvedValue(restoredUser);

  await expect(serviceNoEvents.restore('User', { id: '1' })).resolves.not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/soft-delete.service.spec.ts`
Expected: FAIL — constructor signature mismatch

- [ ] **Step 3: Modify SoftDeleteService to accept and use event emitter**

Update `src/services/soft-delete.service.ts`:

Add imports:

```typescript
import { SoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
import { RestoredEvent, PurgedEvent } from '../events/soft-delete.events';
```

Update constructor to inject the event emitter (4th parameter, optional):

```typescript
constructor(
  @Inject(SOFT_DELETE_MODULE_OPTIONS) private readonly options: SoftDeleteModuleOptions,
  @Inject(SOFT_DELETE_PRISMA_SERVICE) private readonly prisma: any,
  @Optional() @Inject(CascadeHandler) private readonly cascadeHandler: CascadeHandler | null,
  @Optional() private readonly eventEmitter: SoftDeleteEventEmitter | null,
) {
  this.deletedAtField = options.deletedAtField ?? 'deletedAt';
  this.deletedByField = options.deletedByField ?? null;
}
```

Add event emission at the end of `restore()`, after cascade restore:

```typescript
// Emit restored event
this.eventEmitter?.emitRestored(
  new RestoredEvent(model, where, SoftDeleteContext.getActorId()),
);

return restored as T;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/soft-delete.service.spec.ts`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/soft-delete.service.ts src/services/soft-delete.service.spec.ts
git commit -m "feat(events): emit RestoredEvent from SoftDeleteService.restore()"
```

---

## Task 4: Purge API

**Files:**
- Modify: `src/services/soft-delete.service.ts`
- Create: `src/services/soft-delete.service.purge.spec.ts`

- [ ] **Step 1: Write failing tests for purge**

Create `src/services/soft-delete.service.purge.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftDeleteService } from './soft-delete.service';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

describe('SoftDeleteService.purge()', () => {
  let service: SoftDeleteService;
  let mockPrisma: any;
  let mockEventEmitter: any;

  const defaultOptions: SoftDeleteModuleOptions = {
    softDeleteModels: ['User', 'Post'],
    deletedAtField: 'deletedAt',
    prismaServiceToken: 'PRISMA',
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      post: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    mockEventEmitter = {
      emitSoftDeleted: vi.fn(),
      emitRestored: vi.fn(),
      emitPurged: vi.fn(),
      isEnabled: true,
    };

    service = new SoftDeleteService(defaultOptions, mockPrisma, null, mockEventEmitter);
  });

  it('should permanently delete records older than the given date', async () => {
    const olderThan = new Date('2024-01-01');

    const result = await service.purge('User', { olderThan });

    expect(mockPrisma.user.deleteMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { not: null, lt: olderThan },
      },
    });
    expect(result).toEqual({ count: 3 });
  });

  it('should use skipSoftDelete context so extension does not intercept', async () => {
    const { SoftDeleteContext } = await import('./soft-delete-context');
    let wasSkipped = false;

    mockPrisma.user.deleteMany.mockImplementation(() => {
      wasSkipped = SoftDeleteContext.isSkipped();
      return Promise.resolve({ count: 1 });
    });

    await service.purge('User', { olderThan: new Date() });

    expect(wasSkipped).toBe(true);
  });

  it('should emit PurgedEvent after successful purge', async () => {
    const olderThan = new Date('2024-01-01');

    await service.purge('User', { olderThan });

    expect(mockEventEmitter.emitPurged).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'User',
        count: 3,
        olderThan,
      }),
    );
  });

  it('should not emit PurgedEvent when count is 0', async () => {
    await service.purge('Post', { olderThan: new Date() });

    expect(mockEventEmitter.emitPurged).not.toHaveBeenCalled();
  });

  it('should not throw when eventEmitter is null', async () => {
    const serviceNoEvents = new SoftDeleteService(defaultOptions, mockPrisma, null, null);

    await expect(
      serviceNoEvents.purge('User', { olderThan: new Date() }),
    ).resolves.not.toThrow();
  });

  it('should merge additional where conditions', async () => {
    const olderThan = new Date('2024-01-01');

    await service.purge('User', { olderThan, where: { role: 'guest' } });

    expect(mockPrisma.user.deleteMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { not: null, lt: olderThan },
        role: 'guest',
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/soft-delete.service.purge.spec.ts`
Expected: FAIL — `service.purge is not a function`

- [ ] **Step 3: Add purge method to SoftDeleteService**

Add to `src/services/soft-delete.service.ts`:

```typescript
/**
 * Permanently delete soft-deleted records older than the specified date.
 * Runs within skipSoftDelete context so the extension does not intercept the deleteMany.
 */
async purge(
  model: string,
  options: { olderThan: Date; where?: Record<string, any> },
): Promise<{ count: number }> {
  const { olderThan, where: extraWhere } = options;

  const result = await SoftDeleteContext.run(
    { filterMode: 'default', skipSoftDelete: true },
    async () => {
      const delegate = this.getModelDelegate(model);
      return delegate.deleteMany({
        where: {
          [this.deletedAtField]: { not: null, lt: olderThan },
          ...extraWhere,
        },
      });
    },
  );

  if (result.count > 0) {
    this.eventEmitter?.emitPurged(
      new PurgedEvent(model, result.count, olderThan),
    );
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/soft-delete.service.purge.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `npx vitest run`
Expected: All 117+ tests pass

- [ ] **Step 6: Commit**

```bash
git add src/services/soft-delete.service.ts src/services/soft-delete.service.purge.spec.ts
git commit -m "feat(purge): add SoftDeleteService.purge() with PurgedEvent emission"
```

---

## Task 5: Wire Events into Prisma Extension (delete/deleteMany)

**Files:**
- Modify: `src/prisma/soft-delete-extension.ts`
- Modify: `src/prisma/soft-delete-extension.spec.ts`
- Modify: `src/interfaces/soft-delete-options.interface.ts`

- [ ] **Step 1: Add eventEmitter to SoftDeleteExtensionOptions**

In `src/interfaces/soft-delete-options.interface.ts`, update `SoftDeleteExtensionOptions`:

```typescript
export interface SoftDeleteExtensionOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  /** Optional event emitter for soft-delete lifecycle events */
  eventEmitter?: { emitSoftDeleted: (event: any) => void } | null;
}
```

- [ ] **Step 2: Write failing tests**

Add to `src/prisma/soft-delete-extension.spec.ts`, inside the `describe('delete')` block:

```typescript
it('should emit SoftDeletedEvent when eventEmitter is provided', async () => {
  const mockEmitter = { emitSoftDeleted: vi.fn() };
  const handlersWithEvents = _buildSoftDeleteQueryHandlers({
    ...defaultOptions,
    eventEmitter: mockEmitter,
  });
  const client = createMockClient('User');
  const query = createMockQuery();

  await handlersWithEvents.delete({
    model: 'User',
    args: { where: { id: 1 } },
    query,
    client,
  });

  expect(mockEmitter.emitSoftDeleted).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'User',
      where: { id: 1 },
    }),
  );
});

it('should not throw when eventEmitter is null', async () => {
  const handlersNoEvents = _buildSoftDeleteQueryHandlers({
    ...defaultOptions,
    eventEmitter: null,
  });
  const client = createMockClient('User');
  const query = createMockQuery();

  await expect(
    handlersNoEvents.delete({
      model: 'User',
      args: { where: { id: 1 } },
      query,
      client,
    }),
  ).resolves.not.toThrow();
});
```

Add similar tests inside `describe('deleteMany')`:

```typescript
it('should emit SoftDeletedEvent for deleteMany when eventEmitter is provided', async () => {
  const mockEmitter = { emitSoftDeleted: vi.fn() };
  const handlersWithEvents = _buildSoftDeleteQueryHandlers({
    ...defaultOptions,
    eventEmitter: mockEmitter,
  });
  const client = createMockClient('User');
  const query = createMockQuery();

  await handlersWithEvents.deleteMany({
    model: 'User',
    args: { where: { role: 'guest' } },
    query,
    client,
  });

  expect(mockEmitter.emitSoftDeleted).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'User',
      where: { role: 'guest' },
    }),
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/prisma/soft-delete-extension.spec.ts`
Expected: FAIL — emitSoftDeleted not called (not yet wired)

- [ ] **Step 4: Wire event emission into extension handlers**

In `src/prisma/soft-delete-extension.ts`, update `_buildSoftDeleteQueryHandlers`:

Add import at top:

```typescript
import { SoftDeletedEvent } from '../events/soft-delete.events';
```

Inside the function body, extract event emitter from options:

```typescript
const eventEmitter = options.eventEmitter ?? null;
```

In the `delete` handler, after the cascade block and before `return result`:

```typescript
eventEmitter?.emitSoftDeleted(
  new SoftDeletedEvent(model, args.where, data[deletedAtField] as Date, SoftDeleteContext.getActorId()),
);
```

In the `deleteMany` handler, after the updateMany (both branches — with and without cascade), before `return`:

```typescript
eventEmitter?.emitSoftDeleted(
  new SoftDeletedEvent(model, args.where, data[deletedAtField] as Date, SoftDeleteContext.getActorId()),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/prisma/soft-delete-extension.spec.ts`
Expected: PASS (all existing + 3 new tests)

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/soft-delete-options.interface.ts src/prisma/soft-delete-extension.ts src/prisma/soft-delete-extension.spec.ts
git commit -m "feat(events): emit SoftDeletedEvent from Prisma extension delete/deleteMany"
```

---

## Task 6: Module Registration for Events

**Files:**
- Modify: `src/soft-delete.module.ts`
- Modify: `src/soft-delete.module.spec.ts`
- Modify: `src/interfaces/soft-delete-options.interface.ts`

- [ ] **Step 1: Add enableEvents to module options**

In `src/interfaces/soft-delete-options.interface.ts`, update `SoftDeleteModuleOptions`:

```typescript
export interface SoftDeleteModuleOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  actorExtractor?: (req: any) => string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  prismaServiceToken: any;
  /** Enable event emission. Requires @nestjs/event-emitter to be installed. Default: false */
  enableEvents?: boolean;
}
```

- [ ] **Step 2: Write failing test for module registration with events**

Add to `src/soft-delete.module.spec.ts`:

```typescript
import { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';
```

Add inside `describe('forRoot()')`:

```typescript
it('should provide SoftDeleteEventEmitter when enableEvents is true', () => {
  const dynamicModule = SoftDeleteModule.forRoot({
    ...options,
    enableEvents: true,
  });

  expect(dynamicModule.providers).toContainEqual(SoftDeleteEventEmitter);
  expect(dynamicModule.exports).toContain(SoftDeleteEventEmitter);
});

it('should not provide SoftDeleteEventEmitter when enableEvents is not set', () => {
  const dynamicModule = SoftDeleteModule.forRoot(options);

  expect(dynamicModule.providers).not.toContainEqual(SoftDeleteEventEmitter);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/soft-delete.module.spec.ts`
Expected: FAIL — SoftDeleteEventEmitter not in providers

- [ ] **Step 4: Update module to conditionally register event emitter**

Update `src/soft-delete.module.ts`:

Add import:

```typescript
import { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';
```

In `forRoot()`, conditionally add provider and export:

```typescript
static forRoot(options: SoftDeleteModuleOptions): DynamicModule {
  const providers: any[] = [
    {
      provide: SOFT_DELETE_MODULE_OPTIONS,
      useValue: options,
    },
    {
      provide: SOFT_DELETE_PRISMA_SERVICE,
      useExisting: options.prismaServiceToken,
    },
    SoftDeleteService,
    {
      provide: APP_INTERCEPTOR,
      useClass: SoftDeleteFilterInterceptor,
    },
  ];

  const exports: any[] = [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS];

  if (options.enableEvents) {
    providers.push(SoftDeleteEventEmitter);
    exports.push(SoftDeleteEventEmitter);
  }

  return {
    module: SoftDeleteModule,
    global: true,
    providers,
    exports,
  };
}
```

Apply the same pattern to `forRootAsync()`. Since the options are resolved at runtime via factory, always include `SoftDeleteEventEmitter` — it uses `@Optional()` injection so it gracefully degrades:

```typescript
static forRootAsync(options: SoftDeleteModuleAsyncOptions): DynamicModule {
  const providers: any[] = [
    {
      provide: SOFT_DELETE_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    },
    {
      provide: SOFT_DELETE_PRISMA_SERVICE,
      useExisting: options.prismaServiceToken,
    },
    SoftDeleteService,
    SoftDeleteEventEmitter,
    {
      provide: APP_INTERCEPTOR,
      useClass: SoftDeleteFilterInterceptor,
    },
  ];

  return {
    module: SoftDeleteModule,
    global: true,
    imports: options.imports ?? [],
    providers,
    exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS, SoftDeleteEventEmitter],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/soft-delete.module.spec.ts`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/soft-delete-options.interface.ts src/soft-delete.module.ts src/soft-delete.module.spec.ts
git commit -m "feat(events): register SoftDeleteEventEmitter conditionally in module"
```

---

## Task 7: Update Public Exports and Package Config

**Files:**
- Modify: `src/index.ts`
- Modify: `src/testing/test-soft-delete.module.ts`
- Modify: `package.json`

- [ ] **Step 1: Update public exports**

In `src/index.ts`, add after the Errors section:

```typescript
// Events
export { SoftDeletedEvent, RestoredEvent, PurgedEvent } from './events/soft-delete.events';
export { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';
```

- [ ] **Step 2: Update TestSoftDeleteModule to support event emitter**

In `src/testing/test-soft-delete.module.ts`, update `register()` to accept optional event emitter:

```typescript
import { DynamicModule, Module } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from '../soft-delete.constants';
import { SoftDeleteService } from '../services/soft-delete.service';
import { SoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

@Module({})
export class TestSoftDeleteModule {
  static register(
    options: Partial<SoftDeleteModuleOptions> & { softDeleteModels: string[] },
    prisma?: any,
  ): DynamicModule {
    const fullOptions: SoftDeleteModuleOptions = {
      deletedAtField: 'deletedAt',
      prismaServiceToken: 'TEST_PRISMA',
      ...options,
    };

    const providers: any[] = [
      { provide: SOFT_DELETE_MODULE_OPTIONS, useValue: fullOptions },
      SoftDeleteService,
      SoftDeleteEventEmitter,
    ];

    if (prisma) {
      providers.push({ provide: SOFT_DELETE_PRISMA_SERVICE, useValue: prisma });
    }

    return {
      module: TestSoftDeleteModule,
      providers,
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS, SoftDeleteEventEmitter],
    };
  }
}
```

- [ ] **Step 3: Update package.json**

Add `@nestjs/event-emitter` as optional peer dependency and bump version:

```json
{
  "version": "0.2.0",
  "peerDependenciesMeta": {
    "@nestarc/tenancy": { "optional": true },
    "@nestarc/audit-log": { "optional": true },
    "@nestjs/event-emitter": { "optional": true }
  }
}
```

Also add to `devDependencies`:

```json
"@nestjs/event-emitter": "^3.0.0"
```

And add to `tsup.config.ts` externals:

```typescript
external: [
  // ... existing ...
  '@nestjs/event-emitter',
],
```

- [ ] **Step 4: Install and verify build**

Run: `npm install && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/testing/test-soft-delete.module.ts package.json package-lock.json tsup.config.ts
git commit -m "feat: export events, update test module, add event-emitter peer dep, bump to 0.2.0"
```

---

## Task 8: Comprehensive README Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

Read `README.md` to see current content.

- [ ] **Step 2: Write comprehensive README**

Replace `README.md` with full documentation covering:

1. **Header** — package name, badges (npm version, CI, license), one-line description
2. **Features** — bullet list of all capabilities
3. **Quick Start** — install, Prisma schema setup, module registration, basic usage
4. **API Reference**
   - `SoftDeleteModule.forRoot()` / `forRootAsync()` — all options explained
   - `SoftDeleteService` — `restore()`, `forceDelete()`, `withDeleted()`, `onlyDeleted()`, `purge()`
   - Decorators — `@WithDeleted()`, `@OnlyDeleted()`, `@SkipSoftDelete()`
   - Events — `SoftDeletedEvent`, `RestoredEvent`, `PurgedEvent` with `@OnEvent()` listener examples
   - `createPrismaSoftDeleteExtension()` — standalone usage without NestJS module
5. **Cascade Configuration** — parent/child setup, depth limits
6. **Purge (Scheduled Hard-Delete)** — usage with `@nestjs/schedule` Cron example
7. **Testing** — `TestSoftDeleteModule`, `expectSoftDeleted`, `expectNotSoftDeleted`, `expectCascadeSoftDeleted`
8. **Unique Constraint Strategy** — Prisma schema guide for `@@unique` with `deletedAt`
9. **License**

The README should contain code examples for every feature. Use the actual API signatures from the source code. Do NOT use placeholder or pseudo-code.

- [ ] **Step 3: Verify README renders correctly**

Scan the markdown for syntax errors — mismatched backticks, broken links, unclosed code blocks.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: comprehensive README with API reference, examples, and guides"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (120+ tests)

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build, output sizes reasonable

- [ ] **Step 4: Verify exports**

Run: `node -e "const m = require('./dist/index.js'); console.log(Object.keys(m).sort().join('\n'))"`
Expected output includes: `PurgedEvent`, `RestoredEvent`, `SoftDeleteEventEmitter`, `SoftDeletedEvent` (among existing exports)

- [ ] **Step 5: Final commit (if any lint/format fixes)**

```bash
git add -A
git commit -m "chore: lint and format fixes for v0.2.0"
```
