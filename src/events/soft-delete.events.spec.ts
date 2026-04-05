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
