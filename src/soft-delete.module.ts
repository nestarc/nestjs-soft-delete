import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from './soft-delete.constants';
import { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions } from './interfaces/soft-delete-options.interface';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import { SoftDeleteActorMiddleware } from './middleware/soft-delete-actor.middleware';
import { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';

@Module({})
export class SoftDeleteModule implements NestModule {
  static forRoot(options: SoftDeleteModuleOptions): DynamicModule {
    const providers: any[] = [
      {
        provide: SOFT_DELETE_MODULE_OPTIONS,
        useValue: options,
      },
      {
        provide: SOFT_DELETE_PRISMA_SERVICE,
        useExisting: options.prismaServiceToken,
      },
      SoftDeleteService,
      {
        provide: APP_INTERCEPTOR,
        useClass: SoftDeleteFilterInterceptor,
      },
    ];

    const exports: any[] = [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS];

    if (options.enableEvents) {
      providers.push(SoftDeleteEventEmitter);
      exports.push(SoftDeleteEventEmitter);
    }

    return {
      module: SoftDeleteModule,
      global: true,
      providers,
      exports,
    };
  }

  static forRootAsync(options: SoftDeleteModuleAsyncOptions): DynamicModule {
    const providers: any[] = [
      {
        provide: SOFT_DELETE_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      {
        provide: SOFT_DELETE_PRISMA_SERVICE,
        useExisting: options.prismaServiceToken,
      },
      SoftDeleteService,
      SoftDeleteEventEmitter,
      {
        provide: APP_INTERCEPTOR,
        useClass: SoftDeleteFilterInterceptor,
      },
    ];

    return {
      module: SoftDeleteModule,
      global: true,
      imports: options.imports ?? [],
      providers,
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS, SoftDeleteEventEmitter],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SoftDeleteActorMiddleware).forRoutes('*');
  }
}
