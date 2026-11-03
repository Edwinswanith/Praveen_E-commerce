'use client';
import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/**
 * Filter state persisted in the URL query string (shareable, survives back nav).
 * Setting any non-page key resets `page` to 1.
 */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const defaultsRef = React.useRef(defaults);

  const state = React.useMemo(() => {
    const out = { ...defaultsRef.current };
    for (const key of Object.keys(out) as K[]) {
      const v = params.get(key);
      if (v !== null) out[key] = v;
    }
    return out;
  }, [params]);

  const set = React.useCallback(
    (patch: Partial<Record<K, string>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (v === undefined || v === '' || v === defaultsRef.current[k]) next.delete(k);
        else next.set(k, v);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return [state, set] as const;
}
