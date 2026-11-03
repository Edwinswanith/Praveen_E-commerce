import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MessagingService } from '../src/common/messaging/messaging.service';
import { CampaignsService } from '../src/modules/campaigns/campaigns.service';
import { bootApp, createCategory, createStaff, H, productInput, registerCustomer } from './helpers';

const HOUR = 3600_000;
const address = (phone = '9123400001') => ({ fullName: 'Asha Rao', phone, line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', type: 'HOME', isDefault: true });
type Product = { id: string; slug: string; variants: { id: string; size: string; color: string }[] };

describe('Festival campaigns, offers and the discount ledger (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let categoryId: string;
  let n = 0;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    admin = await createStaff(app, 'ADMIN');
    categoryId = (await createCategory(prisma)).id;
  });
  afterAll(() => app.close());

  /** Fresh product per scenario (regular ₹799, MRP ₹1,299, cost ₹400) with 20 units per variant. */
  async function newProduct(): Promise<Product> {
    n++;
    const base = productInput(categoryId);
    const p = (await admin.post('/api/v1/admin/products').set(H).send({ ...base, name: `Festive Tee ${n}`, variants: base.variants.map((v) => ({ ...v, costPrice: 400 })) }).expect(201)).body.data;
    for (const v of p.variants) await admin.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_IN', quantity: 20, reason: 'Opening stock' }).expect(201);
    return p;
  }

  async function campaign(over: Record<string, unknown> = {}) {
    n++;
    return (await admin.post('/api/v1/admin/campaigns').set(H).send({
      name: `Diwali Sale ${n}`, slug: `diwali-${n}`, festival: 'Diwali', bannerTitle: 'Festive edit',
      startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 48 * HOUR), ...over,
    }).expect(201)).body.data as { id: string; slug: string };
  }

  const pdp = async (slug: string) => (await request(app.getHttpServer()).get(`/api/v1/products/${slug}`).expect(200)).body.data;
  const listing = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

  it('validates prices, publishes, and every surface shows the same live sale price', async () => {
    const p = await newProduct();
    const c = await campaign();
    const v = p.variants[0]!;
    // Hard rules: never at/above the regular price, never below cost.
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 799 }] }).expect(422);
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 399 }] }).expect(422);
    // Bulk: 25% off regular, rounded down to …9 (₹599.25 → ₹599).
    const bulk = (await admin.post(`/api/v1/admin/campaigns/${c.id}/prices/bulk`).set(H).send({ productIds: [p.id], percentOff: 25, roundToNine: true }).expect(200)).body.data;
    expect(bulk.applied).toBe(3);
    expect(bulk.rows.every((r: { salePrice: number }) => r.salePrice === 599)).toBe(true);

    // Draft: nothing changes for shoppers.
    expect((await pdp(p.slug)).variants[0].price).toBe(799);
    expect((await request(app.getHttpServer()).get('/api/v1/campaigns/current').expect(200)).body.data).toHaveLength(0);

    const check = (await admin.get(`/api/v1/admin/campaigns/${c.id}/checklist`).expect(200)).body.data;
    expect(check.ready).toBe(true);
    expect(check.problems.some((x: { message: string }) => /start is in the past/.test(x.message))).toBe(true);
    const pub = (await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200)).body.data;
    expect(pub.phase).toBe('LIVE');
    // The claim is computed from real in-stock prices, rounded down: (1299-599)/1299 = 53.9% → "up to 50%".
    expect(pub.claim).toEqual({ upToPercent: 50, productCount: 1 });

    const detail = await pdp(p.slug);
    expect(detail.variants[0]).toMatchObject({ price: 599, basePrice: 799, mrp: 1299, campaign: { slug: c.slug } });
    expect(detail.campaign.slug).toBe(c.slug);
    expect(Number((await listing(p.id)).minPrice)).toBe(599); // sort/filter read model

    const shopper = request.agent(app.getHttpServer());
    const cart = (await shopper.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201)).body.data;
    expect(cart.items[0].unitPrice).toBe(599);
    expect(cart.totals).toMatchObject({ subtotal: 599, campaignSavings: 200, mrpTotal: 1299 });

    const order = (await shopper.post('/api/v1/checkout').set(H).send({ address: address(), guestEmail: 'asha@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data.order;
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.campaignId).toBe(c.id);
    expect(Number(item.unitPrice)).toBe(599);
    const ledger = await prisma.orderDiscount.findMany({ where: { orderId: order.id } });
    expect(ledger.map((d) => [d.source, Number(d.amount), d.sourceId])).toEqual([['CAMPAIGN_PRICE', 200, c.id]]);
    expect((await prisma.campaignPrice.findFirstOrThrow({ where: { campaignId: c.id, variantId: v.id } })).soldCount).toBe(1);

    const report = (await admin.get(`/api/v1/admin/campaigns/${c.id}/report`).expect(200)).body.data;
    expect(report).toMatchObject({ orders: 1, units: 1, discount: { campaign: 200 } });

    // Cancelling gives the deal unit back.
    await admin.post(`/api/v1/admin/orders/${order.id}/cancel`).set(H).send({ reason: 'Customer changed mind' }).expect(200);
    expect((await prisma.campaignPrice.findFirstOrThrow({ where: { campaignId: c.id, variantId: v.id } })).soldCount).toBe(0);
  });

  it('only lets a running sale get better, discloses extensions, and ends on the clock without any job', async () => {
    const p = await newProduct();
    const c = await campaign();
    const v = p.variants[0]!;
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 649 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 699 }] }).expect(422); // raise: refused
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 629 }] }).expect(200); // lower: fine
    await admin.delete(`/api/v1/admin/campaigns/${c.id}/prices/${v.id}`).set(H).expect(400); // advertised deal can't vanish mid-sale
    await admin.patch(`/api/v1/admin/campaigns/${c.id}`).set(H).send({ endsAt: new Date(Date.now() + 72 * HOUR) }).expect(400); // must use extend
    await admin.patch(`/api/v1/admin/campaigns/${c.id}`).set(H).send({ bannerTitle: 'Flat 50% off' }).expect(422); // no typed % claims

    const ext = (await admin.post(`/api/v1/admin/campaigns/${c.id}/extend`).set(H).send({ endsAt: new Date(Date.now() + 72 * HOUR), note: 'Extended by popular demand' }).expect(200)).body.data;
    expect(ext.extended).toBe(true);
    expect(ext.originalEndsAt).not.toBeNull();
    const pub = (await request(app.getHttpServer()).get(`/api/v1/campaigns/${c.slug}`).expect(200)).body.data;
    expect(pub).toMatchObject({ extended: true, phase: 'LIVE' });
    expect(pub.countdownTo).toBe(ext.endsAt); // countdown only to the real end

    // The sale ends: prices revert immediately (phase is derived from the clock)...
    await prisma.campaign.update({ where: { id: c.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await pdp(p.slug)).variants[0].price).toBe(799);
    // ...and the sweep refreshes the listing read model.
    expect(Number((await listing(p.id)).minPrice)).toBe(629);
    await app.get(CampaignsService).sweep();
    expect(Number((await listing(p.id)).minPrice)).toBe(799);
    expect((await admin.get(`/api/v1/admin/campaigns/${c.id}`).expect(200)).body.data.phase).toBe('ENDED');
  });

  it('enforces deal stock caps and per-customer limits atomically', async () => {
    const p = await newProduct();
    const c = await campaign();
    const v = p.variants[0]!;
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 499, stockCap: 2, perCustomerLimit: 1 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);

    const a = await registerCustomer(app, 'capped-a@test.local');
    await a.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 2 }).expect(201);
    const over = await a.post('/api/v1/checkout').set(H).send({ address: address('9123400002'), paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(400);
    expect(over.body.error.message).toMatch(/limited to 1 per customer/);
    await a.patch(`/api/v1/cart/items/${(await a.get('/api/v1/cart')).body.data.items[0].id}`).set(H).send({ quantity: 1 }).expect(200);
    await a.post('/api/v1/checkout').set(H).send({ address: address('9123400002'), paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201);
    // Same person again (same phone, different account): limit holds.
    const a2 = request.agent(app.getHttpServer());
    await a2.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201);
    await a2.post('/api/v1/checkout').set(H).send({ address: address('9123400002'), guestEmail: 'other@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(400);

    const b = request.agent(app.getHttpServer());
    await b.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201);
    await b.post('/api/v1/checkout').set(H).send({ address: address('9123400003'), guestEmail: 'b@test.local', paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201);
    // Cap reached: the next shopper sees and pays the regular price.
    const d = request.agent(app.getHttpServer());
    const cart = (await d.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201)).body.data;
    expect(cart.items[0].unitPrice).toBe(799);
    expect(cart.totals.campaignSavings).toBe(0);
    expect((await pdp(p.slug)).variants[0]).toMatchObject({ price: 799, campaign: null });
  });

  it('gives early access only to opted-in signed-in customers, and stops checkout if the price rose', async () => {
    const p = await newProduct();
    const v = p.variants[0]!;
    const c = await campaign({ earlyAccessStartsAt: new Date(Date.now() - HOUR), startsAt: new Date(Date.now() + 2 * HOUR), teaserStartsAt: new Date(Date.now() - 2 * HOUR) });
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 549 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);

    const guest = request.agent(app.getHttpServer());
    expect((await guest.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201)).body.data.items[0].unitPrice).toBe(799);
    expect((await pdp(p.slug)).variants[0].price).toBe(799); // public price until the sale starts
    expect(Number((await listing(p.id)).minPrice)).toBe(799);

    const member = await registerCustomer(app, 'early@test.local');
    expect((await member.get(`/api/v1/campaigns/${c.slug}`).expect(200)).body.data).toMatchObject({ phase: 'EARLY_ACCESS', hasEarlyAccess: false });
    expect((await member.post(`/api/v1/campaigns/${c.slug}/remind-me`).set(H).send({}).expect(200)).body.data.earlyAccess).toBe(true);
    expect((await member.get(`/api/v1/campaigns/${c.slug}`).expect(200)).body.data).toMatchObject({ hasEarlyAccess: true, subscribed: true });
    const cart = (await member.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201)).body.data;
    expect(cart.items[0].unitPrice).toBe(549);

    // The shopper saw ₹549 + shipping; if early access is withdrawn meanwhile, we stop instead of charging more.
    const expectedTotal = cart.totals.grandTotal;
    await admin.post(`/api/v1/admin/campaigns/${c.id}/pause`).set(H).send({ note: 'Pricing error' }).expect(200);
    const r = await member.post('/api/v1/checkout').set(H).send({ address: address('9123400004'), paymentMethod: 'COD', expectedTotal, idempotencyKey: randomUUID() }).expect(409);
    expect(r.body.error.code).toBe('PRICE_CHANGED');
  });

  it('applies bundles, picks the best auto coupon, and claws back only what kept items no longer qualify for', async () => {
    const p = await newProduct();
    const [m, l] = p.variants;
    await admin.post('/api/v1/admin/promotions').set(H).send({ name: 'Buy 2, extra 10% off', minQuantity: 2, percentOff: 10, productIds: [p.id] }).expect(201);
    await admin.post('/api/v1/admin/coupons').set(H).send({ code: 'AUTO50', type: 'FIXED', value: 50, autoApply: true }).expect(201);
    await admin.post('/api/v1/admin/coupons').set(H).send({ code: 'AUTO100', type: 'FIXED', value: 100, minOrderValue: 5000, autoApply: true }).expect(201); // not eligible

    const shopper = await registerCustomer(app, 'bundle@test.local');
    await shopper.post('/api/v1/cart/items').set(H).send({ variantId: m!.id, quantity: 1 }).expect(201);
    const cart = (await shopper.post('/api/v1/cart/items').set(H).send({ variantId: l!.id, quantity: 1 }).expect(201)).body.data;
    expect(cart.totals).toMatchObject({ subtotal: 1598, promotionDiscount: 159.8, promotionName: 'Buy 2, extra 10% off', couponDiscount: 50 });
    expect(cart).toMatchObject({ couponCode: 'AUTO50', couponAutoApplied: true });

    const order = (await shopper.post('/api/v1/checkout').set(H).send({ address: address('9123400005'), paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data.order;
    const detail = (await shopper.get(`/api/v1/orders/${order.number}`).expect(200)).body.data;
    expect(detail.savings).toEqual({ campaign: 0, promotion: 159.8, coupon: 50, prepaid: 0 });
    expect(detail.promotionDiscount).toBe(159.8);
    await admin.post(`/api/v1/admin/orders/${order.id}/confirm-cod`).set(H).send({}).expect(200);
    await admin.post(`/api/v1/admin/orders/${order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${order.id}/shipment`).set(H).send({ provider: 'MANUAL' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${order.id}/status`).set(H).send({ status: 'DELIVERED' }).expect(200);

    const [i1, i2] = detail.items as { id: string; lineTotal: number }[];
    const delivered = (await shopper.get(`/api/v1/orders/${order.number}`).expect(200)).body.data;
    expect(delivered.exchangeOptions[i1!.id].length).toBeGreaterThan(0);
    const preview = (await shopper.post(`/api/v1/orders/${order.number}/return-preview`).set(H).send({ items: [{ orderItemId: i1!.id, quantity: 1 }] }).expect(200)).body.data;
    expect(preview.itemsValue).toBe(i1!.lineTotal);
    expect(preview.deductions).toHaveLength(1);
    expect(preview.deductions[0].label).toMatch(/Buy 2.*needs 2/);
    expect(preview.refundAmount).toBeCloseTo(i1!.lineTotal - preview.deductions[0].amount, 2);

    const r1 = (await shopper.post('/api/v1/returns').set(H).send({ orderId: order.id, type: 'RETURN', reason: 'OTHER', items: [{ orderItemId: i1!.id, quantity: 1 }] }).expect(201)).body.data;
    expect(r1.refundAmount).toBe(preview.refundAmount);
    // Returning the rest gives the deduction back: everything returned = everything paid for the items.
    const p2 = (await shopper.post(`/api/v1/orders/${order.number}/return-preview`).set(H).send({ items: [{ orderItemId: i2!.id, quantity: 1 }] }).expect(200)).body.data;
    expect(p2.deductions.some((d: { amount: number }) => d.amount < 0)).toBe(true);
    expect(Math.round((r1.refundAmount + p2.refundAmount) * 100)).toBe(Math.round((i1!.lineTotal + i2!.lineTotal) * 100));
    await prisma.coupon.updateMany({ where: { code: { in: ['AUTO50', 'AUTO100'] } }, data: { isActive: false } }); // isolate later scenarios
  });

  it('keeps the better offer when a coupon cannot combine with a bundle, and says so', async () => {
    const p = await newProduct();
    const [m, l] = p.variants;
    await admin.post('/api/v1/admin/promotions').set(H).send({ name: 'Pair deal 15%', minQuantity: 2, percentOff: 15, productIds: [p.id] }).expect(201);
    await admin.post('/api/v1/admin/coupons').set(H).send({ code: 'SOLO100', type: 'FIXED', value: 100, combinableWithPromotions: false }).expect(201);
    const s = request.agent(app.getHttpServer());
    await s.post('/api/v1/cart/items').set(H).send({ variantId: m!.id, quantity: 1 }).expect(201);
    await s.post('/api/v1/cart/items').set(H).send({ variantId: l!.id, quantity: 1 }).expect(201);
    // Applying a code that would save nothing is refused with the reason (we never store a dead code).
    const refused = await s.post('/api/v1/cart/coupon').set(H).send({ code: 'SOLO100' }).expect(400);
    expect(refused.body.error.message).toMatch(/can't be combined with “Pair deal 15%”/);
    const q = (await s.post('/api/v1/checkout/quote').set(H).send({ couponCode: 'SOLO100', shippingMethod: 'STANDARD', paymentMethod: 'COD' }).expect(200)).body.data;
    expect(q.promotionDiscount).toBeGreaterThan(100); // 15% of the pair beats ₹100
    expect(q.couponDiscount).toBe(0);
    expect(q.offerNote).toMatch(/kept the better offer/);
    // With a single item there's no bundle, so the coupon wins and applies.
    await s.delete(`/api/v1/cart/items/${(await s.get('/api/v1/cart')).body.data.items[1].id}`).set(H).expect(200);
    expect((await s.post('/api/v1/cart/coupon').set(H).send({ code: 'SOLO100' }).expect(200)).body.data.totals.couponDiscount).toBe(100);
  });

  it('auto-pauses a campaign when its discount budget is used, and the ledger stays consistent', async () => {
    const p = await newProduct();
    const v = p.variants[1]!;
    const c = await campaign({ budget: 300 });
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 599 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);
    for (const phone of ['9123400006', '9123400007']) {
      const s = request.agent(app.getHttpServer());
      await s.post('/api/v1/cart/items').set(H).send({ variantId: v.id, quantity: 1 }).expect(201);
      await s.post('/api/v1/checkout').set(H).send({ address: address(phone), guestEmail: `${phone}@test.local`, paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201);
    }
    await new Promise((r) => setTimeout(r, 300)); // budget check runs after the order commits
    const after = (await admin.get(`/api/v1/admin/campaigns/${c.id}`).expect(200)).body.data;
    expect(after).toMatchObject({ status: 'PAUSED', phase: 'PAUSED', budgetUsed: 400 });
    expect((await pdp(p.slug)).variants[1].price).toBe(799);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/resume`).set(H).send({}).expect(400); // raise the budget first
    expect((await admin.get('/api/v1/admin/inventory/reconcile').expect(200)).body.data.consistent).toBe(true);
  });

  it('lets items bought at a sale price be exchanged for another size', async () => {
    const p = await newProduct();
    const [m, l] = p.variants;
    const c = await campaign();
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: m!.id, salePrice: 599 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);
    const s = await registerCustomer(app, 'swap@test.local');
    await s.post('/api/v1/cart/items').set(H).send({ variantId: m!.id, quantity: 1 }).expect(201);
    const order = (await s.post('/api/v1/checkout').set(H).send({ address: address('9123400010'), paymentMethod: 'COD', idempotencyKey: randomUUID() }).expect(201)).body.data.order;
    await admin.post(`/api/v1/admin/orders/${order.id}/confirm-cod`).set(H).send({}).expect(200);
    await admin.post(`/api/v1/admin/orders/${order.id}/status`).set(H).send({ status: 'PACKED' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${order.id}/shipment`).set(H).send({ provider: 'MANUAL' }).expect(200);
    await admin.post(`/api/v1/admin/orders/${order.id}/status`).set(H).send({ status: 'DELIVERED' }).expect(200);
    const d = (await s.get(`/api/v1/orders/${order.number}`).expect(200)).body.data;
    expect(d.items[0].unitPrice).toBe(599);
    expect(d.exchangeOptions[d.items[0].id].map((o: { variantId: string }) => o.variantId)).toContain(l!.id);
    await s.post('/api/v1/returns').set(H).send({ orderId: order.id, type: 'EXCHANGE', reason: 'SIZE_ISSUE', items: [{ orderItemId: d.items[0].id, quantity: 1, exchangeVariantId: l!.id }] }).expect(201);
  });

  it('PATCH changes only the fields sent; bulk rules keep caps; ended sales cannot be reopened', async () => {
    const p = await newProduct();
    const c = await campaign({ priority: 7 });
    await admin.patch(`/api/v1/admin/campaigns/${c.id}`).set(H).send({ description: 'Updated' }).expect(200);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).priority).toBe(7);
    const promo = (await admin.post('/api/v1/admin/promotions').set(H).send({ name: 'Trio deal', campaignId: c.id, minQuantity: 3, percentOff: 12, productIds: [p.id] }).expect(201)).body.data;
    await admin.patch(`/api/v1/admin/promotions/${promo.id}`).set(H).send({ name: 'Trio deal plus' }).expect(200);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } })).productIds).toEqual([p.id]);

    const v = p.variants[0]!;
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: v.id, salePrice: 699, stockCap: 5 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/prices/bulk`).set(H).send({ productIds: [p.id], percentOff: 20, roundToNine: true }).expect(200);
    expect((await prisma.campaignPrice.findFirstOrThrow({ where: { campaignId: c.id, variantId: v.id } })).stockCap).toBe(5);

    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/pause`).set(H).send({}).expect(200);
    await admin.delete(`/api/v1/admin/campaigns/${c.id}/prices/${v.id}`).set(H).expect(400); // paused after start: still locked
    await prisma.campaign.update({ where: { id: c.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await admin.post(`/api/v1/admin/campaigns/${c.id}/extend`).set(H).send({ endsAt: new Date(Date.now() + 24 * HOUR), note: 'Try to reopen' }).expect(400);
  });

  it('sends opted-in reminders once per phase', async () => {
    const c = await campaign();
    const p = await newProduct();
    await admin.put(`/api/v1/admin/campaigns/${c.id}/prices`).set(H).send({ items: [{ variantId: p.variants[0]!.id, salePrice: 699 }] }).expect(200);
    await admin.post(`/api/v1/admin/campaigns/${c.id}/publish`).set(H).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/campaigns/${c.slug}/remind-me`).set(H).send({ phone: '9123400099' }).expect(200);
    const outbox = app.get(MessagingService).outbox;
    const sent = () => outbox.filter((m) => m.to === '9123400099' && m.template === 'vyra_sale_live').length;
    await app.get(CampaignsService).sweep();
    await app.get(CampaignsService).sweep();
    expect(sent()).toBe(1);
  });
});
