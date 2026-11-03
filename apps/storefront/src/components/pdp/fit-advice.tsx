import { Ruler } from 'lucide-react';
import type { FitSummaryDto } from '@vyra/shared';
import { cn } from '@vyra/ui';

const SEGMENTS = [
  { key: 'runsSmall', label: 'Runs small', cls: 'bg-sun-400' },
  { key: 'trueToSize', label: 'True to size', cls: 'bg-teal-500' },
  { key: 'runsLarge', label: 'Runs large', cls: 'bg-violet-500' },
] as const;

/** Review-based fit advice shown beside the size selector (only when the API has enough data). */
export function FitAdvice({ fit, className }: { fit: FitSummaryDto | null | undefined; className?: string }) {
  if (!fit?.advice || fit.total <= 0) return null;
  const pct = (n: number) => Math.round((n / fit.total) * 100);
  const summary = SEGMENTS.map((s) => `${pct(fit[s.key])}% ${s.label.toLowerCase()}`).join(', ');
  return (
    <div className={cn('rounded-md border border-border bg-surface p-3', className)} data-testid="fit-advice">
      <p className="flex items-start gap-2 text-sm">
        <Ruler className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <span>
          <strong className="font-semibold">Fit: </strong>
          {fit.advice}
        </span>
      </p>
      <div
        className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`Based on ${fit.total} reviews: ${summary}`}
      >
        {SEGMENTS.map((s) => (
          <span key={s.key} className={cn('h-full', s.cls)} style={{ width: `${pct(fit[s.key])}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        {SEGMENTS.map((s) => (
          <span key={s.key}>
            {s.label} {pct(fit[s.key])}%
          </span>
        ))}
      </div>
    </div>
  );
}
