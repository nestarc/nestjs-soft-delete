import type { PrismaDmmfLike } from '../interfaces/soft-delete-options.interface';
import { SoftDeleteContext } from '../services/soft-delete-context';

export interface RelationReadFilterOptions {
  dmmf: PrismaDmmfLike;
  softDeleteModels: string[];
  deletedAtField: string;
  maxDepth?: number;
}

function modelKey(model: string): string {
  return model.toLowerCase();
}

function isSoftDeleteModel(model: string, softDeleteModels: string[]): boolean {
  const normalized = modelKey(model);
  return softDeleteModels.some((m) => modelKey(m) === normalized);
}

function findModel(dmmf: PrismaDmmfLike, model: string) {
  return dmmf.datamodel.models.find((m) => m.name === model);
}

function relationFilter(deletedAtField: string): Record<string, unknown> | null {
  const filterMode = SoftDeleteContext.getFilterMode();

  if (filterMode === 'withDeleted' || SoftDeleteContext.isSkipped()) {
    return null;
  }

  return filterMode === 'onlyDeleted'
    ? { [deletedAtField]: { not: null } }
    : { [deletedAtField]: null };
}

function applyFilterToRelationValue(
  value: unknown,
  filter: Record<string, unknown> | null,
): unknown {
  if (!filter) {
    return value;
  }

  if (value === true) {
    return { where: filter };
  }

  if (value && typeof value === 'object') {
    const relationArgs = { ...(value as Record<string, unknown>) };
    relationArgs.where = {
      ...((relationArgs.where as Record<string, unknown> | undefined) ?? {}),
      ...filter,
    };
    return relationArgs;
  }

  return value;
}

function walkRelationSelections(
  args: Record<string, unknown>,
  model: string,
  options: Required<RelationReadFilterOptions>,
  depth: number,
  pathPrefix: string,
): Record<string, unknown> {
  if (depth >= options.maxDepth) {
    return args;
  }

  const modelDef = findModel(options.dmmf, model);
  if (!modelDef) {
    return args;
  }

  const nextArgs = { ...args };

  for (const selectionKey of ['include', 'select'] as const) {
    const selection = nextArgs[selectionKey];
    if (!selection || typeof selection !== 'object') {
      continue;
    }

    const nextSelection = { ...(selection as Record<string, unknown>) };

    for (const [fieldName, fieldSelection] of Object.entries(nextSelection)) {
      const field = modelDef.fields.find((candidate) => candidate.name === fieldName);
      if (!field || field.kind !== 'object' || !field.type) {
        continue;
      }

      const relationPath = pathPrefix ? `${pathPrefix}.${fieldName}` : fieldName;
      const isToManySoftDeleteRelation =
        field.isList === true && isSoftDeleteModel(field.type, options.softDeleteModels);

      let nextFieldSelection = fieldSelection;
      if (
        isToManySoftDeleteRelation &&
        !SoftDeleteContext.isWithDeletedRelationPath(relationPath)
      ) {
        nextFieldSelection = applyFilterToRelationValue(
          fieldSelection,
          relationFilter(options.deletedAtField),
        );
      }

      if (nextFieldSelection && typeof nextFieldSelection === 'object') {
        nextFieldSelection = walkRelationSelections(
          nextFieldSelection as Record<string, unknown>,
          field.type,
          options,
          depth + 1,
          relationPath,
        );
      }

      nextSelection[fieldName] = nextFieldSelection;
    }

    nextArgs[selectionKey] = nextSelection;
  }

  return nextArgs;
}

export function applyRelationReadFilters(
  args: Record<string, unknown>,
  model: string,
  options: RelationReadFilterOptions,
): Record<string, unknown> {
  return walkRelationSelections(
    { ...args },
    model,
    {
      ...options,
      maxDepth: options.maxDepth ?? 3,
    },
    0,
    '',
  );
}
