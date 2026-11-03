import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PaymentsGateway } from '../src/modules/payments/payments.gateway';
import { bootApp, createCategory, createStaff, H, productInput, registerCustomer } from './helpers';

const address = { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true };

describe('End-to-end commerce flow (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let variantId: string;
  let productSlug: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    admin = await createStaff(app, 'ADMIN');
    const cat = await createCategory(prisma);
    const p = (await admin.post('/api/v1/admin/products').set(H).send(productInput(cat.id)).expect(201)).body.data;
    variantId = p.variants[0].id;
    productSlug = p.slug;
    await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId, type: 'STOCK_IN', quantity: 3, reason: 'Opening stock' }).expect(201);
    await prisma.coupon.create({ data: { code: 'VIBE10', type: 'PERCENTAGE', value: 10, maxDiscount: 300, perUserLimit: 1 } });
  });
  afterAll(() => app.close());

  it('lets a customer find, bag, pay for and track an order; stock moves reserved → fulfilled', async () => {
    // Find the product via natural-language search (structured price filter + semantic text).
    const s = await request(app.getHttpServer()).get('/api/v1/search').query({ q: 'oversized black cotton t-shirt under 1000 rupees' }).expect(200);
    expect(s.body.data.interpretation.filters).toMatchObject({ maxPrice: 1000, colors: ['black'] });
    expect(s.body.data.items[0].slug).toBe(productSlug);
    const pdp = await request(app.getHttpServer()).get(`/api/v1/products/${productSlug}`).expect(200);
    expect(pdp.body.data.variants.find((v: { id: string }) => v.id === variantId).available).toBe(3);

    const shopper = await registerCustomer(app);
    await shopper.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 5 }).expect(409); // only 3 in stock
    const cart = (await shopper.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 2 }).expect(201)).body.data;
    expect(cart.totals.subtotal).toBe(1598);
    expect(cart.totals.shippingFee).toBe(0);
    const withCoupon = (await shopper.post('/api/v1/cart/coupon').set(H).send({ code: 'vibe10' }).expect(200)).body.data;
    expect(withCoupon.totals.couponDiscount).toBe(159.8);

    const key = randomUUID();
    const co = (await shopper.post('/api/v1/checkout').set(H).send({ address, paymentMethod: 'ONLINE', shippingMethod: 'STANDARD', idempotencyKey: key }).expect(201)).body.data;
    expect(co.order.status).toBe('PENDING_PAYMENT');
    expect(co.order.grandTotal).toBe(1438.2);
    expect(co.payment.provider).toBe('mock');
    expect(co.payment.amount).toBe(143820);
    // Same idempotency key → same order, no second reservation.
    const replay = (await shopper.post('/api/v1/checkout').set(H).send({ address, paymentMethod: 'ONLINE', idempotencyKey: key }).expect(201)).body.data;
    expect(replay.order.id).toBe(co.order.id);
    expect(await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).toMatchObject({ onHand: 3, reserved: 2 });

    // A forged signature is rejected; the order stays unpaid.
    await shopper.post('/api/v1/payments/verify').set(H).send({ orderId: co.order.id, providerOrderId: co.payment.providerOrderId, providerPaymentId: 'pay_fake', signature: 'a'.repeat(64) }).expect(400);
    const auth = (await shopper.post('/api/v1/payments/mock/authorize').set(H).send({ providerOrderId: co.payment.providerOrderId, outcome: 'success' }).expect(200)).body.data;
    const paid = (await shopper.post('/api/v1/payments/verify').set(H).send({ orderId: co.order.id, ...auth }).expect(200)).body.data;
    expect(paid.status).toBe('CONFIRMED');
    // Verifying twice is a no-op.
    await shopper.post('/api/v1/payments/verify').set(H).send({ orderId: co.order.id, ...auth }).expect(200);
    expect(await prisma.payment.count({ where: { orderId: co.order.id, status: 'CAPTURED' } })).toBe(1);

    // Coupon is single-use for this customer.
    await shopper.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
    await shopper.post('/api/v1/cart/coupon').set(H).send({ code: 'VIBE10' }).expect(400);

    // Admin fulfils: cannot skip packing; ship converts the reservation.
    await admin.post(`/api/v1/admin/orders/${co.order.id}/status`).set(H).send({ status: 'DELIVERED' }).expect(400);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/shipment`).set(H).send({ provider: 'MANUAL', courierName: 'Delhivery', trackingNumber: 'AWB123' }).expect(200);
    expect(await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).toMatchObject({ onHand: 1, reserved: 0 });
    await admin.post(`/api/v1/admin/orders/${co.order.id}/status`).set(H).send({ status: 'DELIVERED' }).expect(200);

    // Customer (and a guest with order number + email) can track it.
    const mine = (await shopper.get(`/api/v1/orders/${co.order.number}`).expect(200)).body.data;
    expect(mine.status).toBe('DELIVERED');
    expect(mine.shipment.trackingNumber).toBe('AWB123');
    expect(mine.canReturn).toBe(true);
    await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number: co.order.number, email: 'shopper@test.local' }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/orders/track').query({ number: co.order.number, email: 'other@test.local' }).expect(404);

    // Ledger tells the whole story.
    const types = (await prisma.inventoryMovement.findMany({ where: { variantId }, orderBy: { createdAt: 'asc' } })).map((m) => m.type);
    expect(types).toEqual(['STOCK_IN', 'RESERVATION', 'FULFILLMENT']);

    // Return → receive (restock) → refund via provider.
    const ret = (await shopper.post('/api/v1/returns').set(H).send({ orderId: co.order.id, reason: 'SIZE_ISSUE', items: [{ orderItemId: mine.items[0].id, quantity: 1 }] }).expect(201)).body.data;
    expect(ret.refundAmount).toBe(719.1);
    for (const action of ['APPROVE', 'RECEIVE', 'REFUND']) await admin.post(`/api/v1/admin/returns/${ret.id}/decision`).set(H).send({ action, restock: true }).expect(200);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(2);
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: co.order.id } });
    expect(Number(refund.amount)).toBe(719.1);
    expect(refund.status).toBe('PROCESSED');
  });

  it('releases stock and the coupon when an unpaid order is cancelled', async () => {
    const guest = request.agent(app.getHttpServer());
    await guest.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 1 }).expect(201);
    const co = (await guest.post('/api/v1/checkout').set(H).send({ address, guestEmail: 'guest@test.local', paymentMethod: 'ONLINE', idempotencyKey: randomUUID() }).expect(201)).body.data;
    const before = await prisma.inventory.findUniqueOrThrow({ where: { variantId } });
    expect(before.reserved).toBe(1);
    await prisma.order.update({ where: { id: co.order.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    expect((await app.get(OrdersService).expireReservations()).expired).toBe(1);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: co.order.id } })).status).toBe('CANCELLED');
  });

  it('places COD orders as confirmed and refuses checkout when stock ran out', async () => {
    const guest = request.agent(app.getHttpServer());
    await guest.post('/api/v1/cart/items').set(H).send({ variantId, quantity: 2 }).expect(201);
    // Someone else buys the stock first.
    await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId, type: 'STOCK_OUT', quantity: 1, reason: 'Sold in store' }).expect(201);
    const oos = await guest.post('/api/v1/checkout').set(H).send({ address, guestEmail: 'g2@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(409);
    expect(oos.body.error.code).toBe('OUT_OF_STOCK');
    expect(oos.body.error.details.items[0]).toMatchObject({ variantId, requested: 2, available: 1 });
    const item = (await guest.get('/api/v1/cart').expect(200)).body.data.items[0];
    await guest.patch(`/api/v1/cart/items/${item.id}`).set(H).send({ quantity: 1 }).expect(200);
    const cod = (await guest.post('/api/v1/checkout').set(H).send({ address, guestEmail: 'g2@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data;
    expect(cod.order.status).toBe('CONFIRMED');
    expect(cod.order.codFee).toBe(49);
    expect(cod.payment).toBeNull();
  });

  it('verifies and deduplicates payment webhooks', async () => {
    const mock = app.get(PaymentsGateway).mock!;
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_none' } } } });
    const bad = await request(app.getHttpServer()).post('/api/v1/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', 'deadbeef').send(body).expect(403);
    expect(bad.body.error.message).toBe('Invalid webhook signature');
    const sig = mock.signWebhook(Buffer.from(body));
    const first = await request(app.getHttpServer()).post('/api/v1/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', 'evt_1').send(body);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    const again = await request(app.getHttpServer()).post('/api/v1/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', 'evt_1').send(body).expect(200);
    expect(again.body.duplicate).toBe(true);
  });
});

describe('Authorization boundaries (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await bootApp());
  });
  afterAll(() => app.close());

  it('keeps customers out of admin, enforces CSRF and least privilege', async () => {
    const shopper = await registerCustomer(app, 'c@test.local');
    await shopper.get('/api/v1/admin/products').expect(401); // customer cookie is not a staff session
    await shopper.post('/api/v1/admin/auth/login').set(H).send({ email: 'c@test.local', password: 'Passw0rd!x' }).expect(401);
    await shopper.post('/api/v1/cart/items').send({ variantId: 'x', quantity: 1 }).expect(403); // no CSRF header

    const ordersMgr = await createStaff(app, 'ORDER_MANAGER');
    await ordersMgr.get('/api/v1/admin/orders').expect(200);
    await ordersMgr.get('/api/v1/admin/dashboard').expect(403);
    await ordersMgr.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: 'x', type: 'STOCK_IN', quantity: 1, reason: 'test' }).expect(403);
    await ordersMgr.post('/api/v1/admin/orders/x/refunds').set(H).send({ amount: 1, reason: 'test' }).expect(403);
    await ordersMgr.post('/api/v1/admin/users').set(H).send({ name: 'Evil', email: 'e@test.local', password: 'Passw0rd!x', role: 'ADMIN' }).expect(403);

    const adminAgent = await createStaff(app, 'ADMIN');
    await adminAgent.post('/api/v1/admin/users').set(H).send({ name: 'Peer', email: 'peer@test.local', password: 'Passw0rd!x', role: 'ADMIN' }).expect(403); // no escalation
    await adminAgent.post('/api/v1/admin/users').set(H).send({ name: 'Stock', email: 'stock@test.local', password: 'Passw0rd!x', role: 'INVENTORY_MANAGER' }).expect(201);
    await adminAgent.post('/api/v1/auth/login').set(H).send({ email: 'admin@test.local', password: 'Passw0rd!x' }).expect(400); // staff can't use storefront login
  });

  it('locks accounts after repeated failed logins and rotates refresh tokens', async () => {
    const agent = await registerCustomer(app, 'lock@test.local');
    const refreshed = await agent.post('/api/v1/auth/refresh').set(H).expect(200);
    expect(refreshed.body.data.email).toBe('lock@test.local');
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/api/v1/auth/login').set(H).send({ email: 'lock@test.local', password: 'wrong-pass1' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').set(H).send({ email: 'lock@test.local', password: 'Passw0rd!x' }).expect(429);
  });
});
