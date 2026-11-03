import { formatINR } from '@vyra/shared';

export { formatINR };

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const numFmt = new Intl.NumberFormat('en-IN');

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const formatDate = (v: string | Date | null | undefined) => { const d = toDate(v); return d ? dateFmt.format(d) : '—'; };
export const formatDateTime = (v: string | Date | null | undefined) => { const d = toDate(v); return d ? dateTimeFmt.format(d) : '—'; };
export const formatTime = (v: string | Date | null | undefined) => { const d = toDate(v); return d ? timeFmt.format(d) : '—'; };
export const formatNumber = (n: number | null | undefined) => (n === null || n === undefined ? '—' : numFmt.format(n));

/** Compact INR for chart axes: ₹1.2L, ₹3.4Cr. */
export function formatINRCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `₹${Math.round(n)}`;
}

export function humanize(value: string): string {
  return value.toLowerCase().split('_').map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/** yyyy-mm-dd in local time, for <input type="date">. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

/** Converts a yyyy-mm-dd day to an ISO timestamp at local start/end of day. */
export function dayToIso(day: string, edge: 'start' | 'end'): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${edge === 'start' ? '00:00:00' : '23:59:59.999'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
