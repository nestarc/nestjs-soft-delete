// Core Module
export { SoftDeleteModule } from './soft-delete.module';
export type { SoftDeleteModuleOptions, SoftDeleteModuleAsyncOptions, SoftDeleteExtensionOptions } from './interfaces/soft-delete-options.interface';

// Services
export { SoftDeleteService } from './services/soft-delete.service';
export { SoftDeleteContext } from './services/soft-delete-context';
export type { SoftDeleteFilterMode, SoftDeleteStore } from './interfaces/soft-delete-context.interface';

// Prisma Extension
export { createPrismaSoftDeleteExtension } from './prisma/soft-delete-extension';

// Decorators
export { WithDeleted } from './decorators/with-deleted.decorator';
export { OnlyDeleted } from './decorators/only-deleted.decorator';
export { SkipSoftDelete } from './decorators/skip-soft-delete.decorator';

// Interceptor
export { SoftDeleteFilterInterceptor } from './interceptors/soft-delete-filter.interceptor';

// Errors
export { SoftDeleteFieldMissingError } from './errors/soft-delete-field-missing.error';
export { CascadeRelationNotFoundError } from './errors/cascade-relation-not-found.error';

// Events
export { SoftDeletedEvent, RestoredEvent, PurgedEvent } from './events/soft-delete.events';
export { SoftDeleteEventEmitter } from './events/soft-delete-event-emitter';

// Constants
export { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from './soft-delete.constants';
