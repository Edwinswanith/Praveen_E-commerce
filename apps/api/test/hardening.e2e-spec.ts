import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { NewsletterService } from '../src/modules/newsletter/newsletter.service';
import { bootApp, createCategory, createStaff, H, productInput, registerCustomer } from './helpers';

/** Regression tests for the audit findings fixed in the verification pass. */
describe('Security hardening (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    admin = await createStaff(app, 'ADMIN');
  });
  afterAll(() => app.close());

  describe('customer support notes need customers:write', () => {
    let customerId: string;
    beforeAll(async () => {
      await registerCustomer(app, 'noted@test.local');
      customerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'noted@test.local' } })).id;
    });

    it('lets roles with customers:write save notes, audited', async () => {
      const om = await createStaff(app, 'ORDER_MANAGER', 'om-notes@test.local');
      await om.post(`/api/v1/admin/customers/${customerId}/notes`).set(H).send({ notes: 'Prefers calls after 6pm' }).expect(200);
      expect((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: customerId } })).notes).toBe('Prefers calls after 6pm');
      expect(await prisma.auditLog.count({ where: { action: 'customer.notes', entityId: customerId } })).toBe(1);
    });

    it('denies roles without customers:write and leaves notes unchanged', async () => {
      const inv = await createStaff(app, 'INVENTORY_MANAGER', 'inv-notes@test.local');
      const r = await inv.post(`/api/v1/admin/customers/${customerId}/notes`).set(H).send({ notes: 'tampered' }).expect(403);
      expect(r.body.error.code).toBe('FORBIDDEN');
      expect((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: customerId } })).notes).toBe('Prefers calls after 6pm');
    });

    it('returns 404 for unknown ids and staff accounts instead of writing or erroring', async () => {
      await admin.post('/api/v1/admin/customers/cnotarealid000000000000000/notes').set(H).send({ notes: 'x' }).expect(404);
      const staffId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })).id;
      await admin.post(`/api/v1/admin/customers/${staffId}/notes`).set(H).send({ notes: 'x' }).expect(404);
      expect(await prisma.customerProfile.count({ where: { userId: staffId } })).toBe(0);
    });

    it('rejects customer tokens on the staff route', async () => {
      const cust = await registerCustomer(app, 'cross@test.local');
      await cust.post(`/api/v1/admin/customers/${customerId}/notes`).set(H).send({ notes: 'x' }).expect(401);
    });
  });

  describe('guest order tracking', () => {
    let number: string;
    const phone = '9876500011';
    beforeAll(async () => {
      const cat = await createCategory(prisma, 'track-tees', 'TRK');
      const p = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(cat.id), name: 'Track Tee' }).expect(201)).body.data;
      await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: p.variants[0].id, type: 'STOCK_IN', quantity: 5, reason: 'Fixture' }).expect(201);
      const g = request.agent(app.getHttpServer());
      await g.post('/api/v1/cart/items').set(H).send({ variantId: p.variants[0].id, quantity: 1 }).expect(201);
      const co = (await g.post('/api/v1/checkout').set(H).send({ address: { fullName: 'Track Guest', phone, line1: '221B Baker Street', line2: 'Flat 4', landmark: 'Near park', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true }, guestEmail: 'trackguest@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data;
      number = co.order.number;
    });

    it('returns the order with contact details and street address masked', async () => {
      const o = (await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number, phone }).set('X-Forwarded-For', '10.1.0.1').expect(200)).body.data;
      expect(o.number).toBe(number);
      expect(o.shippingAddress.phone).toBe('••••••••11');
      expect(o.shippingAddress.line1).not.toContain('Baker');
      expect(o.shippingAddress).toMatchObject({ line2: null, landmark: null, city: 'Bengaluru', pincode: '560001' });
      expect(o.customerEmail).not.toBe('trackguest@test.local');
    });

    it('locks a contact out after 5 failed guesses, even from different IPs', async () => {
      const victim = '9876500099';
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number: `VY0000000${i}`, phone: victim }).set('X-Forwarded-For', `10.2.0.${i + 1}`).expect(404);
      }
      const r = await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number, phone: victim }).set('X-Forwarded-For', '10.2.0.99').expect(429);
      expect(r.body.error.code).toBe('RATE_LIMITED');
    });

    it('locks an order number after 5 failed contact guesses', async () => {
      const guessed = `${number.slice(0, -1)}${number.endsWith('9') ? '8' : '9'}`;
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number: guessed, phone: `98765000${20 + i}` }).set('X-Forwarded-For', `10.3.0.${i + 1}`).expect(404);
      }
      await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number: guessed, phone: '9876500030' }).set('X-Forwarded-For', '10.3.0.50').expect(429);
    });
  });

  describe('health endpoints', () => {
    it('public /health reveals no version or integration configuration', async () => {
      const h = (await request(app.getHttpServer()).get('/api/v1/health').expect(200)).body.data;
      expect(Object.keys(h).sort()).toEqual(['db', 'redis', 'status']);
    });

    it('/admin/system/health is staff-only and has the integration status', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/system/health').expect(401);
      const cust = await registerCustomer(app, 'health@test.local');
      await cust.get('/api/v1/admin/system/health').expect(401);
      const h = (await admin.get('/api/v1/admin/system/health').expect(200)).body.data;
      expect(h).toMatchObject({ status: 'ok', db: true, integrations: { payments: expect.any(String), storage: expect.any(String) } });
    });
  });

  describe('review post-moderation', () => {
    it('lets reviews-moderators hide and restore a review with a reason, updating the rating and audit log', async () => {
      const cat = await createCategory(prisma, 'review-tees', 'RVW');
      const p = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(cat.id), name: 'Review Tee' }).expect(201)).body.data;
      const c = await registerCustomer(app, 'reviewer@test.local');
      const rv = (await c.post(`/api/v1/products/${p.slug}/reviews`).set(H).send({ rating: 1, title: 'Spam link', body: 'buy followers at example' }).expect(201)).body.data;
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).ratingCount).toBe(1);
      const inv = await createStaff(app, 'INVENTORY_MANAGER', 'inv-reviews@test.local');
      await inv.post(`/api/v1/admin/reviews/${rv.id}/hide`).set(H).send({ reason: 'Spam' }).expect(403);
      await admin.post(`/api/v1/admin/reviews/${rv.id}/hide`).set(H).send({}).expect(422);
      const hidden = (await admin.post(`/api/v1/admin/reviews/${rv.id}/hide`).set(H).send({ reason: 'Spam link' }).expect(200)).body.data;
      expect(hidden).toMatchObject({ isPublished: false, moderationNote: 'Spam link', moderatedBy: 'ADMIN' });
      const pub = (await request(app.getHttpServer()).get(`/api/v1/products/${p.slug}/reviews`).expect(200)).body;
      expect(JSON.stringify(pub)).not.toContain(rv.id);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).ratingCount).toBe(0);
      expect((await admin.get('/api/v1/admin/reviews').query({ status: 'hidden' }).expect(200)).body.data.map((r: { id: string }) => r.id)).toContain(rv.id);
      await admin.post(`/api/v1/admin/reviews/${rv.id}/publish`).set(H).send({ reason: 'Appeal accepted' }).expect(200);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).ratingCount).toBe(1);
      expect(await prisma.auditLog.count({ where: { entity: 'Review', entityId: rv.id } })).toBe(2);
    });
  });

  describe('newsletter double opt-in', () => {
    const email = 'reader@test.local';
    const csv = async () => (await admin.get('/api/v1/admin/newsletter/export').buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c: Buffer) => (d += c)); res.on('end', () => cb(null, d)); }).expect(200)).body as string;

    it('subscribes only after the email owner confirms, and can unsubscribe in one click', async () => {
      const pub = request(app.getHttpServer());
      await pub.post('/api/v1/newsletter').set(H).send({ email, source: 'footer' }).expect(200);
      const row = await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email } });
      expect(row).toMatchObject({ status: 'PENDING', source: 'footer' });
      expect(await csv()).not.toContain(email);
      // Re-submitting reveals nothing and doesn't subscribe.
      expect((await pub.post('/api/v1/newsletter').set(H).send({ email }).expect(200)).body.data).toEqual({ ok: true });
      const svc = app.get(NewsletterService);
      await pub.post('/api/v1/newsletter/confirm').set(H).send({ token: `${row.id}.${'0'.repeat(64)}` }).expect(400);
      await pub.post('/api/v1/newsletter/confirm').set(H).send({ token: svc.token('unsubscribe', row) }).expect(400); // wrong purpose
      expect((await pub.post('/api/v1/newsletter/confirm').set(H).send({ token: svc.token('confirm', row) }).expect(200)).body.data.status).toBe('SUBSCRIBED');
      expect(await csv()).toContain(email);
      expect((await pub.post('/api/v1/newsletter/unsubscribe').set(H).send({ token: svc.token('unsubscribe', row) }).expect(200)).body.data.status).toBe('UNSUBSCRIBED');
      expect(await csv()).not.toContain(email);
      // Suppressed until fresh consent: re-subscribing goes back to PENDING, not SUBSCRIBED.
      await pub.post('/api/v1/newsletter').set(H).send({ email }).expect(200);
      expect((await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email } })).status).toBe('PENDING');
    });

    it('keeps the subscriber list and export staff-only and neutralises CSV formulas', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/newsletter').expect(401);
      const inv = await createStaff(app, 'INVENTORY_MANAGER', 'inv-news@test.local');
      await inv.get('/api/v1/admin/newsletter').expect(403);
      const evil = await prisma.newsletterSubscriber.create({ data: { email: '=cmd@test.local', status: 'SUBSCRIBED', confirmedAt: new Date() } });
      expect(await csv()).toContain("'=cmd@test.local");
      const list = (await admin.get('/api/v1/admin/newsletter').query({ status: 'SUBSCRIBED' }).expect(200)).body;
      expect(list.data.map((s: { id: string }) => s.id)).toContain(evil.id);
      expect(list.counts.SUBSCRIBED).toBeGreaterThanOrEqual(1);
    });
  });

  describe('session cookies', () => {
    it('a refresh attempt without a refresh cookie does not clear cookies (it would log out a session set in parallel)', async () => {
      for (const path of ['/api/v1/auth/refresh', '/api/v1/admin/auth/refresh']) {
        const r = await request(app.getHttpServer()).post(path).set(H).expect(401);
        expect(r.headers['set-cookie']).toBeUndefined();
      }
    });

    it('a refresh with an invalid refresh cookie still clears the stale cookies', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(H).set('Cookie', 'vyra_rt=not-a-real-token').expect(401);
      expect((r.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('vyra_rt=;'))).toBe(true);
    });

    it('sets httpOnly, SameSite=Lax, path-scoped session cookies', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/register').set(H).send({ name: 'Cookie Test', email: 'cookies@test.local', password: 'Passw0rd!x' }).expect(201);
      const c = r.headers['set-cookie'] as unknown as string[];
      const at = c.find((x) => x.startsWith('vyra_at='))!;
      const rt = c.find((x) => x.startsWith('vyra_rt='))!;
      for (const x of [at, rt]) { expect(x).toMatch(/HttpOnly/i); expect(x).toMatch(/SameSite=Lax/i); }
      expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    });
  });
});
