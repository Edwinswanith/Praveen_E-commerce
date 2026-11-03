import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  cancelOrderSchema, checkoutSchema, codConfirmSchema, indianMobileSchema, orderStatusUpdateSchema, paginationSchema, pincodeSchema, returnDecisionSchema, returnPreviewSchema, returnRequestSchema,
  shipmentCreateSchema, verifyPaymentSchema, type CheckoutInput,
} from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { paginated, RawResponse } from '../../common/http/envelope';
import { AppError, badRequest, notFound } from '../../common/http/errors';
import { CurrentUser, OptionalAuth, Public, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { CartService } from '../carts/cart.service';
import { PaymentsGateway } from '../payments/payments.gateway';
import { ShippingService } from '../shipping/shipping.service';
import { InvoiceService } from './invoice.service';
import { loadExtras, toOrderSummary, toReturnDto } from './order.mappers';
import { OrdersService } from './orders.service';
import { AttemptLimiter } from '../../common/ratelimit/attempt-limiter.service';
import { ShiprocketWebhookService, type ShiprocketTrackingPayload } from '../shipping/shiprocket-webhook.service';
import type { OrderDetailDto } from '@vyra/shared';

/** Failed guest tracking attempts allowed per contact / order number per hour. */
const TRACK_MAX_FAILURES = 5;

const maskTail = (v: string | null | undefined, keep: number) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${keep > 0 ? v.slice(-keep) : ''}` : v ?? null);
const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_m, a: string, b: string, d: string) => `${a}${'•'.repeat(Math.min(b.length, 6))}${d}`);
/** Guest tracking needs status and items, not the full street address or contact details. */
function maskForGuest(o: OrderDetailDto): OrderDetailDto {
  return {
    ...o,
    customerEmail: maskEmail(o.customerEmail),
    shippingAddress: { ...o.shippingAddress, phone: maskTail(o.shippingAddress.phone, 2) ?? '', line1: maskTail(o.shippingAddress.line1, 0) ?? '', line2: null, landmark: null },
    payments: o.payments.map((p) => ({ ...p, providerOrderId: null, providerPaymentId: null })),
    refunds: o.refunds.map((r) => ({ ...r, providerRefundId: null })),
  };
}
import { EventsService } from '../events/events.service';

const actorOf = (u: AuthUser) => ({ id: u.id, name: u.name });

@ApiTags('checkout')
@Public()
@OptionalAuth()
@Controller()
export class CheckoutController {
  constructor(private readonly limiter: AttemptLimiter, private readonly shiprocket: ShiprocketWebhookService, private readonly orders: OrdersService, private readonly carts: CartService, private readonly payments: PaymentsGateway, private readonly shipping: ShippingService, private readonly prisma: PrismaService, private readonly events: EventsService) {}

  @Get('shipping/serviceability')
  serviceability(@Query(new ZodPipe(z.object({ pincode: pincodeSchema }))) q: { pincode: string }) {
    return this.shipping.serviceability(q.pincode);
  }

  @HttpCode(200) @Post('checkout/quote')
  quote(@Req() req: Request, @Body(new ZodPipe(z.object({ shippingMethod: z.enum(['STANDARD', 'EXPRESS']).default('STANDARD'), paymentMethod: z.enum(['ONLINE', 'COD']).default('ONLINE'), couponCode: z.string().trim().toUpperCase().max(30).nullish(), pincode: pincodeSchema.optional(), phone: indianMobileSchema.optional() }))) b: { shippingMethod: 'STANDARD' | 'EXPRESS'; paymentMethod: 'ONLINE' | 'COD'; couponCode?: string | null; pincode?: string; phone?: string }, @CurrentUser() u?: AuthUser) {
    return this.orders.quote(this.carts.owner(req, u?.id), b, u ? { email: u.email, phone: u.phone } : undefined);
  }

  /** The OTP itself authorises this (works for guests): it was sent to the order's delivery phone. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('orders/:number/confirm-cod')
  confirmCod(@Param('number') number: string, @Body(new ZodPipe(codConfirmSchema)) b: { code: string }) {
    return this.orders.confirmCod(number, b.code);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } }) @HttpCode(200) @Post('orders/:number/resend-cod-otp')
  resendCod(@Param('number') number: string) {
    return this.orders.resendCodOtp(number);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('checkout')
  async checkout(@Req() req: Request, @Body(new ZodPipe(checkoutSchema)) b: CheckoutInput, @CurrentUser() u?: AuthUser) {
    const r = await this.orders.checkout(this.carts.owner(req, u?.id), u ? { id: u.id, email: u.email, name: u.name } : undefined, b);
    // Idempotent replays must not double-count: one ORDER_PLACED per order.
    if (!(await this.prisma.analyticsEvent.findFirst({ where: { type: 'ORDER_PLACED', orderId: r.order.id }, select: { id: true } }))) {
      void this.events.record('ORDER_PLACED', this.events.context(req, u?.id), { orderId: r.order.id, value: r.order.grandTotal });
    }
    return r;
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @HttpCode(200) @Post('payments/verify')
  verify(@Body(new ZodPipe(verifyPaymentSchema)) b: z.infer<typeof verifyPaymentSchema>) {
    return this.orders.verifyPayment(b);
  }

  /** DEVELOPMENT ONLY: stands in for the Razorpay widget. 404 unless PAYMENT_PROVIDER=mock. */
  @HttpCode(200) @Post('payments/mock/authorize')
  mockAuthorize(@Body(new ZodPipe(z.object({ providerOrderId: z.string().min(1), outcome: z.enum(['success', 'failure']) }))) b: { providerOrderId: string; outcome: 'success' | 'failure' }) {
    const mock = this.payments.mock;
    if (!mock) throw notFound('Route');
    const r = mock.authorize(b.providerOrderId, b.outcome);
    if (!r) throw notFound('Payment order');
    return r;
  }

  /** Razorpay → server. Raw body HMAC verified; deduplicated by event id. */
  @HttpCode(200) @RawResponse() @Post('payments/razorpay/webhook')
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-razorpay-signature') sig?: string, @Headers('x-razorpay-event-id') eventId?: string) {
    const provider = this.payments.provider;
    if (!provider || !req.rawBody || !provider.verifyWebhook(req.rawBody, sig)) throw new AppError('FORBIDDEN', 'Invalid webhook signature', 403);
    const body = JSON.parse(req.rawBody.toString('utf8')) as { event: string; payload: Record<string, unknown>; created_at?: number };
    const id = eventId ?? `${body.event}:${JSON.stringify(body.payload).length}:${body.created_at ?? ''}`;
    const r = await this.orders.handleWebhook({ id, type: body.event, payload: body.payload });
    return { ok: true, ...r };
  }

  /** Shiprocket tracking webhook (server-to-server): token in x-api-key, replay-safe, CSRF-exempt by exact path. */
  @Throttle({ default: { limit: 600, ttl: 60_000 } }) @HttpCode(200) @Post('shipping/shiprocket/webhook')
  async shiprocketWebhook(@Headers('x-api-key') token: string | undefined, @Body() body: ShiprocketTrackingPayload) {
    this.shiprocket.authenticate(token);
    return this.shiprocket.handle(body ?? {});
  }

  /**
   * Guest order tracking by order number + the email or phone used.
   * Anti-enumeration: same 404 for any wrong part; 10 req/min per IP; and failed
   * attempts are counted per contact and per order number across IPs (Redis), so
   * guessing order numbers for a known phone is cut off after a few tries.
   * The guest view masks contact details and the street address.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Get('orders/track')
  async track(@Query(new ZodPipe(z.object({ number: z.string().trim().toUpperCase().min(5).max(30), email: z.string().trim().toLowerCase().email().optional(), phone: indianMobileSchema.optional() }).refine((q) => q.email || q.phone, { message: 'Enter the email or phone used for the order', path: ['email'] }))) q: { number: string; email?: string; phone?: string }) {
    const contact = q.email ?? q.phone!;
    const tooMany = 'Too many tracking attempts. Please wait an hour or sign in to see your orders.';
    await this.limiter.assertUnder('track-contact', contact, TRACK_MAX_FAILURES, tooMany);
    await this.limiter.assertUnder('track-number', q.number, TRACK_MAX_FAILURES, tooMany);
    const o = await this.prisma.order.findUnique({ where: { number: q.number } });
    // Same response whether the number, email or phone is wrong (no enumeration).
    if (!o || (q.email ? o.customerEmail !== q.email : o.customerPhone !== q.phone)) {
      await this.limiter.hit('track-contact', contact, 3600);
      await this.limiter.hit('track-number', q.number, 3600);
      throw notFound('Order');
    }
    return maskForGuest(await this.orders.detail({ id: o.id }));
  }
}

@ApiTags('orders')
@Controller()
export class CustomerOrdersController {
  constructor(private readonly orders: OrdersService, private readonly prisma: PrismaService) {}

  @Get('orders')
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(paginationSchema)) q: { page: number; pageSize: number }) {
    const where = { userId: u.id };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: { items: true, payments: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(rows.map(toOrderSummary), total, q.page, q.pageSize);
  }

  @Get('orders/:number')
  async detail(@CurrentUser() u: AuthUser, @Param('number') number: string) {
    const o = await this.prisma.order.findUnique({ where: { number } });
    if (!o || o.userId !== u.id) throw notFound('Order');
    return this.orders.detail({ id: o.id });
  }

  @HttpCode(200) @Post('orders/:number/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('number') number: string, @Body(new ZodPipe(cancelOrderSchema)) b: { reason: string }) {
    const o = await this.prisma.order.findUnique({ where: { number } });
    if (!o) throw notFound('Order');
    return this.orders.cancel(o.id, b.reason, actorOf(u), { customerUserId: u.id });
  }

  @HttpCode(200) @Post('orders/:number/pay')
  pay(@CurrentUser() u: AuthUser, @Param('number') number: string) {
    return this.orders.resumePayment(number, u.id);
  }

  /** What a return would refund, including offers the kept items lose. */
  @HttpCode(200) @Post('orders/:number/return-preview')
  async returnPreview(@CurrentUser() u: AuthUser, @Param('number') number: string, @Body(new ZodPipe(returnPreviewSchema)) b: z.infer<typeof returnPreviewSchema>) {
    const o = await this.prisma.order.findUnique({ where: { number }, include: { items: { select: { id: true, quantity: true, returnedQuantity: true } } } });
    if (!o || o.userId !== u.id) throw notFound('Order');
    for (const i of b.items) {
      const oi = o.items.find((x) => x.id === i.orderItemId);
      if (!oi) throw notFound('Order item');
      if (i.quantity > oi.quantity) throw badRequest('Quantity exceeds what was ordered');
    }
    return this.orders.returnPreview(o.id, b.items);
  }

  @Post('returns')
  async createReturn(@CurrentUser() u: AuthUser, @Body(new ZodPipe(returnRequestSchema)) b: z.infer<typeof returnRequestSchema>) {
    const { r, number } = await this.orders.requestReturn(u.id, b);
    return toReturnDto(r, number, await loadExtras(this.prisma, [r]));
  }

  @Get('returns')
  async returns(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.returnRequest.findMany({ where: { userId: u.id }, include: { items: { include: { orderItem: true } }, order: { select: { number: true } } }, orderBy: { createdAt: 'desc' } });
    const extras = await loadExtras(this.prisma, rows);
    return rows.map((r) => toReturnDto(r, r.order.number, extras));
  }
}

const adminOrderQ = paginationSchema.extend({
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'RTO']).optional(),
  codPending: z.enum(['true', 'false']).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
});

@ApiTags('admin:orders')
@StaffOnly()
@Controller('admin')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService, private readonly prisma: PrismaService, private readonly invoices: InvoiceService) {}

  @RequirePermissions('orders:read') @Get('orders')
  async list(@Query(new ZodPipe(adminOrderQ)) q: z.infer<typeof adminOrderQ>) {
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.codPending === 'true' ? { codConfirmation: 'PENDING' as const, status: { not: 'CANCELLED' as const } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q.toUpperCase() } }, { customerEmail: { contains: q.q.toLowerCase() } }, { customerName: { contains: q.q, mode: 'insensitive' as const } }, { customerPhone: { contains: q.q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: { items: true, payments: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(rows.map(toOrderSummary), total, q.page, q.pageSize);
  }

  @RequirePermissions('orders:read') @Get('orders/:id')
  async detail(@Param('id') id: string) {
    const o = await this.prisma.order.findFirst({ where: { OR: [{ id }, { number: id }] }, include: { user: { select: { id: true, name: true, email: true, phone: true } }, items: true } });
    if (!o) throw notFound('Order');
    const scans = await this.prisma.scanEvent.groupBy({ by: ['variantId'], where: { orderId: o.id, mode: 'DISPATCH', found: true }, _count: true });
    const dispatch = o.items.map((i) => ({ variantId: i.variantId, sku: i.sku, expected: i.quantity, scanned: scans.find((s) => s.variantId === i.variantId)?._count ?? 0 }));
    return { ...(await this.orders.detail({ id: o.id })), customer: o.user, dispatch };
  }

  @RequirePermissions('orders:write') @HttpCode(200) @Post('orders/:id/status')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderStatusUpdateSchema)) b: z.infer<typeof orderStatusUpdateSchema>) {
    return this.orders.updateStatus(id, b.status, b.note, actorOf(u));
  }

  @RequirePermissions('orders:write') @HttpCode(200) @Post('orders/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(cancelOrderSchema)) b: { reason: string }) {
    return this.orders.cancel(id, b.reason, actorOf(u));
  }

  @RequirePermissions('orders:write') @HttpCode(200) @Post('orders/:id/shipment')
  async ship(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(shipmentCreateSchema)) b: z.infer<typeof shipmentCreateSchema>) {
    return (await this.orders.ship(id, b, actorOf(u))).shipment;
  }

  @RequirePermissions('orders:refund') @Post('orders/:id/refunds')
  refund(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().min(3).max(300) }))) b: { amount: number; reason: string }) {
    return this.orders.refund(id, b.amount, b.reason, actorOf(u));
  }

  @RequirePermissions('orders:read') @Get('orders/:id/invoice')
  async invoice(@Param('id') id: string) {
    const o = await this.prisma.order.findFirst({ where: { OR: [{ id }, { number: id }] } });
    if (!o) throw notFound('Order');
    if (o.status === 'PENDING_PAYMENT' || o.status === 'CANCELLED') throw badRequest('Invoices are issued for confirmed orders');
    return new StreamableFile(await this.invoices.pdf(o.id), { type: 'application/pdf', disposition: `inline; filename="invoice-${o.number}.pdf"` });
  }

  @RequirePermissions('orders:read') @Get('returns')
  async returns(@Query(new ZodPipe(paginationSchema.extend({ status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED', 'EXCHANGED']).optional() }))) q: { page: number; pageSize: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'REFUNDED' | 'EXCHANGED' }) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.returnRequest.findMany({ where, include: { items: { include: { orderItem: true } }, order: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.returnRequest.count({ where }),
    ]);
    const extras = await loadExtras(this.prisma, rows);
    return paginated(rows.map((r) => toReturnDto(r, r.order.number, extras)), total, q.page, q.pageSize);
  }

  @RequirePermissions('orders:write') @HttpCode(200) @Post('returns/:id/decision')
  async decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(returnDecisionSchema)) b: z.infer<typeof returnDecisionSchema>) {
    if (b.action === 'REFUND' && !u.permissions.includes('orders:refund')) throw new AppError('FORBIDDEN', 'Missing permission: orders:refund', 403);
    const { r, number } = await this.orders.decideReturn(id, b.action, b.note, b.restock, actorOf(u));
    return toReturnDto(r, number, await loadExtras(this.prisma, [r]));
  }

  @RequirePermissions('orders:write') @HttpCode(200) @Post('orders/:id/confirm-cod')
  confirmCod(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ note: z.string().trim().max(300).optional() }))) b: { note?: string }) {
    return this.orders.staffConfirmCod(id, b.note, actorOf(u));
  }
}
