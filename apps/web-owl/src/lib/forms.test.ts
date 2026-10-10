import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldErrors } from './forms';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters').regex(/\d/, 'Needs a digit'),
  token: z.string().min(1),
});

function failure(input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected a failure');
  return result.error;
}

describe('fieldErrors', () => {
  it('maps each named field to its message', () => {
    const errors = fieldErrors(failure({ email: 'nope', password: 'short', token: 'x' }), ['email', 'password']);
    expect(errors).toEqual({ email: 'Enter a valid email address', password: 'Use at least 10 characters' });
  });

  it('keeps only the first message when a field fails several rules', () => {
    const errors = fieldErrors(failure({ email: 'a@b.co', password: 'short', token: 'x' }), ['password']);
    expect(errors.password).toBe('Use at least 10 characters');
  });

  it('ignores issues on fields that were not asked for', () => {
    const errors = fieldErrors(failure({ email: 'a@b.co', password: 'longenough1', token: '' }), ['email', 'password']);
    expect(errors).toEqual({});
  });

  it('returns nothing for a field with no issue', () => {
    expect(fieldErrors(failure({ email: 'nope', password: 'longenough1', token: 'x' }), ['password'])).toEqual({});
  });
});
