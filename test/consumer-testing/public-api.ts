import { SoftDeleteService, SoftDeleteContext, type SoftDeleteModuleOptions } from '@nestarc/soft-delete';
import { TestSoftDeleteModule, expectSoftDeleted } from '@nestarc/soft-delete/testing';

const options: Pick<SoftDeleteModuleOptions, 'softDeleteModels'> = { softDeleteModels: ['User'] };
const module = TestSoftDeleteModule.register(options);
const restore: SoftDeleteService['restore'] = async () => null as never;
const context: string = SoftDeleteContext.getFilterMode();
const assertion: Promise<void> = expectSoftDeleted({ findFirst: async () => ({ deletedAt: new Date() }) }, { id: 1 });
void [module, restore, context, assertion];
