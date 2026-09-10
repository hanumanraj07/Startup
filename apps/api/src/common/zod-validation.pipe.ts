import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { ValidationError } from './errors';

/**
 * Validates a request payload against a shared Zod schema.
 *
 * The schemas come from @onsite/validation and are shared with the web app, so
 * client and server cannot disagree about what is valid. Zod strips unknown
 * keys, which is what stops a client smuggling a commission or a status into a
 * create call. See docs/16-security-requirements.md.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.') || '_';
        fields[path] ??= issue.message;
      }
      throw new ValidationError('The submitted values are not valid.', { fields });
    }

    return result.data;
  }
}

/** Convenience factory: `@UsePipes(zodPipe(createTaskSchema))`. */
export const zodPipe = (schema: ZodSchema) => new ZodValidationPipe(schema);
