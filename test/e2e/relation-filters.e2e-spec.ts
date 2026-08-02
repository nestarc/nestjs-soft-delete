import { PrismaClient } from '../generated/client/client';
import { prismaDmmf } from './prisma-dmmf';
import { createPrismaSoftDeleteExtension, SoftDeleteContext } from '../../src';
import {
  cleanData,
  createBasePrisma,
  createTables,
  dropTables,
} from './setup-helpers';

function extendClient(client: PrismaClient, relationFilters: boolean) {
  return client.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post'],
      deletedAtField: 'deletedAt',
      relationFilters,
      dmmf: prismaDmmf,
    }),
  );
}

let basePrisma: PrismaClient;
let defaultClient: ReturnType<typeof extendClient>;
let relationFilterClient: ReturnType<typeof extendClient>;

beforeAll(async () => {
  basePrisma = createBasePrisma();
  await basePrisma.$connect();
  await dropTables(basePrisma);
  await createTables(basePrisma);
  defaultClient = extendClient(basePrisma, false);
  relationFilterClient = extendClient(basePrisma, true);
});

afterAll(async () => {
  await dropTables(basePrisma);
  await basePrisma.$disconnect();
});

beforeEach(async () => {
  await cleanData(basePrisma);
});

async function createUserWithActiveAndDeletedPosts() {
  const user = await relationFilterClient.user.create({
    data: {
      email: 'relations@example.com',
      name: 'Relation User',
    },
  });
  const activePost = await relationFilterClient.post.create({
    data: {
      title: 'Active Post',
      authorId: user.id,
    },
  });
  const deletedPost = await relationFilterClient.post.create({
    data: {
      title: 'Deleted Post',
      authorId: user.id,
    },
  });

  await relationFilterClient.post.delete({
    where: {
      id: deletedPost.id,
    },
  });

  return { user, activePost, deletedPost };
}

describe('relation read filters (e2e)', () => {
  it('keeps existing Prisma include behavior when relationFilters is disabled', async () => {
    const { user, activePost, deletedPost } = await createUserWithActiveAndDeletedPosts();

    const found = await defaultClient.user.findUnique({
      where: {
        id: user.id,
      },
      include: {
        posts: {
          orderBy: {
            title: 'asc',
          },
        },
      },
    });

    expect(found?.posts.map((post) => post.id)).toEqual([activePost.id, deletedPost.id]);
  });

  it('filters soft-deleted to-many include rows when relationFilters is enabled', async () => {
    const { user, activePost } = await createUserWithActiveAndDeletedPosts();

    const found = await relationFilterClient.user.findUnique({
      where: {
        id: user.id,
      },
      include: {
        posts: {
          orderBy: {
            title: 'asc',
          },
        },
      },
    });

    expect(found?.posts.map((post) => post.id)).toEqual([activePost.id]);
  });

  it('allows selected relation paths to include deleted rows', async () => {
    const { user, activePost, deletedPost } = await createUserWithActiveAndDeletedPosts();

    const found = await SoftDeleteContext.run(
      {
        filterMode: 'default',
        skipSoftDelete: false,
        withDeletedRelationPaths: ['posts'],
      },
      () =>
        relationFilterClient.user.findUnique({
          where: {
            id: user.id,
          },
          include: {
            posts: {
              orderBy: {
                title: 'asc',
              },
            },
          },
        }),
    );

    expect(found?.posts.map((post) => post.id)).toEqual([activePost.id, deletedPost.id]);
  });
});
