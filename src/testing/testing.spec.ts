import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { TestSoftDeleteModule } from './test-soft-delete.module';
import { expectSoftDeleted, expectNotSoftDeleted } from './expect-soft-deleted';
import { SoftDeleteService } from '../services/soft-delete.service';
import { SoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from '../soft-delete.constants';
import { CascadeDmmfMissingError } from '../errors/cascade-dmmf-missing.error';

describe('TestSoftDeleteModule', () => {
  it('provides the root service, tokens, and event emitter without cascade metadata', async () => {
    const prisma = {};
    const module = await Test.createTestingModule({
      imports: [TestSoftDeleteModule.register({ softDeleteModels: ['User'] }, prisma)],
    }).compile();
    try {
      expect(module.get(SoftDeleteService)).toBeInstanceOf(SoftDeleteService);
      expect(module.get(SoftDeleteEventEmitter)).toBeInstanceOf(SoftDeleteEventEmitter);
      expect(module.get(SOFT_DELETE_PRISMA_SERVICE)).toBe(prisma);
      expect(module.get(SOFT_DELETE_MODULE_OPTIONS).deletedAtField).toBe('deletedAt');
    } finally {
      await module.close();
    }
  });

  it('rejects configured cascade without DMMF, like the production module', async () => {
    await expect(Test.createTestingModule({
      imports: [TestSoftDeleteModule.register({
        softDeleteModels: ['User', 'Post'], cascade: { User: ['Post'] },
      }, {})],
    }).compile()).rejects.toBeInstanceOf(CascadeDmmfMissingError);
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
