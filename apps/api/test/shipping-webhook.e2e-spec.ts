import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, createCategory, createStaff, H, productInput } from './helpers';

const TOKEN = 'test-shiprocket-token-0123456789';

/** Shiprocket tracking webhook + CSRF exemption scope, through the real middleware chain. */
describe('Shiprocket webhook and webhook CSRF scope (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let variantId: string;
  const prev = process.env.SHIPROCKET_WEBHOOK_TOKEN;

  beforeAll(async () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = TOKEN;
    ({ app, prisma } = await bootApp());
    admin = await createStaff(app, 'ADMIN');
    const cat = await createCategory(prisma);
    const p = (await admin.post('/api/v1/admin/products').set(H).send(productInput(cat.id)).expect(201)).body.data;
    variantId = p.variants[0].id;
    await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId, type: 'STOCK_IN', quantity: 10, reason: 'Fixture' }).expect(201);
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.SHIPROCKET_WEBHOOK_TOKEN; else process.env.SHIPROCKET_WEBHOOK_TOKEN = prev;
    await app.close();
  });

  let n = 0;
  async function shippedOrder(awb: string) {
    const g = request.agent(app.getHttpServer()).set('X-Forwarded-For', `10.7.0.${++n}`);
    await g.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
    const co = (await g.post('/api/v1/checkout').set(H).send({ address: { fullName: 'Ship Test', phone: `98000000${10 + n}`, line1: '1 Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true }, guestEmail: `ship${n}@test.local`, paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data;
    await admin.post(`/api/v1/admin/orders/${co.order.id}/confirm-cod`).set(H).send({}).expect(200);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/shipment`).set(H).send({ provider: 'MANUAL', courierName: 'Delhivery', trackingNumber: awb }).expect(200);
    return co.order.id as string;
  }
  const hook = (body: object, token: string | null = TOKEN) => {
    const r = request(app.getHttpServer()).post('/api/v1/shipping/shiprocket/webhook').set('content-type', 'application/json');
    return (token ? r.set('x-api-key', token) : r).send(body);
  };
  const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  it('rejects missing or wrong tokens without touching orders', async () => {
    const id = await shippedOrder('AWB1001');
    expect((await hook({ awb: 'AWB1001', current_status: 'DELIVERED' }, null)).status).toBe(403);
    expect((await hook({ awb: 'AWB1001', current_status: 'DELIVERED' }, 'wrong-token-wrong-token-xx')).status).toBe(403);
    expect(await status(id)).toBe('SHIPPED');
  });

  it('applies out-for-delivery then delivered, and ignores replays', async () => {
    const id = await shippedOrder('AWB1002');
    expect((await hook({ awb: 'AWB1002', current_status: 'OUT FOR DELIVERY', current_timestamp: '2026-11-03 10:00:00' }).expect(200)).body.data).toMatchObject({ applied: true });
    expect(await status(id)).toBe('OUT_FOR_DELIVERY');
    expect((await hook({ awb: 'AWB1002', current_status: 'OUT FOR DELIVERY', current_timestamp: '2026-11-03 10:00:00' }).expect(200)).body.data).toMatchObject({ duplicate: true });
    await hook({ awb: 'AWB1002', current_status: 'Delivered', current_timestamp: '2026-11-03 14:00:00' }).expect(200);
    expect(await status(id)).toBe('DELIVERED');
    // A late delivery scan for an already-delivered order is recorded, not an error.
    expect((await hook({ awb: 'AWB1002', current_status: 'DELIVERED', current_timestamp: '2026-11-03 15:00:00' }).expect(200)).body.data.applied).toBe(false);
  });

  it('restocks only when the RTO parcel is physically back', async () => {
    const id = await shippedOrder('AWB1003');
    const onHand = async () => (await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).onHand;
    const before = await onHand();
    await hook({ awb: 'AWB1003', current_status: 'RTO INITIATED', current_timestamp: '2026-11-03 11:00:00' }).expect(200);
    expect(await status(id)).toBe('SHIPPED');
    expect(await onHand()).toBe(before);
    await hook({ awb: 'AWB1003', current_status: 'RTO DELIVERED', current_timestamp: '2026-11-05 11:00:00' }).expect(200);
    expect(await status(id)).toBe('RTO');
    expect(await onHand()).toBe(before + 1);
    expect((await admin.get('/api/v1/admin/inventory/reconcile').expect(200)).body.data.consistent).toBe(true);
  });

  it('ignores unknown AWBs', async () => {
    expect((await hook({ awb: 'NOPE999', current_status: 'DELIVERED' }).expect(200)).body.data).toMatchObject({ applied: false, reason: 'unknown awb' });
  });

  it('exempts only the exact webhook paths from the CSRF header check', async () => {
    // Exact path + query string: exempt (fails on signature, not CSRF).
    const rp = await request(app.getHttpServer()).post('/api/v1/payments/razorpay/webhook?x=1').set('content-type', 'application/json').set('x-razorpay-signature', 'bad').send('{}');
    expect(rp.body.error.message).toBe('Invalid webhook signature');
    // Look-alike paths are not exempt.
    for (const path of ['/api/v1/payments/razorpay/webhook2', '/api/v1/payments/razorpay/webhook/extra', '/api/v1/shipping/shiprocket/webhookx']) {
      const r = await request(app.getHttpServer()).post(path).set('content-type', 'application/json').send('{}');
      expect(r.status).toBe(403);
      expect(r.body.error.message).toBe('Missing CSRF header');
    }
    // Ordinary cookie-authenticated mutations still need the header.
    const r = await admin.post('/api/v1/admin/categories').send({ name: 'x', slug: 'x', code: 'XXX' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe('Missing CSRF header');
  });
});
