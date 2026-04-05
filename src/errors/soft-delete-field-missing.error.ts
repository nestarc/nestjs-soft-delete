export class SoftDeleteFieldMissingError extends Error {
  constructor(model: string, field: string) {
    super(
      `Model "${model}" is listed in softDeleteModels but does not have a "${field}" field. ` +
      `Add "${field} DateTime? @map("${field.replace(/([A-Z])/g, '_$1').toLowerCase()}")" to your Prisma schema.`,
    );
    this.name = 'SoftDeleteFieldMissingError';
  }
}
