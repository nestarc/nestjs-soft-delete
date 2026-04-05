import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from './soft-delete.constants';
import { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions } from './interfaces/soft-delete-options.interface';
import { SoftDeleteService } from './services/soft-delete.service';
import { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';
import { SoftDeleteActorMiddleware } from './middleware/soft-delete-actor.middleware';
import { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';
import { Prisma } from '@prisma/client';
import { CascadeHandler } from './prisma/cascade-handler';
import { DEFAULT_DELETED_AT_FIELD, DEFAULT_MAX_CASCADE_DEPTH } from './soft-delete.constants';

function buildCascadeHandlerProvider() {
  return {
    provide: CascadeHandler,
    useFactory: (options: SoftDeleteModuleOptions) => {
      if (!options.cascade || Object.keys(options.cascade).length === 0) {
        return null;
      }
      return new CascadeHandler({
        cascade: options.cascade,
        deletedAtField: options.deletedAtField ?? DEFAULT_DELETED_AT_FIELD,
        deletedByField: options.deletedByField,
        maxCascadeDepth: options.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH,
        dmmf: (Prisma as any).dmmf,
      });
    },
    inject: [SOFT_DELETE_MODULE_OPTIONS],
  };
}

function buildEventEmitterProvider() {
  return {
    provide: SoftDeleteEventEmitter,
    useFactory: (options: SoftDeleteModuleOptions, eventEmitter: any | null) => {
      if (!options.enableEvents) {
        return null;
      }
      return new SoftDeleteEventEmitter(eventEmitter);
    },
    inject: [
      SOFT_DELETE_MODULE_OPTIONS,
      { token: 'EventEmitter2', optional: true },
    ],
  };
}

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
      buildCascadeHandlerProvider(),
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
      buildCascadeHandlerProvider(),
      SoftDeleteService,
      buildEventEmitterProvider(),
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
