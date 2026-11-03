import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ImageGenService } from '../src/modules/ai/image-gen.service';
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
      return sharp({ create: { width: 800, height: 1000, channels: 3, background: '#335533' } }).jpeg().toBuffer();
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
    const p = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(cat.id), name: 'Kids Dino Tee', gender: 'KIDS' }).expect(201)).body.data;
    calls.length = 0;
    await admin.post(`/api/v1/admin/products/${p.id}/images/generate`).set(H).send({ style: 'MODEL' }).expect(201);
    expect(calls[0]!.prompt).toMatch(/ghost mannequin/);
    expect(calls[0]!.prompt).not.toMatch(/wearing/);
    const orders = await createStaff(app, 'ORDER_MANAGER');
    await orders.post(`/api/v1/admin/products/${p.id}/images/generate`).set(H).send({ style: 'STUDIO' }).expect(403);
  });
});
