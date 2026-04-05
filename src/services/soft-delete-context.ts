import { AsyncLocalStorage } from 'node:async_hooks';
import type { SoftDeleteFilterMode, SoftDeleteStore } from '../interfaces/soft-delete-context.interface';

export class SoftDeleteContext {
  private static storage = new AsyncLocalStorage<SoftDeleteStore>();

  /**
   * Runs a callback within the given soft-delete context store.
   *
   * Supports both synchronous and asynchronous callbacks. When the callback
   * returns a Promise (e.g. a Prisma query), the context is preserved
   * throughout the entire async chain — including inside Prisma extension
   * handlers whose internal Promise implementation may not propagate
   * AsyncLocalStorage context on its own.
   */
  static run<T>(store: SoftDeleteStore, callback: () => T): T {
    return this.storage.run(store, () => {
      const result = callback();
      // If the callback returns a thenable (Promise), wrap it so the
      // continuation executes inside the same AsyncLocalStorage context.
      // Prisma's internal query-engine Promises may not propagate the
      // Node.js async context, so we re-enter via an async IIFE that
      // keeps the store active for every `await` in the chain.
      if (result != null && typeof (result as any).then === 'function') {
        return new Promise<any>((resolve, reject) => {
          (result as any).then(
            (val: any) => resolve(val),
            (err: any) => reject(err),
          );
        }) as any as T;
      }
      return result;
    });
  }

  static getFilterMode(): SoftDeleteFilterMode {
    return this.storage.getStore()?.filterMode ?? 'default';
  }

  static isSkipped(): boolean {
    return this.storage.getStore()?.skipSoftDelete ?? false;
  }

  static getActorId(): string | null {
    return this.storage.getStore()?.actorId ?? null;
  }
}
