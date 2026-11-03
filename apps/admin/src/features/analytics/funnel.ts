import type { FunnelDto, FunnelStepDto } from '@vyra/shared';

/** Pure helpers for the Conversion screen (GET /admin/analytics/funnel). All rates are percentages (0–100). */

export type FunnelStep = FunnelStepDto['step'];
export type FunnelProduct = FunnelDto['products'][number];

export const STEP_LABEL: Record<FunnelStep, string> = {
  PRODUCT_VIEW: 'Viewed product',
  ADD_TO_CART: 'Added to bag',
  CHECKOUT_STARTED: 'Started checkout',
  ORDER_PLACED: 'Ordered',
};

/** "…of shoppers who <from> never <to>" phrasing for each transition (keyed by the step being reached). */
const LEAK_PHRASE: Record<Exclude<FunnelStep, 'PRODUCT_VIEW'>, string> = {
  ADD_TO_CART: 'view a product never add it to bag',
  CHECKOUT_STARTED: 'add to bag never start checkout',
  ORDER_PLACED: 'start checkout never place an order',
};

export interface Leak {
  from: FunnelStep;
  to: Exclude<FunnelStep, 'PRODUCT_VIEW'>;
  /** Sessions at `from` that never reached `to`. */
  lost: number;
  /** Share of `from` sessions lost, 0–100 (rounded to 1 decimal). */
  dropPct: number;
}

/** Drop-off between consecutive steps; never negative (a later step can exceed an earlier one when events are missing). */
export function dropOffs(steps: FunnelStepDto[]): Leak[] {
  const out: Leak[] = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!;
    const cur = steps[i]!;
    if (cur.step === 'PRODUCT_VIEW') continue;
    const lost = Math.max(0, prev.sessions - cur.sessions);
    const dropPct = prev.sessions ? Math.round((lost / prev.sessions) * 1000) / 10 : 0;
    out.push({ from: prev.step, to: cur.step, lost, dropPct });
  }
  return out;
}

/** The transition losing the largest share of shoppers (earliest wins ties); null when nothing is lost. */
export function biggestLeak(steps: FunnelStepDto[]): Leak | null {
  let best: Leak | null = null;
  for (const d of dropOffs(steps)) {
    if (d.lost > 0 && (!best || d.dropPct > best.dropPct)) best = d;
  }
  return best;
}

export function leakMessage(leak: Leak): string {
  return `Biggest leak: ${Math.round(leak.dropPct)}% of shoppers who ${LEAK_PHRASE[leak.to]}`;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** First-touch source label: `tag` = garment-tag QR scan, `direct` = no utm_source. */
export function sourceLabel(source: string): string {
  const s = source.trim().toLowerCase();
  if (s === 'tag') return 'Garment tag QR';
  if (s === 'direct' || s === '' || s === 'unknown') return 'Direct / unknown';
  return capitalize(source.trim().replace(/[_-]+/g, ' '));
}

export function deviceLabel(device: string): string {
  return device === 'unknown' || !device ? 'Unknown' : capitalize(device);
}

export const LOW_INTEREST_MIN_VIEWS = 20;
export const LOW_INTEREST_MAX_RATE = 5;

/** Enough traffic to judge, but almost nobody adds it to bag: photos, price or sizing likely off-putting. */
export function isLowInterest(p: Pick<FunnelProduct, 'views' | 'viewToCartRate'>): boolean {
  return p.views >= LOW_INTEREST_MIN_VIEWS && p.viewToCartRate < LOW_INTEREST_MAX_RATE;
}

export interface TryOnUplift {
  /** Percentage-point difference (try-on conversion − overall conversion). */
  points: number;
  /** Relative multiplier (try-on ÷ overall), null when overall is 0. */
  ratio: number | null;
}

/** null when no session used try-on (nothing to compare). */
export function tryOnUplift(tryOn: FunnelDto['tryOn'], overallRate: number): TryOnUplift | null {
  if (tryOn.sessions === 0) return null;
  return {
    points: Math.round((tryOn.conversionRate - overallRate) * 10) / 10,
    ratio: overallRate > 0 ? Math.round((tryOn.conversionRate / overallRate) * 10) / 10 : null,
  };
}

export const QUOTA_WARN_PCT = 80;

export function quotaUsage(usedToday: number, dailyLimit: number): { pct: number; warn: boolean } {
  if (dailyLimit <= 0) return { pct: 0, warn: false };
  const exact = (usedToday / dailyLimit) * 100;
  // Warn on the exact ratio (79.5% must not round up into a warning).
  return { pct: Math.floor(exact), warn: exact >= QUOTA_WARN_PCT };
}

/** True when no shopper event was recorded in the range (tracking only started with v1.2). */
export function hasNoEvents(d: FunnelDto): boolean {
  return d.steps.every((s) => s.sessions === 0) && d.daily.every((x) => x.sessions === 0) && d.tryOn.total === 0;
}
