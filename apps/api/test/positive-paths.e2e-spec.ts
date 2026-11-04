import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { bootApp, createCategory, createStaff, H, PASSWORD, productInput, registerCustomer } from './helpers';

/**
 * Success-path coverage for every endpoint that previously had only error-path
 * tests. Each test asserts the response contract AND the resulting database state.
 */
describe('Positive paths for previously untested endpoints (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let categoryId: string;
  let product: { id: string; slug: string; variants: { id: string; color: string; size: string }[] };
  let ip = 0;
  const agent = () => request.agent(app.getHttpServer()).set('X-Forwarded-For', `10.50.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`);
  const address = (phone: string) => ({ fullName: 'Path Tester', phone, line1: '5 Test Street', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true });
  const png = () => sharp({ create: { width: 400, height: 500, channels: 3, background: '#224466' } }).png().toBuffer();

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    admin = await createStaff(app, 'ADMIN');
    const cat = await createCategory(prisma);
    categoryId = cat.id;
    product = (await admin.post('/api/v1/admin/products').set(H).send(productInput(categoryId)).expect(201)).body.data;
    for (const v of product.variants) await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_IN', quantity: 20, reason: 'Fixture' }).expect(201);
  });
  afterAll(() => app.close());

  describe('customer authentication', () => {
    it('logs in with email/password, verifies email, resets and changes password', async () => {
      await registerCustomer(app, 'pathuser@test.local');
      const a = agent();
      const login = await a.post('/api/v1/auth/login').set(H).send({ email: 'pathuser@test.local', password: PASSWORD }).expect(200);
      expect(login.body.data).toMatchObject({ email: 'pathuser@test.local' });
      expect((login.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('vyra_at=') && c.includes('HttpOnly'))).toBe(true);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'pathuser@test.local' } });
      const auth = app.get(AuthService) as unknown as { issueToken(u: string, p: string, ttl: number): Promise<string> };
      // Verification token issued as the mailer would; the endpoint consumes it.
      const vt = await auth.issueToken(user.id, 'EMAIL_VERIFICATION', 60);
      await a.post('/api/v1/auth/verify-email').set(H).send({ token: vt }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
      await a.post('/api/v1/auth/verify-email').set(H).send({ token: vt }).expect(400); // single use
      // Forgot password always answers 200 (no account enumeration).
      await agent().post('/api/v1/auth/forgot-password').set(H).send({ email: 'pathuser@test.local' }).expect(200);
      await agent().post('/api/v1/auth/forgot-password').set(H).send({ email: 'nobody@test.local' }).expect(200);
      const rt = await auth.issueToken(user.id, 'PASSWORD_RESET', 30);
      await agent().post('/api/v1/auth/reset-password').set(H).send({ token: rt, password: 'NewPassw0rd!x' }).expect(200);
      await agent().post('/api/v1/auth/login').set(H).send({ email: 'pathuser@test.local', password: PASSWORD }).expect(401);
      const b = agent();
      await b.post('/api/v1/auth/login').set(H).send({ email: 'pathuser@test.local', password: 'NewPassw0rd!x' }).expect(200);
      await b.post('/api/v1/auth/change-password').set(H).send({ currentPassword: 'NewPassw0rd!x', newPassword: 'Third0ne!pass' }).expect(200);
      await agent().post('/api/v1/auth/login').set(H).send({ email: 'pathuser@test.local', password: 'Third0ne!pass' }).expect(200);
    });

    it('rotates the staff refresh token', async () => {
      const r = await admin.post('/api/v1/admin/auth/refresh').set(H).expect(200);
      expect((r.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('vyra_staff_rt='))).toBe(true);
      await admin.get('/api/v1/admin/auth/me').expect(200);
    });
  });

  describe('addresses and wishlist', () => {
    it('creates, edits, defaults and deletes addresses', async () => {
      const c = await registerCustomer(app, 'addr@test.local');
      const a1 = (await c.post('/api/v1/users/me/addresses').set(H).send(address('9811100001')).expect(201)).body.data;
      const a2 = (await c.post('/api/v1/users/me/addresses').set(H).send({ ...address('9811100002'), isDefault: false }).expect(201)).body.data;
      const edited = (await c.patch(`/api/v1/users/me/addresses/${a2.id}`).set(H).send({ city: 'Mysuru', isDefault: true }).expect(200)).body.data;
      expect(edited).toMatchObject({ city: 'Mysuru', isDefault: true });
      expect((await prisma.address.findUniqueOrThrow({ where: { id: a1.id } })).isDefault).toBe(false);
      await c.delete(`/api/v1/users/me/addresses/${a1.id}`).set(H).expect(200);
      expect((await c.get('/api/v1/users/me/addresses').expect(200)).body.data.map((x: { id: string }) => x.id)).toEqual([a2.id]);
      // Another customer can't touch it (IDOR).
      const other = await registerCustomer(app, 'addr2@test.local');
      await other.patch(`/api/v1/users/me/addresses/${a2.id}`).set(H).send({ city: 'Pune' }).expect(404);
      await other.delete(`/api/v1/users/me/addresses/${a2.id}`).set(H).expect(404);
    });

    it('adds a product to the wishlist', async () => {
      const c = await registerCustomer(app, 'wish@test.local');
      await c.post('/api/v1/wishlist').set(H).send({ productId: product.id }).expect(201);
      expect((await c.get('/api/v1/wishlist/ids').expect(200)).body.data).toEqual([product.id]);
    });
  });

  describe('catalog', () => {
    it('manages categories (create, public lookup, edit, delete)', async () => {
      const c = (await admin.post('/api/v1/admin/categories').set(H).send({ name: 'Jackets', slug: 'path-jackets', code: 'JKT' }).expect(201)).body.data;
      const pub = (await request(app.getHttpServer()).get('/api/v1/categories/path-jackets').expect(200)).body.data;
      expect(pub).toMatchObject({ slug: 'path-jackets' });
      await admin.patch(`/api/v1/admin/categories/${c.id}`).set(H).send({ name: 'Winter Jackets' }).expect(200);
      expect((await prisma.category.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Winter Jackets');
      await admin.delete(`/api/v1/admin/categories/${c.id}`).set(H).expect(200);
      await request(app.getHttpServer()).get('/api/v1/categories/path-jackets').expect(404);
    });

    it('serves product cards by ids, similar and related products', async () => {
      const second = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(categoryId), name: 'Relaxed Grey Tee' }).expect(201)).body.data;
      const cards = (await request(app.getHttpServer()).get('/api/v1/products/by-ids').query({ ids: `${second.id},${product.id}` }).expect(200)).body.data;
      expect(cards.map((c: { id: string }) => c.id)).toEqual([second.id, product.id]);
      const similar = (await request(app.getHttpServer()).get(`/api/v1/products/${product.slug}/similar`).expect(200)).body.data;
      expect(Array.isArray(similar)).toBe(true);
      expect(similar.every((c: { id: string }) => c.id !== product.id)).toBe(true);
      const related = (await request(app.getHttpServer()).get(`/api/v1/products/${product.slug}/related`).expect(200)).body.data;
      expect(Array.isArray(related)).toBe(true);
    });

    it('reads admin product detail, bulk-updates status, and imports CSV (dry run, then commit)', async () => {
      const d = (await admin.get(`/api/v1/admin/products/${product.id}`).expect(200)).body.data;
      expect(d.variants).toHaveLength(3);
      const r = (await admin.post('/api/v1/admin/products/bulk').set(H).send({ ids: [product.id], action: 'feature' }).expect(200)).body.data;
      expect(r.updated).toBe(1);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).isFeatured).toBe(true);
      const tpl = (await admin.get('/api/v1/admin/products/import/template').buffer(true).parse((res, cb) => { let s = ''; res.on('data', (c: Buffer) => (s += c)); res.on('end', () => cb(null, s)); }).expect(200));
      expect(tpl.headers['content-type']).toContain('text/csv');
      const csv = String(tpl.body).replace('men-tshirts', 'men-tshirts').replace('oversized-cotton-tee', 'path-import-tee');
      const before = await prisma.product.count();
      const dry = (await admin.post('/api/v1/admin/products/import').set(H).query({ dryRun: 'true' }).attach('file', Buffer.from(csv), 'import.csv').expect(200)).body.data;
      expect(dry.dryRun).toBe(true);
      expect(await prisma.product.count()).toBe(before);
      const done = (await admin.post('/api/v1/admin/products/import').set(H).attach('file', Buffer.from(csv), 'import.csv').expect(200)).body.data;
      expect(done.created).toBe(1);
      expect(await prisma.product.findUnique({ where: { slug: 'path-import-tee' } })).not.toBeNull();
    });

    it('uploads, edits and deletes product images and videos', async () => {
      const up = await admin.post(`/api/v1/admin/products/${product.id}/images`).set(H).attach('files', await png(), 'a.png');
      const imgs = up.body.data;
      expect(up.status).toBe(201);
      const img = imgs[0];
      const ed = (await admin.patch(`/api/v1/admin/products/${product.id}/images/${img.id}`).set(H).send({ alt: 'Front view', sortOrder: 3 }).expect(200)).body.data;
      expect(ed).toMatchObject({ alt: 'Front view', sortOrder: 3 });
      await admin.delete(`/api/v1/admin/products/${product.id}/images/${img.id}`).set(H).expect(200);
      expect(await prisma.productImage.count({ where: { id: img.id } })).toBe(0);
      // Minimal MP4 container header (sniffed by magic bytes).
      const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);
      const vid = (await admin.post(`/api/v1/admin/products/${product.id}/videos`).set(H).attach('file', mp4, 'clip.mp4').expect(201)).body.data;
      expect(vid.url).toMatch(/\.mp4$/);
      await admin.delete(`/api/v1/admin/products/${product.id}/videos/${vid.id}`).set(H).expect(200);
      expect(await prisma.productVideo.count({ where: { productId: product.id } })).toBe(0);
    });
  });

  describe('procurement', () => {
    it('runs supplier CRUD and a purchase order through to receiving stock', async () => {
      const s = (await admin.post('/api/v1/admin/suppliers').set(H).send({ name: 'Tiruppur Knits', email: 'sales@knits.test' }).expect(201)).body.data;
      await admin.patch(`/api/v1/admin/suppliers/${s.id}`).set(H).send({ contactName: 'Ravi' }).expect(200);
      expect((await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).contactName).toBe('Ravi');
      const v = product.variants[1]!;
      const onHand = async () => (await prisma.inventory.findUniqueOrThrow({ where: { variantId: v.id } })).onHand;
      const before = await onHand();
      const po = (await admin.post('/api/v1/admin/purchase-orders').set(H).send({ supplierId: s.id, items: [{ variantId: v.id, quantity: 6, unitCost: 320 }] }).expect(201)).body.data;
      const detail = (await admin.get(`/api/v1/admin/purchase-orders/${po.id}`).expect(200)).body.data;
      await admin.post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(H).send({ items: [{ itemId: detail.items[0].id, quantity: 4 }] }).expect(200);
      expect(await onHand()).toBe(before + 4);
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PARTIALLY_RECEIVED');
      expect((await admin.get('/api/v1/admin/inventory/reconcile').expect(200)).body.data.consistent).toBe(true);
      const unused = (await admin.post('/api/v1/admin/suppliers').set(H).send({ name: 'Unused Supplier' }).expect(201)).body.data;
      await admin.delete(`/api/v1/admin/suppliers/${unused.id}`).set(H).expect(200);
    });
  });

  describe('cart, shipping and orders', () => {
    it('saves an item for later and moves it back; checks PIN serviceability', async () => {
      const g = agent();
      const cart = (await g.post('/api/v1/cart/items').set(H).send({ variantId: product.variants[0]!.id, quantity: 1 }).expect(201)).body.data;
      const id = cart.items[0].id;
      const saved = (await g.post(`/api/v1/cart/items/${id}/save-for-later`).set(H).expect(200)).body.data;
      expect(saved).toMatchObject({ items: [], savedItems: [{ id }] });
      const back = (await g.post(`/api/v1/cart/items/${id}/move-to-cart`).set(H).expect(200)).body.data;
      expect(back.items.map((i: { id: string }) => i.id)).toEqual([id]);
      const svc = (await request(app.getHttpServer()).get('/api/v1/shipping/serviceability').query({ pincode: '560001' }).expect(200)).body.data;
      expect(svc).toMatchObject({ serviceable: true });
    });

    it('resends a COD OTP, cancels an order, resumes an online payment, and shows staff detail + invoice', async () => {
      const c = await registerCustomer(app, 'orders@test.local');
      await c.post('/api/v1/cart/items').set(H).send({ variantId: product.variants[0]!.id, quantity: 1 }).expect(201);
      const cod = (await c.post('/api/v1/checkout').set(H).send({ address: address('9822200001'), paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data.order;
      await prisma.otpCode.updateMany({ where: { orderId: cod.id }, data: { createdAt: new Date(Date.now() - 120_000) } }); // past the resend window
      const otp = (await c.post(`/api/v1/orders/${cod.number}/resend-cod-otp`).set(H).expect(200)).body.data;
      expect(otp.phoneMasked).toContain('01');
      const staffDetail = (await admin.get(`/api/v1/admin/orders/${cod.id}`).expect(200)).body.data;
      expect(staffDetail.number).toBe(cod.number);
      const inv = await admin.get(`/api/v1/admin/orders/${cod.id}/invoice`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (x: Buffer) => b.push(x)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
      expect(inv.headers['content-type']).toContain('application/pdf');
      expect((inv.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      const cancelled = (await c.post(`/api/v1/orders/${cod.number}/cancel`).set(H).send({ reason: 'Ordered the wrong size' }).expect(200)).body.data;
      expect(cancelled.status).toBe('CANCELLED');
      expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: product.variants[0]!.id } })).reserved).toBe(0);
      await c.post('/api/v1/cart/items').set(H).send({ variantId: product.variants[0]!.id, quantity: 1 }).expect(201);
      const online = (await c.post('/api/v1/checkout').set(H).send({ address: address('9822200001'), paymentMethod: 'ONLINE', idempotencyKey: randomUUID() }).expect(201)).body.data;
      const pay = (await c.post(`/api/v1/orders/${online.order.number}/pay`).set(H).expect(200)).body.data;
      expect(pay.payment.providerOrderId).toBe(online.payment.providerOrderId); // same provider order: no double charge
    });

    it('searches by photo', async () => {
      const r = (await request(app.getHttpServer()).post('/api/v1/visual-search').set(H).attach('image', await png(), 'look.png').expect(200)).body.data;
      expect(Array.isArray(r.items)).toBe(true);
    });
  });

  describe('admin operations', () => {
    it('updates a staff role, a coupon, a COD risk; reads customer detail; exports analytics', async () => {
      await createStaff(app, 'ORDER_MANAGER', 'om-role@test.local');
      const om = await prisma.user.findUniqueOrThrow({ where: { email: 'om-role@test.local' } });
      const u = (await admin.patch(`/api/v1/admin/users/${om.id}`).set(H).send({ role: 'INVENTORY_MANAGER' }).expect(200)).body.data;
      expect(u.role).toBe('INVENTORY_MANAGER');
      const coupon = (await admin.post('/api/v1/admin/coupons').set(H).send({ code: 'PATH50', type: 'FIXED', value: 50 }).expect(201)).body.data;
      await admin.patch(`/api/v1/admin/coupons/${coupon.id}`).set(H).send({ value: 75 }).expect(200);
      expect(Number((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).value)).toBe(75);
      await admin.delete(`/api/v1/admin/coupons/${coupon.id}`).set(H).expect(200);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).deletedAt).not.toBeNull();
      const risk = (await admin.patch('/api/v1/admin/cod/risks/9833300001').set(H).send({ codBlocked: true, note: 'Repeated refusals' }).expect(200)).body.data;
      expect(risk).toMatchObject({ phone: '9833300001', codBlocked: true });
      const cust = await prisma.user.findUniqueOrThrow({ where: { email: 'orders@test.local' } });
      const cd = (await admin.get(`/api/v1/admin/customers/${cust.id}`).expect(200)).body.data;
      expect(cd.orders.length).toBeGreaterThanOrEqual(2);
      for (const format of ['csv', 'xlsx'] as const) {
        const ex = await admin.get('/api/v1/admin/analytics/export').query({ report: 'sales', format }).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (x: Buffer) => b.push(x)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
        expect(ex.headers['content-type']).toContain(format === 'csv' ? 'text/csv' : 'spreadsheetml');
        expect((ex.body as Buffer).length).toBeGreaterThan(10);
      }
    });

    it('covers the remaining campaign and promotion admin paths', async () => {
      const mk = async (slug: string, startsAt: Date) => (await admin.post('/api/v1/admin/campaigns').set(H).send({ name: `Path ${slug}`, slug, startsAt, endsAt: new Date(Date.now() + 48 * 3600_000) }).expect(201)).body.data;
      const draft = await mk('path-draft', new Date(Date.now() + 3600_000));
      const v = product.variants[2]!;
      await admin.put(`/api/v1/admin/campaigns/${draft.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 699 }] }).expect(200);
      expect((await admin.get(`/api/v1/admin/campaigns/${draft.id}/prices`).expect(200)).body.data).toHaveLength(1);
      const pv = (await admin.get(`/api/v1/admin/campaigns/${draft.id}/preview`).query({ at: new Date(Date.now() + 2 * 3600_000).toISOString() }).expect(200)).body.data;
      expect(pv).toMatchObject({ salePriceApplies: true, campaign: { phase: 'LIVE' } });
      await admin.delete(`/api/v1/admin/campaigns/${draft.id}/prices/${v.id}`).set(H).expect(204);
      const promo = (await admin.post('/api/v1/admin/promotions').set(H).send({ name: 'Path pair deal', campaignId: draft.id, minQuantity: 2, percentOff: 10 }).expect(201)).body.data;
      await admin.delete(`/api/v1/admin/promotions/${promo.id}`).set(H).expect(204);
      expect(await prisma.promotion.count({ where: { id: promo.id } })).toBe(0);
      await admin.delete(`/api/v1/admin/campaigns/${draft.id}`).set(H).expect(204);
      expect(await prisma.campaign.count({ where: { id: draft.id } })).toBe(0);

      const live = await mk('path-live', new Date(Date.now() - 3600_000));
      await admin.put(`/api/v1/admin/campaigns/${live.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 649 }] }).expect(200);
      await admin.post(`/api/v1/admin/campaigns/${live.id}/publish`).set(H).expect(200);
      const cards = (await request(app.getHttpServer()).get('/api/v1/campaigns/path-live/products').expect(200)).body.data;
      expect(cards.map((c: { id: string }) => c.id)).toContain(product.id);
      await admin.post(`/api/v1/admin/campaigns/${live.id}/pause`).set(H).send({}).expect(200);
      expect((await admin.post(`/api/v1/admin/campaigns/${live.id}/resume`).set(H).send({ note: 'Back on' }).expect(200)).body.data.status).toBe('SCHEDULED');
      expect((await admin.post(`/api/v1/admin/campaigns/${live.id}/cancel`).set(H).send({ note: 'Stock issue' }).expect(200)).body.data.phase).toBe('CANCELLED');
      // Cancelling takes the sale price off immediately.
      const pdp = (await request(app.getHttpServer()).get(`/api/v1/products/${product.slug}`).expect(200)).body.data;
      expect(pdp.variants.find((x: { id: string }) => x.id === v.id).price).toBe(799);
    });
  });
});
