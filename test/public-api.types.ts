import type { SoftDeleteExtensionOptions, SoftDeleteModuleOptions } from '../dist';

const moduleOptions: SoftDeleteModuleOptions = {
  softDeleteModels: ['User'],
  prismaServiceToken: 'PRISMA',
  auditLifecycle: 'atomic-required',
  auditMaxBatchRecords: 1000,
};

const extensionOptions: SoftDeleteExtensionOptions = {
  softDeleteModels: ['User'],
  auditLifecycle: 'atomic-required',
  auditMaxBatchRecords: 1000,
};

const lifecycleMode: 'atomic-required' | undefined = extensionOptions.auditLifecycle;
const batchLimit: number | undefined = moduleOptions.auditMaxBatchRecords;

const unsupportedMode: SoftDeleteExtensionOptions = {
  softDeleteModels: ['User'],
  // @ts-expect-error The integration deliberately exposes no best-effort mode.
  auditLifecycle: 'best-effort',
};

void lifecycleMode;
void batchLimit;
void unsupportedMode;
