import type { ReturnRequestDto } from '@vyra/shared';

export type ReturnItem = ReturnRequestDto['items'][number];

/** "M → L, Black" (size change) or "Navy, M" (colour-only change) from the original SKU and the exchange target. */
export function exchangeLabel(i: ReturnItem): string {
  const to = i.exchangeFor;
  if (!to) return '';
  const parts = i.sku.split('-');
  const fromSize = parts[parts.length - 1] ?? '';
  return fromSize && fromSize.toUpperCase() !== to.size.toUpperCase() ? `${fromSize} → ${to.size}, ${to.color}` : `${to.color}, ${to.size}`;
}
