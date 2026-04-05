import { SoftDeleteContext } from '../services/soft-delete-context';

export async function expectSoftDeleted(
  modelDelegate: any,
  where: Record<string, any>,
  deletedAtField = 'deletedAt',
): Promise<void> {
  const record = await SoftDeleteContext.run(
    { filterMode: 'withDeleted', skipSoftDelete: false },
    () => modelDelegate.findFirst({ where }),
  );

  if (!record) {
    throw new Error(`Expected record to exist (soft-deleted), but it was not found`);
  }

  if (record[deletedAtField] === null || record[deletedAtField] === undefined) {
    throw new Error(
      `Expected record to be soft-deleted (${deletedAtField} should be non-null), but ${deletedAtField} is ${record[deletedAtField]}`,
    );
  }
}

export async function expectNotSoftDeleted(
  modelDelegate: any,
  where: Record<string, any>,
  deletedAtField = 'deletedAt',
): Promise<void> {
  const record = await modelDelegate.findFirst({ where });

  if (!record) {
    throw new Error(`Expected record to exist (not soft-deleted), but it was not found`);
  }

  if (record[deletedAtField] !== null && record[deletedAtField] !== undefined) {
    throw new Error(
      `Expected record to NOT be soft-deleted (${deletedAtField} should be null), but ${deletedAtField} is ${record[deletedAtField]}`,
    );
  }
}

export async function expectCascadeSoftDeleted(
  prisma: any,
  parentModel: string,
  where: Record<string, any>,
  childModels: string[],
  deletedAtField = 'deletedAt',
): Promise<void> {
  const parentKey = parentModel.charAt(0).toLowerCase() + parentModel.slice(1);
  await expectSoftDeleted(prisma[parentKey], where, deletedAtField);

  for (const childModel of childModels) {
    const childKey = childModel.charAt(0).toLowerCase() + childModel.slice(1);
    const deletedChildren = await SoftDeleteContext.run(
      { filterMode: 'onlyDeleted', skipSoftDelete: false },
      () => prisma[childKey].findMany({ where: { [deletedAtField]: { not: null } } }),
    );

    if (deletedChildren.length === 0) {
      throw new Error(
        `Expected "${childModel}" to have cascade soft-deleted records, but found none`,
      );
    }
  }
}
