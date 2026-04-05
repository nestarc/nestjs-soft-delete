import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftDeleteService } from './soft-delete.service';
import { SoftDeleteContext } from './soft-delete-context';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

describe('SoftDeleteService', () => {
  let service: SoftDeleteService;
  let mockPrisma: any;
  let mockCascadeHandler: any;
  let mockEventEmitter: any;
  const deletedDate = new Date('2024-01-15T10:00:00Z');

  const defaultOptions: SoftDeleteModuleOptions = {
    softDeleteModels: ['User', 'Post'],
    deletedAtField: 'deletedAt',
    deletedByField: 'deletedBy',
    prismaServiceToken: 'PRISMA',
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      post: {
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };

    mockCascadeHandler = {
      cascadeRestore: vi.fn().mockResolvedValue(undefined),
    };

    mockEventEmitter = {
      emitSoftDeleted: vi.fn(),
      emitRestored: vi.fn(),
      emitPurged: vi.fn(),
      isEnabled: true,
    };

    service = new SoftDeleteService(defaultOptions, mockPrisma, mockCascadeHandler, mockEventEmitter);
  });

  describe('restore()', () => {
    it('should find and restore a soft-deleted record', async () => {
      const deletedUser = {
        id: '1',
        name: 'Alice',
        deletedAt: deletedDate,
        deletedBy: 'admin',
      };
      const restoredUser = {
        id: '1',
        name: 'Alice',
        deletedAt: null,
        deletedBy: null,
      };

      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(restoredUser);

      const result = await service.restore('User', { id: '1' });

      expect(result).toEqual(restoredUser);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: '1' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { deletedAt: null, deletedBy: null },
      });
    });

    it('should throw when record not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.restore('User', { id: '999' })).rejects.toThrow(
        'Record not found for model "User"',
      );
    });

    it('should cascade restore when cascadeHandler is present and record was deleted', async () => {
      const deletedUser = {
        id: '1',
        name: 'Alice',
        deletedAt: deletedDate,
      };
      const restoredUser = {
        id: '1',
        name: 'Alice',
        deletedAt: null,
      };

      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(restoredUser);

      await service.restore('User', { id: '1' });

      expect(mockCascadeHandler.cascadeRestore).toHaveBeenCalledWith(
        mockPrisma,
        'User',
        '1',
        deletedDate,
        0,
      );
    });

    it('should not cascade restore when cascadeHandler is null', async () => {
      const serviceNoCascade = new SoftDeleteService(defaultOptions, mockPrisma, null, mockEventEmitter);
      const deletedUser = {
        id: '1',
        name: 'Alice',
        deletedAt: deletedDate,
      };
      const restoredUser = {
        id: '1',
        name: 'Alice',
        deletedAt: null,
      };

      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(restoredUser);

      await serviceNoCascade.restore('User', { id: '1' });

      expect(mockCascadeHandler.cascadeRestore).not.toHaveBeenCalled();
    });

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

    it('should not throw when eventEmitter is null on restore', async () => {
      const serviceNoEvents = new SoftDeleteService(defaultOptions, mockPrisma, mockCascadeHandler, null);
      const deletedUser = { id: '1', deletedAt: deletedDate };
      const restoredUser = { id: '1', deletedAt: null };

      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(restoredUser);

      await expect(serviceNoEvents.restore('User', { id: '1' })).resolves.not.toThrow();
    });
  });

  describe('forceDelete()', () => {
    it('should perform physical delete in skip context', async () => {
      const user = { id: '1', name: 'Alice' };
      mockPrisma.user.delete.mockResolvedValue(user);

      const result = await service.forceDelete('User', { id: '1' });

      expect(result).toEqual(user);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should run within skipSoftDelete context', async () => {
      let capturedSkipped = false;
      mockPrisma.user.delete.mockImplementation(() => {
        capturedSkipped = SoftDeleteContext.isSkipped();
        return Promise.resolve({ id: '1' });
      });

      await service.forceDelete('User', { id: '1' });

      expect(capturedSkipped).toBe(true);
    });
  });

  describe('withDeleted()', () => {
    it('should set withDeleted filter mode in context', async () => {
      let capturedMode: string = '';

      await service.withDeleted(() => {
        capturedMode = SoftDeleteContext.getFilterMode();
        return Promise.resolve();
      });

      expect(capturedMode).toBe('withDeleted');
    });

    it('should return the callback result', async () => {
      const result = await service.withDeleted(() => Promise.resolve('test-value'));

      expect(result).toBe('test-value');
    });
  });

  describe('onlyDeleted()', () => {
    it('should set onlyDeleted filter mode in context', async () => {
      let capturedMode: string = '';

      await service.onlyDeleted(() => {
        capturedMode = SoftDeleteContext.getFilterMode();
        return Promise.resolve();
      });

      expect(capturedMode).toBe('onlyDeleted');
    });

    it('should return the callback result', async () => {
      const result = await service.onlyDeleted(() => Promise.resolve('deleted-items'));

      expect(result).toBe('deleted-items');
    });
  });

  describe('default field names', () => {
    it('should use default deletedAtField when not specified', async () => {
      const optionsNoField: SoftDeleteModuleOptions = {
        softDeleteModels: ['User'],
        prismaServiceToken: 'PRISMA',
      };
      const svc = new SoftDeleteService(optionsNoField, mockPrisma, null, mockEventEmitter);

      const deletedUser = { id: '1', deletedAt: deletedDate };
      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue({ id: '1', deletedAt: null });

      await svc.restore('User', { id: '1' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { deletedAt: null },
      });
    });
  });
});
