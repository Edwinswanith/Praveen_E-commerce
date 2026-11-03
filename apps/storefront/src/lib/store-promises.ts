import { formatINR, fromPaise, PRICING_RULES, RETURN_WINDOW_DAYS } from '@vyra/shared';

/**
 * Customer-facing promises derived from the SAME constants the API enforces.
 * Never hardcode "₹999" or "14-day" in UI copy: change the rule once and every
 * banner, footer and SEO description follows.
 */
export const FREE_SHIPPING_TEXT = formatINR(fromPaise(PRICING_RULES.freeShippingThreshold));
export const RETURN_DAYS = RETURN_WINDOW_DAYS;
