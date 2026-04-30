import { describe, expect, it } from 'vitest';
import { CascadeDmmfMissingError } from '../errors/cascade-dmmf-missing.error';
import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';
import { isCascadeConfigured, requireCascadeDmmf, resolveCascadeDmmf } from './dmmf-resolver';

const optionsDmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'OptionsModel',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
    ],
  },
};

const fallbackDmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'FallbackModel',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
    ],
  },
};

const prismaDmmf: PrismaDmmfLike = {
  datamodel: {
    models: [
      {
        name: 'PrismaModel',
        fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }],
      },
    ],
  },
};

describe('isCascadeConfigured', () => {
  it('should return false when cascade is undefined or empty', () => {
    expect(isCascadeConfigured(undefined)).toBe(false);
    expect(isCascadeConfigured({})).toBe(false);
  });

  it('should return true when cascade has at least one parent key', () => {
    expect(isCascadeConfigured({ User: ['Post'] })).toBe(true);
  });
});

describe('resolveCascadeDmmf', () => {
  it('should prefer options dmmf over fallback and Prisma static dmmf', () => {
    const result = resolveCascadeDmmf({
      optionsDmmf,
      fallbackDmmf,
      prismaDmmf,
    });

    expect(result).toBe(optionsDmmf);
  });

  it('should use fallback dmmf when options dmmf is absent', () => {
    const result = resolveCascadeDmmf({
      fallbackDmmf,
      prismaDmmf,
    });

    expect(result).toBe(fallbackDmmf);
  });

  it('should use Prisma static dmmf when explicit sources are absent', () => {
    const result = resolveCascadeDmmf({
      prismaDmmf,
    });

    expect(result).toBe(prismaDmmf);
  });
});

describe('requireCascadeDmmf', () => {
  it('should return the resolved dmmf when one is available', () => {
    expect(requireCascadeDmmf({ optionsDmmf })).toBe(optionsDmmf);
  });

  it('should throw CascadeDmmfMissingError when no dmmf is available', () => {
    expect(() =>
      requireCascadeDmmf({
        optionsDmmf: undefined,
        fallbackDmmf: undefined,
        prismaDmmf: undefined,
      }),
    ).toThrow(CascadeDmmfMissingError);
  });
});
