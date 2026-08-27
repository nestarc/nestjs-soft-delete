import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';
import { CascadeRelationNotFoundError } from '../errors/cascade-relation-not-found.error';

export interface CascadeHandlerOptions {
  cascade: Record<string, string[]>;
  deletedAtField: string;
  deletedByField?: string | null;
  maxCascadeDepth: number;
  dmmf: PrismaDmmfLike;
}

export type CascadeLifecycleRunner = <T>(
  model: string,
  callback: (client: any) => Promise<T>,
) => Promise<T>;

/**
 * Handles cascading soft-delete and restore operations by walking
 * the cascade graph defined in the module options and using Prisma
 * DMMF metadata to resolve foreign-key relationships.
 */
export class CascadeHandler {
  private readonly cascade: Record<string, string[]>;
  private readonly deletedAtField: string;
  private readonly maxCascadeDepth: number;
  private readonly dmmf: PrismaDmmfLike;
  private readonly fkCache = new Map<string, string>();

  constructor(options: CascadeHandlerOptions) {
    this.cascade = options.cascade;
    this.deletedAtField = options.deletedAtField;
    this.maxCascadeDepth = options.maxCascadeDepth;
    this.dmmf = options.dmmf;
  }

  /**
   * Finds the primary key field name for a given model by inspecting the
   * Prisma DMMF datamodel. Falls back to 'id' if the model or PK is not found.
   */
  findPrimaryKey(model: string): string {
    const modelDef = this.dmmf.datamodel.models.find((m: any) => m.name === model);
    const pkField = modelDef?.fields.find((f: any) => f.isId);
    return pkField?.name ?? 'id';
  }

  /**
   * Finds the foreign key field on the child model that references the parent model
   * by inspecting the Prisma DMMF datamodel. Results are cached for performance.
   *
   * @throws CascadeRelationNotFoundError if no relation from child to parent exists
   */
  findForeignKey(parent: string, child: string): string {
    const cacheKey = `${parent}:${child}`;
    const cached = this.fkCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const childModel = this.dmmf.datamodel.models.find((m: any) => m.name === child);

    if (!childModel) {
      throw new CascadeRelationNotFoundError(parent, child);
    }

    for (const field of childModel.fields) {
      if (
        field.kind === 'object' &&
        field.type === parent &&
        field.relationFromFields &&
        field.relationFromFields.length > 0
      ) {
        const fk = field.relationFromFields[0];
        this.fkCache.set(cacheKey, fk);
        return fk;
      }
    }

    throw new CascadeRelationNotFoundError(parent, child);
  }

  /**
   * Cascades a soft-delete from a parent record to all configured child models.
   * Recursively walks the cascade graph up to maxCascadeDepth.
   */
  async cascadeSoftDelete(
    prisma: any,
    parentModel: string,
    parentId: unknown,
    deletedAt: Date,
    depth: number,
    lifecycle?: CascadeLifecycleRunner,
  ): Promise<void> {
    if (depth >= this.maxCascadeDepth) {
      return;
    }

    const children = this.cascade[parentModel];
    if (!children || children.length === 0) {
      return;
    }

    for (const childModel of children) {
      const fk = this.findForeignKey(parentModel, childModel);
      const childKey = childModel.charAt(0).toLowerCase() + childModel.slice(1);
      const pkField = this.findPrimaryKey(childModel);

      if (!lifecycle) {
        await prisma[childKey].updateMany({
          where: {
            [fk]: parentId,
            [this.deletedAtField]: null,
          },
          data: {
            [this.deletedAtField]: deletedAt,
          },
        });
        const affectedChildren = await prisma[childKey].findMany({
          where: { [fk]: parentId, [this.deletedAtField]: deletedAt },
          select: { [pkField]: true },
        });
        for (const child of affectedChildren) {
          await this.cascadeSoftDelete(prisma, childModel, child[pkField], deletedAt, depth + 1);
        }
        continue;
      }

      const affectedChildren = await prisma[childKey].findMany({
        where: { [fk]: parentId, [this.deletedAtField]: null },
        select: { [pkField]: true },
      });

      for (const child of affectedChildren) {
        const data: Record<string, unknown> = {
          [this.deletedAtField]: deletedAt,
        };
        const update = (mutationClient: any) =>
          mutationClient[childKey].update({
            where: {
              [pkField]: child[pkField],
              [fk]: parentId,
              [this.deletedAtField]: null,
            },
            data,
          });
        await lifecycle(childModel, update);
        await this.cascadeSoftDelete(
          prisma,
          childModel,
          child[pkField],
          deletedAt,
          depth + 1,
          lifecycle,
        );
      }
    }
  }

  /**
   * Cascades a restore from a parent record to all configured child models.
   * Uses +/-1 second timestamp matching to find children that were soft-deleted
   * at approximately the same time as the parent.
   */
  async cascadeRestore(
    prisma: any,
    parentModel: string,
    parentId: unknown,
    deletedAt: Date,
    depth: number,
    lifecycle?: CascadeLifecycleRunner,
  ): Promise<void> {
    if (depth >= this.maxCascadeDepth) {
      return;
    }

    const children = this.cascade[parentModel];
    if (!children || children.length === 0) {
      return;
    }

    const lowerBound = new Date(deletedAt.getTime() - 1000);
    const upperBound = new Date(deletedAt.getTime() + 1000);

    for (const childModel of children) {
      const fk = this.findForeignKey(parentModel, childModel);
      const childKey = childModel.charAt(0).toLowerCase() + childModel.slice(1);
      const pkField = this.findPrimaryKey(childModel);

      // Find affected children BEFORE restoring (to capture their deletedAt for recursion)
      const affectedChildren = await prisma[childKey].findMany({
        where: {
          [fk]: parentId,
          [this.deletedAtField]: {
            gte: lowerBound,
            lte: upperBound,
          },
        },
        select: { [pkField]: true, [this.deletedAtField]: true },
      });

      if (!lifecycle) {
        await prisma[childKey].updateMany({
          where: {
            [fk]: parentId,
            [this.deletedAtField]: {
              gte: lowerBound,
              lte: upperBound,
            },
          },
          data: {
            [this.deletedAtField]: null,
          },
        });
        for (const child of affectedChildren) {
          await this.cascadeRestore(
            prisma,
            childModel,
            child[pkField],
            child[this.deletedAtField],
            depth + 1,
          );
        }
        continue;
      }

      // Recurse for each affected child with its original deletedAt
      for (const child of affectedChildren) {
        const data: Record<string, unknown> = {
          [this.deletedAtField]: null,
        };
        const update = (mutationClient: any) =>
          mutationClient[childKey].update({
            where: {
              [pkField]: child[pkField],
              [fk]: parentId,
              [this.deletedAtField]: child[this.deletedAtField],
            },
            data,
          });
        await lifecycle(childModel, update);
        await this.cascadeRestore(
          prisma,
          childModel,
          child[pkField],
          child[this.deletedAtField],
          depth + 1,
          lifecycle,
        );
      }
    }
  }
}
