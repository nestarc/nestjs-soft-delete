import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CascadeHandler } from './cascade-handler';
import { CascadeRelationNotFoundError } from '../errors/cascade-relation-not-found.error';

const mockDmmf = {
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
          {
            name: 'comments',
            kind: 'object',
            type: 'Comment',
            relationName: 'PostComments',
            isList: true,
          },
        ],
      },
      {
        name: 'Comment',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
          { name: 'postId', kind: 'scalar', type: 'String' },
          {
            name: 'post',
            kind: 'object',
            type: 'Post',
            relationName: 'PostComments',
            isList: false,
            relationFromFields: ['postId'],
            relationToFields: ['id'],
          },
        ],
      },
    ],
  },
};

function createMockPrisma() {
  return {
    user: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
    },
    post: {
      updateMany: vi.fn(async () => ({ count: 2 })),
      findMany: vi.fn(async () => []),
    },
    comment: {
      updateMany: vi.fn(async () => ({ count: 3 })),
      findMany: vi.fn(async () => []),
    },
  };
}

describe('CascadeHandler', () => {
  let handler: CascadeHandler;

  beforeEach(() => {
    handler = new CascadeHandler({
      cascade: { User: ['Post'], Post: ['Comment'] },
      deletedAtField: 'deletedAt',
      maxCascadeDepth: 3,
      dmmf: mockDmmf,
    });
  });

  // ── findForeignKey ─────────────────────────────────────────────────────

  describe('findForeignKey', () => {
    it('should return authorId for User -> Post', () => {
      expect(handler.findForeignKey('User', 'Post')).toBe('authorId');
    });

    it('should return postId for Post -> Comment', () => {
      expect(handler.findForeignKey('Post', 'Comment')).toBe('postId');
    });

    it('should throw CascadeRelationNotFoundError when no relation exists', () => {
      expect(() => handler.findForeignKey('Comment', 'User')).toThrow(
        CascadeRelationNotFoundError,
      );
    });

    it('should cache FK lookups', () => {
      // Call twice and verify same result (cache hit)
      const first = handler.findForeignKey('User', 'Post');
      const second = handler.findForeignKey('User', 'Post');
      expect(first).toBe('authorId');
      expect(second).toBe('authorId');
    });
  });

  // ── findPrimaryKey ─────────────────────────────────────────────────────

  describe('findPrimaryKey', () => {
    it('should return "id" for a model with isId on the id field', () => {
      expect(handler.findPrimaryKey('User')).toBe('id');
    });

    it('should return the custom PK field name when isId is on a non-id field', () => {
      const customPkDmmf = {
        datamodel: {
          models: [
            {
              name: 'Tenant',
              fields: [
                { name: 'tenantCode', kind: 'scalar', type: 'String', isId: true },
                { name: 'name', kind: 'scalar', type: 'String' },
              ],
            },
          ],
        },
      };

      const customHandler = new CascadeHandler({
        cascade: {},
        deletedAtField: 'deletedAt',
        maxCascadeDepth: 3,
        dmmf: customPkDmmf,
      });

      expect(customHandler.findPrimaryKey('Tenant')).toBe('tenantCode');
    });

    it('should fall back to "id" when the model is not found in DMMF', () => {
      expect(handler.findPrimaryKey('NonExistent')).toBe('id');
    });

    it('should fall back to "id" when no field has isId set', () => {
      const noPkDmmf = {
        datamodel: {
          models: [
            {
              name: 'Log',
              fields: [
                { name: 'logId', kind: 'scalar', type: 'String' },
              ],
            },
          ],
        },
      };

      const noPkHandler = new CascadeHandler({
        cascade: {},
        deletedAtField: 'deletedAt',
        maxCascadeDepth: 3,
        dmmf: noPkDmmf,
      });

      expect(noPkHandler.findPrimaryKey('Log')).toBe('id');
    });
  });

  // ── cascadeSoftDelete ──────────────────────────────────────────────────

  describe('cascadeSoftDelete', () => {
    it('should cascade soft-delete from parent to children with correct FK and where clause', async () => {
      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');

      prisma.post.findMany.mockResolvedValueOnce([
        { id: 'post-1' },
        { id: 'post-2' },
      ]);
      // For each post, comments findMany returns empty
      prisma.comment.findMany.mockResolvedValue([]);

      await handler.cascadeSoftDelete(prisma, 'User', 'user-1', deletedAt, 0);

      // Should updateMany posts where authorId = user-1 and deletedAt is null
      expect(prisma.post.updateMany).toHaveBeenCalledWith({
        where: { authorId: 'user-1', deletedAt: null },
        data: { deletedAt },
      });

      // Should findMany posts that were just soft-deleted for recursion
      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: { authorId: 'user-1', deletedAt },
        select: { id: true },
      });

      // Should recurse into comments for each post
      expect(prisma.comment.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.comment.updateMany).toHaveBeenCalledWith({
        where: { postId: 'post-1', deletedAt: null },
        data: { deletedAt },
      });
      expect(prisma.comment.updateMany).toHaveBeenCalledWith({
        where: { postId: 'post-2', deletedAt: null },
        data: { deletedAt },
      });
    });

    it('should respect maxCascadeDepth and stop recursing at depth limit', async () => {
      const shallowHandler = new CascadeHandler({
        cascade: { User: ['Post'], Post: ['Comment'] },
        deletedAtField: 'deletedAt',
        maxCascadeDepth: 1,
        dmmf: mockDmmf,
      });

      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');

      prisma.post.findMany.mockResolvedValueOnce([{ id: 'post-1' }]);

      await shallowHandler.cascadeSoftDelete(prisma, 'User', 'user-1', deletedAt, 0);

      // Should soft-delete posts (depth 0 -> 1, which is within limit)
      expect(prisma.post.updateMany).toHaveBeenCalledTimes(1);

      // Should NOT recurse into comments because depth 1 >= maxCascadeDepth 1
      expect(prisma.comment.updateMany).not.toHaveBeenCalled();
    });

    it('should do nothing when cascade config has no children for model', async () => {
      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');

      await handler.cascadeSoftDelete(prisma, 'Comment', 'comment-1', deletedAt, 0);

      // Comment has no cascade children, so nothing should be called
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.post.updateMany).not.toHaveBeenCalled();
      expect(prisma.comment.updateMany).not.toHaveBeenCalled();
    });

    it('should NOT include previously-deleted children in cascade recursion', async () => {
      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');

      // findMany with deletedAt filter returns only the newly-deleted post
      prisma.post.findMany.mockResolvedValueOnce([{ id: 'post-1' }]);
      prisma.comment.findMany.mockResolvedValue([]);

      await handler.cascadeSoftDelete(prisma, 'User', 'user-1', deletedAt, 0);

      // The findMany should filter by the exact deletedAt timestamp
      // (not return ALL children regardless of deletion state)
      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: { authorId: 'user-1', deletedAt },
        select: { id: true },
      });

      // Only 1 post was returned, so comments updateMany should be called once
      expect(prisma.comment.updateMany).toHaveBeenCalledTimes(1);
    });

    it('should use dynamic PK field from DMMF when cascading', async () => {
      const customPkDmmf = {
        datamodel: {
          models: [
            {
              name: 'Organization',
              fields: [
                { name: 'orgCode', kind: 'scalar', type: 'String', isId: true },
                { name: 'projects', kind: 'object', type: 'Project', isList: true },
              ],
            },
            {
              name: 'Project',
              fields: [
                { name: 'projectId', kind: 'scalar', type: 'String', isId: true },
                { name: 'organizationId', kind: 'scalar', type: 'String' },
                {
                  name: 'organization',
                  kind: 'object',
                  type: 'Organization',
                  isList: false,
                  relationFromFields: ['organizationId'],
                  relationToFields: ['orgCode'],
                },
              ],
            },
          ],
        },
      };

      const customHandler = new CascadeHandler({
        cascade: { Organization: ['Project'] },
        deletedAtField: 'deletedAt',
        maxCascadeDepth: 3,
        dmmf: customPkDmmf,
      });

      const prisma = {
        project: {
          updateMany: vi.fn(async () => ({ count: 1 })),
          findMany: vi.fn(async () => []),
        },
      };

      const deletedAt = new Date('2025-01-15T10:00:00Z');
      await customHandler.cascadeSoftDelete(prisma, 'Organization', 'org-1', deletedAt, 0);

      // Should use the dynamic PK field 'projectId' in the select
      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt },
        select: { projectId: true },
      });
    });
  });

  // ── cascadeRestore ─────────────────────────────────────────────────────

  describe('cascadeRestore', () => {
    it('should restore children with +/-1 second timestamp matching', async () => {
      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');
      const lowerBound = new Date(deletedAt.getTime() - 1000);
      const upperBound = new Date(deletedAt.getTime() + 1000);

      prisma.post.findMany.mockResolvedValueOnce([
        { id: 'post-1', deletedAt },
      ]);
      prisma.comment.findMany.mockResolvedValue([]);

      await handler.cascadeRestore(prisma, 'User', 'user-1', deletedAt, 0);

      // Should find children with timestamp within +/-1 second
      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: {
          authorId: 'user-1',
          deletedAt: { gte: lowerBound, lte: upperBound },
        },
        select: { id: true, deletedAt: true },
      });

      // Should restore matching children
      expect(prisma.post.updateMany).toHaveBeenCalledWith({
        where: {
          authorId: 'user-1',
          deletedAt: { gte: lowerBound, lte: upperBound },
        },
        data: { deletedAt: null },
      });

      // Should recurse into comments for restored post
      expect(prisma.comment.findMany).toHaveBeenCalledTimes(1);
    });

    it('should respect maxCascadeDepth on restore', async () => {
      const shallowHandler = new CascadeHandler({
        cascade: { User: ['Post'], Post: ['Comment'] },
        deletedAtField: 'deletedAt',
        maxCascadeDepth: 1,
        dmmf: mockDmmf,
      });

      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');

      prisma.post.findMany.mockResolvedValueOnce([
        { id: 'post-1', deletedAt },
      ]);

      await shallowHandler.cascadeRestore(prisma, 'User', 'user-1', deletedAt, 0);

      // Should restore posts
      expect(prisma.post.updateMany).toHaveBeenCalledTimes(1);

      // Should NOT recurse into comments (depth 1 >= maxCascadeDepth 1)
      expect(prisma.comment.updateMany).not.toHaveBeenCalled();
      expect(prisma.comment.findMany).not.toHaveBeenCalled();
    });

    it('should do nothing when cascade config has no children for model', async () => {
      const prisma = createMockPrisma();
      const deletedAt = new Date('2025-01-15T10:00:00Z');

      await handler.cascadeRestore(prisma, 'Comment', 'comment-1', deletedAt, 0);

      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.post.updateMany).not.toHaveBeenCalled();
      expect(prisma.comment.updateMany).not.toHaveBeenCalled();
    });
  });
});
