import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ImageGenService } from '../src/modules/ai/image-gen.service';
import { garmentSlot } from '../src/modules/tryon/tryon.service';
import { bootApp, createCategory, createStaff, H, productInput } from './helpers';

const sid = () => `s_${randomUUID().replace(/-/g, '')}`;
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

describe('Funnel analytics + virtual try-on (integration, Gemini stubbed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let product: { id: string; slug: string; variants: { id: string }[] };
  const genCalls: { prompt: string; refs: number }[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    const gen = app.get(ImageGenService);
    Object.defineProperty(gen, 'configured', { get: () => true });
    jest.spyOn(gen, 'generate').mockImplementation(async (prompt, refs = []) => {
      genCalls.push({ prompt, refs: refs.length });
      return sharp({ create: { width: 800, height: 1000, channels: 3, background: '#aa8800' } }).jpeg().toBuffer();
    });
    admin = await createStaff(app, 'ADMIN');
    const cat = await createCategory(prisma, 'men-ethnic', 'ETH');
    product = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(cat.id), name: 'Festive Kurta' }).expect(201)).body.data;
    const img = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#d9a21b' } }).jpeg().toBuffer();
    await admin.post(`/api/v1/admin/products/${product.id}/images`).set(H).field('color', 'Black').attach('files', img, 'k.jpg').expect(201);
    for (const v of product.variants) await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_IN', quantity: 10, reason: 'stock' }).expect(201);
  });
  afterAll(() => app.close());

  it('records a funnel where revenue events come from the server, not the browser', async () => {
    const http = () => request(app.getHttpServer());
    const s1 = sid(), s2 = sid(), s3 = sid();
    // 3 sessions view; 2 add to bag (server-side); 1 starts checkout and orders.
    for (const [s, device, source] of [[s1, 'mobile', 'tag'], [s2, 'mobile', 'instagram'], [s3, 'desktop', '']] as const) {
      await http().post('/api/v1/events').set(H).send({ sessionId: s, device, ...(source ? { source } : {}), events: [{ type: 'PRODUCT_VIEW', productId: product.id }] }).expect(202);
    }
    // The browser cannot report revenue events.
    await http().post('/api/v1/events').set(H).send({ sessionId: s1, events: [{ type: 'ORDER_PLACED' }] }).expect(422);
    // Unknown product ids are dropped, not stored.
    expect((await http().post('/api/v1/events').set(H).send({ sessionId: s1, events: [{ type: 'PRODUCT_VIEW', productId: 'cl_nope_nope_nope' }] }).expect(202)).body.data.accepted).toBe(0);

    const a1 = request.agent(app.getHttpServer()), a2 = request.agent(app.getHttpServer());
    await a1.post('/api/v1/cart/items').set(H).set('x-vyra-session', s1).set('x-vyra-device', 'mobile').send({ variantId: product.variants[0]!.id, quantity: 1 }).expect(201);
    await a2.post('/api/v1/cart/items').set(H).set('x-vyra-session', s2).send({ variantId: product.variants[0]!.id, quantity: 1 }).expect(201);
    await http().post('/api/v1/events').set(H).send({ sessionId: s1, events: [{ type: 'CHECKOUT_STARTED' }] }).expect(202);
    const body = { address: { fullName: 'F T', phone: '9876512345', line1: '1 Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', type: 'HOME', isDefault: true }, guestEmail: 'f@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() };
    await a1.post('/api/v1/checkout').set(H).set('x-vyra-session', s1).send(body).expect(201);
    await a1.post('/api/v1/checkout').set(H).set('x-vyra-session', s1).send(body).expect(201); // idempotent replay: not double-counted
    // Bots are ignored.
    await http().post('/api/v1/events').set(H).set('user-agent', 'Googlebot/2.1').send({ sessionId: sid(), events: [{ type: 'PRODUCT_VIEW', productId: product.id }] }).expect(202);

    const f = (await admin.get('/api/v1/admin/analytics/funnel').expect(200)).body.data;
    expect(f.steps.map((s: { sessions: number }) => s.sessions)).toEqual([3, 2, 1, 1]);
    expect(f.steps[1].rateFromPrevious).toBe(66.7);
    expect(f.conversionRate).toBe(33.3);
    expect(f.bagAbandonmentRate).toBe(50);
    expect(f.bySource.find((s: { source: string }) => s.source === 'tag')).toMatchObject({ orders: 1, conversionRate: 100 });
    expect(f.byDevice.find((d: { device: string }) => d.device === 'mobile')).toMatchObject({ sessions: 2, orders: 1 });
    expect(f.products[0]).toMatchObject({ views: 3, addToCart: 2, viewToCartRate: 66.7 });
    expect(await prisma.analyticsEvent.count({ where: { type: 'ORDER_PLACED' } })).toBe(1);
  });

  it('refuses kids clothing and requires a session id', async () => {
    const cat = await createCategory(prisma, 'kids-boys', 'BOY');
    const kids = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(cat.id), name: 'Kids Tee', gender: 'KIDS' }).expect(201)).body.data;
    const selfie = await sharp({ create: { width: 700, height: 900, channels: 3, background: '#556677' } }).jpeg().toBuffer();
    const r = await request(app.getHttpServer()).post('/api/v1/try-on').set(H).set('x-vyra-session', sid()).field('productSlug', kids.slug).field('consent', 'true').attach('photo', selfie, 'me.jpg').expect(400);
    expect(r.body.error.message).toMatch(/kids/);
    await request(app.getHttpServer()).post('/api/v1/try-on').set(H).field('productSlug', product.slug).field('consent', 'true').attach('photo', selfie, 'me.jpg').expect(400);
  });

  it('tries a garment on in memory: photo never stored, disclosed, capped per session', async () => {
    const before = files(process.env.STORAGE_LOCAL_DIR!).length;
    const selfie = await sharp({ create: { width: 700, height: 900, channels: 3, background: '#556677' } }).jpeg().toBuffer();
    const s = sid();
    const http = () => request(app.getHttpServer());
    await http().post('/api/v1/try-on').set(H).set('x-vyra-session', s).field('productSlug', product.slug).attach('photo', selfie, 'me.jpg').expect(422); // no consent
    const r = (await http().post('/api/v1/try-on').set(H).set('x-vyra-session', s).field('productSlug', product.slug).field('consent', 'true').attach('photo', selfie, 'me.jpg').expect(200)).body.data;
    expect(r.image).toMatch(/^data:image\/webp;base64,/);
    expect(r.disclaimer).toMatch(/approximate/);
    expect(r.remainingToday).toBe(4);
    expect(genCalls.at(-1)).toMatchObject({ refs: 2 });
    expect(genCalls.at(-1)!.prompt).toMatch(/Keep the person IDENTICAL/);
    expect(files(process.env.STORAGE_LOCAL_DIR!).length).toBe(before); // nothing written to disk
    const ev = await prisma.analyticsEvent.findFirstOrThrow({ where: { type: 'TRY_ON', sessionId: s } });
    expect(ev.productId).toBe(product.id);
    // Simulate 4 more try-ons earlier today (calling 4x would trip the separate per-IP 5/min limit).
    await prisma.analyticsEvent.createMany({ data: Array.from({ length: 4 }, () => ({ type: 'TRY_ON' as const, sessionId: s, productId: product.id })) });
    const capped = await http().post('/api/v1/try-on').set(H).set('x-vyra-session', s).field('productSlug', product.slug).field('consent', 'true').attach('photo', selfie, 'me.jpg').expect(429);
    expect(capped.body.error.message).toMatch(/5 free try-ons/);
  });

  it('maps products to the right garment slot', () => {
    expect(garmentSlot('men-jeans', 'Slim Fit Stretch Jeans')).toBe('lower');
    expect(garmentSlot('women-dresses', 'Floral Tiered Midi Dress')).toBe('full');
    expect(garmentSlot('accessories-caps', 'Classic Cotton Baseball Cap')).toBe('head');
    expect(garmentSlot('accessories-bags', 'Commuter Backpack')).toBe('carry');
    expect(garmentSlot('men-ethnic', 'Festive Silk Blend Kurta')).toBe('upper');
  });
});
