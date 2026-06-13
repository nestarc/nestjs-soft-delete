export class RelationDmmfMissingError extends Error {
  constructor() {
    super(
      'Relation read filters require Prisma DMMF metadata, but none was provided. ' +
        'Prisma 7 no longer exposes Prisma.dmmf. Pass DMMF via the dmmf option, ' +
        'or disable relationFilters.',
    );
    this.name = 'RelationDmmfMissingError';
  }
}
