import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PaymentsGateway } from '../src/modules/payments/payments.gateway';
import { OrdersService } from '../src/modules/orders/orders.service';
import { bootApp, createCategory, createStaff, H, productInput } from './helpers';

/**
 * Financial and inventory invariants under concurrency. Every test fires the
 * competing requests at the same time against the real app + Postgres and then
 * checks the database, not just the HTTP codes.
 */
const address = (phone: string) => ({ fullName: 'Race Tester', phone, line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true });

describe('Concurrency invariants (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let categoryId: string;
  let n = 0;
  const phone = () => `91234${String(10000 + ++n).slice(-5)}`;
  let ipN = 0;
  /** Each simulated shopper gets its own client IP (real buyers do), so per-IP throttles apply per buyer. */
  const shopperAgent = () => request.agent(app.getHttpServer()).set('X-Forwarded-For', `10.9.${Math.floor(++ipN / 250)}.${ipN % 250 + 1}`);
  async function registered(email: string) {
    const a = shopperAgent();
    await a.post('/api/v1/auth/register').set(H).send({ name: 'Race Tester', email, password: 'Passw0rd!x' }).expect(201);
    return a;
  }

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    admin = await createStaff(app, 'ADMIN');
    categoryId = (await createCategory(prisma)).id;
  });
  afterAll(() => app.close());

  async function product(stock: number) {
    n++;
    const p = (await admin.post('/api/v1/admin/products').set(H).send({ ...productInput(categoryId), name: `Race Tee ${n}` }).expect(201)).body.data as { id: string; variants: { id: string }[] };
    if (stock > 0) await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: p.variants[0]!.id, type: 'STOCK_IN', quantity: stock, reason: 'Fixture stock' }).expect(201);
    return p.variants[0]!.id;
  }

  /** Online order paid through the mock provider (signature + server re-fetch path). */
  async function paidOnlineOrder(variantId: string, qty = 1) {
    const s = await registered(`paid${++n}@test.local`);
    await s.post('/api/v1/cart/items').set(H).send({ variantId, quantity: qty }).expect(201);
    const co = (await s.post('/api/v1/checkout').set(H).send({ address: address(phone()), paymentMethod: 'ONLINE', idempotencyKey: randomUUID() }).expect(201)).body.data;
    const auth = (await s.post('/api/v1/payments/mock/authorize').set(H).send({ providerOrderId: co.payment.providerOrderId, outcome: 'success' }).expect(200)).body.data;
    await s.post('/api/v1/payments/verify').set(H).send({ orderId: co.order.id, ...auth }).expect(200);
    return { shopper: s, order: co.order as { id: string; number: string; grandTotal: number } };
  }

  async function deliver(orderId: string) {
    await admin.post(`/api/v1/admin/orders/${orderId}/status`).set(H).send({ status: 'PACKED' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${orderId}/shipment`).set(H).send({ provider: 'MANUAL' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${orderId}/status`).set(H).send({ status: 'DELIVERED' }).expect(200);
  }

  const refundedPaise = async (orderId: string) =>
    (await prisma.refund.findMany({ where: { orderId, status: { not: 'FAILED' } } })).reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);

  it('two simultaneous refunds can never exceed what was paid', async () => {
    const { order } = await paidOnlineOrder(await product(5));
    const paid = Math.round(order.grandTotal * 100);
    const each = Math.ceil((paid * 0.6) / 100); // two of these together exceed the payment
    const results = await Promise.all([1, 2].map(() => admin.post(`/api/v1/admin/orders/${order.id}/refunds`).set(H).send({ amount: each, reason: 'Race test' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await refundedPaise(order.id)).toBeLessThanOrEqual(paid);
  });

  it('two simultaneous REFUND decisions on one return refund it exactly once', async () => {
    const { shopper, order } = await paidOnlineOrder(await product(5));
    await deliver(order.id);
    const item = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } }));
    const ret = (await shopper.post('/api/v1/returns').set(H).send({ orderId: order.id, type: 'RETURN', reason: 'OTHER', items: [{ orderItemId: item.id, quantity: 1 }] }).expect(201)).body.data;
    await admin.post(`/api/v1/admin/returns/${ret.id}/decision`).set(H).send({ action: 'APPROVE' }).expect(200);
    await admin.post(`/api/v1/admin/returns/${ret.id}/decision`).set(H).send({ action: 'RECEIVE', restock: true }).expect(200);
    const results = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/admin/returns/${ret.id}/decision`).set(H).send({ action: 'REFUND' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const refunds = await prisma.refund.findMany({ where: { returnRequestId: ret.id } });
    expect(refunds).toHaveLength(1);
    expect(Math.round(Number(refunds[0]!.amount) * 100)).toBe(Math.round(ret.refundAmount * 100));
  });

  it('two simultaneous RECEIVE decisions restock a return once', async () => {
    const variantId = await product(5);
    const { shopper, order } = await paidOnlineOrder(variantId, 2); // 2 bought, 1 returned: a DB CHECK can't catch a double receive
    await deliver(order.id);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const ret = (await shopper.post('/api/v1/returns').set(H).send({ orderId: order.id, type: 'RETURN', reason: 'OTHER', items: [{ orderItemId: item.id, quantity: 1 }] }).expect(201)).body.data;
    await admin.post(`/api/v1/admin/returns/${ret.id}/decision`).set(H).send({ action: 'APPROVE' }).expect(200);
    const before = await prisma.inventory.findUniqueOrThrow({ where: { variantId } });
    const rs = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/admin/returns/${ret.id}/decision`).set(H).send({ action: 'RECEIVE', restock: true })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(before.onHand + 1);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).returnedQuantity).toBe(1);
  });

  it('a payment confirmed by verify and webhook at once is captured once', async () => {
    const variantId = await product(5);
    const s = await registered(`dup${++n}@test.local`);
    await s.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
    const co = (await s.post('/api/v1/checkout').set(H).send({ address: address(phone()), paymentMethod: 'ONLINE', idempotencyKey: randomUUID() }).expect(201)).body.data;
    const auth = (await s.post('/api/v1/payments/mock/authorize').set(H).send({ providerOrderId: co.payment.providerOrderId, outcome: 'success' }).expect(200)).body.data;
    const mock = app.get(PaymentsGateway).mock!;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: auth.providerPaymentId, order_id: co.payment.providerOrderId, method: 'upi' } } } });
    const hook = (id: string) => request(app.getHttpServer()).post('/api/v1/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', mock.signWebhook(Buffer.from(body))).set('x-razorpay-event-id', id).send(body);
    const rs = await Promise.all([
      s.post('/api/v1/payments/verify').set(H).send({ orderId: co.order.id, ...auth }),
      s.post('/api/v1/payments/verify').set(H).send({ orderId: co.order.id, ...auth }),
      hook('evt_a'), hook('evt_b'),
    ]);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const payments = await prisma.payment.findMany({ where: { orderId: co.order.id } });
    expect(payments.filter((p) => p.status === 'CAPTURED')).toHaveLength(1);
    expect(await prisma.orderEvent.count({ where: { orderId: co.order.id, status: 'CONFIRMED' } })).toBe(1);
  });

  it('the last unit goes to exactly one of several simultaneous buyers', async () => {
    const variantId = await product(1);
    const buyers = await Promise.all([1, 2, 3, 4].map(async () => {
      const s = shopperAgent();
      await s.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
      return s;
    }));
    const rs = await Promise.all(buyers.map((s) => s.post('/api/v1/checkout').set(H).send({ address: address(phone()), guestEmail: `last${++n}@test.local`, paymentMethod: 'COD', idempotencyKey: randomUUID() })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId } });
    expect(inv.reserved).toBe(1);
    expect(inv.onHand - inv.reserved).toBe(0);
  });

  it('the same idempotency key submitted concurrently creates one order', async () => {
    const variantId = await product(5);
    const s = shopperAgent();
    await s.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
    const key = randomUUID();
    const body = { address: address(phone()), guestEmail: `idem${++n}@test.local`, paymentMethod: 'COD', idempotencyKey: key };
    const rs = await Promise.all([1, 2, 3].map(() => s.post('/api/v1/checkout').set(H).send(body)));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.data.order.id)).size).toBe(1);
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(1);
  });

  it('a coupon with one use left is redeemed once under concurrent checkouts', async () => {
    const variantId = await product(10);
    await admin.post('/api/v1/admin/coupons').set(H).send({ code: `ONCE${n}`, type: 'FIXED', value: 100, usageLimit: 1 }).expect(201);
    const buyers = await Promise.all([1, 2, 3].map(async () => {
      const s = shopperAgent();
      await s.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
      await s.post('/api/v1/cart/coupon').set(H).send({ code: `ONCE${n}` }).expect(200);
      return s;
    }));
    const rs = await Promise.all(buyers.map((s) => s.post('/api/v1/checkout').set(H).send({ address: address(phone()), guestEmail: `cpn${++n}@test.local`, paymentMethod: 'COD', idempotencyKey: randomUUID() })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const c = await prisma.coupon.findFirstOrThrow({ where: { code: { startsWith: 'ONCE' } } });
    expect(c.usedCount).toBe(1);
    expect(await prisma.couponUsage.count({ where: { couponId: c.id } })).toBe(1);
  });

  it('concurrent refreshes from two tabs keep the customer signed in', async () => {
    const s = await registered(`tabs${++n}@test.local`);
    const rs = await Promise.all([1, 2].map(() => s.post('/api/v1/auth/refresh').set(H)));
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    // The family must not have been wiped by reuse detection: the session still works.
    await s.post('/api/v1/auth/refresh').set(H).expect(200);
    await s.get('/api/v1/auth/me').expect(200);
  });

  it('a reused (stolen) refresh token after the grace window revokes the whole family', async () => {
    const email = `theft${++n}@test.local`;
    const reg = await request(app.getHttpServer()).post('/api/v1/auth/register').set(H).send({ name: 'Theft Test', email, password: 'Passw0rd!x' }).expect(201);
    const rt = (reg.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('vyra_rt='))!.split(';')[0]!;
    // Legit rotation.
    const rotated = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(H).set('Cookie', rt).expect(200);
    const newRt = (rotated.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('vyra_rt='))!.split(';')[0]!;
    // Attacker replays the OLD token long after it was rotated (outside the grace window).
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(H).set('Cookie', rt).expect(401);
    // Reuse detection revoked every session, including the legitimate new one.
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(H).set('Cookie', newRt).expect(401);
  });

  it('running the expiry job twice at once cancels and restocks an order once', async () => {
    const variantId = await product(3);
    const s = shopperAgent();
    await s.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 2 }).expect(201);
    const co = (await s.post('/api/v1/checkout').set(H).send({ address: address(phone()), guestEmail: `exp${++n}@test.local`, paymentMethod: 'ONLINE', idempotencyKey: randomUUID() }).expect(201)).body.data;
    await prisma.order.update({ where: { id: co.order.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const orders = app.get(OrdersService);
    await Promise.all([orders.expireReservations(), orders.expireReservations()]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: co.order.id } })).status).toBe('CANCELLED');
    expect(await prisma.inventoryMovement.count({ where: { orderId: co.order.id, type: 'RELEASE' } })).toBe(1);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(0);
    expect((await admin.get('/api/v1/admin/inventory/reconcile').expect(200)).body.data.consistent).toBe(true);
  });
});
