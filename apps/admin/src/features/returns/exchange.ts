import type { ReturnRequestDto } from '@vyra/shared';

export type ReturnItem = ReturnRequestDto['items'][number];

/**
 * Describes an exchange from the original colour/size to the target:
 * size only "M → L, Black"; colour only "Black → Navy, M"; both "Black M → Navy L".
 */
export function exchangeLabel(i: ReturnItem): string {
  const to = i.exchangeFor;
  if (!to) return '';
  const sameSize = i.size.toUpperCase() === to.size.toUpperCase();
  const sameColor = i.color.toLowerCase() === to.color.toLowerCase();
  if (!sameSize && sameColor) return `${i.size} → ${to.size}, ${to.color}`;
  if (sameSize && !sameColor) return `${i.color} → ${to.color}, ${to.size}`;
  return `${i.color} ${i.size} → ${to.color} ${to.size}`;
}
