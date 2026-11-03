import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type OrderStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import {
  canTransition, CUSTOMER_CANCELLABLE, fromPaise, PRICING_RULES, priceCart, RETURN_WINDOW_DAYS,
  type CheckoutInput, type CheckoutResponse, type OrderDetailDto,
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
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsGateway } from '../payments/payments.gateway';
import { ShippingService } from '../shipping/shipping.service';
import { orderDetailInclude, toOrderDetail } from './order.mappers';

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
  ) {}

  async onModuleInit() {
    this.queue.process(MAINTENANCE_QUEUE, async () => this.expireReservations(), 1);
    await this.queue.repeat(MAINTENANCE_QUEUE, 'expire-reservations', 60_000).catch((e) => this.logger.warn(`Scheduler: ${(e as Error).message}`));
  }

  async detail(where: Prisma.OrderWhereUniqueInput): Promise<OrderDetailDto> {
    const o = await this.prisma.order.findUnique({ where, include: orderDetailInclude });
    if (!o) throw notFound('Order');
    return toOrderDetail(o);
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

  async quote(owner: CartOwner, input: { shippingMethod: 'STANDARD' | 'EXPRESS'; paymentMethod: 'ONLINE' | 'COD'; couponCode?: string | null }, email?: string) {
    const { pricing, couponError } = await this.carts.quote(owner, { ...input, email });
    const p = pricing;
    return {
      mrpTotal: fromPaise(p.mrpTotal), subtotal: fromPaise(p.subtotal), productDiscount: fromPaise(p.productDiscount), couponDiscount: fromPaise(p.couponDiscount),
      shippingFee: fromPaise(p.shippingFee), codFee: fromPaise(p.codFee), taxTotal: fromPaise(p.taxTotal), grandTotal: fromPaise(p.grandTotal),
      codAvailable: p.codAvailable && this.env.COD_ENABLED, freeShippingThreshold: fromPaise(PRICING_RULES.freeShippingThreshold), couponError,
    };
  }

  /**
   * Places an order. Prices, coupons and stock are re-derived server-side from
   * the cart; nothing from the client except identifiers and choices is trusted.
   * Stock is reserved inside the same transaction that creates the order, so
   * either both happen or neither does.
   */
  async checkout(owner: CartOwner, user: { id: string; email: string; name: string } | undefined, input: CheckoutInput): Promise<CheckoutResponse> {
    const replay = await this.prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { payments: true } });
    if (replay) {
      if ((replay.userId ?? null) !== (user?.id ?? null)) throw conflict('Idempotency key already used');
      return this.checkoutResponse(replay.id);
    }

    const email = user?.email ?? input.guestEmail?.toLowerCase();
    if (!email) throw badRequest('Email is required for guest checkout', { fieldErrors: { guestEmail: ['Required'] } });

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
    if (input.paymentMethod === 'COD' && (!this.env.COD_ENABLED || !svc.codAvailable)) throw badRequest('Cash on Delivery is not available for this order');

    const couponCode = input.couponCode ?? cart!.couponCode;
    let couponRow: { id: string } | null = null;
    let coupon = null;
    if (couponCode) {
      const r = await this.coupons.resolve(couponCode, { userId: user?.id, email });
      if ('error' in r) throw badRequest(r.error);
      coupon = r.coupon;
      couponRow = r.row;
    }
    const lines = this.carts.pricingLines(active);
    const pricing = priceCart({ lines, coupon, shippingMethod: input.shippingMethod, paymentMethod: input.paymentMethod });
    if (pricing.couponError) throw badRequest(pricing.couponError);
    if (input.paymentMethod === 'COD' && !pricing.codAvailable) throw badRequest(`Cash on Delivery is available up to ${fromPaise(PRICING_RULES.codMaxOrderValue)} rupees`);

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
                  imageUrl: v.product.images[0]?.thumbUrl ?? null, hsnCode: '6109', quantity: l.quantity, unitMrp: paiseToDec(l.unitMrp), unitPrice: paiseToDec(l.unitPrice),
                  discount: paiseToDec(l.discountShare), taxRate: new Prisma.Decimal(l.gstRate), taxAmount: paiseToDec(l.taxAmount), lineTotal: paiseToDec(l.taxableValue),
                };
              }),
            },
          },
        });
        // HSN codes come from the product (snapshot); fix up in one query.
        await tx.$executeRaw`UPDATE order_items oi SET "hsnCode" = p."hsnCode" FROM products p WHERE p.id = oi."productId" AND oi."orderId" = ${order.id}`;
        await this.inventory.reserveMany(tx, pricing.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), order.id, number);
        if (couponRow) {
          if (!(await this.coupons.consume(tx, couponRow.id))) throw badRequest('This coupon has just reached its usage limit');
          await tx.couponUsage.create({ data: { couponId: couponRow.id, userId: user?.id ?? null, email, orderId: order.id, discount: paiseToDec(pricing.couponDiscount) } });
        }
        await tx.payment.create({ data: { orderId: order.id, provider: isCod ? 'cod' : this.payments.provider!.name, method: input.paymentMethod, amount: paiseToDec(pricing.grandTotal) } });
        await this.addEvent(tx, order.id, isCod ? 'CONFIRMED' : 'PENDING_PAYMENT', isCod ? 'Cash on Delivery order confirmed' : 'Awaiting payment', { id: user?.id ?? null, name: user?.name ?? 'Guest' });
        return order.id;
      }, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('idempotencyKey')) {
        return this.checkoutResponse((await this.prisma.order.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } })).id);
      }
      throw e;
    }

    await this.carts.clearPurchased(cart!.id, pricing.lines.map((l) => l.variantId));

    if (!isCod) {
      try {
        const { providerOrderId } = await this.payments.provider!.createOrder({ amountPaise: pricing.grandTotal, receipt: orderId, notes: { orderId } });
        await this.prisma.payment.updateMany({ where: { orderId, providerOrderId: null }, data: { providerOrderId } });
      } catch (e) {
        this.logger.error(`Payment order creation failed: ${(e as Error).message}`);
        await this.cancel(orderId, 'Payment gateway unavailable', SYSTEM, { refund: false });
        throw new AppError('PAYMENT_FAILED', 'We could not start the payment. No money was taken; please try again.', HttpStatus.BAD_GATEWAY);
      }
    } else {
      void this.notifyConfirmed(orderId);
    }
    return this.checkoutResponse(orderId);
  }

  async checkoutResponse(orderId: string): Promise<CheckoutResponse> {
    const order = await this.detail({ id: orderId });
    const pay = order.payments[order.payments.length - 1];
    const provider = this.payments.provider;
    const needsPayment = order.status === 'PENDING_PAYMENT' && pay?.providerOrderId && provider;
    return {
      order,
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
    return { expired: expired.length };
  }

  async updateStatus(orderId: string, to: OrderStatus, note: string | undefined, actor: Actor) {
    if (to === 'CANCELLED') return this.cancel(orderId, note ?? 'Cancelled by staff', actor);
    if (to === 'SHIPPED') return this.ship(orderId, { provider: 'MANUAL' }, actor);
    if (to === 'RETURNED') throw badRequest('Orders become RETURNED through the returns workflow');
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked) throw notFound('Order');
      if (!canTransition(locked.status, to)) throw badRequest(`Cannot move an order from ${locked.status} to ${to}`);
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
    return this.detail({ id: orderId });
  }

  async refund(orderId: string, amount: number, reason: string, actor: Actor, returnRequestId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { payments: true, refunds: true } });
    if (!order) throw notFound('Order');
    const amountPaise = Math.round(amount * 100);
    if (amountPaise <= 0) throw badRequest('Refund amount must be positive');
    const refunded = order.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + decToPaise(r.amount), 0);
    const paid = order.payments.filter((p) => ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status)).reduce((s, p) => s + decToPaise(p.amount), 0);
    if (refunded + amountPaise > paid) throw badRequest(`Refund exceeds the amount paid (₹${fromPaise(paid - refunded)} refundable)`);
    const payment = order.payments.find((p) => ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status))!;

    let providerRefundId: string | null = null;
    let status: 'PENDING' | 'PROCESSED' | 'FAILED' = 'PENDING';
    if (payment.method === 'ONLINE') {
      const provider = this.payments.provider;
      if (!provider || !payment.providerPaymentId) throw new AppError('NOT_CONFIGURED', 'Payment provider unavailable for refunds', 503);
      const r = await provider.refund(payment.providerPaymentId, amountPaise, { orderId, reason: reason.slice(0, 200) });
      providerRefundId = r.providerRefundId;
      status = r.status === 'processed' ? 'PROCESSED' : r.status === 'failed' ? 'FAILED' : 'PENDING';
    } else {
      // COD: money goes back by bank/UPI transfer done by staff; this records it.
      status = 'PROCESSED';
    }
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.create({ data: { orderId, paymentId: payment.id, amount: paiseToDec(amountPaise), status, reason, providerRefundId, createdById: actor.id, returnRequestId } });
      const total = refunded + amountPaise;
      await tx.payment.update({ where: { id: payment.id }, data: { status: total >= paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      return r;
    });
    await this.audit.log({ actorId: actor.id, action: 'order.refund', entity: 'Order', entityId: orderId, after: { amount, reason, providerRefundId, status } });
    return { id: refund.id, amount: decToNum(refund.amount), status: refund.status, reason: refund.reason, providerRefundId: refund.providerRefundId, createdAt: refund.createdAt.toISOString() };
  }

  // ------------------------------------------------------------------ returns

  async requestReturn(userId: string, input: { orderId: string; reason: string; comments?: string; items: { orderItemId: string; quantity: number }[] }) {
    const order = await this.prisma.order.findFirst({ where: { OR: [{ id: input.orderId }, { number: input.orderId }], userId }, include: { items: true, returnRequests: { include: { items: true } } } });
    if (!order) throw notFound('Order');
    if (order.status !== 'DELIVERED' || !order.deliveredAt) throw badRequest('Returns can be requested after delivery');
    if (Date.now() - order.deliveredAt.getTime() > RETURN_WINDOW_DAYS * 86400_000) throw badRequest(`Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery`);
    const pending = new Map<string, number>();
    for (const r of order.returnRequests.filter((x) => ['REQUESTED', 'APPROVED', 'RECEIVED'].includes(x.status))) for (const i of r.items) pending.set(i.orderItemId, (pending.get(i.orderItemId) ?? 0) + i.quantity);
    let refund = 0;
    for (const ri of input.items) {
      const oi = order.items.find((i) => i.id === ri.orderItemId);
      if (!oi) throw notFound('Order item');
      const left = oi.quantity - oi.returnedQuantity - (pending.get(oi.id) ?? 0);
      if (ri.quantity > left) throw badRequest(`Only ${left} of ${oi.productName} can be returned`);
      refund += Math.floor((decToPaise(oi.lineTotal) * ri.quantity) / oi.quantity);
    }
    const r = await this.prisma.returnRequest.create({
      data: { orderId: order.id, userId, reason: input.reason, comments: input.comments, refundAmount: paiseToDec(refund), items: { create: input.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) } },
      include: { items: { include: { orderItem: true } } },
    });
    return { r, number: order.number };
  }

  async decideReturn(returnId: string, action: 'APPROVE' | 'REJECT' | 'RECEIVE' | 'REFUND', note: string | undefined, restock: boolean, actor: Actor) {
    const r = await this.prisma.returnRequest.findUnique({ where: { id: returnId }, include: { items: { include: { orderItem: true } }, order: true } });
    if (!r) throw notFound('Return request');
    const allowed: Record<string, string[]> = { APPROVE: ['REQUESTED'], REJECT: ['REQUESTED', 'APPROVED'], RECEIVE: ['APPROVED'], REFUND: ['RECEIVED'] };
    if (!allowed[action]!.includes(r.status)) throw badRequest(`Cannot ${action.toLowerCase()} a return that is ${r.status.toLowerCase()}`);
    if (action === 'APPROVE' || action === 'REJECT') {
      await this.prisma.returnRequest.update({ where: { id: r.id }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decisionNote: note } });
    } else if (action === 'RECEIVE') {
      await this.prisma.$transaction(async (tx) => {
        for (const i of r.items) {
          await tx.orderItem.update({ where: { id: i.orderItemId }, data: { returnedQuantity: { increment: i.quantity } } });
          if (restock) await this.inventory.apply(tx, { variantId: i.orderItem.variantId, type: 'RETURN_RESTOCK', onHandDelta: i.quantity, reservedDelta: 0, orderId: r.orderId, reference: r.order.number, reason: `Return ${r.id}`, actorId: actor.id });
        }
        await tx.returnRequest.update({ where: { id: r.id }, data: { status: 'RECEIVED', decisionNote: note ?? (restock ? 'Received and restocked' : 'Received; not restocked (damaged)') } });
        const items = await tx.orderItem.findMany({ where: { orderId: r.orderId } });
        if (items.every((x) => x.returnedQuantity >= x.quantity)) {
          await tx.order.update({ where: { id: r.orderId }, data: { status: 'RETURNED' } });
          await this.addEvent(tx, r.orderId, 'RETURNED', 'All items returned', actor);
        }
      });
    } else {
      await this.refund(r.orderId, decToNum(r.refundAmount), `Return ${r.id}`, actor, r.id);
      await this.prisma.returnRequest.update({ where: { id: r.id }, data: { status: 'REFUNDED' } });
    }
    await this.audit.log({ actorId: actor.id, action: `return.${action.toLowerCase()}`, entity: 'ReturnRequest', entityId: r.id, after: { note, restock } });
    const fresh = await this.prisma.returnRequest.findUniqueOrThrow({ where: { id: r.id }, include: { items: { include: { orderItem: true } } } });
    return { r: fresh, number: r.order.number };
  }

  private async notifyConfirmed(orderId: string) {
    try {
      const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      const lines = o.items.map((i) => `• ${i.productName} (${i.color}/${i.size}) × ${i.quantity}`).join('\n');
      await this.mail.send({
        to: o.customerEmail, userId: o.userId ?? undefined, template: 'order-confirmed', subject: `Your VYRA order ${o.number} is confirmed`,
        text: `Hi ${o.customerName},\n\nThanks for shopping with VYRA! Order ${o.number} is confirmed.\n\n${lines}\n\nTotal: ₹${decToNum(o.grandTotal)}\nTrack it: ${this.env.STOREFRONT_URL}/account/orders/${o.number}`,
      });
    } catch (e) {
      this.logger.warn(`Confirmation email failed: ${(e as Error).message}`);
    }
  }

  assertOwner(order: { userId: string | null }, userId: string) {
    if (order.userId !== userId) throw forbidden();
  }
}
