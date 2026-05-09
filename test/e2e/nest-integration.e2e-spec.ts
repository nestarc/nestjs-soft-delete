/**
 * E2E tests for the full NestJS request → middleware → interceptor → controller →
 * Prisma extension stack.
 *
 * Verifies:
 *   - HTTP DELETE soft-deletes (deletedAt is set, row remains)
 *   - HTTP GET hides soft-deleted rows by default
 *   - @WithDeleted route returns soft-deleted rows
 *   - @OnlyDeleted route returns only soft-deleted rows
 *   - @SkipSoftDelete forces a real hard-delete
 *   - actorExtractor populates deletedBy from the request
 *   - SoftDeleteActorMiddleware is auto-registered by SoftDeleteModule
 *
 * Uses Node's built-in fetch (Node 18+) — no supertest dependency required.
 *
 * Prerequisites: see setup-helpers.ts.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/client';
import {
  createPrismaSoftDeleteExtension,
  OnlyDeleted,
  SkipSoftDelete,
  SoftDeleteModule,
  SoftDeleteService,
  WithDeleted,
} from '../../src';
import {
  cleanData,
  createBasePrisma,
  createE2eProviderModule,
  createTables,
  dropTables,
} from './setup-helpers';

const PRISMA_TOKEN = 'PRISMA_CLIENT';
const prismaDmmf = (Prisma as any).dmmf;

@Controller('users')
class UsersController {
  constructor(
    @Inject(PRISMA_TOKEN) private readonly prisma: any,
    @Inject(SoftDeleteService)
    private readonly softDelete: SoftDeleteService,
  ) {}

  @Post()
  create(@Body() body: { email: string; name: string }) {
    return this.prisma.user.create({ data: body });
  }

  @Get()
  findActive() {
    return this.prisma.user.findMany();
  }

  @Get('all')
  @WithDeleted()
  findAll() {
    return this.prisma.user.findMany();
  }

  @Get('trash')
  @OnlyDeleted()
  findTrash() {
    return this.prisma.user.findMany();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  @Delete(':id/hard')
  @SkipSoftDelete()
  hardRemove(@Param('id') id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.softDelete.restore('User', { id });
  }
}

@Module({ controllers: [UsersController] })
class UsersModule {}

let basePrisma: PrismaClient;
let prisma: any;
let module: TestingModule;
let app: INestApplication;
let baseUrl: string;

function extendClient(client: PrismaClient) {
  return client.$extends(
    createPrismaSoftDeleteExtension({
      softDeleteModels: ['User', 'Post', 'Comment'],
      deletedAtField: 'deletedAt',
      deletedByField: 'deletedBy',
      dmmf: prismaDmmf,
    }),
  );
}

beforeAll(async () => {
  basePrisma = createBasePrisma();
  await basePrisma.$connect();
  await createTables(basePrisma);
  prisma = extendClient(basePrisma);

  const providerModule = createE2eProviderModule([
    { provide: PRISMA_TOKEN, useFactory: () => prisma },
  ]);

  module = await Test.createTestingModule({
    imports: [
      providerModule,
      SoftDeleteModule.forRootAsync({
        imports: [providerModule],
        prismaServiceToken: PRISMA_TOKEN,
        useFactory: () => ({
          softDeleteModels: ['User', 'Post', 'Comment'],
          deletedAtField: 'deletedAt',
          deletedByField: 'deletedBy',
          // Pull actorId from a header so the test stays pure HTTP.
          actorExtractor: (req: any) =>
            (req.headers['x-actor-id'] as string) ?? null,
          prismaServiceToken: PRISMA_TOKEN,
        }),
      }),
      UsersModule,
    ],
  }).compile();

  app = module.createNestApplication();
  await app.init();
  // Bind to IPv4 loopback explicitly so fetch() works the same on every
  // platform (some Node + OS combos resolve `app.getUrl()`'s `[::1]` to
  // a host fetch refuses to connect to).
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await dropTables(basePrisma);
  await basePrisma.$disconnect();
});

beforeEach(async () => {
  await cleanData(basePrisma);
});

async function http(
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function rawUserById(id: string): Promise<any | null> {
  const rows = await basePrisma.$queryRawUnsafe<any[]>(
    `SELECT id, email, name, deleted_at, deleted_by FROM users WHERE id = $1::uuid`,
    id,
  );
  return rows[0] ?? null;
}

describe('NestJS HTTP integration E2E', () => {
  it('DELETE /users/:id soft-deletes through the full stack', async () => {
    const created = await http('POST', '/users', {
      body: { email: 'h1@test.com', name: 'H1' },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const del = await http('DELETE', `/users/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.deletedAt).toBeTruthy();

    // Row remains in the database
    const raw = await rawUserById(id);
    expect(raw).not.toBeNull();
    expect(raw.deleted_at).toBeTruthy();
  });

  it('GET /users hides soft-deleted rows', async () => {
    const a = await http('POST', '/users', {
      body: { email: 'a@test.com', name: 'A' },
    });
    const b = await http('POST', '/users', {
      body: { email: 'b@test.com', name: 'B' },
    });
    await http('DELETE', `/users/${b.body.id}`);

    const list = await http('GET', '/users');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(a.body.id);
  });

  it('@WithDeleted route returns active + soft-deleted', async () => {
    const a = await http('POST', '/users', {
      body: { email: 'wa@test.com', name: 'WA' },
    });
    const b = await http('POST', '/users', {
      body: { email: 'wb@test.com', name: 'WB' },
    });
    await http('DELETE', `/users/${b.body.id}`);

    const list = await http('GET', '/users/all');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    const ids = list.body.map((u: any) => u.id);
    expect(ids).toContain(a.body.id);
    expect(ids).toContain(b.body.id);
  });

  it('@OnlyDeleted route returns only soft-deleted rows', async () => {
    await http('POST', '/users', {
      body: { email: 'oa@test.com', name: 'OA' },
    });
    const b = await http('POST', '/users', {
      body: { email: 'ob@test.com', name: 'OB' },
    });
    await http('DELETE', `/users/${b.body.id}`);

    const list = await http('GET', '/users/trash');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(b.body.id);
  });

  it('@SkipSoftDelete performs a real hard-delete', async () => {
    const created = await http('POST', '/users', {
      body: { email: 'hd@test.com', name: 'HD' },
    });
    const id = created.body.id;

    const res = await http('DELETE', `/users/${id}/hard`);
    expect(res.status).toBe(200);

    // Row should be physically gone
    const raw = await rawUserById(id);
    expect(raw).toBeNull();
  });

  it('actorExtractor populates deletedBy from the request', async () => {
    const created = await http('POST', '/users', {
      body: { email: 'act@test.com', name: 'Act' },
    });
    const id = created.body.id;

    await http('DELETE', `/users/${id}`, {
      headers: { 'X-Actor-Id': 'admin-42' },
    });

    const raw = await rawUserById(id);
    expect(raw.deleted_by).toBe('admin-42');
  });

  it('restore endpoint clears deletedAt and deletedBy', async () => {
    const created = await http('POST', '/users', {
      body: { email: 're@test.com', name: 'Re' },
    });
    const id = created.body.id;

    await http('DELETE', `/users/${id}`, {
      headers: { 'X-Actor-Id': 'someone' },
    });
    let raw = await rawUserById(id);
    expect(raw.deleted_at).toBeTruthy();

    const res = await http('POST', `/users/${id}/restore`);
    expect(res.status).toBe(201);

    raw = await rawUserById(id);
    expect(raw.deleted_at).toBeNull();
    expect(raw.deleted_by).toBeNull();
  });

  it('isolates filter context across concurrent requests', async () => {
    const u1 = await http('POST', '/users', {
      body: { email: 'c1@test.com', name: 'C1' },
    });
    const u2 = await http('POST', '/users', {
      body: { email: 'c2@test.com', name: 'C2' },
    });
    await http('DELETE', `/users/${u2.body.id}`);

    // Fire many concurrent requests against /users (default) and /users/all (@WithDeleted)
    const tasks = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? http('GET', '/users') : http('GET', '/users/all'),
    );
    const responses = await Promise.all(tasks);

    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      expect(r.status).toBe(200);
      if (i % 2 === 0) {
        expect(r.body).toHaveLength(1); // active only
      } else {
        expect(r.body).toHaveLength(2); // including soft-deleted
      }
    }
  });
});
