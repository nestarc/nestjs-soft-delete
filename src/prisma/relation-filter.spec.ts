import { describe, expect, it } from 'vitest';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { applyRelationReadFilters } from './relation-filter';
import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';

const dmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'User',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
          { name: 'posts', kind: 'object', type: 'Post', isList: true },
          { name: 'profile', kind: 'object', type: 'Profile', isList: false },
        ],
      },
      {
        name: 'Post',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
          { name: 'comments', kind: 'object', type: 'Comment', isList: true },
        ],
      },
      {
        name: 'Comment',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
        ],
      },
      {
        name: 'Profile',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String', isId: true },
        ],
      },
    ],
  },
};

function apply(args: Record<string, unknown>, relationPaths: string[] = []) {
  return SoftDeleteContext.run(
    {
      filterMode: 'default',
      skipSoftDelete: false,
      withDeletedRelationPaths: relationPaths,
    },
    () =>
      applyRelationReadFilters(args, 'User', {
        dmmf,
        softDeleteModels: ['User', 'Post', 'Comment'],
        deletedAtField: 'deletedAt',
        maxDepth: 3,
      }),
  );
}

describe('applyRelationReadFilters', () => {
  it('converts true to-many includes into active-only relation queries', () => {
    const result = apply({
      include: {
        posts: true,
      },
    });

    expect(result).toEqual({
      include: {
        posts: {
          where: {
            deletedAt: null,
          },
        },
      },
    });
  });

  it('merges existing relation where clauses with the active-only filter', () => {
    const result = apply({
      include: {
        posts: {
          where: {
            published: true,
          },
        },
      },
    });

    expect(result).toEqual({
      include: {
        posts: {
          where: {
            published: true,
            deletedAt: null,
          },
        },
      },
    });
  });

  it('recurses through nested to-many includes', () => {
    const result = apply({
      include: {
        posts: {
          include: {
            comments: true,
          },
        },
      },
    });

    expect(result).toEqual({
      include: {
        posts: {
          where: {
            deletedAt: null,
          },
          include: {
            comments: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
    });
  });

  it('skips exact relation paths requested by @WithDeletedRelations', () => {
    const result = apply(
      {
        include: {
          posts: {
            include: {
              comments: true,
            },
          },
        },
      },
      ['posts'],
    );

    expect(result).toEqual({
      include: {
        posts: {
          include: {
            comments: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
    });
  });

  it('does not inject filters into to-one relations', () => {
    const result = apply({
      include: {
        profile: true,
      },
    });

    expect(result).toEqual({
      include: {
        profile: true,
      },
    });
  });

  it('uses only-deleted filters in onlyDeleted context', () => {
    const result = SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      () =>
        applyRelationReadFilters({ include: { posts: true } }, 'User', {
          dmmf,
          softDeleteModels: ['Post'],
          deletedAtField: 'deletedAt',
        }),
    );

    expect(result).toEqual({
      include: {
        posts: {
          where: {
            deletedAt: { not: null },
          },
        },
      },
    });
  });

  it('does not inject filters in withDeleted context', () => {
    const result = SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      () =>
        applyRelationReadFilters({ include: { posts: true } }, 'User', {
          dmmf,
          softDeleteModels: ['Post'],
          deletedAtField: 'deletedAt',
        }),
    );

    expect(result).toEqual({
      include: {
        posts: true,
      },
    });
  });
});
