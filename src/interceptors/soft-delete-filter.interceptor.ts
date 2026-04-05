import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { WITH_DELETED_KEY, ONLY_DELETED_KEY, SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';
import { SoftDeleteContext } from '../services/soft-delete-context';
import type { SoftDeleteFilterMode, SoftDeleteStore } from '../interfaces/soft-delete-context.interface';

@Injectable()
export class SoftDeleteFilterInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const targets = [context.getHandler(), context.getClass()];

    const withDeleted = this.reflector.getAllAndOverride<boolean>(WITH_DELETED_KEY, targets) ?? false;
    const onlyDeleted = this.reflector.getAllAndOverride<boolean>(ONLY_DELETED_KEY, targets) ?? false;
    const skipSoftDelete = this.reflector.getAllAndOverride<boolean>(SKIP_SOFT_DELETE_KEY, targets) ?? false;

    let filterMode: SoftDeleteFilterMode = 'default';
    if (withDeleted) {
      filterMode = 'withDeleted';
    } else if (onlyDeleted) {
      filterMode = 'onlyDeleted';
    }

    // Preserve actorId from middleware context (AsyncLocalStorage.run replaces the entire store)
    const currentActorId = SoftDeleteContext.getActorId();

    const store: SoftDeleteStore = {
      filterMode,
      skipSoftDelete,
      actorId: currentActorId,
    };

    return new Observable((subscriber) => {
      SoftDeleteContext.run(store, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
