'use client';
import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatINR, formatINRCompact, formatNumber } from '@/lib/format';

const SERIES = '#7c3aed';
const GRID = '#eaeaea';
const AXIS = '#a3a3a3';

export interface SeriesPoint { label: string; value: number }

function TooltipBox({ active, payload, label, money }: { active?: boolean; payload?: { value?: number | string }[]; label?: string | number; money: boolean }) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs shadow-pop">
      <p className="text-muted">{label}</p>
      <p className="tabular mt-0.5 text-sm font-semibold text-fg">{money ? formatINR(v) : formatNumber(v)}</p>
    </div>
  );
}

/** Single-series time chart (area for money, bars for counts). One axis only. */
export function TimeSeriesChart({ data, kind, money, height = 260, ariaLabel }: {
  data: SeriesPoint[]; kind: 'area' | 'bar'; money: boolean; height?: number; ariaLabel: string;
}) {
  const tick = { fontSize: 11, fill: AXIS };
  const yFmt = (v: number) => (money ? formatINRCompact(v) : formatNumber(v));
  const id = React.useId().replace(/:/g, '');
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
                <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={yFmt} width={56} />
            <Tooltip content={<TooltipBox money={money} />} cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} />
            <Area type="monotone" dataKey="value" stroke={SERIES} strokeWidth={2} fill={`url(#g-${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={yFmt} width={48} allowDecimals={false} />
            <Tooltip content={<TooltipBox money={money} />} cursor={{ fill: 'rgb(23 23 23 / 0.04)' }} />
            <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal magnitude bars rendered in HTML (labels never collide; readable as a list). */
export function BarList({ items, money }: { items: { label: string; value: number; secondary?: string }[]; money?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{i.label}</span>
            <span className="tabular shrink-0 font-medium">
              {money ? formatINR(i.value) : formatNumber(i.value)}
              {i.secondary && <span className="ml-2 text-xs font-normal text-muted">{i.secondary}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
