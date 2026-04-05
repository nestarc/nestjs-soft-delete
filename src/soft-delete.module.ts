import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SOFT_DELETE_MODULE_OPTIONS } from './soft-delete.constants';
import { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions } from './interfaces/soft-delete-options.interface';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import { SoftDeleteActorMiddleware } from './middleware/soft-delete-actor.middleware';

@Module({})
export class SoftDeleteModule implements NestModule {
  static forRoot(options: SoftDeleteModuleOptions): DynamicModule {
    return {
      module: SoftDeleteModule,
      global: true,
      providers: [
        {
          provide: SOFT_DELETE_MODULE_OPTIONS,
          useValue: options,
        },
        SoftDeleteService,
        {
          provide: APP_INTERCEPTOR,
          useClass: SoftDeleteFilterInterceptor,
        },
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: SoftDeleteModuleAsyncOptions): DynamicModule {
    return {
      module: SoftDeleteModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: SOFT_DELETE_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        SoftDeleteService,
        {
          provide: APP_INTERCEPTOR,
          useClass: SoftDeleteFilterInterceptor,
        },
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SoftDeleteActorMiddleware).forRoutes('*');
  }
}
