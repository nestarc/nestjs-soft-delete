import { describe, it, expect } from 'vitest';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SoftDeleteModule } from './soft-delete.module';
import { SOFT_DELETE_MODULE_OPTIONS } from './soft-delete.constants';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import type { SoftDeleteModuleOptions } from './interfaces/soft-delete-options.interface';

describe('SoftDeleteModule', () => {
  const options: SoftDeleteModuleOptions = {
    softDeleteModels: ['User', 'Post'],
    deletedAtField: 'deletedAt',
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
  });

  describe('forRootAsync()', () => {
    it('should return DynamicModule with correct module property', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
      });

      expect(dynamicModule.module).toBe(SoftDeleteModule);
    });

    it('should be global', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
      });

      expect(dynamicModule.global).toBe(true);
    });

    it('should provide SOFT_DELETE_MODULE_OPTIONS via useFactory', () => {
      const factory = () => options;
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: factory,
        inject: ['CONFIG_SERVICE'],
      });

      const optionsProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_MODULE_OPTIONS,
      ) as any;

      expect(optionsProvider).toBeDefined();
      expect(optionsProvider.useFactory).toBe(factory);
      expect(optionsProvider.inject).toEqual(['CONFIG_SERVICE']);
    });

    it('should provide SoftDeleteService', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
      });

      expect(dynamicModule.providers).toContain(SoftDeleteService);
    });

    it('should export SoftDeleteService and SOFT_DELETE_MODULE_OPTIONS', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
      });

      expect(dynamicModule.exports).toContain(SoftDeleteService);
      expect(dynamicModule.exports).toContain(SOFT_DELETE_MODULE_OPTIONS);
    });

    it('should include imports when provided', () => {
      const mockModule = class MockModule {};
      const dynamicModule = SoftDeleteModule.forRootAsync({
        imports: [mockModule as any],
        useFactory: () => options,
      });

      expect(dynamicModule.imports).toContain(mockModule);
    });

    it('should default to empty imports and inject when not provided', () => {
      const dynamicModule = SoftDeleteModule.forRootAsync({
        useFactory: () => options,
      });

      expect(dynamicModule.imports).toEqual([]);

      const optionsProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === SOFT_DELETE_MODULE_OPTIONS,
      ) as any;
      expect(optionsProvider.inject).toEqual([]);
    });
  });

  describe('configure()', () => {
    it('should be a NestModule with configure method', () => {
      const moduleInstance = new SoftDeleteModule();
      expect(typeof moduleInstance.configure).toBe('function');
    });
  });
});
