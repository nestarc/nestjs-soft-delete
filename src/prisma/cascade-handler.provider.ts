import type { SoftDeleteModuleOptions } from '../interfaces/soft-delete-options.interface';
import {
  DEFAULT_DELETED_AT_FIELD,
  DEFAULT_MAX_CASCADE_DEPTH,
  SOFT_DELETE_MODULE_OPTIONS,
} from '../soft-delete.constants';
import { CascadeHandler } from './cascade-handler';
import { isCascadeConfigured, requireCascadeDmmf } from './dmmf-resolver';

/** Keep production and testing module restore behavior on the same cascade contract. */
export function buildCascadeHandlerProvider() {
  return {
    provide: CascadeHandler,
    useFactory: (options: SoftDeleteModuleOptions) => {
      if (!isCascadeConfigured(options.cascade)) {
        return null;
      }

      const dmmf = requireCascadeDmmf({ optionsDmmf: options.dmmf });
      return new CascadeHandler({
        cascade: options.cascade!,
        deletedAtField: options.deletedAtField ?? DEFAULT_DELETED_AT_FIELD,
        deletedByField: options.deletedByField,
        maxCascadeDepth: options.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH,
        dmmf,
      });
    },
    inject: [SOFT_DELETE_MODULE_OPTIONS],
  };
}
