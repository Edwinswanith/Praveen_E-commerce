import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { QueueService } from '../../common/queue/queue.service';

export interface PhotoPreviewMeta {
  productId: string;
  sourceImageId: string | null;
  style: string;
  color: string;
  alt: string;
  aiPrompt: string;
  actorId: string;
  createdAt: string;
}

export const PREVIEW_TTL_SECONDS = 30 * 60;
/** Unreviewed previews per product. Each one is a paid generation, so a runaway client is capped here too. */
export const MAX_PREVIEWS_PER_PRODUCT = 6;

/**
 * Holds generated-but-unreviewed AI photos. Nothing here is part of the product:
 * a preview becomes a ProductImage only when staff accept it, and expires on its own
 * otherwise (no orphan files in storage). Redis when queues are enabled (shared by
 * every API instance), in-process memory otherwise (tests, single dev process).
 */
@Injectable()
export class PhotoPreviewStore {
  private readonly mem = new Map<string, { meta: PhotoPreviewMeta; image: Buffer; expires: number }>();

  constructor(private readonly queue: QueueService) {}

  private key(id: string) {
    return `vyra:ai-preview:${id}`;
  }

  private listKey(productId: string) {
    return `vyra:ai-preview-list:${productId}`;
  }

  /** Stores the RAW generator output; accepting re-runs the normal image pipeline on it. */
  async put(meta: PhotoPreviewMeta, image: Buffer): Promise<{ id: string; expiresAt: Date }> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000);
    const redis = this.queue.redis;
    if (redis) {
      const list = this.listKey(meta.productId);
      await redis.multi()
        .hset(this.key(id), 'meta', JSON.stringify(meta), 'image', image)
        .expire(this.key(id), PREVIEW_TTL_SECONDS)
        .lpush(list, id)
        .ltrim(list, 0, MAX_PREVIEWS_PER_PRODUCT - 1)
        .expire(list, PREVIEW_TTL_SECONDS)
        .exec(); // a preview trimmed off the list is no longer served (see get) and expires with its TTL
    } else {
      this.sweep();
      // Map iteration is insertion order: drop this product's oldest previews beyond the cap.
      const mine = [...this.mem.keys()].filter((k) => this.mem.get(k)!.meta.productId === meta.productId);
      for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_PREVIEWS_PER_PRODUCT - 1)))) this.mem.delete(old);
      this.mem.set(id, { meta, image, expires: expiresAt.getTime() });
    }
    return { id, expiresAt };
  }

  async get(id: string): Promise<{ meta: PhotoPreviewMeta; image: Buffer } | null> {
    const redis = this.queue.redis;
    if (redis) {
      const [meta, image] = await Promise.all([redis.hget(this.key(id), 'meta'), redis.hgetBuffer(this.key(id), 'image')]);
      if (!meta || !image) return null;
      const m = JSON.parse(meta) as PhotoPreviewMeta;
      // A preview evicted from its product's list no longer counts as live.
      const live = await redis.lrange(this.listKey(m.productId), 0, -1);
      return live.includes(id) ? { meta: m, image } : null;
    }
    this.sweep();
    const v = this.mem.get(id);
    return v ? { meta: v.meta, image: v.image } : null;
  }

  /**
   * Removes a preview. Returns true for exactly one caller, so two concurrent
   * "accept" clicks can't both save the image.
   */
  async take(id: string): Promise<boolean> {
    const redis = this.queue.redis;
    if (redis) {
      const meta = await redis.hget(this.key(id), 'meta');
      const removed = await redis.del(this.key(id));
      if (meta) await redis.lrem(this.listKey((JSON.parse(meta) as PhotoPreviewMeta).productId), 0, id);
      return removed === 1;
    }
    return this.mem.delete(id);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.mem) if (v.expires <= now) this.mem.delete(k);
  }
}
