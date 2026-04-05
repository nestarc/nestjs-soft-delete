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
