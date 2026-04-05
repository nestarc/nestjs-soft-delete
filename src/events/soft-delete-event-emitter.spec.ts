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

    it('should report isEnabled as true', () => {
      expect(emitter.isEnabled).toBe(true);
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
});
