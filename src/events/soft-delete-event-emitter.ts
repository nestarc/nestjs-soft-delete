import { Injectable, Optional, Inject } from '@nestjs/common';
import { SoftDeletedEvent } from './soft-delete.events';
import { RestoredEvent } from './soft-delete.events';
import { PurgedEvent } from './soft-delete.events';

let registeredSoftDeleteEventEmitter: SoftDeleteEventEmitter | null = null;

function registerSoftDeleteEventEmitter(instance: SoftDeleteEventEmitter): void {
  registeredSoftDeleteEventEmitter = instance;
}

export function getRegisteredSoftDeleteEventEmitter(): SoftDeleteEventEmitter | null {
  return registeredSoftDeleteEventEmitter;
}

export function resetRegisteredSoftDeleteEventEmitter(): void {
  registeredSoftDeleteEventEmitter = null;
}

@Injectable()
export class SoftDeleteEventEmitter {
  constructor(
    @Optional() @Inject('EventEmitter2') private readonly eventEmitter: any | null,
  ) {
    if (this.eventEmitter) {
      registerSoftDeleteEventEmitter(this);
    }
  }

  get isEnabled(): boolean {
    return this.eventEmitter != null;
  }

  emitSoftDeleted(event: SoftDeletedEvent): void {
    this.eventEmitter?.emit(SoftDeletedEvent.EVENT_NAME, event);
  }

  emitRestored(event: RestoredEvent): void {
    this.eventEmitter?.emit(RestoredEvent.EVENT_NAME, event);
  }

  emitPurged(event: PurgedEvent): void {
    this.eventEmitter?.emit(PurgedEvent.EVENT_NAME, event);
  }
}
