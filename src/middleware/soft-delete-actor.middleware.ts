import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SOFT_DELETE_MODULE_OPTIONS } from '../soft-delete.constants';
import { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';
import { SoftDeleteContext } from '../services/soft-delete-context';

@Injectable()
export class SoftDeleteActorMiddleware implements NestMiddleware {
  constructor(
    @Inject(SOFT_DELETE_MODULE_OPTIONS) private readonly options: SoftDeleteModuleOptions,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // If deletedByField or actorExtractor are not configured, pass through
    if (!this.options.deletedByField || !this.options.actorExtractor) {
      next();
      return;
    }

    const actorId = this.options.actorExtractor(req) ?? null;

    SoftDeleteContext.run(
      {
        filterMode: 'default',
        skipSoftDelete: false,
        actorId,
      },
      () => {
        next();
      },
    );
  }
}
