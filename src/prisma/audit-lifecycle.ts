import type {
  SoftDeleteExtensionOptions,
  SoftDeleteModuleOptions,
} from '../interfaces/soft-delete-options.interface';

export const DEFAULT_AUDIT_MAX_BATCH_RECORDS = 1000;

type AuditLifecycleOptions = Pick<
  SoftDeleteExtensionOptions | SoftDeleteModuleOptions,
  'auditLifecycle' | 'auditMaxBatchRecords'
>;

interface AuditLifecycleClient {
  getAuditCapabilities(): {
    consistency: string;
    atomicLifecycle: boolean;
  };
  withAuditLifecycle<T>(
    input: {
      action: string;
      metadata?: Record<string, unknown>;
      suppressOuterOperation?: {
        model: string;
        operation: 'delete' | 'deleteMany';
      };
    },
    callback: (tx: any) => Promise<T>,
  ): Promise<T>;
}

export function validateAuditLifecycleOptions(options: AuditLifecycleOptions): void {
  if (options.auditLifecycle !== undefined && options.auditLifecycle !== 'atomic-required') {
    throw new Error(
      '[@nestarc/soft-delete] auditLifecycle must be "atomic-required" when provided',
    );
  }

  if (
    options.auditMaxBatchRecords !== undefined &&
    (!Number.isInteger(options.auditMaxBatchRecords) || options.auditMaxBatchRecords < 1)
  ) {
    throw new Error('[@nestarc/soft-delete] auditMaxBatchRecords must be a positive integer');
  }
}

export function requireAuditLifecycleClient(client: any): AuditLifecycleClient {
  if (typeof client?.withAuditLifecycle !== 'function') {
    throw new Error(
      '[@nestarc/soft-delete] auditLifecycle: "atomic-required" requires the extension order tenancy -> audit-log -> soft-delete and execution inside withAuditTransaction()',
    );
  }
  if (typeof client?.getAuditCapabilities !== 'function') {
    throw new Error(
      '[@nestarc/soft-delete] auditLifecycle: "atomic-required" requires @nestarc/audit-log >=0.4.1 with atomic lifecycle capabilities',
    );
  }
  const capabilities = client.getAuditCapabilities();
  if (capabilities?.consistency !== 'atomic-required' || capabilities?.atomicLifecycle !== true) {
    throw new Error(
      '[@nestarc/soft-delete] auditLifecycle: "atomic-required" requires audit-log consistency: "atomic-required"',
    );
  }
  return client as AuditLifecycleClient;
}

export async function runAuditLifecycle<T>(
  client: any,
  options: AuditLifecycleOptions,
  model: string,
  operation: string,
  action: 'softDeleted' | 'restored' | 'purged',
  callback: (mutationClient: any) => Promise<T>,
  suppressOuterOperation?: 'delete' | 'deleteMany',
): Promise<T> {
  if (options.auditLifecycle !== 'atomic-required') {
    return callback(client);
  }

  return requireAuditLifecycleClient(client).withAuditLifecycle(
    {
      action: `${model}.${action}`,
      metadata: {
        auditKind: 'record',
        lifecycle: 'soft-delete',
        lifecycleOperation: operation,
      },
      ...(suppressOuterOperation
        ? { suppressOuterOperation: { model, operation: suppressOuterOperation } }
        : {}),
    },
    callback,
  );
}
