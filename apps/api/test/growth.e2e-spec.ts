import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MessagingService } from '../src/common/messaging/messaging.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { bootApp, createCategory, createStaff, H, productInput } from './helpers';

const PHONE = '9123456780';
const address = (phone = PHONE, pincode = '560001') => ({ fullName: 'Ravi Kumar', phone, line1: '7 Brigade Road', city: 'Bengaluru', state: 'Karnataka', pincode, type: 'HOME', isDefault: true });

describe('Phone OTP, COD protection, exchanges, reviews (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: MessagingService['outbox'];
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let product: { id: string; slug: string; variants: { id: string; size: string; color: string }[] };
  const lastOtp = (to: string) => [...outbox].reverse().find((m) => m.to === to && m.template === 'otp')!.params[0]!;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    outbox = app.get(MessagingService).outbox;
    admin = await createStaff(app, 'ADMIN');
    const cat = await createCategory(prisma);
    product = (await admin.post('/api/v1/admin/products').set(H).send(productInput(cat.id)).expect(201)).body.data;
    for (const v of product.variants) await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_IN', quantity: 20, reason: 'Opening stock' }).expect(201);
  });
  afterAll(() => app.close());

  async function codOrder(agent: request.Agent, phone = PHONE, pincode = '560001') {
    await agent.post('/api/v1/cart/items').set(H).send({ variantId: product.variants[0]!.id, quantity: 1 }).expect(201);
    return (await agent.post('/api/v1/checkout').set(H).send({ address: address(phone, pincode), guestEmail: 'ravi@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() })).body;
  }

  it('signs customers up and in with phone + OTP, with resend limits and attempt limits', async () => {
    const agent = request.agent(app.getHttpServer());
    const sent = (await agent.post('/api/v1/auth/otp/request').set(H).send({ phone: '+91 98111-22233' }).expect(200)).body.data;
    expect(sent.phoneMasked).toBe('+91 98••••••33');
    await agent.post('/api/v1/auth/otp/request').set(H).send({ phone: '9811122233' }).expect(429); // 30s resend window
    const code = lastOtp('9811122233');
    await agent.post('/api/v1/auth/otp/verify').set(H).send({ phone: '9811122233', code: code === '000000' ? '111111' : '000000' }).expect(400);
    const needName = await agent.post('/api/v1/auth/otp/verify').set(H).send({ phone: '9811122233', code }).expect(422);
    expect(needName.body.error.details.needsName).toBe(true);
    // The failed "needs name" attempt consumed nothing: the code is still valid.
    const res = (await agent.post('/api/v1/auth/otp/verify').set(H).send({ phone: '9811122233', code, name: 'Meera N', marketingOptIn: true }).expect(200)).body.data;
    expect(res.isNewUser).toBe(true);
    expect(res.user).toMatchObject({ email: null, phone: '9811122233', phoneVerified: true, marketingOptIn: true });
    expect((await agent.get('/api/v1/auth/me').expect(200)).body.data.name).toBe('Meera N');
    // OTP values are never stored in plain text.
    const stored = await prisma.otpCode.findFirstOrThrow({ where: { phone: '9811122233' } });
    expect(stored.codeHash).not.toContain(code);
    const note = await prisma.notification.findFirstOrThrow({ where: { recipient: '9811122233', channel: 'sms' } });
    expect(JSON.stringify(note.payload)).not.toContain(code);
  });

  it('never lets an OTP login take over an account that merely typed the phone', async () => {
    const attacker = request.agent(app.getHttpServer());
    await attacker.post('/api/v1/auth/register').set(H).send({ name: 'Attacker', email: 'attacker@test.local', phone: '9822233344', password: 'Passw0rd!x' }).expect(201);
    const owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/otp/request').set(H).send({ phone: '9822233344' }).expect(200);
    const r = (await owner.post('/api/v1/auth/otp/verify').set(H).send({ phone: '9822233344', code: lastOtp('9822233344'), name: 'Real Owner' }).expect(200)).body.data;
    expect(r.isNewUser).toBe(true);
    expect(r.user.email).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'attacker@test.local' } })).phone).toBeNull();
  });

  it('holds COD orders until OTP confirmation and blocks packing until then', async () => {
    const guest = request.agent(app.getHttpServer());
    const { data } = await codOrder(guest);
    expect(data.order.codConfirmation).toBe('PENDING');
    expect(data.codOtp.phoneMasked).toBe('+91 91••••••80');
    expect(data.order.prepaidDiscount).toBe(0);
    await admin.post(`/api/v1/admin/orders/${data.order.id}/status`).set(H).send({ status: 'PACKED' }).expect(400);
    await guest.post(`/api/v1/orders/${data.order.number}/confirm-cod`).set(H).send({ code: '123456' === lastOtp(PHONE) ? '654321' : '123456' }).expect(400);
    const ok = (await guest.post(`/api/v1/orders/${data.order.number}/confirm-cod`).set(H).send({ code: lastOtp(PHONE) }).expect(200)).body.data;
    expect(ok.codConfirmation).toBe('CONFIRMED');
    expect(outbox.some((m) => m.channel === 'whatsapp' && m.template === 'vyra_order_confirmed' && m.to === PHONE)).toBe(true);
    await admin.post(`/api/v1/admin/orders/${data.order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
  });

  it('auto-cancels COD orders that are never confirmed, releasing stock', async () => {
    const guest = request.agent(app.getHttpServer());
    const { data } = await codOrder(guest, '9333344455');
    const before = await prisma.inventory.findUniqueOrThrow({ where: { variantId: product.variants[0]!.id } });
    await prisma.order.update({ where: { id: data.order.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const r = await app.get(OrdersService).expireReservations();
    expect(r.codUnconfirmed).toBe(1);
    const after = await prisma.inventory.findUniqueOrThrow({ where: { variantId: product.variants[0]!.id } });
    expect(after.reserved).toBe(before.reserved - 1);
  });

  it('turns COD off after repeated refusals (RTO) and for blocked PIN codes; prepaid still works', async () => {
    const risky = '9444455566';
    for (let i = 0; i < 2; i++) {
      const guest = request.agent(app.getHttpServer());
      const { data } = await codOrder(guest, risky);
      await admin.post(`/api/v1/admin/orders/${data.order.id}/confirm-cod`).set(H).send({ note: 'Called customer' }).expect(200);
      await admin.post(`/api/v1/admin/orders/${data.order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
      await admin.post(`/api/v1/admin/orders/${data.order.id}/shipment`).set(H).send({ provider: 'MANUAL', courierName: 'Delhivery' }).expect(200);
      const onHand = (await prisma.inventory.findUniqueOrThrow({ where: { variantId: product.variants[0]!.id } })).onHand;
      const rto = (await admin.post(`/api/v1/admin/orders/${data.order.id}/status`).set(H).send({ status: 'RTO', note: 'Customer refused' }).expect(200)).body.data;
      expect(rto.status).toBe('RTO');
      expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: product.variants[0]!.id } })).onHand).toBe(onHand + 1);
    }
    expect(await prisma.codRisk.findUniqueOrThrow({ where: { phone: risky } })).toMatchObject({ rtoCount: 2, codBlocked: true });
    const guest = request.agent(app.getHttpServer());
    const blocked = await codOrder(guest, risky);
    expect(blocked.error.message).toMatch(/earlier COD parcels/);
    const quote = (await guest.post('/api/v1/checkout/quote').set(H).send({ paymentMethod: 'COD', phone: risky }).expect(200)).body.data;
    expect(quote.codAvailable).toBe(false);
    expect(quote.prepaidSavings).toBeGreaterThan(0);
    await guest.post('/api/v1/checkout').set(H).send({ address: address(risky), guestEmail: 'ravi@test.local', paymentMethod: 'ONLINE', idempotencyKey: randomUUID() }).expect(201);

    await admin.post('/api/v1/admin/cod/blocked-pincodes').set(H).send({ pincode: '110001', reason: 'High refusals' }).expect(201);
    const pinGuest = request.agent(app.getHttpServer());
    expect((await codOrder(pinGuest, '9555566677', '110001')).error.message).toMatch(/PIN 110001/);
    const cod = (await admin.get('/api/v1/admin/analytics/cod').expect(200)).body.data;
    expect(cod.rtoOrders).toBe(2);
    expect(cod.topRtoPincodes[0]).toMatchObject({ pincode: '560001', rto: 2 });
  });

  it('exchanges a size: no refund, returned item restocked, replacement order reserved', async () => {
    const shopperPhone = '9666677788';
    const shopper = request.agent(app.getHttpServer());
    await shopper.post('/api/v1/auth/otp/request').set(H).send({ phone: shopperPhone }).expect(200);
    await shopper.post('/api/v1/auth/otp/verify').set(H).send({ phone: shopperPhone, code: lastOtp(shopperPhone), name: 'Kabir' }).expect(200);
    const m = product.variants.find((v) => v.color === 'Black' && v.size === 'M')!;
    const l = product.variants.find((v) => v.color === 'Black' && v.size === 'L')!;
    await shopper.post('/api/v1/cart/items').set(H).send({ variantId: m.id, quantity: 1 }).expect(201);
    const co = (await shopper.post('/api/v1/checkout').set(H).send({ address: address(shopperPhone), guestEmail: 'kabir@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data;
    expect((await prisma.user.findFirstOrThrow({ where: { phone: shopperPhone } })).email).toBe('kabir@test.local'); // saved for next time
    await admin.post(`/api/v1/admin/orders/${co.order.id}/confirm-cod`).set(H).send({}).expect(200);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/shipment`).set(H).send({ provider: 'MANUAL' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${co.order.id}/status`).set(H).send({ status: 'DELIVERED' }).expect(200);

    const detail = (await shopper.get(`/api/v1/orders/${co.order.number}`).expect(200)).body.data;
    expect(detail.exchangeOptions[detail.items[0].id].map((o: { size: string; color: string }) => `${o.color}/${o.size}`)).toEqual(['Black/L', 'White/M']);
    await shopper.post('/api/v1/returns').set(H).send({ orderId: co.order.id, type: 'EXCHANGE', reason: 'SIZE_ISSUE', items: [{ orderItemId: detail.items[0].id, quantity: 1 }] }).expect(422);
    const ex = (await shopper.post('/api/v1/returns').set(H).send({ orderId: co.order.id, type: 'EXCHANGE', reason: 'SIZE_ISSUE', items: [{ orderItemId: detail.items[0].id, quantity: 1, exchangeVariantId: l.id }] }).expect(201)).body.data;
    expect(ex).toMatchObject({ type: 'EXCHANGE', refundAmount: 0 });
    expect(ex.items[0].exchangeFor).toMatchObject({ size: 'L', color: 'Black' });

    const lBefore = await prisma.inventory.findUniqueOrThrow({ where: { variantId: l.id } });
    const mBefore = await prisma.inventory.findUniqueOrThrow({ where: { variantId: m.id } });
    await admin.post(`/api/v1/admin/returns/${ex.id}/decision`).set(H).send({ action: 'APPROVE' }).expect(200);
    const done = (await admin.post(`/api/v1/admin/returns/${ex.id}/decision`).set(H).send({ action: 'RECEIVE', restock: true }).expect(200)).body.data;
    expect(done.status).toBe('EXCHANGED');
    expect(done.replacementOrderNumber).toMatch(/^VY/);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: m.id } })).onHand).toBe(mBefore.onHand + 1);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: l.id } })).reserved).toBe(lBefore.reserved + 1);
    const repl = (await shopper.get(`/api/v1/orders/${done.replacementOrderNumber}`).expect(200)).body.data;
    expect(repl).toMatchObject({ grandTotal: 0, status: 'CONFIRMED', exchangeForOrderNumber: co.order.number });
    await admin.post(`/api/v1/admin/returns/${ex.id}/decision`).set(H).send({ action: 'REFUND' }).expect(400);
    expect(await prisma.refund.count({ where: { orderId: co.order.id } })).toBe(0);
    const rates = (await admin.get('/api/v1/admin/analytics/return-rates').expect(200)).body.data;
    expect(rates[0]).toMatchObject({ unitsReturned: 1, exchanges: 1, topReason: 'SIZE_ISSUE' });

    // Fit feedback + photo review from the verified buyer.
    const photo = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#222222' } }).jpeg().toBuffer();
    const rv = (await shopper.post(`/api/v1/products/${product.slug}/reviews`).set(H).field('rating', '4').field('fit', 'RUNS_SMALL').field('body', 'Great tee, size up').attach('images', photo, 'me.jpg').expect(201)).body.data;
    expect(rv).toMatchObject({ verifiedPurchase: true, fit: 'RUNS_SMALL', sizePurchased: 'M' });
    expect(rv.images[0].url).toMatch(/\.webp$/);
    const pdp = (await request(app.getHttpServer()).get(`/api/v1/products/${product.slug}`).expect(200)).body.data;
    expect(pdp.fit).toMatchObject({ runsSmall: 1, total: 1, advice: null }); // advice needs ≥3 votes
  });

  it('reminds opted-in customers about abandoned bags exactly once per change', async () => {
    const phone = '9777788899';
    const a = request.agent(app.getHttpServer());
    await a.post('/api/v1/auth/otp/request').set(H).send({ phone }).expect(200);
    await a.post('/api/v1/auth/otp/verify').set(H).send({ phone, code: lastOtp(phone), name: 'Diya', marketingOptIn: true }).expect(200);
    await a.post('/api/v1/cart/items').set(H).send({ variantId: product.variants[2]!.id, quantity: 1 }).expect(201);
    await prisma.cartItem.updateMany({ where: { cart: { user: { phone } } }, data: { updatedAt: new Date(Date.now() - 5 * 3600_000) } });
    const orders = app.get(OrdersService);
    expect((await orders.remindAbandonedCarts()).sent).toBe(1);
    expect(outbox.some((m) => m.to === phone && m.template === 'vyra_cart_reminder')).toBe(true);
    expect((await orders.remindAbandonedCarts()).sent).toBe(0);
  });
});

describe('Review photo validation (integration)', () => {
  it('rejects a bad photo without saving a partial review', async () => {
    const { bootApp: boot, createStaff: staff, createCategory: cat, productInput: input, H: h } = await import('./helpers');
    const { app, prisma } = await boot();
    try {
      const admin = await staff(app, 'ADMIN');
      const c = await cat(prisma);
      const p = (await admin.post('/api/v1/admin/products').set(h).send(input(c.id)).expect(201)).body.data;
      const agent = (await import('supertest')).default.agent(app.getHttpServer());
      await agent.post('/api/v1/auth/register').set(h).send({ name: 'Rev', email: 'rev@test.local', password: 'Passw0rd!x' }).expect(201);
      const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer();
      const r = await agent.post(`/api/v1/products/${p.slug}/reviews`).set(h).field('rating', '5').attach('images', tiny, 'tiny.png').expect(400);
      expect(r.body.error.message).toMatch(/200×200/);
      expect(await prisma.review.count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});
