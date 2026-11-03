import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { QueueService } from '../queue/queue.service';
import { AppError } from '../http/errors';

/**
 * Counts attempts per arbitrary key (a phone, an email, an order number) across
 * all API instances via Redis, independent of the client IP, so an attacker
 * rotating IPs still hits the limit. Falls back to process memory when Redis is
 * not configured (tests, single-node dev). Keys are hashed: no PII in Redis.
 */
@Injectable()
export class AttemptLimiter {
  private readonly memory = new Map<string, { n: number; until: number }>();

  constructor(private readonly queue: QueueService) {}

  private key(scope: string, id: string) {
    return `vyra:att:${scope}:${createHash('sha256').update(id.toLowerCase()).digest('hex').slice(0, 32)}`;
  }

  async count(scope: string, id: string): Promise<number> {
    const k = this.key(scope, id);
    const redis = this.queue.redis;
    if (redis) return Number((await redis.get(k)) ?? 0);
    const m = this.memory.get(k);
    return m && m.until > Date.now() ? m.n : 0;
  }

  async hit(scope: string, id: string, windowSeconds: number): Promise<number> {
    const k = this.key(scope, id);
    const redis = this.queue.redis;
    if (redis) {
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSeconds);
      return n;
    }
    const m = this.memory.get(k);
    const next = m && m.until > Date.now() ? { n: m.n + 1, until: m.until } : { n: 1, until: Date.now() + windowSeconds * 1000 };
    this.memory.set(k, next);
    return next.n;
  }

  async reset(scope: string, id: string) {
    const k = this.key(scope, id);
    const redis = this.queue.redis;
    if (redis) await redis.del(k);
    else this.memory.delete(k);
  }

  /** Throws 429 when `id` already used up `max` attempts in the current window. */
  async assertUnder(scope: string, id: string, max: number, message: string) {
    if ((await this.count(scope, id)) >= max) throw new AppError('RATE_LIMITED', message, 429);
  }
}
