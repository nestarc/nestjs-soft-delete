import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftDeleteActorMiddleware } from './soft-delete-actor.middleware';
import { SoftDeleteContext } from '../services/soft-delete-context';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

describe('SoftDeleteActorMiddleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReq = {};
    mockRes = {};
    mockNext = vi.fn();
  });

  it('should extract actorId when actorExtractor is configured and user exists', () => {
    const options: SoftDeleteModuleOptions = {
      softDeleteModels: ['User'],
      deletedByField: 'deletedBy',
      actorExtractor: (req: any) => req.user?.id ?? null,
      prismaServiceToken: 'PRISMA',
    };

    mockReq.user = { id: 'user-42' };

    const middleware = new SoftDeleteActorMiddleware(options);

    // The next() function runs inside SoftDeleteContext.run
    // so we can capture the actor from inside next()
    let capturedActorId: string | null = null;
    mockNext.mockImplementation(() => {
      capturedActorId = SoftDeleteContext.getActorId();
    });

    middleware.use(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(capturedActorId).toBe('user-42');
  });

  it('should set null actorId when user is not authenticated', () => {
    const options: SoftDeleteModuleOptions = {
      softDeleteModels: ['User'],
      deletedByField: 'deletedBy',
      actorExtractor: (req: any) => req.user?.id ?? null,
      prismaServiceToken: 'PRISMA',
    };

    // No user on request
    let capturedActorId: string | null = 'should-be-null';
    mockNext.mockImplementation(() => {
      capturedActorId = SoftDeleteContext.getActorId();
    });

    const middleware = new SoftDeleteActorMiddleware(options);
    middleware.use(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(capturedActorId).toBeNull();
  });

  it('should pass through when deletedByField is not configured', () => {
    const options: SoftDeleteModuleOptions = {
      softDeleteModels: ['User'],
      prismaServiceToken: 'PRISMA',
      // no deletedByField
    };

    const middleware = new SoftDeleteActorMiddleware(options);
    middleware.use(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should pass through when actorExtractor is not configured', () => {
    const options: SoftDeleteModuleOptions = {
      softDeleteModels: ['User'],
      deletedByField: 'deletedBy',
      prismaServiceToken: 'PRISMA',
      // no actorExtractor
    };

    const middleware = new SoftDeleteActorMiddleware(options);
    middleware.use(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should not set actor context when passing through without config', () => {
    const options: SoftDeleteModuleOptions = {
      softDeleteModels: ['User'],
      prismaServiceToken: 'PRISMA',
      // no deletedByField, no actorExtractor
    };

    let capturedActorId: string | null = 'unchanged';
    mockNext.mockImplementation(() => {
      capturedActorId = SoftDeleteContext.getActorId();
    });

    const middleware = new SoftDeleteActorMiddleware(options);
    middleware.use(mockReq, mockRes, mockNext);

    // Without configuration, next() runs outside SoftDeleteContext.run,
    // so getActorId() returns null (no active context)
    expect(capturedActorId).toBeNull();
  });
});
