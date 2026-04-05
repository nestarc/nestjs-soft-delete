import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Observable, firstValueFrom } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { SoftDeleteFilterInterceptor } from './soft-delete-filter.interceptor';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { WITH_DELETED_KEY, ONLY_DELETED_KEY, SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';

describe('SoftDeleteFilterInterceptor', () => {
  let interceptor: SoftDeleteFilterInterceptor;
  let reflector: Reflector;
  let mockHandler: (...args: any[]) => any;

  function createMockContext(handler: (...args: any[]) => any): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => ({}),
      getArgs: () => [],
      getArgByIndex: () => ({}),
      switchToHttp: () => ({} as any),
      switchToRpc: () => ({} as any),
      switchToWs: () => ({} as any),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new SoftDeleteFilterInterceptor(reflector);
    mockHandler = function testHandler() {};
  });

  it('should set withDeleted context when @WithDeleted metadata is present', async () => {
    Reflect.defineMetadata(WITH_DELETED_KEY, true, mockHandler);

    const context = createMockContext(mockHandler);
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          const mode = SoftDeleteContext.getFilterMode();
          subscriber.next(mode);
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, callHandler));
    expect(result).toBe('withDeleted');
  });

  it('should set onlyDeleted context when @OnlyDeleted metadata is present', async () => {
    Reflect.defineMetadata(ONLY_DELETED_KEY, true, mockHandler);

    const context = createMockContext(mockHandler);
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          const mode = SoftDeleteContext.getFilterMode();
          subscriber.next(mode);
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, callHandler));
    expect(result).toBe('onlyDeleted');
  });

  it('should set skipSoftDelete context when @SkipSoftDelete metadata is present', async () => {
    Reflect.defineMetadata(SKIP_SOFT_DELETE_KEY, true, mockHandler);

    const context = createMockContext(mockHandler);
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          const isSkipped = SoftDeleteContext.isSkipped();
          subscriber.next(isSkipped);
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, callHandler));
    expect(result).toBe(true);
  });

  it('should default to standard mode when no metadata is present', async () => {
    const context = createMockContext(mockHandler);
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          const mode = SoftDeleteContext.getFilterMode();
          const isSkipped = SoftDeleteContext.isSkipped();
          subscriber.next({ mode, isSkipped });
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, callHandler));
    expect(result).toEqual({ mode: 'default', isSkipped: false });
  });

  it('should propagate errors from the downstream handler', async () => {
    const context = createMockContext(mockHandler);
    const testError = new Error('downstream error');
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(testError);
        }),
    };

    await expect(firstValueFrom(interceptor.intercept(context, callHandler))).rejects.toThrow(
      'downstream error',
    );
  });

  it('should pass through the response value from next.handle()', async () => {
    const context = createMockContext(mockHandler);
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.next({ data: 'test' });
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(context, callHandler));
    expect(result).toEqual({ data: 'test' });
  });

  it('should preserve actorId from middleware context (Fix 1)', async () => {
    const context = createMockContext(mockHandler);
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.next(SoftDeleteContext.getActorId());
          subscriber.complete();
        }),
    };

    // Simulate middleware setting actorId in outer context
    const result = await SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: false, actorId: 'admin-42' },
      () => firstValueFrom(interceptor.intercept(context, callHandler)),
    );
    expect(result).toBe('admin-42');
  });

  it('should read class-level @WithDeleted metadata (Fix 4)', async () => {
    const mockClass = class TestController {};
    Reflect.defineMetadata(WITH_DELETED_KEY, true, mockClass);

    const classContext = {
      getHandler: () => mockHandler,  // no method-level metadata
      getClass: () => mockClass,      // class-level metadata
      getArgs: () => [],
      getArgByIndex: () => ({}),
      switchToHttp: () => ({} as any),
      switchToRpc: () => ({} as any),
      switchToWs: () => ({} as any),
      getType: () => 'http',
    } as unknown as ExecutionContext;

    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.next(SoftDeleteContext.getFilterMode());
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(classContext, callHandler));
    expect(result).toBe('withDeleted');
  });

  it('should prefer method-level metadata over class-level for same key (Fix 4)', async () => {
    // Class says withDeleted=false, method says withDeleted=true → method wins
    const mockClass = class TestController {};
    Reflect.defineMetadata(WITH_DELETED_KEY, false, mockClass);
    Reflect.defineMetadata(WITH_DELETED_KEY, true, mockHandler);

    const classContext = {
      getHandler: () => mockHandler,
      getClass: () => mockClass,
      getArgs: () => [],
      getArgByIndex: () => ({}),
      switchToHttp: () => ({} as any),
      switchToRpc: () => ({} as any),
      switchToWs: () => ({} as any),
      getType: () => 'http',
    } as unknown as ExecutionContext;

    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.next(SoftDeleteContext.getFilterMode());
          subscriber.complete();
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(classContext, callHandler));
    expect(result).toBe('withDeleted');
  });
});
