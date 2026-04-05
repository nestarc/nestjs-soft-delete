import { describe, it, expect } from 'vitest';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SoftDeleteModule } from './soft-delete.module';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from './soft-delete.constants';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import type { SoftDeleteModuleOptions } from './interfaces/soft-delete-options.interface';
import { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';

describe('SoftDeleteModule', () => {
  const MOCK_PRISMA_TOKEN = 'PrismaService';

  const options: SoftDeleteModuleOptions = {
    softDeleteModels: ['User', 'Post'],
    deletedAtField: 'deletedAt',
    prismaServiceToken: MOCK_PRISMA_TOKEN,
  };

  describe('forRoot()', () => {
    it('should return DynamicModule with correct module property', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      expect(dynamicModule.module).toBe(SoftDeleteModule);
    });

    it('should be global', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      expect(dynamicModule.global).toBe(true);
    });

    it('should provide SOFT_DELETE_MODULE_OPTIONS', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      const optionsProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_MODULE_OPTIONS,
      ) as any;

      expect(optionsProvider).toBeDefined();
      expect(optionsProvider.useValue).toEqual(options);
    });

    it('should provide SOFT_DELETE_PRISMA_SERVICE with useExisting pointing to prismaServiceToken', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      const prismaProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_PRISMA_SERVICE,
      ) as any;

      expect(prismaProvider).toBeDefined();
      expect(prismaProvider.useExisting).toBe(MOCK_PRISMA_TOKEN);
    });

    it('should provide SoftDeleteService', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      expect(dynamicModule.providers).toContain(SoftDeleteService);
    });

    it('should provide APP_INTERCEPTOR with SoftDeleteFilterInterceptor', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      const interceptorProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === APP_INTERCEPTOR,
      ) as any;

      expect(interceptorProvider).toBeDefined();
      expect(interceptorProvider.useClass).toBe(SoftDeleteFilterInterceptor);
    });

    it('should export SoftDeleteService', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      expect(dynamicModule.exports).toContain(SoftDeleteService);
    });

    it('should export SOFT_DELETE_MODULE_OPTIONS', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);

      expect(dynamicModule.exports).toContain(SOFT_DELETE_MODULE_OPTIONS);
    });

    it('should provide SoftDeleteEventEmitter when enableEvents is true', () => {
      const dynamicModule = SoftDeleteModule.forRoot({
        ...options,
        enableEvents: true,
      });

      expect(dynamicModule.providers).toContainEqual(SoftDeleteEventEmitter);
      expect(dynamicModule.exports).toContain(SoftDeleteEventEmitter);
    });

    it('should not provide SoftDeleteEventEmitter when enableEvents is not set', () => {
      const dynamicModule = SoftDeleteModule.forRoot(options);
      const hasEmitter = (dynamicModule.providers as any[])?.some(
        (p: any) => p === SoftDeleteEventEmitter || p?.useClass === SoftDeleteEventEmitter,
      );
      expect(hasEmitter).toBe(false);
    });
  });

  describe('forRootAsync()', () => {
    it('should return DynamicModule with correct module property', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.module).toBe(SoftDeleteModule);
    });

    it('should be global', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.global).toBe(true);
    });

    it('should provide SOFT_DELETE_MODULE_OPTIONS via useFactory', () => {
      const factory = () => options;
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: factory,
        inject: ['CONFIG_SERVICE'],
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      const optionsProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_MODULE_OPTIONS,
      ) as any;

      expect(optionsProvider).toBeDefined();
      expect(optionsProvider.useFactory).toBe(factory);
      expect(optionsProvider.inject).toEqual(['CONFIG_SERVICE']);
    });

    it('should provide SOFT_DELETE_PRISMA_SERVICE with useExisting pointing to prismaServiceToken', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      const prismaProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_PRISMA_SERVICE,
      ) as any;

      expect(prismaProvider).toBeDefined();
      expect(prismaProvider.useExisting).toBe(MOCK_PRISMA_TOKEN);
    });

    it('should provide SoftDeleteService', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.providers).toContain(SoftDeleteService);
    });

    it('should export SoftDeleteService and SOFT_DELETE_MODULE_OPTIONS', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.exports).toContain(SoftDeleteService);
      expect(dynamicModule.exports).toContain(SOFT_DELETE_MODULE_OPTIONS);
    });

    it('should include imports when provided', () => {
      const mockModule = class MockModule {};
      const dynamicModule = SoftDeleteModule.forRootAsync({
        imports: [mockModule as any],
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.imports).toContain(mockModule);
    });

    it('should default to empty imports and inject when not provided', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.imports).toEqual([]);

      const optionsProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_MODULE_OPTIONS,
      ) as any;
      expect(optionsProvider.inject).toEqual([]);
    });

    it('should always provide SoftDeleteEventEmitter in forRootAsync', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
        prismaServiceToken: MOCK_PRISMA_TOKEN,
      });

      expect(dynamicModule.providers).toContainEqual(SoftDeleteEventEmitter);
      expect(dynamicModule.exports).toContain(SoftDeleteEventEmitter);
    });
  });

  describe('configure()', () => {
    it('should be a NestModule with configure method', () => {
      const moduleInstance = new SoftDeleteModule();
      expect(typeof moduleInstance.configure).toBe('function');
    });
  });
});
