import { Injectable, Optional, Inject } from '@nestjs/common';
import { SoftDeletedEvent } from './soft-delete.events';
import { RestoredEvent } from './soft-delete.events';
import { PurgedEvent } from './soft-delete.events';

@Injectable()
export class SoftDeleteEventEmitter {
  constructor(
    @Optional() @Inject('EventEmitter2') private readonly eventEmitter: any | null,
  ) {}

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
