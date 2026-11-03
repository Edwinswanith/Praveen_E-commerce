'use client';
import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

export interface LineSeries { key: string; label: string; color: string }

function MultiTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey?: string | number; value?: number | string }[]; label?: string | number; series: LineSeries[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs shadow-pop">
      <p className="text-muted">{label}</p>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <p key={s.key} className="mt-0.5 flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="tabular ml-auto pl-3 font-semibold text-fg">{formatNumber(Number(v ?? 0))}</span>
          </p>
        );
      })}
    </div>
  );
}

/** Several count series over time on ONE shared axis, with a legend (identity never by colour alone). */
export function MultiLineChart({ data, series, height = 260, ariaLabel }: {
  data: (Record<string, number | string> & { label: string })[]; series: LineSeries[]; height?: number; ariaLabel: string;
}) {
  const tick = { fontSize: 11, fill: AXIS };
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}</li>
        ))}
      </ul>
      <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} width={48} allowDecimals={false} />
            <Tooltip content={<MultiTooltip series={series} />} cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 1 ? { r: 4 } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
