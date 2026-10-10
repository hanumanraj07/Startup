import type { ZodError } from 'zod';

/** The first validation message for each named field, ignoring issues on any other path. */
export function fieldErrors<K extends string>(error: ZodError, fields: readonly K[]): Partial<Record<K, string>> {
  const errors: Partial<Record<K, string>> = {};
  for (const issue of error.issues) {
    const head = issue.path[0];
    const field = fields.find((name) => name === head);
    if (field !== undefined && errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}
