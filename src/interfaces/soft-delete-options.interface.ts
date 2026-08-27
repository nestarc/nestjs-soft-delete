import { ModuleMetadata } from '@nestjs/common';

export interface PrismaDmmfLike {
  datamodel: {
    models: Array<{
      name: string;
      fields: Array<{
        name: string;
        kind?: string;
        type?: string;
        isId?: boolean;
        isList?: boolean;
        relationFromFields?: string[];
      }>;
    }>;
  };
}

export interface RelationFilterOptions {
  enabled?: boolean;
  maxDepth?: number;
}

export interface SoftDeleteModuleOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  actorExtractor?: (req: any) => string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  /** DI token for the PrismaService provider in the consumer's module */
  prismaServiceToken: any;
  /** Enable event emission. Requires @nestjs/event-emitter to be installed. Default: false */
  enableEvents?: boolean;
  /** Prisma DMMF metadata. Required when cascade or relationFilters are enabled. */
  dmmf?: PrismaDmmfLike;
  /** Opt-in relation read filtering for to-many include/select trees. Default: false */
  relationFilters?: boolean | RelationFilterOptions;
  /**
   * Require the @nestarc/audit-log atomic lifecycle bridge. The official
   * extension order is tenancy -> audit-log -> soft-delete.
   */
  auditLifecycle?: 'atomic-required';
  /** Maximum records converted to record-level lifecycle mutations. Default: 1000. */
  auditMaxBatchRecords?: number;
}

export interface SoftDeleteModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: any[]) => Promise<SoftDeleteModuleOptions> | SoftDeleteModuleOptions;
  inject?: any[];
  /** DI token for the PrismaService provider — known at registration time, not async */
  prismaServiceToken: any;
}

export interface SoftDeleteExtensionOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  /** Optional event emitter for soft-delete lifecycle events */
  eventEmitter?: { emitSoftDeleted: (event: any) => void } | null;
  /** Prisma DMMF metadata. Required when cascade or relationFilters are enabled. */
  dmmf?: PrismaDmmfLike;
  /** Opt-in relation read filtering for to-many include/select trees. Default: false */
  relationFilters?: boolean | RelationFilterOptions;
  /** Require same-transaction record-level soft-delete audit integration. */
  auditLifecycle?: 'atomic-required';
  /** Maximum records converted to record-level lifecycle mutations. Default: 1000. */
  auditMaxBatchRecords?: number;
}
