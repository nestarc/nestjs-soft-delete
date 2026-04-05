import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _buildSoftDeleteQueryHandlers, createPrismaSoftDeleteExtension } from './soft-delete-extension';
import { SoftDeleteContext } from '../services/soft-delete-context';
import type { SoftDeleteExtensionOptions } from '../interfaces/soft-delete-options.interface';

/**
 * Creates a mock query function that resolves with whatever args it receives,
 * making it easy to assert what was passed to the underlying Prisma operation.
 */
function createMockQuery() {
  return vi.fn(async (args: any) => ({ __queryArgs: args }));
}

/**
 * Creates a mock Prisma client with update/updateMany stubs for the given model.
 */
function createMockClient(modelName: string) {
  const modelKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  return {
    [modelKey]: {
      update: vi.fn(async (args: any) => ({ __updateArgs: args })),
      updateMany: vi.fn(async (args: any) => ({ __updateManyArgs: args })),
    },
  };
}

const defaultOptions: SoftDeleteExtensionOptions = {
  softDeleteModels: ['User', 'Post'],
};

describe('_buildSoftDeleteQueryHandlers', () => {
  let handlers: ReturnType<typeof _buildSoftDeleteQueryHandlers>;

  beforeEach(() => {
    handlers = _buildSoftDeleteQueryHandlers(defaultOptions);
  });

  // ── Write Operations ──────────────────────────────────────────────────

  describe('delete', () => {
    it('should convert delete to update with deletedAt for soft-delete model', async () => {
      const client = createMockClient('User');
      const query = createMockQuery();

      await handlers.delete({
        model: 'User',
        args: { where: { id: 1 } },
        query,
        client,
      });

      // Should NOT call the original delete query
      expect(query).not.toHaveBeenCalled();
      // Should call update on the client
      expect(client.user.update).toHaveBeenCalledTimes(1);
      const updateCall = client.user.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 1 });
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('should pass-through for non-soft-delete model', async () => {
      const client = createMockClient('Comment');
      const query = createMockQuery();

      await handlers.delete({
        model: 'Comment',
        args: { where: { id: 1 } },
        query,
        client,
      });

      // Original query should be called unchanged
      expect(query).toHaveBeenCalledWith({ where: { id: 1 } });
      // The client's update should NOT have been called
      expect(client.comment.update).not.toHaveBeenCalled();
    });

    it('should pass-through when SoftDeleteContext.isSkipped() is true', async () => {
      const client = createMockClient('User');
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: true },
        async () => {
          await handlers.delete({
            model: 'User',
            args: { where: { id: 1 } },
            query,
            client,
          });
        },
      );

      expect(query).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(client.user.update).not.toHaveBeenCalled();
    });

    it('should include deletedBy when deletedByField is configured and actorId is set', async () => {
      const optionsWithDeletedBy: SoftDeleteExtensionOptions = {
        softDeleteModels: ['User'],
        deletedByField: 'deletedBy',
      };
      const handlersWithDeletedBy = _buildSoftDeleteQueryHandlers(optionsWithDeletedBy);
      const client = createMockClient('User');
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-42' },
        async () => {
          await handlersWithDeletedBy.delete({
            model: 'User',
            args: { where: { id: 5 } },
            query,
            client,
          });
        },
      );

      expect(client.user.update).toHaveBeenCalledTimes(1);
      const updateCall = client.user.update.mock.calls[0][0];
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
      expect(updateCall.data.deletedBy).toBe('admin-42');
    });

    it('should not include deletedBy when actorId is null', async () => {
      const optionsWithDeletedBy: SoftDeleteExtensionOptions = {
        softDeleteModels: ['User'],
        deletedByField: 'deletedBy',
      };
      const handlersWithDeletedBy = _buildSoftDeleteQueryHandlers(optionsWithDeletedBy);
      const client = createMockClient('User');
      const query = createMockQuery();

      await handlersWithDeletedBy.delete({
        model: 'User',
        args: { where: { id: 5 } },
        query,
        client,
      });

      const updateCall = client.user.update.mock.calls[0][0];
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
      expect(updateCall.data).not.toHaveProperty('deletedBy');
    });

    it('should handle case-insensitive model name matching', async () => {
      const optionsLower: SoftDeleteExtensionOptions = {
        softDeleteModels: ['user'],
      };
      const handlersLower = _buildSoftDeleteQueryHandlers(optionsLower);
      const client = createMockClient('User');
      const query = createMockQuery();

      await handlersLower.delete({
        model: 'User',
        args: { where: { id: 1 } },
        query,
        client,
      });

      expect(query).not.toHaveBeenCalled();
      expect(client.user.update).toHaveBeenCalledTimes(1);
    });

    it('should emit SoftDeletedEvent when eventEmitter is provided', async () => {
      const mockEmitter = { emitSoftDeleted: vi.fn() };
      const handlersWithEvents = _buildSoftDeleteQueryHandlers({
        ...defaultOptions,
        eventEmitter: mockEmitter,
      });
      const client = createMockClient('User');
      const query = createMockQuery();

      await handlersWithEvents.delete({
        model: 'User',
        args: { where: { id: 1 } },
        query,
        client,
      });

      expect(mockEmitter.emitSoftDeleted).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'User',
          where: { id: 1 },
        }),
      );
    });

    it('should not throw when eventEmitter is null', async () => {
      const handlersNoEvents = _buildSoftDeleteQueryHandlers({
        ...defaultOptions,
        eventEmitter: null,
      });
      const client = createMockClient('User');
      const query = createMockQuery();

      await expect(
        handlersNoEvents.delete({
          model: 'User',
          args: { where: { id: 1 } },
          query,
          client,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('deleteMany', () => {
    it('should convert deleteMany to updateMany with deletedAt for soft-delete model', async () => {
      const client = createMockClient('Post');
      const query = createMockQuery();

      await handlers.deleteMany({
        model: 'Post',
        args: { where: { authorId: 1 } },
        query,
        client,
      });

      expect(query).not.toHaveBeenCalled();
      expect(client.post.updateMany).toHaveBeenCalledTimes(1);
      const updateCall = client.post.updateMany.mock.calls[0][0];
      expect(updateCall.where).toEqual({ authorId: 1 });
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('should pass-through for non-soft-delete model', async () => {
      const client = createMockClient('Tag');
      const query = createMockQuery();

      await handlers.deleteMany({
        model: 'Tag',
        args: { where: { name: 'old' } },
        query,
        client,
      });

      expect(query).toHaveBeenCalledWith({ where: { name: 'old' } });
    });

    it('should pass-through when SoftDeleteContext.isSkipped() is true', async () => {
      const client = createMockClient('Post');
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: true },
        async () => {
          await handlers.deleteMany({
            model: 'Post',
            args: { where: { authorId: 1 } },
            query,
            client,
          });
        },
      );

      expect(query).toHaveBeenCalledWith({ where: { authorId: 1 } });
      expect(client.post.updateMany).not.toHaveBeenCalled();
    });

    it('should include deletedBy when deletedByField is configured and actorId is set', async () => {
      const optionsWithDeletedBy: SoftDeleteExtensionOptions = {
        softDeleteModels: ['Post'],
        deletedByField: 'deletedBy',
      };
      const handlersWithDeletedBy = _buildSoftDeleteQueryHandlers(optionsWithDeletedBy);
      const client = createMockClient('Post');
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: false, actorId: 'user-99' },
        async () => {
          await handlersWithDeletedBy.deleteMany({
            model: 'Post',
            args: { where: { authorId: 1 } },
            query,
            client,
          });
        },
      );

      const updateCall = client.post.updateMany.mock.calls[0][0];
      expect(updateCall.data.deletedBy).toBe('user-99');
    });

    it('should emit SoftDeletedEvent for deleteMany when eventEmitter is provided', async () => {
      const mockEmitter = { emitSoftDeleted: vi.fn() };
      const handlersWithEvents = _buildSoftDeleteQueryHandlers({
        ...defaultOptions,
        eventEmitter: mockEmitter,
      });
      const client = createMockClient('User');
      const query = createMockQuery();

      await handlersWithEvents.deleteMany({
        model: 'User',
        args: { where: { role: 'guest' } },
        query,
        client,
      });

      expect(mockEmitter.emitSoftDeleted).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'User',
          where: { role: 'guest' },
        }),
      );
    });
  });

  // ── Read Operations ──────────────────────────────────────────────────

  describe('findMany', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.findMany({
        model: 'User',
        args: { where: { name: 'Alice' } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { name: 'Alice', deletedAt: null },
      });
    });

    it('should create where with deletedAt: null when where is undefined', async () => {
      const query = createMockQuery();

      await handlers.findMany({
        model: 'User',
        args: {},
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
    });

    it('should not filter in withDeleted context', async () => {
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'withDeleted', skipSoftDelete: false },
        async () => {
          await handlers.findMany({
            model: 'User',
            args: { where: { name: 'Alice' } },
            query,
          });
        },
      );

      expect(query).toHaveBeenCalledWith({
        where: { name: 'Alice' },
      });
    });

    it('should add deletedAt not-null filter in onlyDeleted context', async () => {
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'onlyDeleted', skipSoftDelete: false },
        async () => {
          await handlers.findMany({
            model: 'User',
            args: { where: { name: 'Alice' } },
            query,
          });
        },
      );

      expect(query).toHaveBeenCalledWith({
        where: { name: 'Alice', deletedAt: { not: null } },
      });
    });

    it('should not filter for non-soft-delete model', async () => {
      const query = createMockQuery();

      await handlers.findMany({
        model: 'Comment',
        args: { where: { text: 'hello' } },
        query,
      });

      expect(query).toHaveBeenCalledWith({ where: { text: 'hello' } });
    });

    it('should not filter when SoftDeleteContext.isSkipped() is true', async () => {
      const query = createMockQuery();

      await SoftDeleteContext.run(
        { filterMode: 'default', skipSoftDelete: true },
        async () => {
          await handlers.findMany({
            model: 'User',
            args: { where: { name: 'Alice' } },
            query,
          });
        },
      );

      expect(query).toHaveBeenCalledWith({ where: { name: 'Alice' } });
    });
  });

  describe('findFirst', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.findFirst({
        model: 'Post',
        args: { where: { title: 'test' } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { title: 'test', deletedAt: null },
      });
    });

    it('should not filter for non-soft-delete model', async () => {
      const query = createMockQuery();

      await handlers.findFirst({
        model: 'Tag',
        args: { where: { name: 'featured' } },
        query,
      });

      expect(query).toHaveBeenCalledWith({ where: { name: 'featured' } });
    });
  });

  describe('findUnique', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.findUnique({
        model: 'User',
        args: { where: { id: 1 } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { id: 1, deletedAt: null },
      });
    });
  });

  describe('findFirstOrThrow', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.findFirstOrThrow({
        model: 'User',
        args: { where: { email: 'alice@test.com' } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { email: 'alice@test.com', deletedAt: null },
      });
    });
  });

  describe('findUniqueOrThrow', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.findUniqueOrThrow({
        model: 'User',
        args: { where: { id: 42 } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { id: 42, deletedAt: null },
      });
    });
  });

  describe('count', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.count({
        model: 'Post',
        args: { where: { published: true } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { published: true, deletedAt: null },
      });
    });

    it('should not filter for non-soft-delete model', async () => {
      const query = createMockQuery();

      await handlers.count({
        model: 'Category',
        args: { where: { active: true } },
        query,
      });

      expect(query).toHaveBeenCalledWith({ where: { active: true } });
    });
  });

  describe('aggregate', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.aggregate({
        model: 'User',
        args: { where: { role: 'admin' }, _count: true },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { role: 'admin', deletedAt: null },
        _count: true,
      });
    });
  });

  describe('groupBy', () => {
    it('should add deletedAt: null filter by default', async () => {
      const query = createMockQuery();

      await handlers.groupBy({
        model: 'Post',
        args: { where: { status: 'draft' }, by: ['authorId'] },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { status: 'draft', deletedAt: null },
        by: ['authorId'],
      });
    });
  });

  // ── Custom deletedAtField ─────────────────────────────────────────────

  describe('custom deletedAtField', () => {
    it('should use custom field name for read filters', async () => {
      const customHandlers = _buildSoftDeleteQueryHandlers({
        softDeleteModels: ['User'],
        deletedAtField: 'removedAt',
      });
      const query = createMockQuery();

      await customHandlers.findMany({
        model: 'User',
        args: { where: { active: true } },
        query,
      });

      expect(query).toHaveBeenCalledWith({
        where: { active: true, removedAt: null },
      });
    });

    it('should use custom field name for write operations', async () => {
      const customHandlers = _buildSoftDeleteQueryHandlers({
        softDeleteModels: ['User'],
        deletedAtField: 'removedAt',
      });
      const client = createMockClient('User');
      const query = createMockQuery();

      await customHandlers.delete({
        model: 'User',
        args: { where: { id: 1 } },
        query,
        client,
      });

      const updateCall = client.user.update.mock.calls[0][0];
      expect(updateCall.data.removedAt).toBeInstanceOf(Date);
      expect(updateCall.data).not.toHaveProperty('deletedAt');
    });
  });

  // ── Cascade integration ──────────────────────────────────────────────

  describe('cascade integration', () => {
    const cascadeDmmf = {
      datamodel: {
        models: [
          {
            name: 'User',
            fields: [
              { name: 'id', kind: 'scalar', type: 'String', isId: true },
              {
                name: 'posts',
                kind: 'object',
                type: 'Post',
                relationName: 'UserPosts',
                isList: true,
              },
            ],
          },
          {
            name: 'Post',
            fields: [
              { name: 'id', kind: 'scalar', type: 'String', isId: true },
              { name: 'authorId', kind: 'scalar', type: 'String' },
              {
                name: 'author',
                kind: 'object',
                type: 'User',
                relationName: 'UserPosts',
                isList: false,
                relationFromFields: ['authorId'],
                relationToFields: ['id'],
              },
            ],
          },
        ],
      },
    };

    const cascadeOptions: SoftDeleteExtensionOptions = {
      softDeleteModels: ['User', 'Post'],
      cascade: { User: ['Post'] },
      maxCascadeDepth: 3,
    };

    function createCascadeMockClient() {
      return {
        user: {
          update: vi.fn(async (args: any) => ({ id: 'user-1', ...args.data })),
          updateMany: vi.fn(async () => ({ count: 1 })),
          findMany: vi.fn(async () => []),
        },
        post: {
          update: vi.fn(async (args: any) => ({ id: 'post-1', ...args.data })),
          updateMany: vi.fn(async () => ({ count: 2 })),
          findMany: vi.fn(async () => []),
        },
      };
    }

    it('should trigger cascade on delete when cascade options are configured', async () => {
      const cascadeHandlers = _buildSoftDeleteQueryHandlers(cascadeOptions, cascadeDmmf);
      const client = createCascadeMockClient();
      const query = createMockQuery();

      await cascadeHandlers.delete({
        model: 'User',
        args: { where: { id: 'user-1' } },
        query,
        client,
      });

      // Original query should NOT be called
      expect(query).not.toHaveBeenCalled();
      // Should have called update on user
      expect(client.user.update).toHaveBeenCalledTimes(1);
      // Should have cascaded to posts (updateMany for soft-delete + findMany for recursion)
      expect(client.post.updateMany).toHaveBeenCalledTimes(1);
      expect(client.post.findMany).toHaveBeenCalledTimes(1);
    });

    it('should trigger cascade on deleteMany for each affected record', async () => {
      const cascadeHandlers = _buildSoftDeleteQueryHandlers(cascadeOptions, cascadeDmmf);
      const client = createCascadeMockClient();
      const query = createMockQuery();

      // findMany returns 2 users to be deleted
      client.user.findMany.mockResolvedValueOnce([
        { id: 'user-1' },
        { id: 'user-2' },
      ]);

      await cascadeHandlers.deleteMany({
        model: 'User',
        args: { where: { role: 'inactive' } },
        query,
        client,
      });

      // Original query should NOT be called
      expect(query).not.toHaveBeenCalled();
      // Should have found records before deleting
      expect(client.user.findMany).toHaveBeenCalledTimes(1);
      // Should have called updateMany on user
      expect(client.user.updateMany).toHaveBeenCalledTimes(1);
      // Should have cascaded for each user (2 users -> 2 cascade calls)
      expect(client.post.updateMany).toHaveBeenCalledTimes(2);
    });

    it('should NOT trigger cascade when cascade is not configured', async () => {
      const noCascadeOptions: SoftDeleteExtensionOptions = {
        softDeleteModels: ['User', 'Post'],
        // No cascade option
      };
      const noCascadeHandlers = _buildSoftDeleteQueryHandlers(noCascadeOptions);
      const client = createCascadeMockClient();
      const query = createMockQuery();

      await noCascadeHandlers.delete({
        model: 'User',
        args: { where: { id: 'user-1' } },
        query,
        client,
      });

      // Should have called update on user
      expect(client.user.update).toHaveBeenCalledTimes(1);
      // Should NOT have cascaded to posts
      expect(client.post.updateMany).not.toHaveBeenCalled();
      expect(client.post.findMany).not.toHaveBeenCalled();
    });

    it('should NOT trigger cascade when dmmf is not provided', async () => {
      // cascade is configured but no dmmf is passed
      const handlersNoDmmf = _buildSoftDeleteQueryHandlers(cascadeOptions);
      const client = createCascadeMockClient();
      const query = createMockQuery();

      await handlersNoDmmf.delete({
        model: 'User',
        args: { where: { id: 'user-1' } },
        query,
        client,
      });

      // Should have called update on user
      expect(client.user.update).toHaveBeenCalledTimes(1);
      // Should NOT have cascaded to posts (no dmmf)
      expect(client.post.updateMany).not.toHaveBeenCalled();
    });

    it('should find records with deletedAt null filter before deleteMany cascade', async () => {
      const cascadeHandlers = _buildSoftDeleteQueryHandlers(cascadeOptions, cascadeDmmf);
      const client = createCascadeMockClient();
      const query = createMockQuery();

      client.user.findMany.mockResolvedValueOnce([{ id: 'user-1' }]);

      await cascadeHandlers.deleteMany({
        model: 'User',
        args: { where: { role: 'inactive' } },
        query,
        client,
      });

      // Should filter by deletedAt: null when finding records to cascade
      expect(client.user.findMany).toHaveBeenCalledWith({
        where: { role: 'inactive', deletedAt: null },
        select: { id: true },
      });
    });
  });

  // ── createPrismaSoftDeleteExtension (smoke test) ──────────────────────

  describe('createPrismaSoftDeleteExtension', () => {
    it('should return a function (extension callback)', () => {
      const extension = createPrismaSoftDeleteExtension({
        softDeleteModels: ['User'],
      });
      // Prisma.defineExtension returns a function: (client) => client
      expect(typeof extension).toBe('function');
    });
  });
});
