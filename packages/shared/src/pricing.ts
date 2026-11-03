import type { CouponType } from './enums';
import type { Paise } from './money';

/**
 * Central commerce pricing rules. The backend is the only authority that
 * applies these to real orders; the frontend may reuse them for previews only.
 */
export const PRICING_RULES = {
  /** Orders with a post-discount subtotal at or above this ship free. */
  freeShippingThreshold: 99_900,
  standardShippingFee: 7_900,
  expressShippingFee: 14_900,
  codFee: 4_900,
  /** Cash on delivery is not offered above this order value. */
  codMaxOrderValue: 500_000,
  /**
   * Indian GST on apparel (GST rationalisation effective 22 Sep 2025):
   * 5% where the per-piece sale value is <= ₹2,500, otherwise 18%.
   * Selling prices are GST-inclusive (as displayed MRP/price in India), so tax
   * is extracted from the price rather than added on top.
   * Verify with your CA before go-live; rates are configuration, not law.
   */
  gstSlabThreshold: 250_000,
  gstLowRate: 5,
  gstHighRate: 18,
  /**
   * Prepaid incentive: COD refusals (RTO) are the biggest margin leak in Indian
   * fashion, so online payment earns a small discount. Set percent to 0 to disable.
   */
  prepaidDiscountPercent: 5,
  prepaidDiscountMax: 10_000,
} as const;

export type ShippingMethod = 'STANDARD' | 'EXPRESS';

/** Below this discount the storefront makes no "% off" claim at all. */
export const DEAL_MIN_DISCOUNT = 10;

/**
 * The only honest "Up to X% off" wording: X is the best discount a shopper can
 * actually buy right now, rounded DOWN to a multiple of 5 (never up), so the
 * claim is always backed by at least one in-stock product. null = no claim.
 */
export function upToDiscountClaim(maxDiscountPercent: number): number | null {
  if (maxDiscountPercent < DEAL_MIN_DISCOUNT) return null;
  return Math.floor(maxDiscountPercent / 5) * 5;
}

export interface PricingLine {
  variantId: string;
  categoryIds: string[];
  /** Effective unit price for this customer now (campaign sale price if any). */
  unitPrice: Paise;
  unitMrp: Paise;
  quantity: number;
  productId?: string;
  /** Regular price before any campaign; (unitBasePrice - unitPrice) is the campaign saving. */
  unitBasePrice?: Paise;
  campaignId?: string | null;
  /** Discounts may never take the unit's net value below this (e.g. cost price). */
  unitFloor?: Paise;
}

export interface PricingCoupon {
  id?: string;
  code: string;
  type: CouponType;
  /** Percentage (0-100) for PERCENTAGE, paise for FIXED. */
  value: number;
  maxDiscount?: Paise | null;
  minOrderValue?: Paise | null;
  /** When non-empty the coupon applies only to lines in these categories. */
  categoryIds?: string[];
  /** false = cannot stack with a bundle promotion; the engine keeps whichever saves the customer more. */
  combinableWithPromotions?: boolean;
}

/** "Buy N (from scope), get X% off those items", capped. */
export interface PricingPromotion {
  id: string;
  name: string;
  minQuantity: number;
  /** 0-90 */
  percentOff: number;
  maxDiscount?: Paise | null;
  /** Empty = all items. */
  categoryIds?: string[];
  productIds?: string[];
}

export interface LineDiscounts {
  campaign: Paise;
  promotion: Paise;
  coupon: Paise;
  prepaid: Paise;
}

export interface PricedLine extends PricingLine {
  lineTotal: Paise;
  lineMrpTotal: Paise;
  /** Promotion + coupon + prepaid discount allocated to this line. */
  discountShare: Paise;
  discounts: LineDiscounts;
  taxableValue: Paise;
  gstRate: number;
  taxAmount: Paise;
}

export interface PricingResult {
  lines: PricedLine[];
  mrpTotal: Paise;
  subtotal: Paise;
  productDiscount: Paise;
  /** Part of productDiscount that comes from live campaign prices (vs regular price). */
  campaignSavings: Paise;
  promotionDiscount: Paise;
  promotion: { id: string; name: string } | null;
  couponDiscount: Paise;
  couponCode: string | null;
  couponError: string | null;
  /** Set when a non-combinable coupon lost (or won) against a promotion. */
  offerNote: string | null;
  prepaidDiscount: Paise;
  shippingFee: Paise;
  codFee: Paise;
  taxTotal: Paise;
  grandTotal: Paise;
  codAvailable: boolean;
}

export function gstRateFor(unitNetPrice: Paise): number {
  return unitNetPrice <= PRICING_RULES.gstSlabThreshold ? PRICING_RULES.gstLowRate : PRICING_RULES.gstHighRate;
}

/** Tax contained in a GST-inclusive amount. */
export function inclusiveTax(amount: Paise, ratePercent: number): Paise {
  return Math.round((amount * ratePercent) / (100 + ratePercent));
}

const inScope = (l: PricingLine, categoryIds?: string[], productIds?: string[]) =>
  (!categoryIds?.length && !productIds?.length) ||
  (!!categoryIds?.length && l.categoryIds.some((c) => categoryIds.includes(c))) ||
  (!!productIds?.length && !!l.productId && productIds.includes(l.productId));

/**
 * Coupon value on the given line values (defaults to unitPrice × qty, i.e. before
 * promotions). Minimum order is checked against the whole bag's value.
 */
export function evaluateCouponDiscount(
  coupon: PricingCoupon,
  lines: PricingLine[],
  values?: Paise[],
): { discount: Paise; error: string | null } {
  const val = (i: number) => (values ? values[i]! : lines[i]!.unitPrice * lines[i]!.quantity);
  const eligibleIdx = lines.map((_, i) => i).filter((i) => inScope(lines[i]!, coupon.categoryIds));
  const eligibleTotal = eligibleIdx.reduce((s, i) => s + val(i), 0);
  const subtotal = lines.reduce((s, _l, i) => s + val(i), 0);
  if (eligibleTotal === 0) return { discount: 0, error: 'Coupon does not apply to items in your bag' };
  if (coupon.minOrderValue && subtotal < coupon.minOrderValue) {
    return { discount: 0, error: `Add items worth ₹${Math.ceil((coupon.minOrderValue - subtotal) / 100)} more to use this coupon` };
  }
  let discount = coupon.type === 'PERCENTAGE'
    ? Math.floor((eligibleTotal * Math.min(Math.max(coupon.value, 0), 100)) / 100)
    : Math.min(coupon.value, eligibleTotal);
  if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  return { discount, error: null };
}

/** Discount a promotion gives on these values, or 0 if its quantity threshold isn't met. */
export function evaluatePromotion(promo: PricingPromotion, lines: PricingLine[], values: Paise[]): Paise {
  const idx = lines.map((_, i) => i).filter((i) => inScope(lines[i]!, promo.categoryIds, promo.productIds));
  const qty = idx.reduce((s, i) => s + lines[i]!.quantity, 0);
  if (qty < promo.minQuantity) return 0;
  const base = idx.reduce((s, i) => s + values[i]!, 0);
  let d = Math.floor((base * Math.min(Math.max(promo.percentOff, 0), 90)) / 100);
  if (promo.maxDiscount != null) d = Math.min(d, promo.maxDiscount);
  return d;
}

interface Scenario { promo: PricingPromotion | null; promoShares: number[]; coupon: PricingCoupon | null; couponShares: number[]; couponError: string | null }

function runScenario(lines: PricingLine[], floors: number[], promo: PricingPromotion | null, coupon: PricingCoupon | null): Scenario {
  const gross = lines.map((l) => l.unitPrice * l.quantity);
  const promoShares = new Array<number>(lines.length).fill(0);
  if (promo) {
    const amount = evaluatePromotion(promo, lines, gross);
    const idx = lines.map((_, i) => i).filter((i) => inScope(lines[i]!, promo.categoryIds, promo.productIds));
    allocateCapped(promoShares, idx, amount, gross, floors);
  }
  const afterPromo = gross.map((g, i) => g - promoShares[i]!);
  const couponShares = new Array<number>(lines.length).fill(0);
  let couponError: string | null = null;
  if (coupon) {
    const r = evaluateCouponDiscount(coupon, lines, afterPromo);
    couponError = r.error;
    if (!r.error) {
      const idx = lines.map((_, i) => i).filter((i) => inScope(lines[i]!, coupon.categoryIds));
      allocateCapped(couponShares, idx, r.discount, afterPromo, floors);
    }
  }
  return { promo, promoShares, coupon, couponShares, couponError };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function priceCart(input: {
  lines: PricingLine[];
  coupon?: PricingCoupon | null;
  promotions?: PricingPromotion[];
  shippingMethod?: ShippingMethod;
  paymentMethod?: 'ONLINE' | 'COD';
  /** Override PRICING_RULES prepaid discount (percent 0 disables). */
  prepaid?: { percent: number; max: number };
}): PricingResult {
  const { lines } = input;
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error('Quantity must be a positive integer');
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new Error('Unit price must be integer paise');
  }
  const gross = lines.map((l) => l.unitPrice * l.quantity);
  const subtotal = sum(gross);
  const mrpTotal = lines.reduce((s, l) => s + Math.max(l.unitMrp, l.unitPrice) * l.quantity, 0);
  const campaignSavings = lines.reduce((s, l) => s + Math.max(0, (l.unitBasePrice ?? l.unitPrice) - l.unitPrice) * l.quantity, 0);
  // Floor per line in paise: discounts never take a line below floor × qty.
  const floors = lines.map((l) => Math.min(l.unitFloor ?? 0, l.unitPrice) * l.quantity);

  // Best bundle promotion for this bag (customer-favourable).
  const promos = (input.promotions ?? []).map((p) => ({ p, d: evaluatePromotion(p, lines, gross) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
  const bestPromo = promos[0]?.p ?? null;
  const coupon = input.coupon ?? null;

  let chosen: Scenario;
  let offerNote: string | null = null;
  if (bestPromo && coupon && coupon.combinableWithPromotions === false) {
    // Not combinable: keep whichever saves the customer more, and say so.
    const a = runScenario(lines, floors, bestPromo, null);
    const b = runScenario(lines, floors, null, coupon);
    const sa = sum(a.promoShares), sb = b.couponError ? -1 : sum(b.couponShares);
    if (sb > sa) {
      chosen = b;
      offerNote = `${coupon.code} saves you more than “${bestPromo.name}”, so we applied ${coupon.code}. They can't be combined.`;
    } else {
      chosen = { ...a, couponError: `${coupon.code} can't be combined with “${bestPromo.name}”. We kept the better offer.` };
      offerNote = chosen.couponError;
    }
  } else {
    chosen = runScenario(lines, floors, bestPromo, coupon);
  }
  const promoShares = chosen.promoShares;
  const couponShares = chosen.couponShares;
  const promotionDiscount = sum(promoShares);
  const couponDiscount = sum(couponShares);
  const couponError = coupon ? chosen.couponError : null;

  // Prepaid discount on the remaining value (ONLINE only), also floor-capped.
  const prepaidShares = new Array<number>(lines.length).fill(0);
  const pct = input.prepaid?.percent ?? PRICING_RULES.prepaidDiscountPercent;
  if (input.paymentMethod === 'ONLINE' && pct > 0 && lines.length) {
    const remaining = gross.map((g, i) => g - promoShares[i]! - couponShares[i]!);
    const amount = Math.min(Math.floor((sum(remaining) * pct) / 100), input.prepaid?.max ?? PRICING_RULES.prepaidDiscountMax);
    allocateCapped(prepaidShares, lines.map((_, i) => i), amount, remaining, floors);
  }
  const prepaidDiscount = sum(prepaidShares);

  const priced: PricedLine[] = lines.map((l, i) => {
    const lineTotal = gross[i]!;
    const share = promoShares[i]! + couponShares[i]! + prepaidShares[i]!;
    const taxableValue = lineTotal - share;
    const rate = gstRateFor(Math.round(taxableValue / l.quantity));
    return {
      ...l,
      lineTotal,
      lineMrpTotal: Math.max(l.unitMrp, l.unitPrice) * l.quantity,
      discountShare: share,
      discounts: {
        campaign: Math.max(0, (l.unitBasePrice ?? l.unitPrice) - l.unitPrice) * l.quantity,
        promotion: promoShares[i]!, coupon: couponShares[i]!, prepaid: prepaidShares[i]!,
      },
      taxableValue,
      gstRate: rate,
      taxAmount: inclusiveTax(taxableValue, rate),
    };
  });

  const beforePrepaid = subtotal - promotionDiscount - couponDiscount;
  const method = input.shippingMethod ?? 'STANDARD';
  let shippingFee = 0;
  if (lines.length > 0) {
    if (method === 'EXPRESS') shippingFee = PRICING_RULES.expressShippingFee;
    // Threshold uses the pre-prepaid-discount value so paying online never loses free shipping.
    else shippingFee = beforePrepaid >= PRICING_RULES.freeShippingThreshold ? 0 : PRICING_RULES.standardShippingFee;
  }
  const codAvailable = beforePrepaid + shippingFee <= PRICING_RULES.codMaxOrderValue;
  const codFee = input.paymentMethod === 'COD' ? PRICING_RULES.codFee : 0;

  return {
    lines: priced,
    mrpTotal,
    subtotal,
    productDiscount: mrpTotal - subtotal,
    campaignSavings,
    promotionDiscount,
    promotion: promotionDiscount > 0 && chosen.promo ? { id: chosen.promo.id, name: chosen.promo.name } : null,
    couponDiscount,
    couponCode: coupon && !couponError ? coupon.code : null,
    couponError,
    offerNote,
    prepaidDiscount,
    shippingFee,
    codFee,
    taxTotal: priced.reduce((s, l) => s + l.taxAmount, 0),
    grandTotal: beforePrepaid - prepaidDiscount + shippingFee + codFee,
    codAvailable,
  };
}

/**
 * Allocates `amount` across lines `idx` proportionally to `values` (each line's
 * current net value), without letting any line fall below its floor:
 * room(i) = values[i] - floors[i] - shares[i]. Amount that can't fit after
 * redistribution is not given, so totals always reflect what was really applied.
 */
function allocateCapped(shares: number[], idx: number[], amount: number, values: number[], floors: number[]) {
  const room = (i: number) => Math.max(0, values[i]! - floors[i]! - shares[i]!);
  let remaining = amount;
  let pool = idx.filter((i) => room(i) > 0);
  for (let round = 0; round < 6 && remaining > 0 && pool.length; round++) {
    const total = pool.reduce((s, i) => s + values[i]!, 0);
    if (total <= 0) break;
    let given = 0;
    pool.forEach((i, k) => {
      const want = k === pool.length - 1 ? remaining - given : Math.floor((remaining * values[i]!) / total);
      const g = Math.max(0, Math.min(want, room(i)));
      shares[i]! += g;
      given += g;
    });
    remaining -= given;
    pool = pool.filter((i) => room(i) > 0);
  }
}
