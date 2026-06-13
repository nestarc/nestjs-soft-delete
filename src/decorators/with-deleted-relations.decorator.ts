import { SetMetadata } from '@nestjs/common';
import { WITH_DELETED_RELATIONS_KEY } from '../soft-delete.constants';

export const WithDeletedRelations = (...paths: string[]) =>
  SetMetadata(WITH_DELETED_RELATIONS_KEY, paths);
