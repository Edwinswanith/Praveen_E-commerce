import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api';

/**
 * Maps an API VALIDATION_FAILED response onto react-hook-form fields.
 * Returns a message for anything that couldn't be attached to a field (or null).
 */
export function applyApiErrors<T extends FieldValues>(
  e: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (e instanceof ApiError) {
    const fe = e.fieldErrors;
    let attached = 0;
    for (const [key, messages] of Object.entries(fe)) {
      const msg = messages?.[0];
      if (!msg) continue;
      // Nested paths like "address.pincode" map to the leaf field when the form is flat.
      const name = fields.includes(key) ? key : fields.find((f) => key.endsWith(`.${f}`));
      if (name) {
        setError(name as Path<T>, { type: 'server', message: msg });
        attached++;
      }
    }
    const formErrors = (e.details as { formErrors?: string[] } | undefined)?.formErrors;
    if (attached > 0) return formErrors?.[0] ?? null;
    return formErrors?.[0] ?? e.message;
  }
  return errorMessage(e);
}
