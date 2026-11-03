'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@vyra/ui';

export function QuantityStepper({
  value,
  min = 1,
  max = 10,
  onChange,
  disabled,
  label = 'Quantity',
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex h-8 items-center rounded-md border border-border-strong',
        className,
      )}
    >
      <button
        type="button"
        className="flex size-8 items-center justify-center text-fg hover:bg-surface-2 disabled:opacity-40"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
      >
        <Minus className="size-3.5" aria-hidden />
      </button>
      <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="flex size-8 items-center justify-center text-fg hover:bg-surface-2 disabled:opacity-40"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
