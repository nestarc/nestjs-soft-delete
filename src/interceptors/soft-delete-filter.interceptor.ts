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
    const handler = context.getHandler();

    const withDeleted = this.reflector.get<boolean>(WITH_DELETED_KEY, handler) ?? false;
    const onlyDeleted = this.reflector.get<boolean>(ONLY_DELETED_KEY, handler) ?? false;
    const skipSoftDelete = this.reflector.get<boolean>(SKIP_SOFT_DELETE_KEY, handler) ?? false;

    let filterMode: SoftDeleteFilterMode = 'default';
    if (withDeleted) {
      filterMode = 'withDeleted';
    } else if (onlyDeleted) {
      filterMode = 'onlyDeleted';
    }

    const store: SoftDeleteStore = {
      filterMode,
      skipSoftDelete,
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
