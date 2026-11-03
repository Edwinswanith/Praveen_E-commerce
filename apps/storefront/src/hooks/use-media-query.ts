'use client';

import * as React from 'react';

/** Subscribes to a CSS media query. `false` during SSR and the first client render. */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
