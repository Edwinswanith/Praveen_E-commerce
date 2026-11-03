'use client';

import * as React from 'react';

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
