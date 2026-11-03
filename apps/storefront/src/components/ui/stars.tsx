import { Star } from 'lucide-react';
import { cn } from '@vyra/ui';

export function RatingPill({
  rating,
  count,
  className,
}: {
  rating: number;
  count?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-fg',
        className,
      )}
    >
      {rating.toFixed(1)}
      <Star className="size-3 fill-teal-500 text-teal-500" aria-hidden />
      {count !== undefined && (
        <span className="font-normal text-muted">
          | {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
        </span>
      )}
      <span className="sr-only">out of 5{count !== undefined ? `, ${count} ratings` : ''}</span>
    </span>
  );
}

export function Stars({
  value,
  className,
  size = 'sm',
}: {
  value: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const s = size === 'sm' ? 'size-3.5' : 'size-5';
  return (
    <span
      className={cn('inline-flex', className)}
      aria-label={`${value} out of 5 stars`}
      role="img"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(
            s,
            i <= Math.round(value) ? 'fill-sun-400 text-sun-400' : 'text-border-strong',
          )}
        />
      ))}
    </span>
  );
}
