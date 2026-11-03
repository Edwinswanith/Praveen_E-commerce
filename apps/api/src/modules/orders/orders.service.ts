import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type OrderStatus, type ReturnStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import {
  canTransition, CUSTOMER_CANCELLABLE, fromPaise, PRICING_RULES, priceCart, RETURN_WINDOW_DAYS,
  type CheckoutInput, type CheckoutResponse, type OrderDetailDto, type PricingResult, type ReturnPreviewDto,
} from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { AppError, badRequest, conflict, forbidden, notFound, outOfStock } from '../../common/http/errors';
import { decToNum, decToPaise, paiseToDec } from '../../common/money';
import { MailService } from '../../common/mail/mail.service';
import { QueueService } from '../../common/queue/queue.service';
import { AuditService } from '../../common/audit/audit.service';
import { CartService, type CartOwner } from '../carts/cart.service';
import { CouponsService } from '../coupons/coupons.service';
import { CodService } from '../cod/cod.service';
import { OtpService, maskPhone } from '../otp/otp.service';
import { MessagingService, WA_TEMPLATES } from '../../common/messaging/messaging.service';
import { InventoryService } from '../inventory/inventory.service';
import { CampaignPricingService } from '../campaigns/campaign-pricing.service';
import { PaymentsGateway } from '../payments/payments.gateway';
import { ShippingService } from '../shipping/shipping.service';
import { loadExtras, orderDetailInclude, returnInclude, toOrderDetail } from './order.mappers';

const MAINTENANCE_QUEUE = 'maintenance';
type Actor = { id: string | null; name: string };
const SYSTEM: Actor = { id: null, name: 'System' };

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger('Orders');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly coupons: CouponsService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsGateway,
    private readonly shipping: ShippingService,
    private readonly mail: MailService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly cod: CodService,
    private readonly otp: OtpService,
    private readonly messaging: MessagingService,
    private readonly campaignPricing: CampaignPricingService,
  ) {}

  async onModuleInit() {
    this.queue.process(MAINTENANCE_QUEUE, async (job) => (job.name === 'abandoned-carts' ? this.remindAbandonedCarts() : this.expireReservations()), 1);
    await this.queue.repeat(MAINTENANCE_QUEUE, 'abandoned-carts', 3600_000).catch((e) => this.logger.warn(`Scheduler: ${(e as Error).message}`));
    await this.queue.repeat(MAINTENANCE_QUEUE, 'expire-reservations', 60_000).catch((e) => this.logger.warn(`Scheduler: ${(e as Error).message}`));
  }

  async detail(where: Prisma.OrderWhereUniqueInput): Promise<OrderDetailDto> {
    const o = await this.prisma.order.findUnique({ where, include: orderDetailInclude });
    if (!o) throw notFound('Order');
    const dto = toOrderDetail(o, await loadExtras(this.prisma, o.returnRequests, [o.exchangeForOrderId]));
    if (dto.canReturn) dto.exchangeOptions = await this.exchangeOptions(o.items.map((i) => ({ id: i.id, productId: i.productId, variantId: i.variantId, unitPrice: i.unitPrice })));
    return dto;
  }

  /**
   * Per order item: same product, same REGULAR price, in-stock variants the
   * customer may swap to. Regular (not paid) price, so items bought at a sale
   * price can still be exchanged for another size of the same product.
   */
  private async exchangeOptions(items: { id: string; productId: string; variantId: string; unitPrice: Prisma.Decimal }[]) {
    const all = await this.prisma.productVariant.findMany({ where: { productId: { in: items.map((i) => i.productId) } }, include: { inventory: true }, orderBy: [{ color: 'asc' }, { sizeOrder: 'asc' }] });
    const variants = all.filter((v) => v.isActive);
    const regular = new Map(all.map((v) => [v.id, decToPaise(v.price)]));
    const out: Record<string, { variantId: string; color: string; size: string; available: number }[]> = {};
    for (const i of items) {
      out[i.id] = variants
        .filter((v) => v.productId === i.productId && v.id !== i.variantId && decToPaise(v.price) === regular.get(i.variantId))
        .map((v) => ({ variantId: v.id, color: v.color, size: v.size, available: Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)) }))
        .filter((v) => v.available > 0);
    }
    return out;
  }

  private async newNumber(tx: Tx) {
    const d = new Date();
    const stamp = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    for (let i = 0; i < 10; i++) {
      const n = `VY${stamp}${randomInt(10000, 99999)}`;
      if (!(await tx.order.findUnique({ where: { number: n } }))) return n;
    }
    throw new Error('Could not allocate order number');
  }

  private async addEvent(tx: Tx, orderId: string, status: OrderStatus, note: string | null, actor: Actor) {
    await tx.orderEvent.create({ data: { orderId, status, note, actorId: actor.id, actorName: actor.name } });
  }

  // ------------------------------------------------------------------ checkout

  async quote(owner: CartOwner, input: { shippingMethod: 'STANDARD' | 'EXPRESS'; paymentMethod: 'ONLINE' | 'COD'; couponCode?: string | null; pincode?: string; phone?: string }, user?: { email: string | null; phone: string | null }) {
    const { pricing, prepaidSavings, couponError } = await this.carts.quote(owner, { ...input, email: user?.email });
    const reason = await this.cod.blockReason(input.phone ?? user?.phone, input.pincode);
    return { ...this.carts.totalsDto(pricing, prepaidSavings, reason), couponError };
  }

  /**
   * Places an order. Prices, coupons and stock are re-derived server-side from
   * the cart; nothing from the client except identifiers and choices is trusted.
   * Stock is reserved inside the same transaction that creates the order, so
   * either both happen or neither does.
   */
  async checkout(owner: CartOwner, user: { id: string; email: string | null; name: string } | undefined, input: CheckoutInput): Promise<CheckoutResponse> {
    const replay = await this.prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { payments: true } });
    if (replay) {
      if ((replay.userId ?? null) !== (user?.id ?? null)) throw conflict('Idempotency key already used');
      return this.checkoutResponse(replay.id);
    }

    // Phone-only accounts provide an email once at checkout for invoices/receipts.
    const email = user?.email ?? input.guestEmail?.toLowerCase();
    if (!email) throw new AppError('VALIDATION_FAILED', 'Add an email for your order receipt', 422, { fieldErrors: { guestEmail: ['Required'] }, formErrors: [] });
    if (user && !user.email && input.guestEmail) {
      const taken = await this.prisma.user.findFirst({ where: { email, NOT: { id: user.id } } });
      if (!taken) await this.prisma.user.update({ where: { id: user.id }, data: { email } });
    }

    let address: Record<string, unknown>;
    if (input.addressId) {
      if (!user) throw badRequest('Sign in to use a saved address');
      const a = await this.prisma.address.findFirst({ where: { id: input.addressId, userId: user.id, deletedAt: null } });
      if (!a) throw notFound('Address');
      address = { fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, state: a.state, pincode: a.pincode, type: a.type };
    } else {
      address = { ...input.address! };
      delete address.isDefault;
      if (user) {
        // Save new addresses to the customer's address book for next time.
        const count = await this.prisma.address.count({ where: { userId: user.id, deletedAt: null } });
        if (count < 20) await this.prisma.address.create({ data: { ...input.address!, userId: user.id, isDefault: count === 0 } });
      }
    }

    const svc = await this.shipping.serviceability(String(address.pincode), input.paymentMethod === 'COD');
    if (!svc.serviceable) throw badRequest(`We don't deliver to PIN ${address.pincode} yet`);
    if (input.shippingMethod === 'EXPRESS' && !svc.expressAvailable) throw badRequest('Express delivery is not available for this PIN code');

    const cart = await this.carts.find(owner);
    const active = (cart?.items ?? []).filter((i) => !i.savedForLater);
    if (!active.length) throw badRequest('Your bag is empty');
    const unavailable = active.filter((i) => {
      const avail = i.variant.inventory ? i.variant.inventory.onHand - i.variant.inventory.reserved : 0;
      return !i.variant.isActive || i.variant.product.status !== 'ACTIVE' || avail < i.quantity;
    });
    if (unavailable.length) {
      throw outOfStock('Some items in your bag are unavailable', {
        items: unavailable.map((i) => ({ variantId: i.variantId, requested: i.quantity, available: Math.max(0, (i.variant.inventory?.onHand ?? 0) - (i.variant.inventory?.reserved ?? 0)) })),
      });
    }

    if (input.paymentMethod === 'ONLINE' && !this.payments.provider) throw new AppError('NOT_CONFIGURED', 'Online payments are pending configuration. Please choose Cash on Delivery.', HttpStatus.SERVICE_UNAVAILABLE);
    if (input.paymentMethod === 'COD') {
      if (!svc.codAvailable) throw badRequest('Cash on Delivery is not available for this PIN code');
      const reason = await this.cod.blockReason(String(address.phone), String(address.pincode));
      if (reason) throw badRequest(reason);
    }

    // Live prices for THIS shopper at THIS moment (campaign sale prices, early access, bundles).
    const prices = await this.carts.prices(active, user?.id);
    const lines = this.carts.pricingLines(active, prices);
    const promotions = await this.carts.promotions(user?.id);
    const couponCode = input.couponCode ?? cart!.couponCode;
    const picked = await this.carts.pickCoupon(lines, promotions, couponCode, { userId: user?.id, email }, { shippingMethod: input.shippingMethod, paymentMethod: input.paymentMethod });
    if (picked.error) throw badRequest(picked.error);
    const coupon = picked.coupon;
    const pricing = priceCart({ lines, coupon, promotions, shippingMethod: input.shippingMethod, paymentMethod: input.paymentMethod, prepaid: this.carts.prepaid });
    // A non-combinable coupon that lost to a bundle is reported, not silently dropped.
    if (pricing.couponError && !pricing.offerNote) throw badRequest(pricing.couponError);
    const couponRow = pricing.couponCode ? picked.row : null;
    if (input.paymentMethod === 'COD' && !pricing.codAvailable) throw badRequest(`Cash on Delivery is available up to ${fromPaise(PRICING_RULES.codMaxOrderValue)} rupees`);
    if (input.expectedTotal !== undefined && pricing.grandTotal > Math.round(input.expectedTotal * 100)) {
      throw new AppError('PRICE_CHANGED', `Prices changed since you opened checkout (a sale may have just ended). Your new total is ₹${fromPaise(pricing.grandTotal)}. Please review and place the order again.`, HttpStatus.CONFLICT, { grandTotal: fromPaise(pricing.grandTotal) });
    }
    await this.assertCampaignLimits(pricing.lines, { userId: user?.id ?? null, email, phone: String(address.phone) });

    const byVariant = new Map(active.map((i) => [i.variantId, i]));
    const isCod = input.paymentMethod === 'COD';
    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(async (tx) => {
        const number = await this.newNumber(tx);
        const order = await tx.order.create({
          data: {
            number, userId: user?.id ?? null, customerName: String(address.fullName), customerEmail: email, customerPhone: String(address.phone),
            status: isCod ? 'CONFIRMED' : 'PENDING_PAYMENT', confirmedAt: isCod ? new Date() : null, paymentMethod: input.paymentMethod,
            codConfirmation: isCod ? 'PENDING' : 'NOT_REQUIRED', prepaidDiscount: paiseToDec(pricing.prepaidDiscount), promotionDiscount: paiseToDec(pricing.promotionDiscount),
            shippingMethod: input.shippingMethod, shippingAddress: address as Prisma.InputJsonValue, idempotencyKey: input.idempotencyKey,
            mrpTotal: paiseToDec(pricing.mrpTotal), subtotal: paiseToDec(pricing.subtotal), couponCode: pricing.couponCode, couponDiscount: paiseToDec(pricing.couponDiscount),
            shippingFee: paiseToDec(pricing.shippingFee), codFee: paiseToDec(pricing.codFee), taxTotal: paiseToDec(pricing.taxTotal), grandTotal: paiseToDec(pricing.grandTotal),
            reservationExpiresAt: isCod ? null : new Date(Date.now() + this.env.PAYMENT_RESERVATION_MINUTES * 60_000),
            items: {
              create: pricing.lines.map((l) => {
                const ci = byVariant.get(l.variantId)!;
                const v = ci.variant;
                return {
                  variantId: v.id, productId: v.product.id, productName: v.product.name, productSlug: v.product.slug, sku: v.sku, color: v.color, size: v.size,
                  imageUrl: v.product.images[0]?.thumbUrl ?? null, hsnCode: '6109', quantity: l.quantity, unitMrp: paiseToDec(l.unitMrp), unitPrice: paiseToDec(l.unitPrice), campaignId: l.campaignId ?? null,
                  discount: paiseToDec(l.discountShare), taxRate: new Prisma.Decimal(l.gstRate), taxAmount: paiseToDec(l.taxAmount), lineTotal: paiseToDec(l.taxableValue),
                };
              }),
            },
          },
        });
        // HSN codes come from the product (snapshot); fix up in one query.
        await tx.$executeRaw`UPDATE order_items oi SET "hsnCode" = p."hsnCode" FROM products p WHERE p.id = oi."productId" AND oi."orderId" = ${order.id}`;
        await this.inventory.reserveMany(tx, pricing.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), order.id, number);
        await this.recordOffers(tx, order.id, pricing, couponRow?.id ?? null);
        if (couponRow) {
          if (!(await this.coupons.consume(tx, couponRow.id))) throw badRequest('This coupon has just reached its usage limit');
          await tx.couponUsage.create({ data: { couponId: couponRow.id, userId: user?.id ?? null, email, orderId: order.id, discount: paiseToDec(pricing.couponDiscount) } });
        }
        await tx.payment.create({ data: { orderId: order.id, provider: isCod ? 'cod' : this.payments.provider!.name, method: input.paymentMethod, amount: paiseToDec(pricing.grandTotal) } });
        await this.addEvent(tx, order.id, isCod ? 'CONFIRMED' : 'PENDING_PAYMENT', isCod ? 'Cash on Delivery order placed; awaiting OTP confirmation' : 'Awaiting payment', { id: user?.id ?? null, name: user?.name ?? 'Guest' });
        return order.id;
      }, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('idempotencyKey')) {
        return this.checkoutResponse((await this.prisma.order.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } })).id);
      }
      throw e;
    }

    await this.carts.clearPurchased(cart!.id, pricing.lines.map((l) => l.variantId));
    const campaignIds = [...new Set(pricing.lines.map((l) => l.campaignId).filter((x): x is string => !!x))];
    if (campaignIds.length) void this.campaignPricing.enforceBudgets(campaignIds).catch((e) => this.logger.warn(`Budget check: ${(e as Error).message}`));

    if (!isCod) {
      try {
        const { providerOrderId } = await this.payments.provider!.createOrder({ amountPaise: pricing.grandTotal, receipt: orderId, notes: { orderId } });
        await this.prisma.payment.updateMany({ where: { orderId, providerOrderId: null }, data: { providerOrderId } });
      } catch (e) {
        this.logger.error(`Payment order creation failed: ${(e as Error).message}`);
        await this.cancel(orderId, 'Payment gateway unavailable', SYSTEM, { refund: false });
        throw new AppError('PAYMENT_FAILED', 'We could not start the payment. No money was taken; please try again.', HttpStatus.BAD_GATEWAY);
      }
      return this.checkoutResponse(orderId);
    }
    // COD: the customer must confirm with an OTP sent to the delivery phone.
    let codOtp: CheckoutResponse['codOtp'] = null;
    try {
      codOtp = await this.otp.issue(String(address.phone), 'COD_CONFIRM', orderId);
    } catch (e) {
      this.logger.warn(`COD OTP not sent for ${orderId}: ${(e as Error).message}`);
      codOtp = { phoneMasked: maskPhone(String(address.phone)), expiresInSeconds: 0 };
    }
    return { ...(await this.checkoutResponse(orderId)), codOtp };
  }

  /** Per-customer deal limits ("max 2 per customer") across non-cancelled orders, by account, email or phone. */
  private async assertCampaignLimits(lines: PricingResult['lines'], who: { userId: string | null; email: string; phone: string }) {
    const deal = lines.filter((l) => l.campaignId);
    if (!deal.length) return;
    const caps = await this.prisma.campaignPrice.findMany({ where: { OR: deal.map((l) => ({ campaignId: l.campaignId!, variantId: l.variantId })), perCustomerLimit: { not: null } }, include: { variant: { include: { product: { select: { name: true } } } } } });
    for (const c of caps) {
      const bought = await this.prisma.orderItem.aggregate({
        _sum: { quantity: true },
        where: {
          campaignId: c.campaignId, variantId: c.variantId, order: { status: { not: 'CANCELLED' }, OR: [...(who.userId ? [{ userId: who.userId }] : []), { customerEmail: who.email }, { customerPhone: who.phone }] },
        },
      });
      const want = deal.find((l) => l.variantId === c.variantId)!.quantity;
      const left = c.perCustomerLimit! - (bought._sum.quantity ?? 0);
      if (want > left) throw badRequest(left > 0 ? `The sale price on ${c.variant.product.name} is limited to ${c.perCustomerLimit} per customer. You can add ${left} more.` : `You've already bought the maximum ${c.perCustomerLimit} of ${c.variant.product.name} at the sale price.`);
    }
  }

  /**
   * Writes the discount ledger (one row per line per source) and consumes
   * deal stock caps and promotion uses atomically with the order. A sold-out
   * deal aborts the whole order, so nobody is charged a price that has run out.
   */
  private async recordOffers(tx: Tx, orderId: string, pricing: PricingResult, couponId: string | null) {
    const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, variantId: true } });
    const itemOf = new Map(items.map((i) => [i.variantId, i.id]));
    const rows: Prisma.OrderDiscountCreateManyInput[] = [];
    for (const l of pricing.lines) {
      const orderItemId = itemOf.get(l.variantId)!;
      const add = (source: 'CAMPAIGN_PRICE' | 'PROMOTION' | 'COUPON' | 'PREPAID', amount: number, sourceId: string | null) => {
        if (amount > 0) rows.push({ orderId, orderItemId, source, sourceId, amount: paiseToDec(amount) });
      };
      add('CAMPAIGN_PRICE', l.discounts.campaign, l.campaignId ?? null);
      add('PROMOTION', l.discounts.promotion, pricing.promotion?.id ?? null);
      add('COUPON', l.discounts.coupon, couponId);
      add('PREPAID', l.discounts.prepaid, null);
      if (l.campaignId) {
        const n = await tx.$executeRaw`UPDATE campaign_prices SET "soldCount" = "soldCount" + ${l.quantity}, "updatedAt" = now()
          WHERE "campaignId" = ${l.campaignId} AND "variantId" = ${l.variantId} AND ("stockCap" IS NULL OR "soldCount" + ${l.quantity} <= "stockCap")`;
        if (n !== 1) throw conflict('A sale price in your bag has just sold out. Please review your bag; the regular price now applies.');
      }
    }
    if (rows.length) await tx.orderDiscount.createMany({ data: rows });
    if (pricing.promotion && pricing.promotionDiscount > 0) {
      const n = await tx.$executeRaw`UPDATE promotions SET "usedCount" = "usedCount" + 1 WHERE id = ${pricing.promotion.id} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
      if (n !== 1) throw conflict(`“${pricing.promotion.name}” has just ended. Please review your bag.`);
    }
  }

  /** Gives back deal stock and promotion uses held by a cancelled order. */
  private async releaseOffers(tx: Tx, orderId: string) {
    const items = await tx.orderItem.findMany({ where: { orderId, campaignId: { not: null } }, select: { campaignId: true, variantId: true, quantity: true } });
    for (const i of items) {
      await tx.$executeRaw`UPDATE campaign_prices SET "soldCount" = GREATEST("soldCount" - ${i.quantity}, 0), "updatedAt" = now() WHERE "campaignId" = ${i.campaignId} AND "variantId" = ${i.variantId}`;
    }
    const promo = await tx.orderDiscount.findFirst({ where: { orderId, source: 'PROMOTION', sourceId: { not: null } }, select: { sourceId: true } });
    if (promo) await tx.$executeRaw`UPDATE promotions SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${promo.sourceId}`;
  }

  // ------------------------------------------------------------------ COD confirmation

  private async codOrder(number: string) {
    const o = await this.prisma.order.findUnique({ where: { number } });
    if (!o || o.paymentMethod !== 'COD') throw notFound('Order');
    if (o.status === 'CANCELLED') throw badRequest('This order was cancelled');
    return o;
  }

  async resendCodOtp(number: string) {
    const o = await this.codOrder(number);
    if (o.codConfirmation !== 'PENDING') throw badRequest('This order is already confirmed');
    return this.otp.issue(o.customerPhone, 'COD_CONFIRM', o.id);
  }

  /** Customer proves they control the delivery phone; the order may now be packed. */
  async confirmCod(number: string, code: string) {
    const o = await this.codOrder(number);
    if (o.codConfirmation === 'CONFIRMED') return this.detail({ id: o.id });
    await this.otp.verify(o.customerPhone, 'COD_CONFIRM', code, o.id);
    await this.markCodConfirmed(o.id, 'Confirmed by customer (OTP)', { id: o.userId, name: o.customerName });
    return this.detail({ id: o.id });
  }

  /** Staff confirmed by calling the customer. */
  async staffConfirmCod(orderId: string, note: string | undefined, actor: Actor) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!o || o.paymentMethod !== 'COD') throw notFound('COD order');
    if (o.status === 'CANCELLED') throw badRequest('This order was cancelled');
    if (o.codConfirmation !== 'CONFIRMED') await this.markCodConfirmed(o.id, note ?? 'Confirmed by phone call', actor);
    return this.detail({ id: o.id });
  }

  private async markCodConfirmed(orderId: string, note: string, actor: Actor) {
    const n = await this.prisma.$transaction(async (tx) => {
      const r = await tx.order.updateMany({ where: { id: orderId, codConfirmation: 'PENDING' }, data: { codConfirmation: 'CONFIRMED', codConfirmedAt: new Date() } });
      if (r.count) await this.addEvent(tx, orderId, 'CONFIRMED', note, actor);
      return r.count;
    });
    if (n) void this.notifyConfirmed(orderId);
  }

  async checkoutResponse(orderId: string): Promise<CheckoutResponse> {
    const order = await this.detail({ id: orderId });
    const pay = order.payments[order.payments.length - 1];
    const provider = this.payments.provider;
    const needsPayment = order.status === 'PENDING_PAYMENT' && pay?.providerOrderId && provider;
    return {
      order,
      codOtp: null,
      payment: needsPayment ? {
        provider: provider!.name, keyId: provider!.keyId, providerOrderId: pay!.providerOrderId!, amount: Math.round(order.grandTotal * 100), currency: 'INR',
        name: 'VYRA', prefill: { name: order.customerName, email: order.customerEmail, contact: order.shippingAddress.phone },
      } : null,
    };
  }

  // ------------------------------------------------------------------ payments

  /**
   * Called after the payment widget succeeds (client) or by the webhook (server).
   * The signature proves the payment came from the provider; then the payment is
   * re-fetched from the provider API and its amount/order/status checked.
   * Idempotent: repeated calls for an already-captured payment are no-ops.
   */
  async verifyPayment(input: { orderId: string; providerOrderId: string; providerPaymentId: string; signature: string }) {
    const provider = this.payments.provider;
    if (!provider) throw new AppError('NOT_CONFIGURED', 'Online payments are pending configuration', 503);
    const payment = await this.prisma.payment.findFirst({ where: { orderId: input.orderId, providerOrderId: input.providerOrderId } });
    if (!payment) throw notFound('Payment');
    if (!provider.verifySignature(input)) {
      await this.audit.log({ action: 'payment.signature_invalid', entity: 'Payment', entityId: payment.id, after: { providerPaymentId: input.providerPaymentId } });
      throw new AppError('PAYMENT_FAILED', 'Payment verification failed', HttpStatus.BAD_REQUEST);
    }
    let remote = await provider.fetchPayment(input.providerPaymentId);
    if (remote.orderId !== input.providerOrderId || remote.amountPaise !== decToPaise(payment.amount)) {
      throw new AppError('PAYMENT_FAILED', 'Payment does not match this order', HttpStatus.BAD_REQUEST);
    }
    if (remote.status === 'authorized') remote = await provider.capture(remote.id, remote.amountPaise);
    if (remote.status === 'failed') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', providerPaymentId: remote.id, failureReason: remote.error } });
      throw new AppError('PAYMENT_FAILED', remote.error ?? 'Payment failed', HttpStatus.PAYMENT_REQUIRED);
    }
    if (remote.status !== 'captured') throw new AppError('PAYMENT_FAILED', 'Payment is not complete yet', HttpStatus.ACCEPTED);
    await this.markPaid(payment.id, remote.id, remote.method);
    return this.detail({ id: input.orderId });
  }

  async markPaid(paymentId: string, providerPaymentId: string, instrument: string | null) {
    let needsRefund = false;
    const orderId = await this.prisma.$transaction(async (tx) => {
      // Row lock on the payment serialises verify-endpoint and webhook races.
      const [p] = await tx.$queryRaw<{ id: string; orderId: string; status: string }[]>`SELECT id, "orderId", status::text FROM payments WHERE id = ${paymentId} FOR UPDATE`;
      if (!p) throw notFound('Payment');
      if (p.status === 'CAPTURED' || p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED') return p.orderId;
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'CAPTURED', providerPaymentId, instrument } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { items: true } });
      if (order.status === 'PENDING_PAYMENT') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), reservationExpiresAt: null } });
        await this.addEvent(tx, order.id, 'CONFIRMED', `Payment received${instrument ? ` via ${instrument.toUpperCase()}` : ''}`, SYSTEM);
      } else if (order.status === 'CANCELLED') {
        // Paid after the reservation expired: try to re-reserve; otherwise refund.
        try {
          await this.inventory.reserveMany(tx, order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), order.id, order.number);
          await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), cancelledAt: null, cancelReason: null } });
          await this.addEvent(tx, order.id, 'CONFIRMED', 'Late payment received; order reinstated', SYSTEM);
        } catch {
          needsRefund = true;
        }
      }
      return p.orderId;
    });
    if (needsRefund) {
      const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await this.refund(orderId, decToNum(o.grandTotal), 'Paid after reservation expired and stock was no longer available', SYSTEM);
    } else {
      void this.notifyConfirmed(orderId);
    }
  }

  async handleWebhook(event: { id: string; type: string; payload: Record<string, unknown> }) {
    try {
      await this.prisma.webhookEvent.create({ data: { provider: this.payments.provider?.name ?? 'unknown', eventId: event.id, eventType: event.type, payload: event.payload as Prisma.InputJsonValue } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { duplicate: true };
      throw e;
    }
    const pay = (event.payload as { payment?: { entity?: { id: string; order_id: string; method?: string; error_description?: string } } }).payment?.entity;
    if (event.type === 'payment.captured' && pay) {
      const p = await this.prisma.payment.findFirst({ where: { providerOrderId: pay.order_id } });
      if (p) await this.markPaid(p.id, pay.id, pay.method ?? null);
    } else if (event.type === 'payment.failed' && pay) {
      await this.prisma.payment.updateMany({ where: { providerOrderId: pay.order_id, status: 'CREATED' }, data: { status: 'FAILED', providerPaymentId: pay.id, failureReason: pay.error_description ?? 'Payment failed' } });
    } else if (event.type.startsWith('refund.')) {
      const r = (event.payload as { refund?: { entity?: { id: string; status: string } } }).refund?.entity;
      if (r) await this.prisma.refund.updateMany({ where: { providerRefundId: r.id }, data: { status: r.status === 'processed' ? 'PROCESSED' : r.status === 'failed' ? 'FAILED' : 'PENDING' } });
    }
    return { duplicate: false };
  }

  /** Customer retry for an unpaid order (same provider order, so no double charge). */
  async resumePayment(number: string, userId: string) {
    const o = await this.prisma.order.findUnique({ where: { number } });
    if (!o || o.userId !== userId) throw notFound('Order');
    if (o.status !== 'PENDING_PAYMENT') throw badRequest('This order does not need payment');
    return this.checkoutResponse(o.id);
  }

  // ------------------------------------------------------------------ lifecycle

  async cancel(orderId: string, reason: string, actor: Actor, opts: { refund?: boolean; customerUserId?: string } = {}) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked) throw notFound('Order');
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payments: true, couponUsage: true } });
      if (opts.customerUserId) {
        if (o.userId !== opts.customerUserId) throw notFound('Order');
        if (!CUSTOMER_CANCELLABLE.includes(o.status)) throw badRequest('This order can no longer be cancelled. You can request a return after delivery.');
      }
      if (o.status === 'CANCELLED') return { order: o, refundPaise: 0 };
      if (!canTransition(o.status, 'CANCELLED')) throw badRequest(`An order that is ${o.status.toLowerCase().replace(/_/g, ' ')} cannot be cancelled`);
      await this.inventory.releaseMany(tx, o.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), o.id, `Order cancelled: ${reason}`, actor.id);
      await tx.order.update({ where: { id: o.id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date(), reservationExpiresAt: null } });
      if (o.couponUsage) await tx.$executeRaw`UPDATE coupons SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${o.couponUsage.couponId}`;
      await this.releaseOffers(tx, o.id);
      await tx.payment.updateMany({ where: { orderId: o.id, status: 'CREATED' }, data: { status: 'FAILED', failureReason: 'Order cancelled' } });
      await this.addEvent(tx, o.id, 'CANCELLED', reason, actor);
      const captured = o.payments.filter((p) => p.status === 'CAPTURED' && p.method === 'ONLINE').reduce((s, p) => s + decToPaise(p.amount), 0);
      return { order: o, refundPaise: captured };
    });
    if (opts.refund !== false && result.refundPaise > 0) await this.refund(orderId, fromPaise(result.refundPaise), `Cancellation: ${reason}`, actor);
    return this.detail({ id: orderId });
  }

  async expireReservations() {
    const expired = await this.prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', reservationExpiresAt: { lt: new Date() } }, select: { id: true }, take: 100 });
    for (const o of expired) {
      await this.cancel(o.id, 'Payment not completed in time', SYSTEM, { refund: false }).catch((e) => this.logger.warn(`Expire ${o.id}: ${(e as Error).message}`));
    }
    const unconfirmed = await this.prisma.order.findMany({
      where: { paymentMethod: 'COD', codConfirmation: 'PENDING', status: 'CONFIRMED', createdAt: { lt: new Date(Date.now() - this.env.COD_CONFIRM_WINDOW_HOURS * 3600_000) } },
      select: { id: true }, take: 100,
    });
    for (const o of unconfirmed) {
      await this.cancel(o.id, 'Cash on Delivery order was not confirmed', SYSTEM, { refund: false }).catch((e) => this.logger.warn(`Expire COD ${o.id}: ${(e as Error).message}`));
    }
    return { expired: expired.length, codUnconfirmed: unconfirmed.length };
  }

  async updateStatus(orderId: string, to: OrderStatus, note: string | undefined, actor: Actor) {
    if (to === 'CANCELLED') return this.cancel(orderId, note ?? 'Cancelled by staff', actor);
    if (to === 'SHIPPED') return this.ship(orderId, { provider: 'MANUAL' }, actor);
    if (to === 'RETURNED') throw badRequest('Orders become RETURNED through the returns workflow');
    if (to === 'RTO') return this.markRto(orderId, note, actor);
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked) throw notFound('Order');
      if (!canTransition(locked.status, to)) throw badRequest(`Cannot move an order from ${locked.status} to ${to}`);
      if (to === 'PACKED') {
        const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { codConfirmation: true } });
        if (o.codConfirmation === 'PENDING') throw badRequest('Confirm this Cash on Delivery order (customer OTP or a phone call) before packing');
      }
      const now = new Date();
      await tx.order.update({ where: { id: orderId }, data: { status: to, ...(to === 'DELIVERED' ? { deliveredAt: now } : {}), ...(to === 'CONFIRMED' ? { confirmedAt: now } : {}) } });
      if (to === 'OUT_FOR_DELIVERY' || to === 'DELIVERED') {
        await tx.shipment.updateMany({ where: { orderId }, data: { status: to, ...(to === 'DELIVERED' ? { deliveredAt: now } : {}) } });
        const s = await tx.shipment.findUnique({ where: { orderId } });
        if (s) await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: to, description: note ?? (to === 'DELIVERED' ? 'Delivered' : 'Out for delivery'), occurredAt: now } });
      }
      if (to === 'DELIVERED') {
        // COD cash is collected on delivery.
        await tx.payment.updateMany({ where: { orderId, method: 'COD', status: 'CREATED' }, data: { status: 'CAPTURED' } });
        const items = await tx.orderItem.findMany({ where: { orderId } });
        for (const i of items) await tx.product.update({ where: { id: i.productId }, data: { soldCount: { increment: i.quantity } } });
      }
      await this.addEvent(tx, orderId, to, note ?? null, actor);
    });
    if (to === 'DELIVERED') void this.notify(orderId, 'delivered');
    return this.detail({ id: orderId });
  }

  /**
   * Parcel came back undelivered. Goods are restocked (they already left stock
   * at shipping), the shipment is marked RTO and, for COD, the customer's phone
   * accrues a refusal that can auto-disable COD. Prepaid RTOs are refunded by
   * staff via the refunds endpoint (shipping cost policy is a business decision).
   */
  async markRto(orderId: string, note: string | undefined, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked) throw notFound('Order');
      if (!canTransition(locked.status, 'RTO')) throw badRequest('Only shipped orders can be marked as returned to origin');
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      for (const i of [...o.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        await this.inventory.apply(tx, { variantId: i.variantId, type: 'RETURN_RESTOCK', onHandDelta: i.quantity, reservedDelta: 0, orderId, reference: o.number, reason: 'RTO: parcel returned undelivered', actorId: actor.id });
      }
      const now = new Date();
      await tx.order.update({ where: { id: orderId }, data: { status: 'RTO', rtoAt: now } });
      const s = await tx.shipment.findUnique({ where: { orderId } });
      if (s) {
        await tx.shipment.update({ where: { id: s.id }, data: { status: 'RTO' } });
        await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: 'RTO', description: note ?? 'Returned to origin', occurredAt: now } });
      }
      if (o.paymentMethod === 'COD') {
        await tx.payment.updateMany({ where: { orderId, status: 'CREATED' }, data: { status: 'FAILED', failureReason: 'COD parcel not accepted (RTO)' } });
        await this.cod.recordRto(tx, o.customerPhone);
      }
      await this.addEvent(tx, orderId, 'RTO', note ?? (o.paymentMethod === 'COD' ? 'COD parcel returned undelivered' : 'Prepaid parcel returned undelivered; refund pending'), actor);
    });
    return this.detail({ id: orderId });
  }

  /** PACKED → SHIPPED: creates the shipment and converts reservations into fulfilment. */
  async ship(orderId: string, input: { provider: 'MANUAL' | 'SHIPROCKET'; courierName?: string; trackingNumber?: string; trackingUrl?: string }, actor: Actor) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { variant: true } } } });
    if (!order) throw notFound('Order');
    if (order.status !== 'PACKED') throw badRequest('Pack the order (verify items) before shipping');
    let booking = { providerShipmentId: null as string | null, courierName: input.courierName ?? null, trackingNumber: input.trackingNumber ?? null, trackingUrl: input.trackingUrl ?? null, labelUrl: null as string | null };
    if (input.provider === 'SHIPROCKET') {
      const sr = this.shipping.shiprocket;
      if (!sr.configured) throw new AppError('NOT_CONFIGURED', 'Shiprocket is pending configuration (SHIPROCKET_EMAIL/PASSWORD/PICKUP_PINCODE)', 503);
      const addr = order.shippingAddress as Record<string, string>;
      booking = await sr.createShipment({
        orderNumber: order.number, orderDate: order.createdAt, paymentMethod: order.paymentMethod, amount: decToNum(order.grandTotal),
        weightGrams: order.items.reduce((s, i) => s + i.variant.weightGrams * i.quantity, 0),
        customer: { name: order.customerName, email: order.customerEmail, phone: order.customerPhone },
        address: { line1: addr.line1!, line2: addr.line2, city: addr.city!, state: addr.state!, pincode: addr.pincode! },
        items: order.items.map((i) => ({ name: i.productName, sku: i.sku, units: i.quantity, sellingPrice: decToNum(i.unitPrice), hsn: i.hsnCode })),
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (locked?.status !== 'PACKED') throw conflict('Order status changed; refresh and try again');
      await this.inventory.fulfilMany(tx, order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), orderId, actor.id);
      const now = new Date();
      const s = await tx.shipment.upsert({
        where: { orderId },
        create: { orderId, provider: input.provider, status: 'IN_TRANSIT', ...booking, weightGrams: order.items.reduce((sum, i) => sum + i.variant.weightGrams * i.quantity, 0), shippedAt: now },
        update: { provider: input.provider, status: 'IN_TRANSIT', ...booking, shippedAt: now },
      });
      await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: 'SHIPPED', description: booking.courierName ? `Handed to ${booking.courierName}` : 'Shipped', occurredAt: now } });
      await tx.order.update({ where: { id: orderId }, data: { status: 'SHIPPED' } });
      await this.addEvent(tx, orderId, 'SHIPPED', booking.trackingNumber ? `AWB ${booking.trackingNumber}` : null, actor);
    });
    void this.notify(orderId, 'shipped');
    return this.detail({ id: orderId });
  }

  /**
   * Issues a refund. The refundable balance is checked and the refund is recorded
   * (PENDING) under a row lock on the order, BEFORE the provider is called, so
   * concurrent refunds can never together exceed what was paid. A return can have
   * at most one live refund. If the provider call fails the refund is marked
   * FAILED, which releases its amount.
   */
  async refund(orderId: string, amount: number, reason: string, actor: Actor, returnRequestId?: string) {
    const amountPaise = Math.round(amount * 100);
    if (amountPaise <= 0) throw badRequest('Refund amount must be positive');
    const held = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked) throw notFound('Order');
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, refunds: true } });
      const live = order.refunds.filter((r) => r.status !== 'FAILED');
      if (returnRequestId && live.some((r) => r.returnRequestId === returnRequestId)) throw conflict('This return has already been refunded');
      const refunded = live.reduce((s, r) => s + decToPaise(r.amount), 0);
      const paidPayments = order.payments.filter((p) => ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status));
      const paid = paidPayments.reduce((s, p) => s + decToPaise(p.amount), 0);
      if (refunded + amountPaise > paid) throw badRequest(`Refund exceeds the amount paid (₹${fromPaise(Math.max(0, paid - refunded))} refundable)`);
      const payment = paidPayments[0]!;
      const r = await tx.refund.create({ data: { orderId, paymentId: payment.id, amount: paiseToDec(amountPaise), status: 'PENDING', reason, createdById: actor.id, returnRequestId } });
      return { refundId: r.id, payment, paid };
    });

    let providerRefundId: string | null = null;
    let status: 'PENDING' | 'PROCESSED' | 'FAILED' = 'PENDING';
    try {
      if (held.payment.method === 'ONLINE') {
        const provider = this.payments.provider;
        if (!provider || !held.payment.providerPaymentId) throw new AppError('NOT_CONFIGURED', 'Payment provider unavailable for refunds', 503);
        const r = await provider.refund(held.payment.providerPaymentId, amountPaise, { orderId, reason: reason.slice(0, 200) });
        providerRefundId = r.providerRefundId;
        status = r.status === 'processed' ? 'PROCESSED' : r.status === 'failed' ? 'FAILED' : 'PENDING';
      } else {
        // COD: money goes back by bank/UPI transfer done by staff; this records it.
        status = 'PROCESSED';
      }
    } catch (e) {
      await this.prisma.refund.update({ where: { id: held.refundId }, data: { status: 'FAILED' } });
      throw e;
    }
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.update({ where: { id: held.refundId }, data: { status, providerRefundId } });
      const total = (await tx.refund.findMany({ where: { orderId, status: { not: 'FAILED' } } })).reduce((s, x) => s + decToPaise(x.amount), 0);
      await tx.payment.update({ where: { id: held.payment.id }, data: { status: total >= held.paid ? 'REFUNDED' : total > 0 ? 'PARTIALLY_REFUNDED' : 'CAPTURED' } });
      return r;
    });
    await this.audit.log({ actorId: actor.id, action: 'order.refund', entity: 'Order', entityId: orderId, after: { amount, reason, providerRefundId, status } });
    return { id: refund.id, amount: decToNum(refund.amount), status: refund.status, reason: refund.reason, providerRefundId: refund.providerRefundId, createdAt: refund.createdAt.toISOString() };
  }

  // ------------------------------------------------------------------ returns

  /**
   * Refund for returning `items`, honest about offers. If the items kept no
   * longer qualify for a bundle ("buy 2") or a coupon's minimum order, the
   * discount those kept items received is deducted from the refund (the
   * customer keeps paying what the kept items would have cost on their own).
   *
   * Computed cumulatively over all non-rejected returns of the order, so a
   * deduction taken on an earlier return is given back if the rest is returned
   * later: returning everything always refunds everything paid for the items.
   */
  async returnPreview(orderId: string, items: { orderItemId: string; quantity: number }[]): Promise<ReturnPreviewDto> {
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, discounts: true, couponUsage: { include: { coupon: true } }, returnRequests: { include: { items: true } } },
    });
    const prior = o.returnRequests.filter((r) => r.type === 'RETURN' && ['REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED'].includes(r.status));
    const priorQty = new Map<string, number>();
    for (const r of prior) for (const i of r.items) priorQty.set(i.orderItemId, (priorQty.get(i.orderItemId) ?? 0) + i.quantity);
    const nowQty = new Map(items.map((i) => [i.orderItemId, i.quantity]));
    const share = (lineTotal: Prisma.Decimal, qty: number, of: number) => Math.floor((decToPaise(lineTotal) * qty) / of);

    let itemsValue = 0, cumulative = 0, priorValue = 0;
    const kept = new Map<string, number>();
    for (const oi of o.items) {
      const before = priorQty.get(oi.id) ?? 0;
      const now = nowQty.get(oi.id) ?? 0;
      itemsValue += share(oi.lineTotal, now, oi.quantity);
      priorValue += share(oi.lineTotal, before, oi.quantity);
      cumulative += share(oi.lineTotal, before + now, oi.quantity);
      kept.set(oi.id, Math.max(0, oi.quantity - before - now));
    }
    const ledger = (itemId: string, source: string) => o.discounts.filter((d) => d.orderItemId === itemId && d.source === source).reduce((s, d) => s + decToPaise(d.amount), 0);
    const keptShare = (source: string) => o.items.reduce((s, oi) => s + Math.floor((ledger(oi.id, source) * kept.get(oi.id)!) / oi.quantity), 0);
    const anyKept = [...kept.values()].some((q) => q > 0);
    const deductions: ReturnPreviewDto['deductions'] = [];

    // Bundle promotion: kept in-scope units must still meet the minimum quantity.
    let promoClawed = false;
    const promoRow = o.discounts.find((d) => d.source === 'PROMOTION');
    if (anyKept && promoRow) {
      const promo = promoRow.sourceId ? await this.prisma.promotion.findUnique({ where: { id: promoRow.sourceId } }) : null;
      const inScopeKept = o.items.filter((oi) => ledger(oi.id, 'PROMOTION') > 0).reduce((s, oi) => s + kept.get(oi.id)!, 0);
      const minQ = promo?.minQuantity ?? 2;
      const amount = keptShare('PROMOTION');
      if (inScopeKept < minQ && amount > 0) {
        promoClawed = true;
        deductions.push({ label: `${promo?.name ?? 'Bundle offer'} no longer applies to the ${inScopeKept} item${inScopeKept === 1 ? '' : 's'} you keep (needs ${minQ})`, amount });
      }
    }
    // Coupon minimum order: the kept items' value must still reach it.
    const coupon = o.couponUsage?.coupon;
    if (anyKept && coupon?.minOrderValue) {
      const keptGross = o.items.reduce((s, oi) => s + decToPaise(oi.unitPrice) * kept.get(oi.id)!, 0) - (promoClawed ? 0 : keptShare('PROMOTION'));
      const amount = keptShare('COUPON');
      if (keptGross < decToPaise(coupon.minOrderValue) && amount > 0) {
        deductions.push({ label: `Coupon ${coupon.code} needs a ₹${decToNum(coupon.minOrderValue)} order; the items you keep come to ₹${fromPaise(keptGross)}`, amount });
      }
    }
    const claw = deductions.reduce((s, d) => s + d.amount, 0);
    const priorRefund = prior.reduce((s, r) => s + decToPaise(r.refundAmount), 0);
    const givenBack = Math.max(0, priorValue - priorRefund);
    if (givenBack > 0) deductions.push({ label: 'Offer deduction from your earlier return, given back', amount: -givenBack });
    const refund = Math.max(0, Math.min(cumulative - claw - priorRefund, itemsValue + givenBack));
    return {
      refundAmount: fromPaise(refund), itemsValue: fromPaise(itemsValue),
      deductions: deductions.map((d) => ({ label: d.label, amount: fromPaise(d.amount) })),
      note: claw > 0 ? 'Offers are recalculated on the items you keep. Return the rest within the window and this deduction is given back.' : null,
    };
  }

  async requestReturn(userId: string, input: { orderId: string; type: 'RETURN' | 'EXCHANGE'; reason: string; comments?: string; items: { orderItemId: string; quantity: number; exchangeVariantId?: string }[] }) {
    const order = await this.prisma.order.findFirst({ where: { OR: [{ id: input.orderId }, { number: input.orderId }], userId }, include: { items: { include: { variant: true } }, returnRequests: { include: { items: true } } } });
    if (!order) throw notFound('Order');
    if (order.status !== 'DELIVERED' || !order.deliveredAt) throw badRequest('Returns can be requested after delivery');
    if (Date.now() - order.deliveredAt.getTime() > RETURN_WINDOW_DAYS * 86400_000) throw badRequest(`Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery`);
    if (order.exchangeForOrderId && input.type === 'EXCHANGE') throw badRequest('A replacement item can be returned for a refund, but not exchanged again');
    const pending = new Map<string, number>();
    for (const r of order.returnRequests.filter((x) => ['REQUESTED', 'APPROVED', 'RECEIVED'].includes(x.status))) for (const i of r.items) pending.set(i.orderItemId, (pending.get(i.orderItemId) ?? 0) + i.quantity);
    let refund = 0;
    for (const ri of input.items) {
      const oi = order.items.find((i) => i.id === ri.orderItemId);
      if (!oi) throw notFound('Order item');
      const left = oi.quantity - oi.returnedQuantity - (pending.get(oi.id) ?? 0);
      if (ri.quantity > left) throw badRequest(`Only ${left} of ${oi.productName} can be returned`);
      if (input.type === 'EXCHANGE') {
        // Exchanges are a size/colour swap of the same product at the same price: no money moves.
        const target = await this.prisma.productVariant.findUnique({ where: { id: ri.exchangeVariantId! }, include: { inventory: true } });
        if (!target || !target.isActive || target.productId !== oi.productId) throw badRequest(`Choose another size or colour of ${oi.productName}`);
        if (target.id === oi.variantId) throw badRequest('Pick a different size or colour to exchange for');
        if (decToPaise(target.price) !== decToPaise(oi.variant.price)) throw badRequest(`${target.color} / ${target.size} has a different price; return for a refund and reorder instead`);
        const avail = (target.inventory?.onHand ?? 0) - (target.inventory?.reserved ?? 0);
        if (avail < ri.quantity) throw outOfStock(`${target.color} / ${target.size} is out of stock. Return for a refund instead.`, { available: avail });
      }
    }
    if (input.type === 'RETURN') refund = Math.round((await this.returnPreview(order.id, input.items)).refundAmount * 100);
    const r = await this.prisma.returnRequest.create({
      data: {
        orderId: order.id, userId, type: input.type, reason: input.reason, comments: input.comments, refundAmount: paiseToDec(input.type === 'EXCHANGE' ? 0 : refund),
        items: { create: input.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, exchangeVariantId: input.type === 'EXCHANGE' ? i.exchangeVariantId : null })) },
      },
      include: returnInclude,
    });
    return { r, number: order.number };
  }

  async decideReturn(returnId: string, action: 'APPROVE' | 'REJECT' | 'RECEIVE' | 'REFUND', note: string | undefined, restock: boolean, actor: Actor) {
    const r = await this.prisma.returnRequest.findUnique({ where: { id: returnId }, include: { items: { include: { orderItem: true } }, order: true } });
    if (!r) throw notFound('Return request');
    const allowed: Record<string, string[]> = { APPROVE: ['REQUESTED'], REJECT: ['REQUESTED', 'APPROVED'], RECEIVE: ['APPROVED'], REFUND: ['RECEIVED'] };
    if (!allowed[action]!.includes(r.status)) throw badRequest(`Cannot ${action.toLowerCase()} a return that is ${r.status.toLowerCase()}`);
    if (action === 'REFUND' && r.type === 'EXCHANGE' && r.replacementOrderId) throw badRequest('This exchange was fulfilled with a replacement order; nothing to refund');
    // Every transition is claimed atomically (status must still be the expected one), so two
    // staff clicks or retries can't approve, receive/restock or refund the same return twice.
    const raced = () => conflict('This return was just updated by someone else. Refresh to see its current status.');
    if (action === 'APPROVE' || action === 'REJECT') {
      const n = await this.prisma.returnRequest.updateMany({ where: { id: r.id, status: { in: allowed[action] as ReturnStatus[] } }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decisionNote: note } });
      if (n.count !== 1) throw raced();
    } else if (action === 'RECEIVE') {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.returnRequest.updateMany({ where: { id: r.id, status: 'APPROVED' }, data: { status: r.type === 'EXCHANGE' ? 'EXCHANGED' : 'RECEIVED' } });
        if (claimed.count !== 1) throw raced();
        for (const i of r.items) {
          await tx.orderItem.update({ where: { id: i.orderItemId }, data: { returnedQuantity: { increment: i.quantity } } });
          if (restock) await this.inventory.apply(tx, { variantId: i.orderItem.variantId, type: 'RETURN_RESTOCK', onHandDelta: i.quantity, reservedDelta: 0, orderId: r.orderId, reference: r.order.number, reason: `Return ${r.id}`, actorId: actor.id });
        }
        let replacementOrderId: string | null = null;
        if (r.type === 'EXCHANGE') replacementOrderId = await this.createReplacementOrder(tx, r, actor);
        await tx.returnRequest.update({
          where: { id: r.id },
          data: { status: r.type === 'EXCHANGE' ? 'EXCHANGED' : 'RECEIVED', replacementOrderId, decisionNote: note ?? (restock ? 'Received and restocked' : 'Received; not restocked (damaged)') },
        });
        const items = await tx.orderItem.findMany({ where: { orderId: r.orderId } });
        if (items.every((x) => x.returnedQuantity >= x.quantity)) {
          await tx.order.update({ where: { id: r.orderId }, data: { status: 'RETURNED' } });
          await this.addEvent(tx, r.orderId, 'RETURNED', r.type === 'EXCHANGE' ? 'All items exchanged' : 'All items returned', actor);
        }
      });
    } else {
      // Refund value is computed server-side from the order snapshot; exchanges never reach here with a replacement.
      if (r.type === 'EXCHANGE') {
        const value = r.items.reduce((s, i) => s + Math.floor((decToPaise(i.orderItem.lineTotal) * i.quantity) / i.orderItem.quantity), 0);
        await this.prisma.returnRequest.update({ where: { id: r.id }, data: { refundAmount: paiseToDec(value) } });
        r.refundAmount = paiseToDec(value);
      }
      // refund() serialises on the order row and allows one live refund per return (also a DB unique index).
      await this.refund(r.orderId, decToNum(r.refundAmount), `Return ${r.id}`, actor, r.id);
      await this.prisma.returnRequest.updateMany({ where: { id: r.id, status: 'RECEIVED' }, data: { status: 'REFUNDED' } });
    }
    await this.audit.log({ actorId: actor.id, action: `return.${action.toLowerCase()}`, entity: 'ReturnRequest', entityId: r.id, after: { note, restock } });
    const fresh = await this.prisma.returnRequest.findUniqueOrThrow({ where: { id: r.id }, include: returnInclude });
    return { r: fresh, number: r.order.number };
  }

  /**
   * Exchange fulfilment: a zero-value replacement order for the requested
   * variants, reserved like any order and shipped through the normal flow. If the
   * new size sold out meanwhile the whole receive step rolls back and staff can
   * refund instead.
   */
  private async createReplacementOrder(tx: Tx, r: { id: string; orderId: string; items: { quantity: number; exchangeVariantId: string | null; orderItem: { hsnCode: string; unitMrp: Prisma.Decimal; unitPrice: Prisma.Decimal } }[]; order: { number: string; userId: string | null; customerName: string; customerEmail: string; customerPhone: string; shippingAddress: Prisma.JsonValue } }, actor: Actor) {
    const number = await this.newNumber(tx);
    const variants = await tx.productVariant.findMany({ where: { id: { in: r.items.map((i) => i.exchangeVariantId!) } }, include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const order = await tx.order.create({
      data: {
        number, userId: r.order.userId, customerName: r.order.customerName, customerEmail: r.order.customerEmail, customerPhone: r.order.customerPhone,
        status: 'CONFIRMED', confirmedAt: new Date(), paymentMethod: 'ONLINE', shippingAddress: r.order.shippingAddress as Prisma.InputJsonValue,
        idempotencyKey: `exchange:${r.id}`, exchangeForOrderId: r.orderId,
        mrpTotal: 0, subtotal: 0, grandTotal: 0, taxTotal: 0,
        items: {
          create: r.items.map((i) => {
            const v = byId.get(i.exchangeVariantId!)!;
            return {
              variantId: v.id, productId: v.productId, productName: v.product.name, productSlug: v.product.slug, sku: v.sku, color: v.color, size: v.size,
              imageUrl: v.product.images[0]?.thumbUrl ?? null, hsnCode: i.orderItem.hsnCode, quantity: i.quantity, unitMrp: i.orderItem.unitMrp, unitPrice: i.orderItem.unitPrice,
              discount: paiseToDec(decToPaise(i.orderItem.unitPrice) * i.quantity), taxRate: new Prisma.Decimal(0), taxAmount: 0, lineTotal: 0,
            };
          }),
        },
      },
    });
    await this.inventory.reserveMany(tx, r.items.map((i) => ({ variantId: i.exchangeVariantId!, quantity: i.quantity })), order.id, number);
    await tx.payment.create({ data: { orderId: order.id, provider: 'exchange', method: 'ONLINE', status: 'CAPTURED', amount: 0 } });
    await this.addEvent(tx, order.id, 'CONFIRMED', `Replacement for exchange on order ${r.order.number}`, actor);
    return order.id;
  }

  // ------------------------------------------------------------------ messaging

  private async notifyConfirmed(orderId: string) {
    await this.notify(orderId, 'confirmed');
  }

  /** Order updates by WhatsApp (utility template) + email. Never blocks or fails the business flow. */
  private async notify(orderId: string, kind: 'confirmed' | 'shipped' | 'delivered') {
    try {
      const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, shipment: true } });
      const url = `${this.env.STOREFRONT_URL}/account/orders/${o.number}`;
      if (kind === 'confirmed') {
        await this.messaging.whatsapp(o.customerPhone, WA_TEMPLATES.orderConfirmed, [o.customerName.split(' ')[0] ?? o.customerName, o.number, `₹${decToNum(o.grandTotal)}`]);
        const lines = o.items.map((i) => `• ${i.productName} (${i.color}/${i.size}) × ${i.quantity}`).join('\n');
        await this.mail.send({
          to: o.customerEmail, userId: o.userId ?? undefined, template: 'order-confirmed', subject: `Your VYRA order ${o.number} is confirmed`,
          text: `Hi ${o.customerName},\n\nThanks for shopping with VYRA! Order ${o.number} is confirmed.\n\n${lines}\n\nTotal: ₹${decToNum(o.grandTotal)}\nTrack it: ${url}`,
        });
      } else if (kind === 'shipped') {
        await this.messaging.whatsapp(o.customerPhone, WA_TEMPLATES.orderShipped, [o.number, o.shipment?.courierName ?? 'our courier partner', o.shipment?.trackingUrl ?? url]);
        await this.mail.send({ to: o.customerEmail, userId: o.userId ?? undefined, template: 'order-shipped', subject: `Order ${o.number} is on its way`, text: `Your order ${o.number} has shipped${o.shipment?.trackingNumber ? ` (AWB ${o.shipment.trackingNumber})` : ''}.\nTrack: ${o.shipment?.trackingUrl ?? url}` });
      } else {
        await this.messaging.whatsapp(o.customerPhone, WA_TEMPLATES.orderDelivered, [o.number]);
      }
    } catch (e) {
      this.logger.warn(`Notification (${kind}) failed: ${(e as Error).message}`);
    }
  }

  /**
   * Abandoned bag reminders, at most one per bag change, only to customers who
   * opted in (WhatsApp policy + respect). Bags idle 3–48h are eligible.
   */
  async remindAbandonedCarts() {
    const after = this.env.ABANDONED_CART_AFTER_HOURS;
    const carts = await this.prisma.$queryRaw<{ id: string; userId: string; lastTouch: Date }[]>`
      SELECT c.id, c."userId", max(ci."updatedAt") AS "lastTouch"
        FROM carts c JOIN cart_items ci ON ci."cartId" = c.id AND NOT ci."savedForLater"
        JOIN customer_profiles cp ON cp."userId" = c."userId" AND cp."marketingOptIn"
       WHERE c."userId" IS NOT NULL
       GROUP BY c.id, c."userId", c."reminderSentAt"
      HAVING max(ci."updatedAt") < now() - make_interval(hours => ${after}::int)
         AND max(ci."updatedAt") > now() - interval '48 hours'
         AND (c."reminderSentAt" IS NULL OR c."reminderSentAt" < max(ci."updatedAt"))
       LIMIT 200`;
    let sent = 0;
    for (const c of carts) {
      const user = await this.prisma.user.findUnique({ where: { id: c.userId } });
      const item = await this.prisma.cartItem.findFirst({ where: { cartId: c.id, savedForLater: false }, include: { variant: { include: { product: { select: { name: true } } } } }, orderBy: { updatedAt: 'desc' } });
      if (!user || !item) continue;
      const first = user.name.split(' ')[0] ?? user.name;
      await this.messaging.whatsapp(user.phone, WA_TEMPLATES.cartReminder, [first, item.variant.product.name, `${this.env.STOREFRONT_URL}/cart`]);
      if (user.email) await this.mail.send({ to: user.email, userId: user.id, template: 'cart-reminder', subject: 'Still thinking it over?', text: `Hi ${first}, your ${item.variant.product.name} is waiting in your VYRA bag. Stock moves fast: ${this.env.STOREFRONT_URL}/cart\n\nUnsubscribe anytime from your account settings.` });
      await this.prisma.cart.update({ where: { id: c.id }, data: { reminderSentAt: new Date() } });
      sent++;
    }
    return { sent };
  }

  assertOwner(order: { userId: string | null }, userId: string) {
    if (order.userId !== userId) throw forbidden();
  }
}
