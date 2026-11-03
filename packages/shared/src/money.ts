/**
 * Money is persisted as DECIMAL(12,2) rupees and computed as integer paise
 * to avoid floating point drift. Never do arithmetic on rupee floats.
 */
export type Paise = number;

export function toPaise(rupees: number | string): Paise {
  const n = typeof rupees === 'string' ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error(`Invalid money value: ${rupees}`);
  return Math.round(n * 100);
}

export function fromPaise(paise: Paise): number {
  return Math.round(paise) / 100;
}

/** Formats a rupee amount for display, e.g. 1299 -> "₹1,299", 1299.5 -> "₹1,299.50". */
export function formatINR(rupees: number): string {
  const hasFraction = Math.round(rupees * 100) % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function discountPercent(mrp: number, price: number): number {
  if (mrp <= 0 || price >= mrp) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}
