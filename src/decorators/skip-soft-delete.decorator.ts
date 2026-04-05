import { SetMetadata } from '@nestjs/common';
import { SKIP_SOFT_DELETE_KEY } from '../soft-delete.constants';

export const SkipSoftDelete = () => SetMetadata(SKIP_SOFT_DELETE_KEY, true);
