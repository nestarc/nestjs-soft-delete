import { Inject, Injectable, Optional } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from '../soft-delete.constants';
import { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';
import { CascadeHandler } from '../prisma/cascade-handler';
import { SoftDeleteContext } from './soft-delete-context';
import { SoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
import { RestoredEvent, PurgedEvent } from '../events/soft-delete.events';
import {
  DEFAULT_AUDIT_MAX_BATCH_RECORDS,
  runAuditLifecycle,
  validateAuditLifecycleOptions,
} from '../prisma/audit-lifecycle';

@Injectable()
export class SoftDeleteService {
  private readonly deletedAtField: string;
  private readonly deletedByField: string | null;

  constructor(
    @Inject(SOFT_DELETE_MODULE_OPTIONS) private readonly options: SoftDeleteModuleOptions,
    @Inject(SOFT_DELETE_PRISMA_SERVICE) private readonly prisma: any,
    @Optional() @Inject(CascadeHandler) private readonly cascadeHandler: CascadeHandler | null,
    @Optional()
    @Inject(SoftDeleteEventEmitter)
    private readonly eventEmitter: SoftDeleteEventEmitter | null,
  ) {
    validateAuditLifecycleOptions(options);
    this.deletedAtField = options.deletedAtField ?? 'deletedAt';
    this.deletedByField = options.deletedByField ?? null;
  }

  /**
   * Helper: get Prisma model delegate by name.
   * Converts model name (e.g. "User") to camelCase key (e.g. "user").
   */
  private getModelDelegate(model: string): any {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    return this.prisma[key];
  }

  private buildRestoreData(): Record<string, any> {
    const data: Record<string, any> = {
      [this.deletedAtField]: null,
    };
    if (this.deletedByField) {
      data[this.deletedByField] = null;
    }
    return data;
  }

  private buildDeletedWhere(where: Record<string, any> | undefined): Record<string, any> {
    return {
      ...(where ?? {}),
      [this.deletedAtField]: { not: null },
    };
  }

  private findPrimaryKey(model: string): string {
    if (this.cascadeHandler) {
      return this.cascadeHandler.findPrimaryKey(model);
    }

    const modelDef = this.options.dmmf?.datamodel.models.find(
      (candidate: any) => candidate.name === model,
    );
    const pkField = modelDef?.fields.find((field: any) => field.isId);
    return pkField?.name ?? 'id';
  }

  private async runLifecycle<T>(
    model: string,
    operation: string,
    action: 'restored' | 'purged',
    callback: (client: any) => Promise<T>,
  ): Promise<T> {
    return runAuditLifecycle(this.prisma, this.options, model, operation, action, callback);
  }

  /**
   * Restore a soft-deleted record by setting deletedAt (and optionally deletedBy) back to null.
   * If cascade is configured, cascade-restores child records as well.
   */
  async restore<T = any>(model: string, where: Record<string, any>): Promise<T> {
    const restored = await this.runLifecycle(model, 'restore', 'restored', (client) =>
      SoftDeleteContext.run(
        {
          filterMode: 'withDeleted',
          skipSoftDelete: false,
          actorId: SoftDeleteContext.getActorId(),
        },
        async () => {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          const delegate = client[modelKey];
          const deletedWhere = this.buildDeletedWhere(where);
          const record = await delegate.findFirst({ where: deletedWhere });
          if (!record) {
            throw new Error(
              `Record not found for model "${model}" with query ${JSON.stringify(where)}`,
            );
          }
          const deletedAt = record[this.deletedAtField];
          const result = await delegate.update({
            where: {
              ...deletedWhere,
              [this.deletedAtField]: deletedAt,
            },
            data: this.buildRestoreData(),
          });
          if (this.cascadeHandler && deletedAt) {
            const pkField = this.cascadeHandler.findPrimaryKey(model);
            await this.cascadeHandler.cascadeRestore(
              client,
              model,
              record[pkField],
              deletedAt,
              0,
              this.options.auditLifecycle === 'atomic-required'
                ? (childModel, callback) =>
                    this.runLifecycle(childModel, 'cascadeRestore', 'restored', callback)
                : undefined,
            );
          }
          return result;
        },
      ),
    );

    this.eventEmitter?.emitRestored(
      new RestoredEvent(model, where, SoftDeleteContext.getActorId()),
    );

    return restored as T;
  }

  /**
   * Restore all soft-deleted records matching the given filter.
   * If cascade is configured, cascade-restores child records for each affected parent.
   */
  async restoreMany(
    model: string,
    options: { where?: Record<string, any> } = {},
  ): Promise<{ count: number }> {
    const delegate = this.getModelDelegate(model);
    const where = options.where ?? {};
    const deletedWhere = this.buildDeletedWhere(where);
    const data = this.buildRestoreData();

    if (this.options.auditLifecycle === 'atomic-required') {
      const maxRecords = this.options.auditMaxBatchRecords ?? DEFAULT_AUDIT_MAX_BATCH_RECORDS;
      const result = await this.runLifecycle(model, 'restoreMany', 'restored', (client) =>
        SoftDeleteContext.run(
          {
            filterMode: 'withDeleted',
            skipSoftDelete: false,
            actorId: SoftDeleteContext.getActorId(),
          },
          async () => {
            const key = model.charAt(0).toLowerCase() + model.slice(1);
            const delegate = client[key];
            const records = await delegate.findMany({
              where: deletedWhere,
              take: maxRecords + 1,
            });
            if (records.length > maxRecords) {
              throw new Error(
                `[@nestarc/soft-delete] ${model}.restoreMany exceeds auditMaxBatchRecords (${maxRecords})`,
              );
            }
            const pkField = this.findPrimaryKey(model);
            for (const record of records) {
              await delegate.update({
                where: {
                  ...deletedWhere,
                  [pkField]: record[pkField],
                  [this.deletedAtField]: record[this.deletedAtField],
                },
                data,
              });
              const deletedAt = record[this.deletedAtField];
              if (this.cascadeHandler && deletedAt) {
                await this.cascadeHandler.cascadeRestore(
                  client,
                  model,
                  record[pkField],
                  deletedAt,
                  0,
                  (childModel, callback) =>
                    this.runLifecycle(childModel, 'cascadeRestore', 'restored', callback),
                );
              }
            }
            return { count: records.length };
          },
        ),
      );
      if (result.count > 0) {
        this.eventEmitter?.emitRestored(
          new RestoredEvent(model, where, SoftDeleteContext.getActorId(), result.count),
        );
      }
      return result;
    }

    let recordsToCascade: Array<Record<string, any>> = [];
    let pkField = 'id';

    if (this.cascadeHandler) {
      pkField = this.cascadeHandler.findPrimaryKey(model);
      recordsToCascade = await this.withDeleted(() =>
        delegate.findMany({
          where: deletedWhere,
          select: {
            [pkField]: true,
            [this.deletedAtField]: true,
          },
        }),
      );
    }

    const result = await delegate.updateMany({
      where: deletedWhere,
      data,
    });

    if (this.cascadeHandler) {
      for (const record of recordsToCascade) {
        const deletedAt = record[this.deletedAtField];
        if (!deletedAt) {
          continue;
        }

        await SoftDeleteContext.run(
          {
            filterMode: 'withDeleted',
            skipSoftDelete: false,
            actorId: SoftDeleteContext.getActorId(),
          },
          () =>
            this.cascadeHandler!.cascadeRestore(this.prisma, model, record[pkField], deletedAt, 0),
        );
      }
    }

    if (result.count > 0) {
      this.eventEmitter?.emitRestored(
        new RestoredEvent(model, where, SoftDeleteContext.getActorId(), result.count),
      );
    }

    return result;
  }

  /**
   * Permanently delete a record, bypassing soft-delete logic.
   */
  async forceDelete<T = any>(model: string, where: Record<string, any>): Promise<T> {
    return this.runLifecycle(model, 'forceDelete', 'purged', (client) =>
      SoftDeleteContext.run({ filterMode: 'default', skipSoftDelete: true }, async () => {
        const key = model.charAt(0).toLowerCase() + model.slice(1);
        return client[key].delete({ where }) as T;
      }),
    );
  }

  /**
   * Permanently delete soft-deleted records older than the specified date.
   * Runs within skipSoftDelete context so the extension does not intercept the deleteMany.
   */
  async purge(
    model: string,
    options: { olderThan: Date; where?: Record<string, any> },
  ): Promise<{ count: number }> {
    const { olderThan, where: extraWhere } = options;

    const result = await this.runLifecycle(model, 'purge', 'purged', (client) =>
      SoftDeleteContext.run({ filterMode: 'default', skipSoftDelete: true }, async () => {
        const key = model.charAt(0).toLowerCase() + model.slice(1);
        return client[key].deleteMany({
          where: {
            ...extraWhere,
            [this.deletedAtField]: { not: null, lt: olderThan },
          },
        });
      }),
    );

    if (result.count > 0) {
      this.eventEmitter?.emitPurged(new PurgedEvent(model, result.count, olderThan));
    }

    return result;
  }

  /**
   * Execute a callback where all queries include soft-deleted records.
   */
  async withDeleted<T>(callback: () => T | Promise<T>): Promise<T> {
    return SoftDeleteContext.run({ filterMode: 'withDeleted', skipSoftDelete: false }, callback);
  }

  /**
   * Execute a callback where only soft-deleted records are returned.
   */
  async onlyDeleted<T>(callback: () => T | Promise<T>): Promise<T> {
    return SoftDeleteContext.run({ filterMode: 'onlyDeleted', skipSoftDelete: false }, callback);
  }
}
