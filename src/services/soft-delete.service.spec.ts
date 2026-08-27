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
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      post: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    };

    mockCascadeHandler = {
      cascadeRestore: vi.fn().mockResolvedValue(undefined),
      findPrimaryKey: vi.fn().mockReturnValue('id'),
    };

    mockEventEmitter = {
      emitSoftDeleted: vi.fn(),
      emitRestored: vi.fn(),
      emitPurged: vi.fn(),
      isEnabled: true,
    };

    service = new SoftDeleteService(
      defaultOptions,
      mockPrisma,
      mockCascadeHandler,
      mockEventEmitter,
    );
  });

  describe('restoreMany()', () => {
    it('should restore deleted records matching the where clause and cascade each affected row', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: '1', deletedAt: deletedDate },
        { id: '2', deletedAt: deletedDate },
      ]);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.restoreMany('User', { where: { role: 'guest' } });

      expect(result).toEqual({ count: 2 });
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          role: 'guest',
          deletedAt: { not: null },
        },
        select: {
          id: true,
          deletedAt: true,
        },
      });
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          role: 'guest',
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
          deletedBy: null,
        },
      });
      expect(mockCascadeHandler.cascadeRestore).toHaveBeenCalledTimes(2);
      expect(mockCascadeHandler.cascadeRestore).toHaveBeenNthCalledWith(
        1,
        mockPrisma,
        'User',
        '1',
        deletedDate,
        0,
      );
      expect(mockCascadeHandler.cascadeRestore).toHaveBeenNthCalledWith(
        2,
        mockPrisma,
        'User',
        '2',
        deletedDate,
        0,
      );
      expect(mockEventEmitter.emitRestored).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'User',
          where: { role: 'guest' },
          count: 2,
        }),
      );
    });

    it('should update deleted rows without loading records when cascadeHandler is null', async () => {
      const serviceNoCascade = new SoftDeleteService(
        defaultOptions,
        mockPrisma,
        null,
        mockEventEmitter,
      );
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await serviceNoCascade.restoreMany('User', { where: { role: 'guest' } });

      expect(result).toEqual({ count: 1 });
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          role: 'guest',
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
          deletedBy: null,
        },
      });
    });

    it('should only clear deletedAt when deletedByField is not configured', async () => {
      const optionsNoDeletedBy: SoftDeleteModuleOptions = {
        softDeleteModels: ['User'],
        prismaServiceToken: 'PRISMA',
      };
      const serviceNoDeletedBy = new SoftDeleteService(
        optionsNoDeletedBy,
        mockPrisma,
        null,
        mockEventEmitter,
      );
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      await serviceNoDeletedBy.restoreMany('User');

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
        },
      });
    });
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
        where: { id: '1', deletedAt: { not: null } },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '1', deletedAt: deletedDate },
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
        undefined,
      );
    });

    it('should use dynamic PK field from cascadeHandler instead of hardcoded id', async () => {
      mockCascadeHandler.findPrimaryKey.mockReturnValue('uuid');
      const deletedUser = {
        uuid: 'abc-123',
        name: 'Alice',
        deletedAt: deletedDate,
      };
      const restoredUser = { uuid: 'abc-123', deletedAt: null };

      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(restoredUser);

      await service.restore('User', { uuid: 'abc-123' });

      expect(mockCascadeHandler.findPrimaryKey).toHaveBeenCalledWith('User');
      expect(mockCascadeHandler.cascadeRestore).toHaveBeenCalledWith(
        mockPrisma,
        'User',
        'abc-123',
        deletedDate,
        0,
        undefined,
      );
    });

    it('should not cascade restore when cascadeHandler is null', async () => {
      const serviceNoCascade = new SoftDeleteService(
        defaultOptions,
        mockPrisma,
        null,
        mockEventEmitter,
      );
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

    it('should pass actorId from context to RestoredEvent', async () => {
      const deletedUser = { id: '1', deletedAt: deletedDate };
      const restoredUser = { id: '1', deletedAt: null };

      mockPrisma.user.findFirst.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(restoredUser);

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-123' },
        () => service.restore('User', { id: '1' }),
      );

      expect(mockEventEmitter.emitRestored).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-123',
        }),
      );
    });

    it('should not throw when eventEmitter is null on restore', async () => {
      const serviceNoEvents = new SoftDeleteService(
        defaultOptions,
        mockPrisma,
        mockCascadeHandler,
        null,
      );
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

  describe('atomic audit lifecycle bridge', () => {
    const auditOptions: SoftDeleteModuleOptions = {
      ...defaultOptions,
      auditLifecycle: 'atomic-required',
      auditMaxBatchRecords: 2,
    };

    it('fails before restore mutation when the lifecycle client is unavailable', async () => {
      const auditService = new SoftDeleteService(auditOptions, mockPrisma, null, null);

      await expect(auditService.restore('User', { id: '1' })).rejects.toThrow(
        'requires the extension order',
      );
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('routes restore through lifecycle metadata and guards the captured deletion', async () => {
      const tx = {
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: '1',
            deletedAt: deletedDate,
          }),
          update: vi.fn().mockResolvedValue({ id: '1', deletedAt: null }),
        },
      };
      const auditPrisma = {
        getAuditCapabilities: vi.fn(() => ({
          consistency: 'atomic-required',
          atomicLifecycle: true,
        })),
        withAuditLifecycle: vi.fn(
          async (_input: unknown, callback: (client: any) => Promise<unknown>) => callback(tx),
        ),
      };
      const auditService = new SoftDeleteService(auditOptions, auditPrisma, null, null);

      await auditService.restore('User', { id: '1' });

      expect(auditPrisma.withAuditLifecycle).toHaveBeenCalledWith(
        {
          action: 'User.restored',
          metadata: {
            auditKind: 'record',
            lifecycle: 'soft-delete',
            lifecycleOperation: 'restore',
          },
        },
        expect.any(Function),
      );
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: '1', deletedAt: deletedDate },
        data: { deletedAt: null, deletedBy: null },
      });
    });

    it('uses DMMF primary keys and exact captured deletion guards for restoreMany', async () => {
      const tx = {
        user: {
          findMany: vi.fn().mockResolvedValue([{ uuid: 'user-1', deletedAt: deletedDate }]),
          update: vi.fn().mockResolvedValue({
            uuid: 'user-1',
            deletedAt: null,
          }),
        },
      };
      const auditPrisma = {
        getAuditCapabilities: vi.fn(() => ({
          consistency: 'atomic-required',
          atomicLifecycle: true,
        })),
        withAuditLifecycle: vi.fn(
          async (_input: unknown, callback: (client: any) => Promise<unknown>) => callback(tx),
        ),
      };
      const auditService = new SoftDeleteService(
        {
          ...auditOptions,
          dmmf: {
            datamodel: {
              models: [
                {
                  name: 'User',
                  fields: [
                    {
                      name: 'uuid',
                      kind: 'scalar',
                      type: 'String',
                      isId: true,
                    },
                  ],
                },
              ],
            },
          },
        },
        auditPrisma,
        null,
        null,
      );

      await auditService.restoreMany('User', { where: { role: 'guest' } });

      expect(tx.user.findMany).toHaveBeenCalledWith({
        where: { role: 'guest', deletedAt: { not: null } },
        take: 3,
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { role: 'guest', deletedAt: deletedDate, uuid: 'user-1' },
        data: { deletedAt: null, deletedBy: null },
      });
    });

    it('fails restoreMany before mutation when the audit cap is exceeded', async () => {
      const tx = {
        user: {
          findMany: vi.fn().mockResolvedValue([
            { id: '1', deletedAt: deletedDate },
            { id: '2', deletedAt: deletedDate },
          ]),
          update: vi.fn(),
        },
      };
      const auditPrisma = {
        getAuditCapabilities: vi.fn(() => ({
          consistency: 'atomic-required',
          atomicLifecycle: true,
        })),
        withAuditLifecycle: vi.fn(
          async (_input: unknown, callback: (client: any) => Promise<unknown>) => callback(tx),
        ),
      };
      const auditService = new SoftDeleteService(
        { ...auditOptions, auditMaxBatchRecords: 1 },
        auditPrisma,
        null,
        null,
      );

      await expect(auditService.restoreMany('User')).rejects.toThrow(
        'exceeds auditMaxBatchRecords (1)',
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('rejects invalid runtime module audit options', () => {
      expect(
        () =>
          new SoftDeleteService(
            {
              ...defaultOptions,
              auditLifecycle: 'best-effort',
            } as unknown as SoftDeleteModuleOptions,
            mockPrisma,
            null,
            null,
          ),
      ).toThrow('auditLifecycle must be "atomic-required"');

      expect(
        () =>
          new SoftDeleteService(
            { ...defaultOptions, auditMaxBatchRecords: Number.NaN },
            mockPrisma,
            null,
            null,
          ),
      ).toThrow('auditMaxBatchRecords must be a positive integer');
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
        where: { id: '1', deletedAt: deletedDate },
        data: { deletedAt: null },
      });
    });
  });
});
