import { readFileSync } from 'node:fs';
import { getDMMF } from '@prisma/internals';

export const prismaDmmf = await getDMMF({
  datamodel: readFileSync('test/prisma/schema.prisma', 'utf8'),
});
