import { Injectable } from '@nestjs/common';
import { parseSearchQuery, type SearchResponse } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from '../ai/embedding.service';
import { ProductsService } from '../products/products.service';
import { productWhere, type ProductFilter } from '../products/product-query';

export interface SearchInput {
  q?: string; page: number; pageSize: number; categoryIds?: string[]; gender?: ProductFilter['gender'];
  sizes?: string[]; colors?: string[]; minPrice?: number; maxPrice?: number; sort?: string; inStock?: boolean;
}

const MAX_SEMANTIC = 240;
// Below this cosine similarity a vector hit is noise, not a match.
const MIN_TEXT_SCORE = 0.2;
// Keep hits within this fraction of the best score: precise queries return a
// tight list, vague ones ("something for diwali") keep their broader recall.
const RELATIVE_CUTOFF = 0.65;
const STOPWORDS = new Set(['something', 'wear', 'outfit', 'with', 'that', 'this', 'from', 'look', 'nice', 'good', 'best', 'want', 'need']);

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService, private readonly embeddings: EmbeddingService, private readonly products: ProductsService) {}

  private mergeFilters(input: SearchInput, parsed?: ReturnType<typeof parseSearchQuery>): ProductFilter {
    return {
      categoryIds: input.categoryIds,
      gender: input.gender ?? parsed?.gender,
      sizes: input.sizes?.length ? input.sizes : parsed?.sizes.length ? parsed.sizes : undefined,
      colors: input.colors?.length ? input.colors : parsed?.colors.length ? parsed.colors : undefined,
      minPrice: input.minPrice ?? parsed?.minPrice,
      maxPrice: input.maxPrice ?? parsed?.maxPrice,
      inStock: input.inStock,
    };
  }

  /**
   * Hybrid text search: NL constraints → SQL filters; remaining text → vector
   * similarity (text vectors, and image vectors when the model is multimodal),
   * blended with a keyword-match boost. Degrades to keyword search if the
   * embedding provider fails.
   */
  async text(input: SearchInput, ctx: { userId?: string }): Promise<SearchResponse> {
    const started = Date.now();
    const raw = (input.q ?? '').trim();
    const parsed = parseSearchQuery(raw);
    const filter = this.mergeFilters(input, parsed);
    const prov = this.embeddings.provider;
    const vec = raw ? await this.embeddings.embedQueryText(parsed.semanticText) : null;

    let ids: string[] = [];
    let total = 0;
    const scores = new Map<string, number>();
    let mode: SearchResponse['interpretation']['mode'] = 'keyword';

    if (vec && (!input.sort || input.sort === 'relevance')) {
      mode = 'semantic';
      const textHits = await this.embeddings.nearest(vec, prov.textModel, ['TEXT'], filter, MAX_SEMANTIC);
      for (const h of textHits) if (h.score >= MIN_TEXT_SCORE) scores.set(h.productId, h.score);
      if (prov.multimodal) {
        const imgHits = await this.embeddings.nearest(vec, prov.imageModel, ['IMAGE'], filter, MAX_SEMANTIC);
        for (const h of imgHits) scores.set(h.productId, Math.max(scores.get(h.productId) ?? 0, h.score * 0.85));
      }
      // Keyword boost: each meaningful query token found in a product's tags or
      // name adds weight, so "diwali" lifts items tagged diwali above vague neighbours.
      for (const [id, hits] of await this.tokenMatches(parsed.semanticText, filter)) scores.set(id, (scores.get(id) ?? 0.3) + Math.min(0.2, 0.08 * hits));
      const sorted = [...scores].sort((a, b) => b[1] - a[1]);
      const floor = (sorted[0]?.[1] ?? 0) * RELATIVE_CUTOFF;
      const ranked = sorted.filter(([, sc]) => sc >= floor);
      total = ranked.length;
      ids = ranked.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(([id]) => id);
    }
    if (mode === 'keyword' || total === 0) {
      mode = 'keyword';
      const r = await this.products.idsPage({ ...filter, keyword: raw ? parsed.semanticText : undefined }, input.sort ?? 'relevance', input.page, input.pageSize);
      ids = r.ids;
      total = r.total;
    }
    const items = await this.products.cardsByIds(ids, mode === 'semantic' ? scores : undefined);
    await this.prisma.searchHistory.create({ data: { userId: ctx.userId, query: raw.slice(0, 300), mode, filters: JSON.parse(JSON.stringify(filter)), resultCount: total, latencyMs: Date.now() - started } }).catch(() => undefined);
    return {
      items,
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) },
      interpretation: { semanticText: parsed.semanticText, filters: stripEmpty(filter), mode, model: mode === 'semantic' ? prov.textModel : null },
    };
  }

  /** Photo → image vector → nearest product images; optional text refines (hybrid). */
  async visual(image: Buffer, input: SearchInput & { refine?: string }, ctx: { userId?: string }): Promise<SearchResponse> {
    const started = Date.now();
    const prov = this.embeddings.provider;
    const parsed = input.refine ? parseSearchQuery(input.refine) : undefined;
    const filter = this.mergeFilters(input, parsed);
    const vec = await this.embeddings.embedQueryImage(image, 'image/jpeg');
    const scores = new Map<string, number>();
    for (const h of await this.embeddings.nearest(vec, prov.imageModel, ['IMAGE'], filter, MAX_SEMANTIC)) scores.set(h.productId, h.score);
    if (prov.multimodal) {
      for (const h of await this.embeddings.nearest(vec, prov.textModel, ['TEXT'], filter, MAX_SEMANTIC)) scores.set(h.productId, Math.max(scores.get(h.productId) ?? 0, h.score * 0.8));
    }
    let mode: SearchResponse['interpretation']['mode'] = 'visual';
    if (parsed?.semanticText) {
      mode = 'hybrid';
      const tv = await this.embeddings.embedQueryText(parsed.semanticText);
      if (tv) {
        const textScores = new Map((await this.embeddings.nearest(tv, prov.textModel, ['TEXT'], filter, MAX_SEMANTIC)).map((h) => [h.productId, h.score]));
        for (const [id, s] of scores) scores.set(id, 0.65 * s + 0.35 * (textScores.get(id) ?? 0));
      }
    }
    const ranked = [...scores].sort((a, b) => b[1] - a[1]);
    const ids = ranked.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(([id]) => id);
    await this.prisma.searchHistory.create({ data: { userId: ctx.userId, query: input.refine?.slice(0, 300), mode, filters: JSON.parse(JSON.stringify(filter)), resultCount: ranked.length, latencyMs: Date.now() - started } }).catch(() => undefined);
    return {
      items: await this.products.cardsByIds(ids, scores),
      meta: { page: input.page, pageSize: input.pageSize, total: ranked.length, totalPages: Math.max(1, Math.ceil(ranked.length / input.pageSize)) },
      interpretation: { semanticText: parsed?.semanticText ?? '', filters: stripEmpty(filter), mode, model: prov.imageModel },
    };
  }

  private async tokenMatches(text: string, filter: ProductFilter): Promise<Map<string, number>> {
    const tokens = [...new Set(text.toLowerCase().replace(/t-shirts?/g, 'tshirt').split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t)))].slice(0, 8);
    if (!tokens.length) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: string; hits: number }[]>`
      SELECT p.id, (SELECT count(*) FROM unnest(${tokens}::text[]) t
                     WHERE t = ANY(p.tags) OR p.name ILIKE '%' || t || '%')::int AS hits
        FROM products p WHERE ${productWhere(filter)}`;
    return new Map(rows.filter((r) => r.hits > 0).map((r) => [r.id, r.hits]));
  }

  async suggest(q: string) {
    const term = q.trim();
    if (term.length < 2) return { products: [], categories: [] };
    const like = `%${term}%`;
    const [products, categories] = await Promise.all([
      this.prisma.$queryRaw<{ slug: string; name: string; imageUrl: string | null; price: string }[]>`
        SELECT p.slug, p.name, p."minPrice"::text AS price,
               (SELECT i."thumbUrl" FROM product_images i WHERE i."productId" = p.id ORDER BY i."sortOrder" LIMIT 1) AS "imageUrl"
          FROM products p WHERE p.status = 'ACTIVE' AND p."deletedAt" IS NULL AND (p.name ILIKE ${like} OR similarity(p.name, ${term}) > 0.2)
         ORDER BY similarity(p.name, ${term}) DESC, p."soldCount" DESC LIMIT 6`,
      this.prisma.category.findMany({ where: { isActive: true, deletedAt: null, name: { contains: term, mode: 'insensitive' } }, select: { slug: true, name: true }, take: 4 }),
    ]);
    return { products: products.map((p) => ({ ...p, price: Number(p.price) })), categories };
  }
}

function stripEmpty(f: ProductFilter) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length)));
}
