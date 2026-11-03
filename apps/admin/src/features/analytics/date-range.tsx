'use client';
import * as React from 'react';
import { Button, Input } from '@vyra/ui';
import { daysAgo, isoDay } from '@/lib/format';

export const RANGE_PRESETS = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }, { label: '12m', days: 365 }] as const;

/** From/to day inputs plus 7d/30d/90d/12m presets (yyyy-mm-dd, local time). Shared by the analytics screens. */
export function DateRangeControl({ from, to, onChange, onPreset }: {
  from: string; to: string;
  onChange: (next: { from?: string; to?: string }) => void;
  /** Called instead of onChange when a preset is picked (lets callers also adjust e.g. granularity). */
  onPreset?: (range: { from: string; to: string }, days: number) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => onChange({ from: e.target.value })} className="h-9 w-40" />
        <span className="text-xs text-muted">to</span>
        <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => onChange({ to: e.target.value })} className="h-9 w-40" />
      </div>
      <div className="flex gap-1">
        {RANGE_PRESETS.map((p) => {
          const range = { from: daysAgo(p.days - 1), to: isoDay(new Date()) };
          return (
            <Button key={p.label} variant="ghost" size="sm" onClick={() => (onPreset ? onPreset(range, p.days) : onChange(range))}>{p.label}</Button>
          );
        })}
      </div>
    </>
  );
}
