import { DynamicModule, Module } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from '../soft-delete.constants';
import { SoftDeleteService } from '../services/soft-delete.service';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

@Module({})
export class TestSoftDeleteModule {
  static register(
    options: Partial<SoftDeleteModuleOptions> & { softDeleteModels: string[] },
    prisma?: any,
  ): DynamicModule {
    const fullOptions: SoftDeleteModuleOptions = {
      deletedAtField: 'deletedAt',
      prismaServiceToken: 'TEST_PRISMA',
      ...options,
    };

    const providers: any[] = [
      { provide: SOFT_DELETE_MODULE_OPTIONS, useValue: fullOptions },
      SoftDeleteService,
    ];

    if (prisma) {
      providers.push({ provide: SOFT_DELETE_PRISMA_SERVICE, useValue: prisma });
    }

    return {
      module: TestSoftDeleteModule,
      providers,
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }
}
