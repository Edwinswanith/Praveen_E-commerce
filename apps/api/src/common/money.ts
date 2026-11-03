import { Prisma } from '@prisma/client';
import { fromPaise, toPaise } from '@vyra/shared';

/** Prisma Decimal (rupees) -> integer paise. */
export function decToPaise(d: Prisma.Decimal | number | string | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return toPaise(typeof d === 'object' ? d.toString() : d);
}

/** Prisma Decimal -> rupee number for API responses. */
export function decToNum(d: Prisma.Decimal | number | string | null | undefined): number {
  return fromPaise(decToPaise(d));
}

export function decToNumOrNull(d: Prisma.Decimal | null | undefined): number | null {
  return d === null || d === undefined ? null : decToNum(d);
}

/** Integer paise -> Prisma Decimal string for persistence. */
export function paiseToDec(p: number): Prisma.Decimal {
  return new Prisma.Decimal(fromPaise(p).toFixed(2));
}
