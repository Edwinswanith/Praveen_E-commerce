import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnrecoverableError, type Job } from 'bullmq';
import type { EmbeddingStatusDto } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { StorageService } from '../../common/storage/storage.service';
import { productWhere, type ProductFilter } from '../products/product-query';
import { contentHash, EmbeddingProviderError, GeminiEmbeddingProvider, LocalEmbeddingProvider, type EmbeddingProvider } from './providers';

export const EMBEDDING_QUEUE = 'embeddings';
const toVectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(7) : '0')).join(',')}]`;

export function createProvider(env: Env): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === 'gemini') return new GeminiEmbeddingProvider(env.GEMINI_API_KEY, env.GEMINI_EMBEDDING_MODEL, env.EMBEDDING_DIMENSIONS);
  return new LocalEmbeddingProvider(env.EMBEDDING_DIMENSIONS);
}

/**
 * Product embedding pipeline:
 *   product/image change → enqueue (non-blocking) → worker builds text + reads
 *   images → provider → vectors persisted with model id + content hash.
 * Unchanged content (same hash, same model) is skipped, so re-runs are cheap.
 * Commerce flows never wait on this: failures only degrade search ranking.
 */
@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger('Embeddings');
  readonly provider: EmbeddingProvider;

  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {
    if (env.EMBEDDING_DIMENSIONS !== 768) throw new Error('EMBEDDING_DIMENSIONS must match the vector(768) column; add a migration to change it');
    this.provider = createProvider(env);
  }

  onModuleInit() {
    this.queue.process(EMBEDDING_QUEUE, (job: Job<{ productId: string; jobId: string }>) => this.runJob(job), 2);
  }

  async enqueue(productId: string) {
    const job = await this.prisma.embeddingJob.create({ data: { productId, model: this.provider.textModel } });
    try {
      await this.queue.add(EMBEDDING_QUEUE, 'embed-product', { productId, jobId: job.id }, { delay: this.queue.enabled ? 1500 : 0 });
    } catch (e) {
      // Queue outage must never break the admin save that triggered it.
      this.logger.warn(`Could not enqueue embedding for ${productId}: ${(e as Error).message}`);
      await this.prisma.embeddingJob.update({ where: { id: job.id }, data: { status: 'FAILED', lastError: 'Queue unavailable; use Reindex' } });
    }
  }

  private async runJob(job: Job<{ productId: string; jobId: string }>) {
    const { productId, jobId } = job.data;
    await this.prisma.embeddingJob.updateMany({ where: { id: jobId }, data: { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 } } });
    try {
      const r = await this.processProduct(productId);
      await this.prisma.embeddingJob.updateMany({ where: { id: jobId }, data: { status: 'COMPLETED', completedAt: new Date(), lastError: null } });
      return r;
    } catch (e) {
      const err = e as Error;
      const retryable = !(e instanceof EmbeddingProviderError) || e.retryable;
      const finalAttempt = !retryable || job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
      await this.prisma.embeddingJob.updateMany({ where: { id: jobId }, data: { status: finalAttempt ? 'FAILED' : 'PENDING', lastError: err.message.slice(0, 500) } });
      if (!this.queue.enabled) return; // inline mode: record failure, don't throw into caller
      throw retryable ? err : new UnrecoverableError(err.message);
    }
  }

  static buildText(p: {
    name: string; brand: string; gender: string; description: string; tags: string[];
    category: { name: string }; attributes: { key: string; value: string }[]; variants: { color: string }[];
  }, categoryPath: string[] = []) {
    const colors = [...new Set(p.variants.map((v) => v.color))].join(', ');
    const attrs = p.attributes.map((a) => `${a.key}: ${a.value}`).join('; ');
    const gender = { MEN: "men's", WOMEN: "women's", KIDS: "kids'", UNISEX: 'unisex' }[p.gender] ?? '';
    return [
      `${p.name} by ${p.brand}`,
      `${gender} ${categoryPath.length ? categoryPath.join(' > ') : p.category.name}`,
      colors && `Colours: ${colors}`,
      attrs,
      p.tags.length ? `Style: ${p.tags.join(', ')}` : '',
      p.description,
    ].filter(Boolean).join('\n');
  }

  private async upsert(productId: string, kind: 'TEXT' | 'IMAGE', imageId: string | null, model: string, hash: string, vector: number[]) {
    await this.prisma.$transaction([
      this.prisma.productEmbedding.deleteMany({ where: { productId, kind, imageId, model } }),
      this.prisma.$executeRaw`
        INSERT INTO product_embeddings (id, "productId", "imageId", kind, model, dimensions, "contentHash", vector)
        VALUES (${`emb_${hash.slice(0, 10)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`}, ${productId}, ${imageId}, ${kind}::"EmbeddingKind", ${model}, ${vector.length}, ${hash}, ${toVectorLiteral(vector)}::vector)`,
    ]);
  }

  async processProduct(productId: string) {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: { include: { parent: true } }, attributes: true, variants: { where: { isActive: true }, select: { color: true } }, images: true, embeddings: { select: { kind: true, imageId: true, model: true, contentHash: true } } },
    });
    if (!p || p.deletedAt) return { skipped: true };
    const prov = this.provider;
    const path = [p.category.parent?.name, p.category.name].filter(Boolean) as string[];
    const text = EmbeddingService.buildText(p, path);
    const textHash = contentHash(text);
    let embedded = 0;

    const hasText = p.embeddings.some((e) => e.kind === 'TEXT' && e.model === prov.textModel && e.contentHash === textHash);
    if (!hasText) {
      const [vec] = await prov.embedTexts([text]);
      await this.upsert(p.id, 'TEXT', null, prov.textModel, textHash, vec!);
      await this.prisma.product.update({ where: { id: p.id }, data: { textHash } });
      embedded++;
    }
    for (const img of p.images) {
      const has = p.embeddings.some((e) => e.kind === 'IMAGE' && e.imageId === img.id && e.model === prov.imageModel && e.contentHash === img.contentHash);
      if (has) continue;
      const buf = await this.storage.get(img.storageKey);
      const vec = await prov.embedImage(buf, img.mimeType);
      await this.upsert(p.id, 'IMAGE', img.id, prov.imageModel, img.contentHash, vec);
      embedded++;
    }
    return { embedded };
  }

  async embedQueryText(text: string): Promise<number[] | null> {
    try {
      const [v] = await this.provider.embedTexts([text]);
      return v ?? null;
    } catch (e) {
      this.logger.warn(`Query embedding failed, falling back to keyword search: ${(e as Error).message}`);
      return null;
    }
  }

  async embedQueryImage(image: Buffer, mime: string): Promise<number[]> {
    return this.provider.embedImage(image, mime);
  }

  /**
   * Nearest products by cosine similarity. Only vectors whose model equals the
   * query model are considered. The HNSW index picks the nearest candidates,
   * then structured filters and per-product max-aggregation are applied.
   */
  async nearest(vector: number[], model: string, kinds: ('TEXT' | 'IMAGE')[], filter: ProductFilter, limit: number, candidatePool = 600) {
    const lit = toVectorLiteral(vector);
    return this.prisma.$queryRaw<{ productId: string; score: number }[]>`
      WITH candidates AS (
        SELECT e."productId", 1 - (e.vector <=> ${lit}::vector) AS score
          FROM product_embeddings e
         WHERE e.model = ${model} AND e.kind::text IN (${Prisma.join(kinds)})
         ORDER BY e.vector <=> ${lit}::vector
         LIMIT ${candidatePool}
      )
      SELECT c."productId", max(c.score)::float8 AS score
        FROM candidates c JOIN products p ON p.id = c."productId"
       WHERE ${productWhere(filter)}
       GROUP BY c."productId"
       ORDER BY score DESC
       LIMIT ${limit}`;
  }

  async status(): Promise<EmbeddingStatusDto> {
    const [counts, indexed, total] = await Promise.all([
      this.prisma.embeddingJob.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
      this.prisma.productEmbedding.findMany({ where: { model: this.provider.textModel, kind: 'TEXT' }, select: { productId: true }, distinct: ['productId'] }),
      this.prisma.product.count({ where: { deletedAt: null } }),
    ]);
    const c = Object.fromEntries(counts.map((x) => [x.status, x._count])) as Record<string, number>;
    return {
      provider: this.provider.name, model: this.provider.textModel, dimensions: this.provider.dimensions, configured: this.provider.configured,
      counts: { pending: c.PENDING ?? 0, processing: c.PROCESSING ?? 0, completed: c.COMPLETED ?? 0, failed: c.FAILED ?? 0 },
      productsIndexed: indexed.length, productsTotal: total,
    };
  }
}
