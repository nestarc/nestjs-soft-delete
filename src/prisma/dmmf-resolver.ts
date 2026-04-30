import { Prisma } from '@prisma/client';
import { CascadeDmmfMissingError } from '../errors/cascade-dmmf-missing.error';
import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';

export interface ResolveCascadeDmmfOptions {
  optionsDmmf?: PrismaDmmfLike;
  fallbackDmmf?: PrismaDmmfLike;
  prismaDmmf?: PrismaDmmfLike;
}

export function isCascadeConfigured(cascade?: Record<string, string[]>): boolean {
  return !!cascade && Object.keys(cascade).length > 0;
}

export function resolveCascadeDmmf({
  optionsDmmf,
  fallbackDmmf,
  prismaDmmf = (Prisma as any).dmmf,
}: ResolveCascadeDmmfOptions): PrismaDmmfLike | undefined {
  return optionsDmmf ?? fallbackDmmf ?? prismaDmmf;
}

export function requireCascadeDmmf(options: ResolveCascadeDmmfOptions): PrismaDmmfLike {
  const dmmf = resolveCascadeDmmf(options);

  if (!dmmf) {
    throw new CascadeDmmfMissingError();
  }

  return dmmf;
}
