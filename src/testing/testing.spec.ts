import { describe, it, expect, vi } from 'vitest';
import { TestSoftDeleteModule } from './test-soft-delete.module';
import { expectSoftDeleted, expectNotSoftDeleted } from './expect-soft-deleted';
import { SoftDeleteService } from '../services/soft-delete.service';
import { SOFT_DELETE_MODULE_OPTIONS } from '../soft-delete.constants';

describe('TestSoftDeleteModule', () => {
  it('should return a DynamicModule from register()', () => {
    const result = TestSoftDeleteModule.register({
      softDeleteModels: ['User', 'Post'],
    });

    expect(result).toEqual({
      module: TestSoftDeleteModule,
      providers: [
        { provide: SOFT_DELETE_MODULE_OPTIONS, useValue: { deletedAtField: 'deletedAt', prismaServiceToken: 'TEST_PRISMA', softDeleteModels: ['User', 'Post'] } },
        SoftDeleteService,
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    });
  });
});

describe('expectSoftDeleted', () => {
  it('should pass when record has non-null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: 1, deletedAt: new Date() }),
    };

    await expect(expectSoftDeleted(mockDelegate, { id: 1 })).resolves.toBeUndefined();
  });

  it('should fail when record has null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: 1, deletedAt: null }),
    };

    await expect(expectSoftDeleted(mockDelegate, { id: 1 })).rejects.toThrow(
      'Expected record to be soft-deleted',
    );
  });

  it('should fail when record is not found', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue(null),
    };

    await expect(expectSoftDeleted(mockDelegate, { id: 1 })).rejects.toThrow(
      'Expected record to exist (soft-deleted), but it was not found',
    );
  });
});

describe('expectNotSoftDeleted', () => {
  it('should pass when record has null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: 1, deletedAt: null }),
    };

    await expect(expectNotSoftDeleted(mockDelegate, { id: 1 })).resolves.toBeUndefined();
  });

  it('should fail when record has non-null deletedAt', async () => {
    const mockDelegate = {
      findFirst: vi.fn().mockResolvedValue({ id: 1, deletedAt: new Date() }),
    };

    await expect(expectNotSoftDeleted(mockDelegate, { id: 1 })).rejects.toThrow(
      'Expected record to NOT be soft-deleted',
    );
  });
});
