/**
 * E2E tests for lifecycle events (SoftDeletedEvent, RestoredEvent, PurgedEvent)
 * via real @nestjs/event-emitter — no mocks.
 *
 * Verifies:
 *   - SoftDeletedEvent emits on direct delete with correct payload
 *   - SoftDeletedEvent emits on deleteMany
 *   - Cascade does NOT emit additional events for child rows
 *     (cascade-handler uses updateMany which is not intercepted)
 *   - RestoredEvent emits on SoftDeleteService.restore()
 *   - PurgedEvent emits on purge() when count > 0
 *   - PurgedEvent does NOT emit when count === 0
 *   - actorId from SoftDeleteContext flows into the event
 *   - With enableEvents:false, no events fire
 *
 * Prerequisites: see setup-helpers.ts.
 */
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '../generated/client';
import { createPrismaSoftDeleteExtension } from '../../src/prisma/soft-delete-extension';
import { SoftDeleteModule } from '../../src/soft-delete.module';
import { SoftDeleteService } from '../../src/services/soft-delete.service';
import { SoftDeleteContext } from '../../src/services/soft-delete-context';
import {
  SoftDeletedEvent,
  RestoredEvent,
  PurgedEvent,
} from '../../src/events/soft-delete.events';
import { resetRegisteredSoftDeleteEventEmitter } from '../../src/events/soft-delete-event-emitter';
import {
  cleanData,
  createBasePrisma,
  createTables,
  dropTables,
} from './setup-helpers';

const PRISMA_TOKEN = 'PRISMA_CLIENT';
const prismaDmmf = (Prisma as any).dmmf;

let basePrisma: PrismaClient;
let prisma: any;
let module: TestingModule;
let eventEmitter: EventEmitter2;
let softDelete: SoftDeleteService;

function extendClient(client: PrismaClient) {
  return client.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post', 'Comment'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
      cascade: { User: ['Post'], Post: ['Comment'] },
      dmmf: prismaDmmf,
    }),
  );
}

async function buildModule(enableEvents: boolean): Promise<TestingModule> {
  resetRegisteredSoftDeleteEventEmitter();

  return Test.createTestingModule({
    imports: [
      EventEmitterModule.forRoot(),
      SoftDeleteModule.forRoot({
        softDeleteModels: ['User', 'Post', 'Comment'],
        deletedAtField: 'deletedAt',
        deletedByField: 'deletedBy',
        cascade: { User: ['Post'], Post: ['Comment'] },
        prismaServiceToken: PRISMA_TOKEN,
        enableEvents,
        dmmf: prismaDmmf,
      }),
    ],
    providers: [
      { provide: PRISMA_TOKEN, useValue: prisma },
      // SoftDeleteEventEmitter resolves @Inject('EventEmitter2') (string token);
      // bridge it to the real EventEmitter2 instance from EventEmitterModule.
      { provide: 'EventEmitter2', useExisting: EventEmitter2 },
    ],
  }).compile();
}

beforeAll(async () => {
  basePrisma = createBasePrisma();
  await basePrisma.$connect();
  await createTables(basePrisma);
  prisma = extendClient(basePrisma);
});

afterAll(async () => {
  await dropTables(basePrisma);
  await basePrisma.$disconnect();
});

beforeEach(async () => {
  await cleanData(basePrisma);
  module = await buildModule(true);
  eventEmitter = module.get(EventEmitter2);
  softDelete = module.get(SoftDeleteService);
});

afterEach(async () => {
  await module?.close();
});

function captureEvent<T>(name: string): Promise<T> {
  return new Promise<T>((resolve) => {
    eventEmitter.once(name, (event: T) => resolve(event));
  });
}

describe('Soft-delete events E2E', () => {
  describe('SoftDeletedEvent', () => {
    it('emits when a tracked model is deleted', async () => {
      const user = await prisma.user.create({
        data: { email: 'e1@test.com', name: 'E1' },
      });

      const eventPromise = captureEvent<SoftDeletedEvent>(
        SoftDeletedEvent.EVENT_NAME,
      );
      await prisma.user.delete({ where: { id: user.id } });
      const event = await eventPromise;

      expect(event).toBeInstanceOf(SoftDeletedEvent);
      expect(event.model).toBe('User');
      expect(event.where).toEqual({ id: user.id });
      expect(event.deletedAt).toBeInstanceOf(Date);
      expect(event.actorId).toBeNull();
    });

    it('carries the actorId from SoftDeleteContext', async () => {
      const user = await prisma.user.create({
        data: { email: 'e2@test.com', name: 'E2' },
      });

      const eventPromise = captureEvent<SoftDeletedEvent>(
        SoftDeletedEvent.EVENT_NAME,
      );
      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-1' },
        () => prisma.user.delete({ where: { id: user.id } }),
      );
      const event = await eventPromise;

      expect(event.actorId).toBe('admin-1');
    });

    it('emits one SoftDeletedEvent for the parent on cascade (no per-child events)', async () => {
      const user = await prisma.user.create({
        data: { email: 'e3@test.com', name: 'E3' },
      });
      await prisma.post.create({
        data: { title: 'P', authorId: user.id },
      });

      const collected: SoftDeletedEvent[] = [];
      eventEmitter.on(SoftDeletedEvent.EVENT_NAME, (event: SoftDeletedEvent) => {
        collected.push(event);
      });

      await prisma.user.delete({ where: { id: user.id } });

      // Cascade uses updateMany, which is not intercepted, so no child events fire.
      expect(collected).toHaveLength(1);
      expect(collected[0].model).toBe('User');
    });

    it('emits on deleteMany once per call', async () => {
      await prisma.user.create({ data: { email: 'm1@test.com', name: 'M1' } });
      await prisma.user.create({ data: { email: 'm2@test.com', name: 'M2' } });

      const eventPromise = captureEvent<SoftDeletedEvent>(
        SoftDeletedEvent.EVENT_NAME,
      );
      await prisma.user.deleteMany({ where: { name: { in: ['M1', 'M2'] } } });
      const event = await eventPromise;

      expect(event.model).toBe('User');
      expect(event.where).toEqual({ name: { in: ['M1', 'M2'] } });
    });
  });

  describe('RestoredEvent', () => {
    it('emits when SoftDeleteService.restore() succeeds', async () => {
      const user = await prisma.user.create({
        data: { email: 'r1@test.com', name: 'R1' },
      });
      await prisma.user.delete({ where: { id: user.id } });

      const eventPromise = captureEvent<RestoredEvent>(RestoredEvent.EVENT_NAME);
      await softDelete.restore('User', { id: user.id });
      const event = await eventPromise;

      expect(event).toBeInstanceOf(RestoredEvent);
      expect(event.model).toBe('User');
      expect(event.where).toEqual({ id: user.id });
    });
  });

  describe('PurgedEvent', () => {
    it('emits when purge actually removes rows', async () => {
      const user = await prisma.user.create({
        data: { email: 'p1@test.com', name: 'P1' },
      });
      const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      await basePrisma.$executeRawUnsafe(
        `UPDATE users SET deleted_at = $1 WHERE id = $2::uuid`,
        longAgo,
        user.id,
      );

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const eventPromise = captureEvent<PurgedEvent>(PurgedEvent.EVENT_NAME);
      const result = await softDelete.purge('User', { olderThan: cutoff });
      const event = await eventPromise;

      expect(result.count).toBe(1);
      expect(event).toBeInstanceOf(PurgedEvent);
      expect(event.model).toBe('User');
      expect(event.count).toBe(1);
      expect(event.olderThan).toEqual(cutoff);
    });

    it('does NOT emit when purge removes 0 rows', async () => {
      const collected: PurgedEvent[] = [];
      eventEmitter.on(PurgedEvent.EVENT_NAME, (event: PurgedEvent) => {
        collected.push(event);
      });

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await softDelete.purge('User', { olderThan: cutoff });

      expect(result.count).toBe(0);
      // Give the event loop a tick in case emission is queued
      await new Promise((r) => setImmediate(r));
      expect(collected).toHaveLength(0);
    });
  });

  describe('enableEvents:false', () => {
    it('does not fire any events when disabled', async () => {
      await module.close();
      module = await buildModule(false);
      eventEmitter = module.get(EventEmitter2);
      softDelete = module.get(SoftDeleteService);

      const collected: any[] = [];
      eventEmitter.on(SoftDeletedEvent.EVENT_NAME, (e) => collected.push(e));
      eventEmitter.on(RestoredEvent.EVENT_NAME, (e) => collected.push(e));
      eventEmitter.on(PurgedEvent.EVENT_NAME, (e) => collected.push(e));

      const user = await prisma.user.create({
        data: { email: 'd1@test.com', name: 'D1' },
      });
      await prisma.user.delete({ where: { id: user.id } });
      await softDelete.restore('User', { id: user.id });

      await new Promise((r) => setImmediate(r));
      expect(collected).toHaveLength(0);
    });
  });
});
