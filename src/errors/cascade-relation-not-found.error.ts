export class CascadeRelationNotFoundError extends Error {
  constructor(parent: string, child: string) {
    super(
      `Cannot find a relation from "${child}" to "${parent}" in Prisma DMMF. ` +
      `Ensure "${child}" has a @relation field pointing to "${parent}".`,
    );
    this.name = 'CascadeRelationNotFoundError';
  }
}
