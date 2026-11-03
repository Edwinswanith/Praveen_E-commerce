import type { CampaignPhase, CampaignPublicDto } from '@vyra/shared';

/**
 * Display helpers for festival sales. Every claim here is derived from the
 * campaign payload: no invented percentages, no invented deadlines.
 */

export const CURRENT_CAMPAIGNS_KEY = '/campaigns/current';
export const campaignKey = (slug: string) => `/campaigns/${encodeURIComponent(slug)}`;
export const campaignProductsKey = (slug: string, limit = 48) =>
  `/campaigns/${encodeURIComponent(slug)}/products?limit=${limit}`;

/** Brand ink (tokens.css --color-fg): the fallback banner background. */
export const BRAND_INK = '#171717';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance contrast ratio, or null for an unparseable colour. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const lum = ([r, g, bl]: [number, number, number]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Banner colours: the campaign theme colour behind white text when that pair
 * meets WCAG AA (4.5:1) for normal text; otherwise brand ink.
 */
export function bannerColors(themeColor: string | null | undefined): { background: string; color: string } {
  const ratio = themeColor ? contrastRatio(themeColor, '#ffffff') : null;
  if (themeColor && ratio !== null && ratio >= 4.5) return { background: themeColor, color: '#ffffff' };
  return { background: BRAND_INK, color: '#ffffff' };
}

/** "Up to 60% off" only from the server's claim. null = no % claim. */
export function claimText(c: Pick<CampaignPublicDto, 'claim'>): string | null {
  const p = c.claim.upToPercent;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? `Up to ${p}% off` : null;
}

/** What the countdown is counting to, worded by phase. null = no countdown for this phase. */
export function countdownLabel(
  c: Pick<CampaignPublicDto, 'phase' | 'countdownTo' | 'earlyAccessStartsAt' | 'hasEarlyAccess'>,
): string | null {
  if (!c.countdownTo) return null;
  switch (c.phase) {
    case 'TEASER':
      return c.earlyAccessStartsAt && sameInstant(c.earlyAccessStartsAt, c.countdownTo)
        ? 'Early access starts in'
        : 'Starts in';
    case 'EARLY_ACCESS':
      return c.hasEarlyAccess ? 'Early access ends in' : 'Sale starts in';
    case 'LIVE':
      return 'Ends in';
    default:
      return null;
  }
}

function sameInstant(a: string, b: string) {
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Remaining time split for display. Never negative. */
export function splitRemaining(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Plain-words bundle offer from its numbers ("Buy 2, extra 10% off"). */
export function promotionText(p: { minQuantity: number; percentOff: number }): string {
  return `Buy ${p.minQuantity}, extra ${p.percentOff}% off`;
}

export const ENDED_PHASES: CampaignPhase[] = ['ENDED', 'PAUSED', 'CANCELLED'];

/** Short status line for the announcement bar. */
export function announcementText(c: CampaignPublicDto): string {
  const claim = claimText(c);
  switch (c.phase) {
    case 'LIVE':
      return claim ? `${c.name} is on. ${claim}` : `${c.name} is on`;
    case 'EARLY_ACCESS':
      return `${c.name}: early access is open`;
    case 'TEASER':
      return `${c.name} is coming soon`;
    default:
      return c.name;
  }
}
