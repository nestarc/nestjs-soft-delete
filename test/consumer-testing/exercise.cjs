const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');

const dmmf = { datamodel: { models: [
  { name: 'User', fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }] },
  { name: 'Post', fields: [
    { name: 'id', kind: 'scalar', type: 'String', isId: true },
    { name: 'authorId', kind: 'scalar', type: 'String' },
    { name: 'author', kind: 'object', type: 'User', relationFromFields: ['authorId'], relationToFields: ['id'] },
  ] },
] } };

module.exports = async function exercise(root, testing) {
  const deletedAt = new Date('2026-10-29T00:00:00.000Z');
  const parent = { id: 'user-1', deletedAt };
  const children = [
    { id: 'recent-child', authorId: parent.id, deletedAt },
    { id: 'old-child', authorId: parent.id, deletedAt: new Date(deletedAt.getTime() - 5000) },
    { id: 'other-parent', authorId: 'user-2', deletedAt },
  ];
  const observedModes = [];
  const extension = root.createPrismaSoftDeleteExtension({ softDeleteModels: ['User', 'Post'] })({
    $extends: definition => definition,
  });
  const queries = extension.query.$allModels;
  const matches = (row, where) => row.authorId === where.authorId && row.deletedAt &&
    row.deletedAt >= where.deletedAt.gte && row.deletedAt <= where.deletedAt.lte;
  const prisma = {
    user: {
      async findFirst(args) {
        return queries.findFirst({ model: 'User', args, query: async filtered => {
          await Promise.resolve();
          observedModes.push(root.SoftDeleteContext.getFilterMode());
          return filtered.where.deletedAt === null ? null : { ...parent };
        } });
      },
      async update({ data }) { Object.assign(parent, data); return { ...parent }; },
    },
    post: {
      async findMany({ where }) { return children.filter(row => matches(row, where)).map(row => ({ ...row })); },
      async updateMany({ where, data }) {
        const selected = children.filter(row => matches(row, where));
        selected.forEach(row => Object.assign(row, data));
        return { count: selected.length };
      },
    },
  };

  const module = await Test.createTestingModule({
    imports: [testing.TestSoftDeleteModule.register({
      softDeleteModels: ['User', 'Post'], cascade: { User: ['Post'] }, dmmf,
    }, prisma)],
  }).compile();
  try {
    const service = module.get(root.SoftDeleteService);
    assert.ok(service instanceof root.SoftDeleteService, 'testing module exports the root class token');
    assert.equal(module.get(root.SOFT_DELETE_PRISMA_SERVICE), prisma, 'Prisma injection token is shared');
    assert.deepEqual(module.get(root.SOFT_DELETE_MODULE_OPTIONS).cascade, { User: ['Post'] });
    assert.ok(module.get(root.SoftDeleteEventEmitter) instanceof root.SoftDeleteEventEmitter);

    await testing.expectSoftDeleted(prisma.user, { id: parent.id });
    assert.deepEqual(observedModes, ['withDeleted'], 'assertion and root runtime share async context');
    assert.equal(root.SoftDeleteContext.getFilterMode(), 'default', 'assertion context is restored');
    await testing.expectCascadeSoftDeleted({
      user: prisma.user,
      post: { async findMany(args) {
        return queries.findMany({ model: 'Post', args, query: async filtered => {
          await Promise.resolve();
          assert.equal(root.SoftDeleteContext.getFilterMode(), 'onlyDeleted');
          assert.deepEqual(filtered.where.deletedAt, { not: null });
          return children;
        } });
      } },
    }, 'User', { id: parent.id }, ['Post']);

    await service.restore('User', { id: parent.id });
    assert.equal(parent.deletedAt, null);
    assert.equal(children[0].deletedAt, null, 'testing module restores configured cascade');
    assert.notEqual(children[1].deletedAt, null, 'old deleted child remains deleted');
    assert.notEqual(children[2].deletedAt, null, 'another parent is untouched');
    assert.equal(root.SoftDeleteContext.getFilterMode(), 'default');
  } finally {
    await module.close();
  }

  await assert.rejects(() => Test.createTestingModule({
    imports: [testing.TestSoftDeleteModule.register({
      softDeleteModels: ['User', 'Post'], cascade: { User: ['Post'] },
    }, prisma)],
  }).compile(), root.CascadeDmmfMissingError);

  const withoutCascade = await Test.createTestingModule({
    imports: [testing.TestSoftDeleteModule.register({ softDeleteModels: ['User'] }, prisma)],
  }).compile();
  try {
    assert.ok(withoutCascade.get(root.SoftDeleteService) instanceof root.SoftDeleteService);
  } finally {
    await withoutCascade.close();
  }
};
