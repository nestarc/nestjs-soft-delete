import { Prisma } from '@prisma/client';
import { CascadeHandler } from './cascade-handler';
import { SoftDeleteExtensionOptions } from '../interfaces/soft-delete-options.interface';
import { SoftDeleteContext } from '../services/soft-delete-context';
import { DEFAULT_DELETED_AT_FIELD } from '../soft-delete.constants';

/**
 * Determines whether a given model name is in the list of soft-delete models.
 * Comparison is case-insensitive to handle variations in casing.
 */
function isSoftDeleteModel(model: string, softDeleteModels: string[]): boolean {
  const normalized = model.toLowerCase();
  return softDeleteModels.some((m) => m.toLowerCase() === normalized);
}

/**
 * Builds the data payload for a soft-delete update operation.
 */
function buildSoftDeleteData(
  deletedAtField: string,
  deletedByField: string | null | undefined,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    [deletedAtField]: new Date(),
  };

  if (deletedByField) {
    const actorId = SoftDeleteContext.getActorId();
    if (actorId != null) {
      data[deletedByField] = actorId;
    }
  }

  return data;
}

/**
 * Injects the appropriate soft-delete filter into a where clause
 * based on the current filter mode from SoftDeleteContext.
 */
function applyReadFilter(
  where: Record<string, unknown> | undefined,
  deletedAtField: string,
): Record<string, unknown> {
  const filterMode = SoftDeleteContext.getFilterMode();

  if (filterMode === 'withDeleted') {
    return where ?? {};
  }

  const filter =
    filterMode === 'onlyDeleted'
      ? { [deletedAtField]: { not: null } }
      : { [deletedAtField]: null };

  if (!where) {
    return filter;
  }

  return { ...where, ...filter };
}

export interface SoftDeleteQueryHandlers {
  delete: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
    client: any;
  }) => Promise<unknown>;
  deleteMany: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
    client: any;
  }) => Promise<unknown>;
  findMany: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  findFirst: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  findUnique: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  findFirstOrThrow: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  findUniqueOrThrow: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  count: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  aggregate: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
  groupBy: (params: {
    model: string;
    args: any;
    query: (args: any) => Promise<unknown>;
  }) => Promise<unknown>;
}

/**
 * Builds the raw soft-delete query handler functions.
 * Exported for unit testing so handlers can be tested without
 * requiring a real Prisma client or Prisma.defineExtension.
 *
 * @param options - Soft delete extension configuration
 * @param dmmf - Optional Prisma DMMF metadata; required when cascade is configured
 */
export function _buildSoftDeleteQueryHandlers(
  options: SoftDeleteExtensionOptions,
  dmmf?: any,
): SoftDeleteQueryHandlers {
  const deletedAtField = options.deletedAtField ?? DEFAULT_DELETED_AT_FIELD;
  const deletedByField = options.deletedByField ?? null;
  const softDeleteModels = options.softDeleteModels;

  let cascadeHandler: CascadeHandler | null = null;
  if (options.cascade && Object.keys(options.cascade).length > 0 && dmmf) {
    cascadeHandler = new CascadeHandler({
      cascade: options.cascade,
      deletedAtField,
      deletedByField,
      maxCascadeDepth: options.maxCascadeDepth ?? 5,
      dmmf,
    });
  }

  function createReadHandler(operationName: string) {
    return async ({
      model,
      args,
      query,
    }: {
      model: string;
      args: any;
      query: (args: any) => Promise<unknown>;
    }): Promise<unknown> => {
      if (!isSoftDeleteModel(model, softDeleteModels) || SoftDeleteContext.isSkipped()) {
        return query(args);
      }

      const updatedArgs = { ...args };
      updatedArgs.where = applyReadFilter(updatedArgs.where, deletedAtField);
      return query(updatedArgs);
    };
  }

  return {
    async delete({ model, args, query, client }) {
      if (!isSoftDeleteModel(model, softDeleteModels) || SoftDeleteContext.isSkipped()) {
        return query(args);
      }

      const data = buildSoftDeleteData(deletedAtField, deletedByField);
      const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
      const result = await (client as any)[modelKey].update({
        where: args.where,
        data,
      });

      if (cascadeHandler) {
        const pkField = cascadeHandler.findPrimaryKey(model);
        await cascadeHandler.cascadeSoftDelete(
          client,
          model,
          result[pkField],
          data[deletedAtField] as Date,
          0,
        );
      }

      return result;
    },

    async deleteMany({ model, args, query, client }) {
      if (!isSoftDeleteModel(model, softDeleteModels) || SoftDeleteContext.isSkipped()) {
        return query(args);
      }

      const data = buildSoftDeleteData(deletedAtField, deletedByField);
      const modelKey = model.charAt(0).toLowerCase() + model.slice(1);

      if (cascadeHandler) {
        const pkField = cascadeHandler.findPrimaryKey(model);
        // Find records BEFORE soft-deleting them
        const toDelete = await (client as any)[modelKey].findMany({
          where: { ...args.where, [deletedAtField]: null },
          select: { [pkField]: true },
        });

        const result = await (client as any)[modelKey].updateMany({
          where: args.where,
          data,
        });

        for (const record of toDelete) {
          await cascadeHandler.cascadeSoftDelete(
            client,
            model,
            record[pkField],
            data[deletedAtField] as Date,
            0,
          );
        }

        return result;
      }

      return (client as any)[modelKey].updateMany({
        where: args.where,
        data,
      });
    },

    findMany: createReadHandler('findMany'),
    findFirst: createReadHandler('findFirst'),
    findUnique: createReadHandler('findUnique'),
    findFirstOrThrow: createReadHandler('findFirstOrThrow'),
    findUniqueOrThrow: createReadHandler('findUniqueOrThrow'),
    count: createReadHandler('count'),
    aggregate: createReadHandler('aggregate'),
    groupBy: createReadHandler('groupBy'),
  };
}

/**
 * Creates a Prisma client extension that intercepts delete operations
 * (converting them to soft-delete updates) and read operations
 * (injecting deletedAt filters based on the current context).
 */
export function createPrismaSoftDeleteExtension(options: SoftDeleteExtensionOptions) {
  return Prisma.defineExtension((client) => {
    const handlers = _buildSoftDeleteQueryHandlers(options, Prisma.dmmf);

    return client.$extends({
      query: {
        $allModels: {
          async delete({ model, args, query }) {
            return handlers.delete({ model, args, query, client });
          },
          async deleteMany({ model, args, query }) {
            return handlers.deleteMany({ model, args, query, client });
          },
          async findMany({ model, args, query }) {
            return handlers.findMany({ model, args, query });
          },
          async findFirst({ model, args, query }) {
            return handlers.findFirst({ model, args, query });
          },
          async findUnique({ model, args, query }) {
            return handlers.findUnique({ model, args, query });
          },
          async findFirstOrThrow({ model, args, query }) {
            return handlers.findFirstOrThrow({ model, args, query });
          },
          async findUniqueOrThrow({ model, args, query }) {
            return handlers.findUniqueOrThrow({ model, args, query });
          },
          async count({ model, args, query }) {
            return handlers.count({ model, args, query });
          },
          async aggregate({ model, args, query }) {
            return handlers.aggregate({ model, args, query });
          },
          async groupBy({ model, args, query }) {
            return handlers.groupBy({ model, args, query });
          },
        },
      },
    });
  });
}
