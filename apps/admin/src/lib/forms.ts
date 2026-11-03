import type { FieldValues, UseFormSetError } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError } from './api';

type LooseSetError = (name: string, error: { type: string; message: string }, opts?: { shouldFocus?: boolean }) => void;

/** Recursively converts '' to null so optional+nullable zod fields accept blank inputs. */
export function blankToNull<T>(value: T): T {
  if (value === '') return null as T;
  if (Array.isArray(value)) return value.map(blankToNull) as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof File)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, blankToNull(v)])) as T;
  }
  return value;
}

/** Validates with a zod schema; on failure, maps issues onto react-hook-form fields and returns null. */
export function parseOrSetErrors<S extends z.ZodType, F extends FieldValues>(
  schema: S,
  values: unknown,
  setError: UseFormSetError<F>,
): z.output<S> | null {
  const result = schema.safeParse(values);
  if (result.success) return result.data;
  const set = setError as unknown as LooseSetError;
  let first = true;
  for (const issue of result.error.issues) {
    const name = issue.path.map(String).join('.') || 'root';
    set(name === 'root' ? 'root.server' : name, { type: 'validate', message: issue.message }, { shouldFocus: first });
    first = false;
  }
  return null;
}

/**
 * Maps an API VALIDATION_FAILED error's `details.fieldErrors` onto form fields.
 * Returns true if any field error was applied (otherwise caller should toast).
 */
export function applyApiErrors<F extends FieldValues>(err: unknown, setError: UseFormSetError<F>, knownFields?: string[]): boolean {
  if (!(err instanceof ApiError)) return false;
  const fe = err.fieldErrors;
  const set = setError as unknown as LooseSetError;
  let applied = false;
  if (fe) {
    for (const [field, messages] of Object.entries(fe)) {
      if (!messages?.length) continue;
      if (knownFields && !knownFields.includes(field.split('.')[0] ?? field)) continue;
      set(field, { type: 'server', message: messages[0] ?? 'Invalid value' });
      applied = true;
    }
  }
  const formErr = err.formErrors[0];
  if (formErr) {
    set('root.server', { type: 'server', message: formErr });
    applied = true;
  }
  return applied;
}

/** Formats API fieldErrors (e.g. "variants.2.price") as a flat list for display. */
export function flattenFieldErrors(err: unknown): { field: string; message: string }[] {
  if (!(err instanceof ApiError) || !err.fieldErrors) return [];
  return Object.entries(err.fieldErrors).flatMap(([field, msgs]) => (msgs ?? []).map((message) => ({ field, message })));
}

export const numOrNull = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
