/**
 * Festival campaign time logic. Pure functions so every boundary second is
 * testable. A campaign's phase is ALWAYS derived from the clock (never a flag
 * flipped by a job), so a missed scheduler run can't leave a sale stuck "on".
 *
 * Windows are half-open: startsAt <= t < endsAt. Times are stored as UTC
 * instants; admins enter and customers see them in IST (Asia/Kolkata).
 */

/** Stored status: what the admin decided. */
export const CampaignStatus = { DRAFT: 'DRAFT', SCHEDULED: 'SCHEDULED', PAUSED: 'PAUSED', CANCELLED: 'CANCELLED' } as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

/** Derived phase: what is true right now. */
export type CampaignPhase = 'DRAFT' | 'UPCOMING' | 'TEASER' | 'EARLY_ACCESS' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED';

export interface CampaignWindow {
  status: CampaignStatus;
  teaserStartsAt?: Date | string | null;
  earlyAccessStartsAt?: Date | string | null;
  startsAt: Date | string;
  endsAt: Date | string;
}

const t = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());

export function computeCampaignPhase(c: CampaignWindow, at: Date = new Date()): CampaignPhase {
  if (c.status === 'DRAFT') return 'DRAFT';
  if (c.status === 'CANCELLED') return 'CANCELLED';
  const now = at.getTime();
  const end = t(c.endsAt)!;
  if (now >= end) return 'ENDED';
  if (c.status === 'PAUSED') return 'PAUSED';
  const start = t(c.startsAt)!;
  if (now >= start) return 'LIVE';
  const early = t(c.earlyAccessStartsAt);
  if (early != null && now >= early) return 'EARLY_ACCESS';
  const teaser = t(c.teaserStartsAt);
  if (teaser != null && now >= teaser) return 'TEASER';
  return 'UPCOMING';
}

/** Phases in which the campaign is publicly visible (banners, landing page). */
export const VISIBLE_PHASES: CampaignPhase[] = ['TEASER', 'EARLY_ACCESS', 'LIVE'];

/** Can this shopper buy at the sale price right now? */
export function salePriceAvailable(phase: CampaignPhase, hasEarlyAccess: boolean): boolean {
  return phase === 'LIVE' || (phase === 'EARLY_ACCESS' && hasEarlyAccess);
}

/** Next instant the phase changes (for countdowns and scheduling), or null. */
export function nextBoundary(c: CampaignWindow, at: Date = new Date()): Date | null {
  const now = at.getTime();
  const ts = [t(c.teaserStartsAt), t(c.earlyAccessStartsAt), t(c.startsAt), t(c.endsAt)].filter((x): x is number => x != null && x > now).sort((a, b) => a - b);
  return ts[0] != null ? new Date(ts[0]) : null;
}

export interface CampaignPriceOffer {
  campaignId: string;
  campaignName: string;
  campaignSlug: string;
  priority: number;
  /** paise */
  salePrice: number;
  phase: CampaignPhase;
  endsAt: Date | string;
  /** Stock cap reached for this deal. */
  soldOut: boolean;
}

export interface ResolvedPrice {
  /** paise: what this shopper pays per unit now */
  price: number;
  /** paise: regular price without any campaign */
  basePrice: number;
  campaign: null | { id: string; name: string; slug: string; endsAt: string };
}

/**
 * Best price for one variant across all campaigns. A campaign price applies
 * only while buyable for this shopper, not sold out, and below the regular price.
 * Never above MRP. Overlaps: lowest price wins; ties go to higher priority.
 */
export function resolveSalePrice(base: { price: number; mrp: number }, offers: CampaignPriceOffer[], ctx: { hasEarlyAccess: boolean }): ResolvedPrice {
  const regular = Math.min(base.price, base.mrp);
  const usable = offers
    .filter((o) => salePriceAvailable(o.phase, ctx.hasEarlyAccess) && !o.soldOut && o.salePrice < regular && o.salePrice >= 0)
    .sort((a, b) => a.salePrice - b.salePrice || b.priority - a.priority);
  const best = usable[0];
  if (!best) return { price: regular, basePrice: regular, campaign: null };
  return { price: best.salePrice, basePrice: regular, campaign: { id: best.campaignId, name: best.campaignName, slug: best.campaignSlug, endsAt: new Date(best.endsAt).toISOString() } };
}

export interface WindowProblem { field: string; message: string }

/** Validates the phase order and sane durations. */
export function validateCampaignWindow(c: { teaserStartsAt?: Date | null; earlyAccessStartsAt?: Date | null; startsAt: Date; endsAt: Date }): WindowProblem[] {
  const p: WindowProblem[] = [];
  const s = c.startsAt.getTime(), e = c.endsAt.getTime();
  if (!(e > s)) p.push({ field: 'endsAt', message: 'End must be after start' });
  if (e - s > 45 * 86400_000) p.push({ field: 'endsAt', message: 'A sale can run at most 45 days' });
  if (c.earlyAccessStartsAt) {
    const ea = c.earlyAccessStartsAt.getTime();
    if (!(ea < s)) p.push({ field: 'earlyAccessStartsAt', message: 'Early access must start before the sale' });
    if (s - ea > 72 * 3600_000) p.push({ field: 'earlyAccessStartsAt', message: 'Early access can be at most 72 hours' });
  }
  if (c.teaserStartsAt) {
    const firstSale = (c.earlyAccessStartsAt ?? c.startsAt).getTime();
    if (!(c.teaserStartsAt.getTime() < firstSale)) p.push({ field: 'teaserStartsAt', message: 'The teaser must start before early access / the sale' });
  }
  return p;
}

/** "9 Oct, 12:00 am IST" style formatting for customer-facing copy. */
export function formatIST(d: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d)) + ' IST';
}

/**
 * Sale price for a bulk "X% off the regular price" rule, in paise. Rounded
 * DOWN (never up), optionally to a price ending in 9 (₹712 → ₹709, ₹700 → ₹699),
 * so the real discount is always at least the stated percentage.
 */
export function bulkSalePrice(regularPaise: number, percentOff: number, roundToNine: boolean): number {
  const raw = Math.floor((regularPaise * (100 - percentOff)) / 100);
  if (!roundToNine) return raw;
  const rupees = Math.floor(raw / 100);
  const nine = Math.floor((rupees + 1) / 10) * 10 - 1;
  return (nine > 0 ? nine : rupees) * 100;
}
