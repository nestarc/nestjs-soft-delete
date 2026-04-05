import { describe, it, expect } from 'vitest';
import { SoftDeleteContext } from './soft-delete-context';

describe('SoftDeleteContext', () => {
  it('should return "default" filter mode when no context is set', () => {
    expect(SoftDeleteContext.getFilterMode()).toBe('default');
  });

  it('should return false for isSkipped when no context is set', () => {
    expect(SoftDeleteContext.isSkipped()).toBe(false);
  });

  it('should set and get filter mode within run()', () => {
    SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('withDeleted');
      },
    );
  });

  it('should set and get onlyDeleted filter mode', () => {
    SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('onlyDeleted');
      },
    );
  });

  it('should set and get skipSoftDelete flag', () => {
    SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: true },
      () => {
        expect(SoftDeleteContext.isSkipped()).toBe(true);
      },
    );
  });

  it('should store and retrieve actorId', () => {
    SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: false, actorId: 'user-123' },
      () => {
        expect(SoftDeleteContext.getActorId()).toBe('user-123');
      },
    );
  });

  it('should return null actorId when not set', () => {
    expect(SoftDeleteContext.getActorId()).toBeNull();
  });

  it('should isolate contexts between nested runs', () => {
    SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      () => {
        expect(SoftDeleteContext.getFilterMode()).toBe('withDeleted');

        SoftDeleteContext.run(
          { filterMode: 'onlyDeleted', skipSoftDelete: true },
          () => {
            expect(SoftDeleteContext.getFilterMode()).toBe('onlyDeleted');
            expect(SoftDeleteContext.isSkipped()).toBe(true);
          },
        );

        expect(SoftDeleteContext.getFilterMode()).toBe('withDeleted');
        expect(SoftDeleteContext.isSkipped()).toBe(false);
      },
    );
  });

  it('should support async callbacks', async () => {
    const result = await SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return SoftDeleteContext.getFilterMode();
      },
    );
    expect(result).toBe('withDeleted');
  });
});
