export class CascadeDmmfMissingError extends Error {
  constructor() {
    super(
      'Cascade soft-delete requires Prisma DMMF metadata, but none was provided. ' +
        'Prisma 7 no longer exposes Prisma.dmmf. Pass DMMF via the dmmf option, ' +
        'or disable cascade.',
    );
    this.name = 'CascadeDmmfMissingError';
  }
}
