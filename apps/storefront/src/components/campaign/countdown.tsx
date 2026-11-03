'use client';

import * as React from 'react';
import { cn } from '@vyra/ui';
import { splitRemaining } from '@/lib/campaigns';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Ticks down to `target` (the campaign's countdownTo, nothing else). Renders
 * nothing until mounted so server HTML and the first client render match, and
 * nothing once the target has passed: it calls `onExpire` once so the caller
 * can refetch the campaign instead of showing a negative or frozen timer.
 */
export function Countdown({
  target,
  label,
  onExpire,
  className,
}: {
  target: string;
  label: string;
  onExpire?: () => void;
  className?: string;
}) {
  const deadline = React.useMemo(() => new Date(target).getTime(), [target]);
  const [now, setNow] = React.useState<number | null>(null);
  const expired = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;

  React.useEffect(() => {
    expired.current = false;
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const remaining = now === null || Number.isNaN(deadline) ? null : deadline - now;
  React.useEffect(() => {
    if (remaining !== null && remaining <= 0 && !expired.current) {
      expired.current = true;
      onExpireRef.current?.();
    }
  }, [remaining]);

  if (remaining === null || remaining <= 0) return null;
  const { days, hours, minutes, seconds } = splitRemaining(remaining);
  const parts = days > 0 ? [`${days}d`, `${pad(hours)}h`, `${pad(minutes)}m`] : [`${pad(hours)}h`, `${pad(minutes)}m`, `${pad(seconds)}s`];
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 text-sm', className)} data-testid="campaign-countdown">
      <span>{label}</span>
      {/* Screen readers get the whole phrase once, not a ticking announcement. */}
      <time dateTime={new Date(deadline).toISOString()} className="font-bold tabular-nums">
        {parts.join(' ')}
      </time>
    </p>
  );
}
