import IORedis from 'ioredis';
import { MAX_PREVIEWS_PER_PRODUCT, PhotoPreviewStore, PREVIEW_TTL_SECONDS, type PhotoPreviewMeta } from '../../src/modules/ai/photo-preview.store';
import type { QueueService } from '../../src/common/queue/queue.service';

const meta = (productId: string): PhotoPreviewMeta => ({ productId, sourceImageId: 'img1', style: 'MARKETPLACE', color: 'Red', alt: 'x', aiPrompt: 'p', actorId: 'u', createdAt: new Date().toISOString() });

// Production path (QUEUES_ENABLED): previews live in Redis, shared by all API instances.
describe('PhotoPreviewStore (Redis)', () => {
  const redis = new IORedis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
  const store = new PhotoPreviewStore({ redis } as unknown as QueueService);
  const product = `test-${Date.now()}`;
  beforeAll(() => redis.connect());
  afterAll(async () => {
    const keys = await redis.keys('vyra:ai-preview*');
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('round-trips binary image bytes and sets a TTL', async () => {
    const image = Buffer.from([0, 255, 1, 254, 0x89, 0x50, 0x4e, 0x47, 0]);
    const { id, expiresAt } = await store.put(meta(product), image);
    const got = await store.get(id);
    expect(got?.image.equals(image)).toBe(true);
    expect(got?.meta.productId).toBe(product);
    const ttl = await redis.ttl(`vyra:ai-preview:${id}`);
    expect(ttl).toBeGreaterThan(PREVIEW_TTL_SECONDS - 5);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + (PREVIEW_TTL_SECONDS - 5) * 1000);
  });

  it('take() succeeds for exactly one of several concurrent callers', async () => {
    const { id } = await store.put(meta(product), Buffer.from('img'));
    const results = await Promise.all([1, 2, 3, 4].map(() => store.take(id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.get(id)).toBeNull();
  });

  it(`keeps at most ${MAX_PREVIEWS_PER_PRODUCT} unreviewed previews per product`, async () => {
    const p2 = `${product}-cap`;
    const ids: string[] = [];
    for (let i = 0; i < MAX_PREVIEWS_PER_PRODUCT + 2; i++) ids.push((await store.put(meta(p2), Buffer.from(`img${i}`))).id);
    expect(await store.get(ids[0]!)).toBeNull();
    expect(await store.get(ids[1]!)).toBeNull();
    expect(await store.get(ids.at(-1)!)).not.toBeNull();
  });
});

describe('PhotoPreviewStore (memory fallback)', () => {
  const store = new PhotoPreviewStore({ redis: null } as unknown as QueueService);
  it('expires previews and caps per product', async () => {
    const { id } = await store.put(meta('m1'), Buffer.from('a'));
    expect(await store.get(id)).not.toBeNull();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + (PREVIEW_TTL_SECONDS + 1) * 1000);
    expect(await store.get(id)).toBeNull();
    spy.mockRestore();
    const ids = [];
    for (let i = 0; i < MAX_PREVIEWS_PER_PRODUCT + 1; i++) ids.push((await store.put(meta('m2'), Buffer.from(`b${i}`))).id);
    expect(await store.get(ids[0]!)).toBeNull();
    expect(await store.get(ids.at(-1)!)).not.toBeNull();
    expect(await store.take(ids.at(-1)!)).toBe(true);
    expect(await store.take(ids.at(-1)!)).toBe(false);
  });
});
