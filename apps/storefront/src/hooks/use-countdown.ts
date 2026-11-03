'use client';

import * as React from 'react';

/**
 * Seconds-remaining countdown. `start(n)` (re)starts it; `remaining` ticks
 * down once per second to 0. Uses wall-clock deadlines so a backgrounded tab
 * doesn't drift.
 */
export function useCountdown(initialSeconds = 0) {
  const [deadline, setDeadline] = React.useState<number | null>(() =>
    initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : null,
  );
  const compute = React.useCallback(
    (d: number | null) => (d === null ? 0 : Math.max(0, Math.ceil((d - Date.now()) / 1000))),
    [],
  );
  const [remaining, setRemaining] = React.useState(() => compute(deadline));

  React.useEffect(() => {
    setRemaining(compute(deadline));
    if (deadline === null) return;
    const id = setInterval(() => {
      const r = compute(deadline);
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, compute]);

  const start = React.useCallback((seconds: number) => {
    setDeadline(seconds > 0 ? Date.now() + seconds * 1000 : null);
  }, []);

  return { remaining, start };
}
