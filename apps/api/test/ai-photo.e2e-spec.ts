import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ImageGenService } from '../src/modules/ai/image-gen.service';
import { PhotoPreviewStore } from '../src/modules/ai/photo-preview.store';
import { StorageService } from '../src/common/storage/storage.service';
import { bootApp, createCategory, createStaff, H, productInput } from './helpers';

describe('AI studio photo (integration, Gemini stubbed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const calls: { prompt: string; refs: number }[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    const gen = app.get(ImageGenService);
    Object.defineProperty(gen, 'configured', { get: () => true });
    jest.spyOn(gen, 'generate').mockImplementation(async (prompt, refs = []) => {
      calls.push({ prompt, refs: refs.length });
      // White studio background with the "garment" in the middle, like a good marketplace shot.
      return sharp({ create: { width: 800, height: 1000, channels: 3, background: '#ffffff' } })
        .composite([{ input: await sharp({ create: { width: 500, height: 800, channels: 3, background: '#335533' } }).png().toBuffer(), top: 100, left: 150 }])
        .png().toBuffer();
    });
  });
  afterAll(() => app.close());

  it('restyles a real garment photo, flags it as AI and keeps the garment locked', async () => {
    const admin = await createStaff(app, 'ADMIN');
    const cat = await createCategory(prisma);
    const p = (await admin.post('/api/v1/admin/products').set(H).send(productInput(cat.id)).expect(201)).body.data;
    const phone = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#111' } }).jpeg().toBuffer();
    const [real] = (await admin.post(`/api/v1/admin/products/${p.id}/images`).set(H).field('color', 'Black').attach('files', phone, 'phone.jpg').expect(201)).body.data;
    expect(real.aiGenerated).toBe(false);

    const out = (await admin.post(`/api/v1/admin/products/${p.id}/images/generate`).set(H).send({ sourceImageId: real.id, style: 'MODEL', count: 2 }).expect(201)).body.data;
    expect(out).toHaveLength(2);
    expect(out.every((i: { aiGenerated: boolean; color: string }) => i.aiGenerated && i.color === 'Black')).toBe(true);
    expect(calls.every((c) => c.refs === 1 && /Do not redesign, recolour/.test(c.prompt))).toBe(true);
    const pdp = (await request(app.getHttpServer()).get(`/api/v1/products/${p.slug}`).expect(200)).body.data;
    expect(pdp.images.filter((i: { aiGenerated: boolean }) => i.aiGenerated)).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'product.image.ai_generate' } })).toBe(1);
  });

  it('never generates a child model and needs catalog:write', async () => {
    const admin = await createStaff(app, 'ADMIN', 'admin2@test.local');
    const cat = await createCategory(prisma, 'kids-boys', 'BOY');
    const p = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(cat.id), name: 'Kids Dino Tee', gender: 'KIDS', status: 'DRAFT' }).expect(201)).body.data;
    calls.length = 0;
    await admin.post(`/api/v1/admin/products/${p.id}/images/generate`).set(H).send({ style: 'MODEL' }).expect(201);
    expect(calls[0]!.prompt).toMatch(/ghost mannequin/);
    expect(calls[0]!.prompt).not.toMatch(/wearing/);
    const orders = await createStaff(app, 'ORDER_MANAGER');
    await orders.post(`/api/v1/admin/products/${p.id}/images/generate`).set(H).send({ style: 'STUDIO' }).expect(403);
  });

  describe('preview → accept / regenerate / keep original', () => {
    // The preview route is throttled per client IP (paid model); each test is its own client.
    let HX: Record<string, string> = H;
    let n = 0;
    beforeEach(() => { HX = { ...H, 'X-Forwarded-For': `10.55.${++n}.1` }; });
    const phone = () => sharp({ create: { width: 700, height: 900, channels: 3, background: '#8a3b2b' } }).jpeg().toBuffer();
    let shared: Awaited<ReturnType<typeof createStaff>> | undefined;
    const setup = async (email: string, status: 'ACTIVE' | 'DRAFT' = 'ACTIVE') => {
      shared ??= await createStaff(app, 'ADMIN', 'preview-admin@test.local'); // login is throttled; one session for the suite
      const admin = shared;
      const cat = await createCategory(prisma, `cat-${email.split('@')[0]}`);
      const p = (await admin.post('/api/v1/admin/products').set(HX).send({ ...productInput(cat.id), status }).expect(201)).body.data;
      const [real] = (await admin.post(`/api/v1/admin/products/${p.id}/images`).set(HX).field('color', 'Rust').attach('files', await phone(), 'phone.jpg').expect(201)).body.data;
      return { admin, p, real };
    };
    const imagesOf = (productId: string) => prisma.productImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });

    it('previews without saving, then accepting as primary saves a separate AI image and leaves the original untouched', async () => {
      const { admin, p, real } = await setup('prev1@test.local');
      const before = await prisma.productImage.findUniqueOrThrow({ where: { id: real.id } });
      const originalBytes = await app.get(StorageService).get(before.storageKey);
      calls.length = 0;

      const pv = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: real.id }).expect(201)).body.data;
      expect(calls).toHaveLength(1);
      expect(calls[0]!.refs).toBe(1); // the real photo is sent to the model
      expect(calls[0]!.prompt).toMatch(/pure white \(#FFFFFF\)/); // MARKETPLACE is the default style
      expect(calls[0]!.prompt).toMatch(/Do not redesign, recolour/);
      expect(pv.style).toBe('MARKETPLACE');
      expect(pv.dataUrl).toMatch(/^data:image\/webp;base64,/);
      expect(pv.source).toMatchObject({ id: real.id, url: real.url });
      expect(pv.edgeWhiteRatio).toBeGreaterThan(0.95);
      expect(pv.color).toBe('Rust');
      expect(await imagesOf(p.id)).toHaveLength(1); // nothing saved yet
      const publicBefore = (await request(app.getHttpServer()).get(`/api/v1/products/${p.slug}`).expect(200)).body.data;
      expect(publicBefore.images).toHaveLength(1);

      const acc = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews/${pv.previewId}/accept`).set(HX).send({ placement: 'PRIMARY' }).expect(201)).body.data;
      expect(acc).toMatchObject({ aiGenerated: true, sourceImageId: real.id, sortOrder: 0, color: 'Rust' });
      const after = await imagesOf(p.id);
      expect(after.map((i) => i.id)).toEqual([acc.id, real.id]);
      // The original row and file are unchanged (only its position moved).
      const orig = after[1]!;
      expect({ url: orig.url, storageKey: orig.storageKey, contentHash: orig.contentHash, aiGenerated: orig.aiGenerated }).toEqual({ url: before.url, storageKey: before.storageKey, contentHash: before.contentHash, aiGenerated: false });
      expect((await app.get(StorageService).get(before.storageKey)).equals(originalBytes)).toBe(true);
      // The accepted image is the bytes that were previewed.
      const stored = await app.get(StorageService).get(after[0]!.storageKey);
      expect(stored.toString('base64')).toBe(pv.dataUrl.split(',')[1]);
      // Storefront: shown first and disclosed as AI.
      const pdp = (await request(app.getHttpServer()).get(`/api/v1/products/${p.slug}`).expect(200)).body.data;
      expect(pdp.images[0]).toMatchObject({ id: acc.id, aiGenerated: true });
      const card = (await request(app.getHttpServer()).get(`/api/v1/products?pageSize=48`).expect(200)).body.data.items.find((c: { id: string }) => c.id === p.id);
      if (card) expect(JSON.stringify(card)).toContain(after[0]!.thumbUrl);
      // Scanner (barcode identify) shows the new primary image.
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: p.id }, include: { barcodes: true } });
      const scan = (await admin.post('/api/v1/admin/scans').set(HX).send({ code: variant.sku, mode: 'IDENTIFY' }).expect(200)).body.data;
      expect(scan.variant.imageUrl).toBe(after[0]!.thumbUrl);
      expect(await prisma.auditLog.count({ where: { action: { in: ['product.image.ai_preview', 'product.image.ai_accept'] }, entityId: { in: [p.id, acc.id] } } })).toBe(2);
      // Accepting twice is refused (the preview is consumed).
      await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews/${pv.previewId}/accept`).set(HX).send({}).expect(404);
    });

    it('regenerate gives a new preview; keep original discards it and saves nothing', async () => {
      const { admin, p, real } = await setup('prev2@test.local');
      const a = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: real.id, style: 'MODEL' }).expect(201)).body.data;
      const b = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: real.id, style: 'MODEL', notes: 'softer light' }).expect(201)).body.data;
      expect(a.previewId).not.toBe(b.previewId);
      await admin.delete(`/api/v1/admin/products/${p.id}/images/ai-previews/${a.previewId}`).set(HX).expect(200);
      await admin.delete(`/api/v1/admin/products/${p.id}/images/ai-previews/${a.previewId}`).set(HX).expect(200); // idempotent
      await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews/${a.previewId}/accept`).set(HX).send({}).expect(404);
      await admin.delete(`/api/v1/admin/products/${p.id}/images/ai-previews/${b.previewId}`).set(HX).expect(200);
      const imgs = await imagesOf(p.id);
      expect(imgs.map((i) => i.id)).toEqual([real.id]);
    });

    it('two concurrent accepts of one preview save exactly one image', async () => {
      const { admin, p, real } = await setup('prev3@test.local');
      const pv = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: real.id }).expect(201)).body.data;
      const rs = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews/${pv.previewId}/accept`).set(HX).send({ placement: 'END' })));
      expect(rs.map((r) => r.status).sort()).toEqual([201, 404, 404]);
      const imgs = await imagesOf(p.id);
      expect(imgs.filter((i) => i.aiGenerated)).toHaveLength(1);
      expect(imgs.map((i) => i.sortOrder)).toEqual([0, 1]);
    });

    it('enforces rule 15: live products need a real (non-AI) source photo; drafts may generate from details', async () => {
      const { admin, p, real } = await setup('prev4@test.local');
      calls.length = 0;
      const noSource = await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({}).expect(400);
      expect(noSource.body.error.message).toMatch(/real photo/);
      await admin.post(`/api/v1/admin/products/${p.id}/images/generate`).set(HX).send({ style: 'STUDIO' }).expect(400); // legacy route too
      const pv = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: real.id }).expect(201)).body.data;
      const ai = (await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews/${pv.previewId}/accept`).set(HX).send({}).expect(201)).body.data;
      await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: ai.id }).expect(400); // no AI-of-AI drift
      await admin.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: 'cl0000000000000000000000x' }).expect(404);
      expect(calls).toHaveLength(1); // refused requests never reach the paid model

      const draft = await setup('prev5@test.local', 'DRAFT');
      const d = (await draft.admin.post(`/api/v1/admin/products/${draft.p.id}/images/ai-previews`).set(HX).send({ style: 'FLATLAY' }).expect(201)).body.data;
      expect(d.source).toBeNull();
    });

    it("a preview can't be accepted onto another product, and expires", async () => {
      const one = await setup('prev6@test.local');
      const two = await setup('prev7@test.local');
      const pv = (await one.admin.post(`/api/v1/admin/products/${one.p.id}/images/ai-previews`).set(HX).send({ sourceImageId: one.real.id }).expect(201)).body.data;
      await one.admin.post(`/api/v1/admin/products/${two.p.id}/images/ai-previews/${pv.previewId}/accept`).set(HX).send({}).expect(404);
      await one.admin.delete(`/api/v1/admin/products/${two.p.id}/images/ai-previews/${pv.previewId}`).set(HX).expect(200);
      expect(await app.get(PhotoPreviewStore).get(pv.previewId)).not.toBeNull(); // a foreign discard doesn't touch it
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
      try {
        expect(await app.get(PhotoPreviewStore).get(pv.previewId)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('needs catalog:write and validates input', async () => {
      const { p, real } = await setup('prev8@test.local');
      const om = await createStaff(app, 'ORDER_MANAGER', 'om-prev@test.local');
      await om.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ sourceImageId: real.id }).expect(403);
      await shared!.post(`/api/v1/admin/products/${p.id}/images/ai-previews`).set(HX).send({ style: 'CARTOON' }).expect(422);
    });
  });
});
