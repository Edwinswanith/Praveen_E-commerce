import type { Prisma } from '@prisma/client';
import { discountPercent, type ProductCardDto, type VariantDto } from '@vyra/shared';
import { decToNum } from '../../common/money';

export const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'FREE', 'OS'];
export function sizeOrder(size: string): number {
  const i = SIZE_ORDER.indexOf(size.toUpperCase());
  if (i >= 0) return i;
  const n = parseInt(size, 10); // numeric sizes (waist 28-44, kids age 2-14) sort after letter sizes
  return Number.isFinite(n) ? 100 + n : 500;
}

export const cardInclude = {
  category: { select: { slug: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 2, select: { url: true, thumbUrl: true } },
  variants: {
    where: { isActive: true },
    select: { color: true, colorHex: true, size: true, sizeOrder: true, inventory: { select: { onHand: true, reserved: true } } },
  },
} satisfies Prisma.ProductInclude;

export type CardProduct = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

const NEW_DAYS = 30;

export function toProductCard(p: CardProduct, score?: number): ProductCardDto {
  const colors = new Map<string, string | null>();
  const sizes = new Map<string, number>();
  let inStock = false;
  for (const v of p.variants) {
    if (!colors.has(v.color)) colors.set(v.color, v.colorHex);
    sizes.set(v.size, v.sizeOrder);
    if (v.inventory && v.inventory.onHand - v.inventory.reserved > 0) inStock = true;
  }
  const minPrice = decToNum(p.minPrice);
  const minMrp = decToNum(p.minMrp);
  const badges: string[] = [];
  if (Date.now() - p.createdAt.getTime() < NEW_DAYS * 86400_000) badges.push('New');
  if (p.soldCount >= 25) badges.push('Bestseller');
  if (p.isFeatured) badges.push('Trending');
  if (!inStock) badges.push('Sold out');
  return {
    id: p.id, slug: p.slug, name: p.name, brand: p.brand, gender: p.gender, categorySlug: p.category.slug,
    imageUrl: p.images[0]?.thumbUrl ?? null, hoverImageUrl: p.images[1]?.thumbUrl ?? null,
    minPrice, minMrp, discountPercent: discountPercent(minMrp, minPrice),
    colors: [...colors].map(([name, hex]) => ({ name, hex })),
    sizes: [...sizes].sort((a, b) => a[1] - b[1]).map(([s]) => s),
    inStock, rating: p.ratingAvg ? Number(p.ratingAvg) : null, reviewCount: p.ratingCount, badges,
    ...(score !== undefined ? { score: Math.round(score * 1000) / 1000 } : {}),
  };
}

export function toVariantDto(v: Prisma.ProductVariantGetPayload<{ include: { inventory: true; barcodes: true } }>): VariantDto {
  const available = v.inventory ? Math.max(0, v.inventory.onHand - v.inventory.reserved) : 0;
  const mrp = decToNum(v.mrp);
  const price = decToNum(v.price);
  return {
    id: v.id, sku: v.sku, color: v.color, colorHex: v.colorHex, size: v.size, mrp, price,
    discountPercent: discountPercent(mrp, price), available, inStock: available > 0 && v.isActive, isActive: v.isActive,
    barcode: v.barcodes.find((b) => b.isPrimary)?.value ?? v.barcodes[0]?.value ?? null,
  };
}
