import type { PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

/**
 * Validates a body, query or param against a contract schema. The ZodError is
 * left to `ApiExceptionFilter`, which turns its issues into JSON-pointer details.
 *
 * Used as `@Body(new ZodValidationPipe(createProjectRequestSchema))` so the
 * schema in `@apion/contracts` is the only definition of what a request may
 * contain: the same object the SPA validates against before it sends.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
