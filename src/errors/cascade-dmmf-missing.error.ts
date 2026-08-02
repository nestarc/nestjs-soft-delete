export class CascadeDmmfMissingError extends Error {
  constructor() {
    super(
      'Cascade soft-delete requires Prisma DMMF metadata, but none was provided. ' +
        'Pass DMMF via the dmmf option, or disable cascade.',
    );
    this.name = 'CascadeDmmfMissingError';
  }
}
