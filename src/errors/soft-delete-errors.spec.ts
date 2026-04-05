import { describe, it, expect } from 'vitest';
import { SoftDeleteFieldMissingError } from './soft-delete-field-missing.error';
import { CascadeRelationNotFoundError } from './cascade-relation-not-found.error';

describe('SoftDeleteFieldMissingError', () => {
  it('should include model name and field name in message', () => {
    const error = new SoftDeleteFieldMissingError('User', 'deletedAt');
    expect(error.message).toContain('User');
    expect(error.message).toContain('deletedAt');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SoftDeleteFieldMissingError');
  });
});

describe('CascadeRelationNotFoundError', () => {
  it('should include parent and child model names in message', () => {
    const error = new CascadeRelationNotFoundError('User', 'Post');
    expect(error.message).toContain('User');
    expect(error.message).toContain('Post');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CascadeRelationNotFoundError');
  });
});
