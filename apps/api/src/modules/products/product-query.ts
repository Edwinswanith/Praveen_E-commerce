import { Prisma } from '@prisma/client';

/** Structured catalog filters shared by listing, keyword search and vector search. */
export interface ProductFilter {
  categoryIds?: string[];
  gender?: 'MEN' | 'WOMEN' | 'KIDS' | 'UNISEX';
  minPrice?: number;
  maxPrice?: number;
  sizes?: string[];
  colors?: string[];
  brands?: string[];
  fabric?: string[];
  fit?: string[];
  occasion?: string[];
  minRating?: number;
  inStock?: boolean;
  featured?: boolean;
  keyword?: string;
  excludeIds?: string[];
}

const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30) : undefined);
export const csv = list;

/** Builds a WHERE clause over alias `p` (products). All values are parameterised. */
export function productWhere(f: ProductFilter): Prisma.Sql {
  const w: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`, Prisma.sql`p."deletedAt" IS NULL`];
  if (f.categoryIds?.length) w.push(Prisma.sql`p."categoryId" IN (${Prisma.join(f.categoryIds)})`);
  if (f.gender) {
    // Unisex items appear for men and women.
    w.push(f.gender === 'MEN' || f.gender === 'WOMEN'
      ? Prisma.sql`p.gender IN (${f.gender}::"Gender", 'UNISEX'::"Gender")`
      : Prisma.sql`p.gender = ${f.gender}::"Gender"`);
  }
  if (f.minPrice !== undefined) w.push(Prisma.sql`p."minPrice" >= ${f.minPrice}`);
  if (f.maxPrice !== undefined) w.push(Prisma.sql`p."minPrice" <= ${f.maxPrice}`);
  if (f.brands?.length) w.push(Prisma.sql`lower(p.brand) IN (${Prisma.join(f.brands.map((b) => b.toLowerCase()))})`);
  if (f.minRating !== undefined) w.push(Prisma.sql`p."ratingAvg" >= ${f.minRating}`);
  if (f.featured) w.push(Prisma.sql`p."isFeatured" = true`);
  if (f.excludeIds?.length) w.push(Prisma.sql`p.id NOT IN (${Prisma.join(f.excludeIds)})`);

  // Size, colour and stock must hold for the SAME variant ("black in M, in stock").
  if (f.sizes?.length || f.colors?.length || f.inStock) {
    const vw: Prisma.Sql[] = [Prisma.sql`v."productId" = p.id`, Prisma.sql`v."isActive"`];
    if (f.sizes?.length) vw.push(Prisma.sql`upper(v.size) IN (${Prisma.join(f.sizes.map((s) => s.toUpperCase()))})`);
    if (f.colors?.length) vw.push(Prisma.sql`lower(v.color) IN (${Prisma.join(f.colors.map((c) => c.toLowerCase()))})`);
    if (f.inStock) vw.push(Prisma.sql`i."onHand" - i.reserved > 0`);
    w.push(Prisma.sql`EXISTS (SELECT 1 FROM product_variants v JOIN inventory i ON i."variantId" = v.id WHERE ${Prisma.join(vw, ' AND ')})`);
  }
  for (const key of ['fabric', 'fit', 'occasion'] as const) {
    const vals = f[key];
    if (vals?.length) {
      w.push(Prisma.sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a."productId" = p.id AND a.key = ${key} AND lower(a.value) IN (${Prisma.join(vals.map((x) => x.toLowerCase()))}))`);
    }
  }
  if (f.keyword?.trim()) {
    const q = f.keyword.trim().slice(0, 100);
    const like = `%${q}%`;
    w.push(Prisma.sql`(p.name ILIKE ${like} OR p.brand ILIKE ${like} OR array_to_string(p.tags, ' ') ILIKE ${like}
      OR similarity(p.name, ${q}) > 0.25
      OR EXISTS (SELECT 1 FROM categories c WHERE c.id = p."categoryId" AND c.name ILIKE ${like}))`);
  }
  return Prisma.join(w, ' AND ');
}

export function productOrder(sort: string, keyword?: string): Prisma.Sql {
  switch (sort) {
    case 'newest': return Prisma.sql`p."publishedAt" DESC NULLS LAST, p."createdAt" DESC`;
    case 'price_asc': return Prisma.sql`p."minPrice" ASC, p.id`;
    case 'price_desc': return Prisma.sql`p."minPrice" DESC, p.id`;
    case 'discount': return Prisma.sql`p."maxDiscount" DESC, p."soldCount" DESC`;
    case 'popularity': return Prisma.sql`p."soldCount" DESC, p."ratingCount" DESC`;
    case 'rating': return Prisma.sql`p."ratingAvg" DESC NULLS LAST, p."ratingCount" DESC`;
    default:
      return keyword?.trim()
        ? Prisma.sql`similarity(p.name, ${keyword.trim()}) DESC, p."soldCount" DESC`
        : Prisma.sql`p."isFeatured" DESC, p."soldCount" DESC, p."createdAt" DESC`;
  }
}
