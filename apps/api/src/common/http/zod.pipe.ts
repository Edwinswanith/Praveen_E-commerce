import { HttpStatus, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from './errors';

export function zodDetails(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    if (issue.path.length === 0) formErrors.push(issue.message);
    else (fieldErrors[issue.path.join('.')] ??= []).push(issue.message);
  }
  return { fieldErrors, formErrors };
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const d = zodDetails(r.error);
    const first = Object.entries(d.fieldErrors)[0];
    const msg = first ? `${first[0]}: ${first[1][0]}` : d.formErrors[0] ?? 'Invalid input';
    throw new AppError('VALIDATION_FAILED', msg, HttpStatus.UNPROCESSABLE_ENTITY, d);
  }
  return r.data;
}

/** `@Body(new ZodPipe(schema))` */
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return parseOrThrow(this.schema, value);
  }
}
