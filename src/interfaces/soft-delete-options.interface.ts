import { ModuleMetadata } from '@nestjs/common';

export interface SoftDeleteModuleOptions {
  softDeleteModels: string[];
  deletedAtField?: string;
  deletedByField?: string | null;
  actorExtractor?: (req: any) => string | null;
  cascade?: Record<string, string[]>;
  maxCascadeDepth?: number;
  /** DI token for the PrismaService provider in the consumer's module */
  prismaServiceToken: any;
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
}
