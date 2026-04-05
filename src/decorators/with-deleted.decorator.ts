import { SetMetadata } from '@nestjs/common';
import { WITH_DELETED_KEY } from '../soft-delete.constants';

export const WithDeleted = () => SetMetadata(WITH_DELETED_KEY, true);
