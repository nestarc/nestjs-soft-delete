import { SetMetadata } from '@nestjs/common';
import { ONLY_DELETED_KEY } from '../soft-delete.constants';

export const OnlyDeleted = () => SetMetadata(ONLY_DELETED_KEY, true);
