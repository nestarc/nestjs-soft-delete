import { DynamicModule, Module } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS } from '../soft-delete.constants';
import { SoftDeleteService } from '../services/soft-delete.service';
import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';

@Module({})
export class TestSoftDeleteModule {
  static register(options: Partial<SoftDeleteModuleOptions> & { softDeleteModels: string[] }): DynamicModule {
    const fullOptions: SoftDeleteModuleOptions = {
      deletedAtField: 'deletedAt',
      ...options,
    };

    return {
      module: TestSoftDeleteModule,
      providers: [
        { provide: SOFT_DELETE_MODULE_OPTIONS, useValue: fullOptions },
        SoftDeleteService,
      ],
      exports: [SoftDeleteService, SOFT_DELETE_MODULE_OPTIONS],
    };
  }
}
