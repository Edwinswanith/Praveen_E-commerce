import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  discountPercent, generateSku, toPaise, type AdminProductDetailDto, type AdminProductRow, type ProductCardDto, type ProductDetailDto,
  type DealsSummaryDto, type ProductFacets, type ProductInput, type ProductListQuery, type VariantInput, DEAL_MIN_DISCOUNT,
} from '@vyra/shared';
import { z } from 'zod';
import { productUpdateSchema } from '@vyra/shared';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { badRequest, conflict, notFound } from '../../common/http/errors';
import { decToNum, decToNumOrNull, paiseToDec } from '../../common/money';
import { BarcodesService } from '../barcodes/barcodes.service';
import { CategoriesService } from '../categories/categories.service';
import { EmbeddingService } from '../ai/embedding.service';
import { CampaignPricingService } from '../campaigns/campaign-pricing.service';
import { cardInclude, sizeOrder, toProductCard, toVariantDto } from './product.mappers';
import { csv, productOrder, productWhere, type ProductFilter } from './product-query';

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);

const detailInclude = {
  category: true,
  images: { orderBy: { sortOrder: 'asc' } },
  videos: { orderBy: { sortOrder: 'asc' } },
  attributes: true,
  variants: { include: { inventory: true, barcodes: true }, orderBy: [{ color: 'asc' }, { sizeOrder: 'asc' }] },
} satisfies Prisma.ProductInclude;

type DetailProduct = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;
type CardProductRow = Parameters<typeof toProductCard>[0];

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly barcodes: BarcodesService,
    private readonly embeddings: EmbeddingService,
    private readonly campaignPricing: CampaignPricingService,
  ) {}

  /** Cards with their live campaign badge. */
  private async toCards(rows: CardProductRow[], scores?: Map<string, number>): Promise<ProductCardDto[]> {
    const badges = await this.campaignPricing.badges(rows.map((r) => r.id));
    return rows.map((p) => toProductCard(p, scores?.get(p.id), badges.get(p.id) ?? null));
  }

  // ------------------------------------------------------------ public reads

  async cardsByIds(ids: string[], scores?: Map<string, number>): Promise<ProductCardDto[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null }, include: cardInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.toCards(ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p), scores);
  }

  async filterFromQuery(q: ProductListQuery): Promise<ProductFilter> {
    let categoryIds: string[] | undefined;
    if (q.category) {
      const cat = await this.prisma.category.findFirst({ where: { slug: q.category, deletedAt: null, isActive: true } });
      if (!cat) throw notFound('Category');
      categoryIds = await this.categories.descendantIds(cat.id);
    }
    return {
      categoryIds, gender: q.gender, minPrice: q.minPrice, maxPrice: q.maxPrice, sizes: csv(q.sizes), colors: csv(q.colors),
      brands: csv(q.brands), fabric: csv(q.fabric), fit: csv(q.fit), occasion: csv(q.occasion), minRating: q.minRating,
      inStock: q.inStock === 'true', featured: q.featured === 'true', keyword: q.q,
    };
  }

  async idsPage(filter: ProductFilter, sort: string, page: number, pageSize: number) {
    const where = productWhere(filter);
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM products p WHERE ${where} ORDER BY ${productOrder(sort, filter.keyword)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM products p WHERE ${where}`,
    ]);
    return { ids: rows.map((r) => r.id), total: Number(count[0]?.n ?? 0) };
  }

  async list(q: ProductListQuery) {
    const filter = await this.filterFromQuery(q);
    const { ids, total } = await this.idsPage(filter, q.sort, q.page, q.pageSize);
    const [items, facets] = await Promise.all([this.cardsByIds(ids), this.facets({ categoryIds: filter.categoryIds, gender: filter.gender, keyword: filter.keyword })]);
    return { items, meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }, facets };
  }

  /** Facet counts over the base set (category/gender/keyword), so options don't vanish as you filter. */
  async facets(base: ProductFilter): Promise<ProductFacets> {
    const where = productWhere(base);
    const [cats, sizes, colors, brands, attrs, price] = await Promise.all([
      this.prisma.$queryRaw<{ slug: string; name: string; count: bigint }[]>`
        SELECT c.slug, c.name, count(*)::bigint AS count FROM products p JOIN categories c ON c.id = p."categoryId" WHERE ${where} GROUP BY c.slug, c.name ORDER BY count DESC`,
      this.prisma.$queryRaw<{ value: string; ord: number; count: bigint }[]>`
        SELECT v.size AS value, min(v."sizeOrder") AS ord, count(DISTINCT p.id)::bigint AS count FROM products p JOIN product_variants v ON v."productId" = p.id AND v."isActive" WHERE ${where} GROUP BY v.size ORDER BY ord`,
      this.prisma.$queryRaw<{ value: string; hex: string | null; count: bigint }[]>`
        SELECT v.color AS value, max(v."colorHex") AS hex, count(DISTINCT p.id)::bigint AS count FROM products p JOIN product_variants v ON v."productId" = p.id AND v."isActive" WHERE ${where} GROUP BY v.color ORDER BY count DESC`,
      this.prisma.$queryRaw<{ value: string; count: bigint }[]>`SELECT p.brand AS value, count(*)::bigint AS count FROM products p WHERE ${where} GROUP BY p.brand ORDER BY count DESC`,
      this.prisma.$queryRaw<{ key: string; value: string; count: bigint }[]>`
        SELECT a.key, a.value, count(*)::bigint AS count FROM products p JOIN product_attributes a ON a."productId" = p.id WHERE ${where} AND a.key IN ('fabric','fit','occasion') GROUP BY a.key, a.value ORDER BY count DESC`,
      this.prisma.$queryRaw<{ min: Prisma.Decimal | null; max: Prisma.Decimal | null }[]>`SELECT min(p."minPrice") AS min, max(p."minPrice") AS max FROM products p WHERE ${where}`,
    ]);
    const n = (b: bigint) => Number(b);
    const attr = (k: string) => attrs.filter((a) => a.key === k).map((a) => ({ value: a.value, count: n(a.count) }));
    return {
      categories: cats.map((c) => ({ slug: c.slug, name: c.name, count: n(c.count) })),
      sizes: sizes.map((s) => ({ value: s.value, count: n(s.count) })),
      colors: colors.map((c) => ({ value: c.value, hex: c.hex, count: n(c.count) })),
      brands: brands.map((b) => ({ value: b.value, count: n(b.count) })),
      fabrics: attr('fabric'), fits: attr('fit'), occasions: attr('occasion'),
      price: { min: decToNum(price[0]?.min ?? 0), max: decToNum(price[0]?.max ?? 0) },
    };
  }

  async home() {
    const take = 12;
    const base = { status: 'ACTIVE' as const, deletedAt: null };
    const [trending, newArrivals, bestSellers, featured, categories] = await Promise.all([
      this.prisma.product.findMany({ where: { ...base, isFeatured: true }, include: cardInclude, orderBy: { updatedAt: 'desc' }, take }),
      this.prisma.product.findMany({ where: base, include: cardInclude, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], take }),
      this.prisma.product.findMany({ where: base, include: cardInclude, orderBy: [{ soldCount: 'desc' }, { ratingCount: 'desc' }], take }),
      this.prisma.product.findMany({ where: { ...base, maxDiscount: { gte: 30 } }, include: cardInclude, orderBy: { maxDiscount: 'desc' }, take }),
      this.categories.tree(),
    ]);
    const c = (xs: typeof trending) => this.toCards(xs);
    return { trending: await c(trending), newArrivals: await c(newArrivals), bestSellers: await c(bestSellers), featured: await c(featured), categories, deals: await this.deals() };
  }

  /**
   * Live deal summary for banners: same discount formula as product cards
   * (minMrp vs minPrice), in-stock products only. Prevents advertising a
   * discount that no purchasable product has.
   */
  async deals(): Promise<DealsSummaryDto> {
    const rows = await this.prisma.$queryRaw<{ minPrice: Prisma.Decimal; minMrp: Prisma.Decimal }[]>`
      SELECT p."minPrice", p."minMrp" FROM products p WHERE ${productWhere({ inStock: true })}`;
    const discounts = rows.map((r) => discountPercent(decToNum(r.minMrp), decToNum(r.minPrice)));
    return {
      maxDiscountPercent: discounts.length ? Math.max(...discounts) : 0,
      productCount: discounts.filter((d) => d >= DEAL_MIN_DISCOUNT).length,
    };
  }

  private async loadDetail(where: Prisma.ProductWhereInput): Promise<DetailProduct> {
    const p = await this.prisma.product.findFirst({ where: { ...where, deletedAt: null }, include: detailInclude });
    if (!p) throw notFound('Product');
    return p;
  }

  /** Aggregates review fit votes into advice ("runs small: consider one size up"). */
  async fitSummary(productId: string) {
    const rows = await this.prisma.review.groupBy({ by: ['fit'], where: { productId, isPublished: true, fit: { not: null } }, _count: true });
    const n = (f: string) => rows.find((r) => r.fit === f)?._count ?? 0;
    const runsSmall = n('RUNS_SMALL'), trueToSize = n('TRUE_TO_SIZE'), runsLarge = n('RUNS_LARGE');
    const total = runsSmall + trueToSize + runsLarge;
    let advice: string | null = null;
    if (total >= 3) {
      if (runsSmall / total >= 0.4) advice = `${Math.round((runsSmall / total) * 100)}% of buyers say it runs small. Consider one size up.`;
      else if (runsLarge / total >= 0.4) advice = `${Math.round((runsLarge / total) * 100)}% of buyers say it runs large. Consider one size down.`;
      else advice = `${Math.round((trueToSize / total) * 100)}% of buyers say it fits true to size.`;
    }
    return { runsSmall, trueToSize, runsLarge, total, advice };
  }

  private async toDetail(p: DetailProduct): Promise<ProductDetailDto> {
    // Public price (product pages are cached for everyone; early-access prices show in the bag).
    const active = p.variants.filter((v) => v.isActive);
    const prices = await this.campaignPricing.resolve(active);
    const variants = active.map((v) => toVariantDto(v, prices.get(v.id)));
    const campaign = variants.find((v) => v.campaign && v.inStock)?.campaign ?? variants.find((v) => v.campaign)?.campaign ?? null;
    const card = toProductCard({ ...p, category: { slug: p.category.slug }, images: p.images.slice(0, 2), variants: active }, undefined, campaign);
    const { imageUrl: _i, hoverImageUrl: _h, ...rest } = card;
    return {
      ...rest,
      description: p.description, status: p.status, tags: p.tags, hsnCode: p.hsnCode,
      category: { id: p.category.id, name: p.category.name, slug: p.category.slug, path: await this.categories.path(p.categoryId) },
      attributes: Object.fromEntries(p.attributes.map((a) => [a.key, a.value])),
      sizeChart: (p.sizeChart as Record<string, Record<string, string>> | null) ?? null,
      images: p.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, alt: i.alt || p.name, color: i.color, sortOrder: i.sortOrder, width: i.width, height: i.height, aiGenerated: i.aiGenerated, sourceImageId: i.sourceImageId })),
      videos: p.videos.map((v) => ({ id: v.id, url: v.url, posterUrl: v.posterUrl })),
      variants, fit: await this.fitSummary(p.id), seoTitle: p.seoTitle, seoDescription: p.seoDescription, createdAt: p.createdAt.toISOString(),
    };
  }

  async detailBySlug(slug: string) {
    return this.toDetail(await this.loadDetail({ slug, status: 'ACTIVE' }));
  }

  /** Visually + semantically similar products (image vectors first, then text), category fallback. */
  async similar(slug: string, limit: number): Promise<ProductCardDto[]> {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true, categoryId: true, gender: true } });
    if (!p) throw notFound('Product');
    const prov = this.embeddings.provider;
    const scores = new Map<string, number>();
    for (const [kind, model] of [['IMAGE', prov.imageModel], ['TEXT', prov.textModel]] as const) {
      const src = await this.prisma.$queryRaw<{ v: string }[]>`SELECT vector::text AS v FROM product_embeddings WHERE "productId" = ${p.id} AND kind = ${kind}::"EmbeddingKind" AND model = ${model} LIMIT 1`;
      if (!src[0]) continue;
      const vec = JSON.parse(src[0].v) as number[];
      const hits = await this.embeddings.nearest(vec, model, [kind], { excludeIds: [p.id], gender: p.gender }, limit * 2);
      for (const h of hits) scores.set(h.productId, Math.max(scores.get(h.productId) ?? 0, h.score * (kind === 'IMAGE' ? 1 : 0.9)));
    }
    let ids = [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
    if (ids.length < limit) {
      const more = await this.prisma.product.findMany({ where: { categoryId: p.categoryId, status: 'ACTIVE', deletedAt: null, id: { notIn: [p.id, ...ids] } }, orderBy: { soldCount: 'desc' }, take: limit - ids.length, select: { id: true } });
      ids = [...ids, ...more.map((m) => m.id)];
    }
    return this.cardsByIds(ids, scores);
  }

  /** Related = same parent category (complementary items), best sellers first. */
  async related(slug: string, limit: number): Promise<ProductCardDto[]> {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, include: { category: true } });
    if (!p) throw notFound('Product');
    const rootId = p.category.parentId ?? p.categoryId;
    const ids = await this.categories.descendantIds(rootId);
    const rows = await this.prisma.product.findMany({
      where: { categoryId: { in: ids.filter((i) => i !== p.categoryId).length ? ids.filter((i) => i !== p.categoryId) : ids }, status: 'ACTIVE', deletedAt: null, id: { not: p.id } },
      include: cardInclude, orderBy: [{ soldCount: 'desc' }, { createdAt: 'desc' }], take: limit,
    });
    return this.toCards(rows);
  }

  // ------------------------------------------------------------ admin

  async adminList(q: { q?: string; status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; categoryId?: string; page: number; pageSize: number }) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.categoryId ? { categoryId: { in: await this.categories.descendantIds(q.categoryId) } } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { variants: { some: { sku: { contains: q.q, mode: 'insensitive' } } } }, { variants: { some: { barcodes: { some: { value: q.q } } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { category: { select: { name: true } }, images: { orderBy: { sortOrder: 'asc' }, take: 1 }, variants: { where: { isActive: true }, include: { inventory: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);
    const items: AdminProductRow[] = rows.map((p) => {
      const prices = p.variants.map((v) => decToNum(v.price));
      return {
        id: p.id, name: p.name, slug: p.slug, brand: p.brand, status: p.status, categoryName: p.category.name, imageUrl: p.images[0]?.thumbUrl ?? null,
        variantCount: p.variants.length, totalStock: p.variants.reduce((s, v) => s + (v.inventory?.onHand ?? 0), 0),
        minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0, isFeatured: p.isFeatured, updatedAt: p.updatedAt.toISOString(),
      };
    });
    return { items, total };
  }

  async adminDetail(id: string): Promise<AdminProductDetailDto> {
    const p = await this.loadDetail({ id });
    const base = await this.toDetail(p);
    const [lastJob, imgEmb, textEmb] = await Promise.all([
      this.prisma.embeddingJob.findFirst({ where: { productId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.productEmbedding.count({ where: { productId: id, kind: 'IMAGE', model: this.embeddings.provider.imageModel } }),
      this.prisma.productEmbedding.count({ where: { productId: id, kind: 'TEXT', model: this.embeddings.provider.textModel } }),
    ]);
    return {
      ...base,
      isFeatured: p.isFeatured, categoryId: p.categoryId,
      variants: p.variants.map((v) => ({
        ...toVariantDto(v), costPrice: decToNumOrNull(v.costPrice), weightGrams: v.weightGrams, lowStockThreshold: v.lowStockThreshold,
        onHand: v.inventory?.onHand ?? 0, reserved: v.inventory?.reserved ?? 0, barcodes: v.barcodes.map((b) => ({ symbology: b.symbology, value: b.value })),
      })),
      embedding: { text: textEmb > 0, images: imgEmb, status: lastJob?.status ?? null, model: this.embeddings.provider.textModel },
    };
  }

  private async uniqueSlug(tx: Tx, base: string, excludeId?: string) {
    const root = slugify(base) || 'product';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const clash = await tx.product.findFirst({ where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
      if (!clash) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private assertUniqueCombos(variants: VariantInput[]) {
    const seen = new Set<string>();
    for (const v of variants) {
      const k = `${v.color.trim().toLowerCase()}|${v.size.trim().toUpperCase()}`;
      if (seen.has(k)) throw badRequest(`Duplicate variant ${v.color} / ${v.size}`);
      seen.add(k);
    }
  }

  /** Keeps listing read-model fields in sync with active variants. */
  async refreshDenormalised(tx: Tx, productId: string) {
    await this.campaignPricing.refreshProducts([productId], tx);
  }

  private variantData(v: VariantInput) {
    return {
      color: v.color.trim(), colorHex: v.colorHex ?? null, size: v.size.trim().toUpperCase(), sizeOrder: sizeOrder(v.size),
      mrp: paiseToDec(toPaise(v.mrp)), price: paiseToDec(toPaise(v.price)), costPrice: v.costPrice != null ? paiseToDec(toPaise(v.costPrice)) : null,
      weightGrams: v.weightGrams, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive,
    };
  }

  private async writeAttributes(tx: Tx, productId: string, attributes: Record<string, string | undefined>) {
    await tx.productAttribute.deleteMany({ where: { productId } });
    const entries = Object.entries(attributes).filter(([, v]) => v && v.trim());
    if (entries.length) await tx.productAttribute.createMany({ data: entries.map(([key, value]) => ({ productId, key, value: value!.trim() })) });
  }

  async create(input: ProductInput, actorId: string) {
    this.assertUniqueCombos(input.variants);
    const category = await this.prisma.category.findFirst({ where: { id: input.categoryId, deletedAt: null } });
    if (!category) throw notFound('Category');
    const product = await this.prisma.$transaction(async (tx) => {
      const slug = input.slug ? await this.assertSlugFree(tx, input.slug) : await this.uniqueSlug(tx, `${input.name}`);
      const p = await tx.product.create({
        data: {
          name: input.name, slug, description: input.description, brand: input.brand, gender: input.gender, categoryId: input.categoryId,
          status: input.status, tags: input.tags, sizeChart: input.sizeChart ?? Prisma.JsonNull, hsnCode: input.hsnCode, isFeatured: input.isFeatured,
          seoTitle: input.seoTitle, seoDescription: input.seoDescription, publishedAt: input.status === 'ACTIVE' ? new Date() : null,
        },
      });
      await this.writeAttributes(tx, p.id, input.attributes);
      await this.createVariants(tx, p.id, p.seq, category.code, input.variants);
      await this.refreshDenormalised(tx, p.id);
      return p;
    });
    await this.embeddings.enqueue(product.id);
    return this.adminDetail(product.id);
  }

  private async assertSlugFree(tx: Tx, slug: string, excludeId?: string) {
    const clash = await tx.product.findFirst({ where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
    if (clash) throw conflict('That URL slug is already used by another product');
    return slug;
  }

  private async createVariants(tx: Tx, productId: string, seq: number, categoryCode: string, variants: VariantInput[]) {
    const ids: string[] = [];
    for (const v of variants) {
      const data = this.variantData(v);
      const sku = generateSku({ categoryCode, productSeq: seq, color: data.color, size: data.size });
      if (await tx.productVariant.findUnique({ where: { sku } })) throw conflict(`SKU ${sku} already exists (two colours abbreviate the same way); rename one colour`);
      const created = await tx.productVariant.create({ data: { ...data, productId, sku, inventory: { create: {} } } });
      ids.push(created.id);
    }
    await this.barcodes.ensureForVariants(tx, ids);
  }

  async update(id: string, input: z.infer<typeof productUpdateSchema>, actorId?: string) {
    const existing = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { variants: true, category: true } });
    if (!existing) throw notFound('Product');
    if (input.variants) this.assertUniqueCombos(input.variants);
    const category = input.categoryId ? await this.prisma.category.findFirst({ where: { id: input.categoryId, deletedAt: null } }) : existing.category;
    if (!category) throw notFound('Category');

    await this.prisma.$transaction(async (tx) => {
      const slug = input.slug && input.slug !== existing.slug ? await this.assertSlugFree(tx, input.slug, id) : undefined;
      await tx.product.update({
        where: { id },
        data: {
          name: input.name, slug, description: input.description, brand: input.brand, gender: input.gender, categoryId: input.categoryId,
          tags: input.tags, hsnCode: input.hsnCode, isFeatured: input.isFeatured, seoTitle: input.seoTitle, seoDescription: input.seoDescription,
          ...(input.sizeChart !== undefined ? { sizeChart: input.sizeChart ?? Prisma.JsonNull } : {}),
          ...(input.status ? { status: input.status, ...(input.status === 'ACTIVE' && !existing.publishedAt ? { publishedAt: new Date() } : {}) } : {}),
        },
      });
      if (input.attributes) await this.writeAttributes(tx, id, input.attributes);
      if (input.variants) {
        const keep = new Set<string>();
        const fresh: VariantInput[] = [];
        for (const v of input.variants) {
          const match = v.id ? existing.variants.find((e) => e.id === v.id) : existing.variants.find((e) => e.color.toLowerCase() === v.color.trim().toLowerCase() && e.size === v.size.trim().toUpperCase());
          if (match) {
            keep.add(match.id);
            // Colour/size of an existing variant are immutable: they're baked into SKU + printed labels.
            const { color: _c, size: _s, sizeOrder: _o, ...mutable } = this.variantData(v);
            if (!match.price.equals(mutable.price) || !match.mrp.equals(mutable.mrp)) {
              // Price history backs "was" prices and lets audits prove no pre-sale price hikes.
              await tx.priceHistory.create({ data: { variantId: match.id, price: mutable.price, mrp: mutable.mrp, changedById: actorId ?? null } });
            }
            await tx.productVariant.update({ where: { id: match.id }, data: mutable });
          } else fresh.push(v);
        }
        // Variants omitted from the payload are deactivated, never deleted (orders reference them).
        await tx.productVariant.updateMany({ where: { productId: id, id: { notIn: [...keep] } , isActive: true }, data: { isActive: false } });
        if (fresh.length) await this.createVariants(tx, id, existing.seq, category.code, fresh);
        await this.refreshDenormalised(tx, id);
      }
    });
    await this.embeddings.enqueue(id);
    return this.adminDetail(id);
  }

  async setStatus(ids: string[], status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED') {
    if (status === 'ACTIVE') {
      const notReady = await this.prisma.product.findMany({ where: { id: { in: ids }, OR: [{ variants: { none: { isActive: true } } }] }, select: { name: true } });
      if (notReady.length) throw badRequest(`Cannot publish without an active variant: ${notReady.map((n) => n.name).join(', ')}`);
    }
    const now = new Date();
    const r = await this.prisma.product.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { status } });
    if (status === 'ACTIVE') await this.prisma.product.updateMany({ where: { id: { in: ids }, publishedAt: null }, data: { publishedAt: now } });
    return { updated: r.count };
  }

  async setFeatured(ids: string[], isFeatured: boolean) {
    const r = await this.prisma.product.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { isFeatured } });
    return { updated: r.count };
  }
}
