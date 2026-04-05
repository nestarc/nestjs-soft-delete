import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { WithDeleted } from './with-deleted.decorator';
import { OnlyDeleted } from './only-deleted.decorator';
import { SkipSoftDelete } from './skip-soft-delete.decorator';
import { WITH_DELETED_KEY, ONLY_DELETED_KEY, SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';

describe('Decorators', () => {
  describe('@WithDeleted()', () => {
    it('should set WITH_DELETED_KEY metadata to true', () => {
      class TestController {
        @WithDeleted()
        handler() {}
      }

      const metadata = Reflect.getMetadata(WITH_DELETED_KEY, TestController.prototype.handler);
      expect(metadata).toBe(true);
    });
  });

  describe('@OnlyDeleted()', () => {
    it('should set ONLY_DELETED_KEY metadata to true', () => {
      class TestController {
        @OnlyDeleted()
        handler() {}
      }

      const metadata = Reflect.getMetadata(ONLY_DELETED_KEY, TestController.prototype.handler);
      expect(metadata).toBe(true);
    });
  });

  describe('@SkipSoftDelete()', () => {
    it('should set SKIP_SOFT_DELETE_KEY metadata to true', () => {
      class TestController {
        @SkipSoftDelete()
        handler() {}
      }

      const metadata = Reflect.getMetadata(SKIP_SOFT_DELETE_KEY, TestController.prototype.handler);
      expect(metadata).toBe(true);
    });
  });
});
