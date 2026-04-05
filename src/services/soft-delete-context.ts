import { AsyncLocalStorage } from 'node:async_hooks';
import type { SoftDeleteFilterMode, SoftDeleteStore } from '../interfaces/soft-delete-context.interface';

export class SoftDeleteContext {
  private static storage = new AsyncLocalStorage<SoftDeleteStore>();

  static run<T>(store: SoftDeleteStore, callback: () => T): T {
    return this.storage.run(store, callback);
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
