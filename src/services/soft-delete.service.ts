import { Inject, Injectable, Optional } from '@nestjs/common';
import { SOFT_DELETE_MODULE_OPTIONS, SOFT_DELETE_PRISMA_SERVICE } from '../soft-delete.constants';
import { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';
import { CascadeHandler } from '../prisma/cascade-handler';
import { SoftDeleteContext } from './soft-delete-context';
import { SoftDeleteEventEmitter } from '../events/soft-delete-event-emitter';
import { RestoredEvent, PurgedEvent } from '../events/soft-delete.events';

@Injectable()
export class SoftDeleteService {
  private readonly deletedAtField: string;
  private readonly deletedByField: string | null;

  constructor(
    @Inject(SOFT_DELETE_MODULE_OPTIONS) private readonly options: SoftDeleteModuleOptions,
    @Inject(SOFT_DELETE_PRISMA_SERVICE) private readonly prisma: any,
    @Optional() @Inject(CascadeHandler) private readonly cascadeHandler: CascadeHandler | null,
    @Optional() private readonly eventEmitter: SoftDeleteEventEmitter | null,
  ) {
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

  /**
   * Restore a soft-deleted record by setting deletedAt (and optionally deletedBy) back to null.
   * If cascade is configured, cascade-restores child records as well.
   */
  async restore<T = any>(model: string, where: Record<string, any>): Promise<T> {
    // Find the deleted record in withDeleted context so we can see soft-deleted rows
    const record = await this.withDeleted(() => {
      const delegate = this.getModelDelegate(model);
      return delegate.findFirst({ where });
    });

    if (!record) {
      throw new Error(`Record not found for model "${model}" with query ${JSON.stringify(where)}`);
    }

    // Build the restore data payload
    const data: Record<string, any> = {
      [this.deletedAtField]: null,
    };
    if (this.deletedByField) {
      data[this.deletedByField] = null;
    }

    const delegate = this.getModelDelegate(model);
    const restored = await delegate.update({
      where,
      data,
    });

    // Cascade restore if handler exists and the record was soft-deleted
    const deletedAt = record[this.deletedAtField];
    if (this.cascadeHandler && deletedAt) {
      const pkField = this.cascadeHandler.findPrimaryKey(model);
      await this.cascadeHandler.cascadeRestore(
        this.prisma,
        model,
        record[pkField],
        deletedAt,
        0,
      );
    }

    this.eventEmitter?.emitRestored(new RestoredEvent(model, where, SoftDeleteContext.getActorId()));

    return restored as T;
  }

  /**
   * Permanently delete a record, bypassing soft-delete logic.
   */
  async forceDelete<T = any>(model: string, where: Record<string, any>): Promise<T> {
    return SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: true },
      async () => {
        const delegate = this.getModelDelegate(model);
        return delegate.delete({ where }) as T;
      },
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

    const result = await SoftDeleteContext.run(
      { filterMode: 'default', skipSoftDelete: true },
      async () => {
        const delegate = this.getModelDelegate(model);
        return delegate.deleteMany({
          where: {
            ...extraWhere,
            [this.deletedAtField]: { not: null, lt: olderThan },
          },
        });
      },
    );

    if (result.count > 0) {
      this.eventEmitter?.emitPurged(
        new PurgedEvent(model, result.count, olderThan),
      );
    }

    return result;
  }

  /**
   * Execute a callback where all queries include soft-deleted records.
   */
  async withDeleted<T>(callback: () => T | Promise<T>): Promise<T> {
    return SoftDeleteContext.run(
      { filterMode: 'withDeleted', skipSoftDelete: false },
      callback,
    );
  }

  /**
   * Execute a callback where only soft-deleted records are returned.
   */
  async onlyDeleted<T>(callback: () => T | Promise<T>): Promise<T> {
    return SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      callback,
    );
  }
}
