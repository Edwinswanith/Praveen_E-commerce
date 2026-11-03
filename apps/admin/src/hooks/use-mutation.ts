'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';

/** Wraps an async action with pending state and error toasts. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); toastErrors?: boolean } = {}) {
  const [pending, setPending] = React.useState(false);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  const run = React.useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      try {
        const r = await fnRef.current(...args);
        if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
        return r;
      } catch (err) {
        if (opts.toastErrors !== false) toast.error(errorMessage(err));
        else throw err;
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.toastErrors],
  );
  return { run, pending };
}
