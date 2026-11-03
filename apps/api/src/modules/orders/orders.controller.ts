import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  cancelOrderSchema, checkoutSchema, orderStatusUpdateSchema, paginationSchema, pincodeSchema, returnDecisionSchema, returnRequestSchema,
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
import { toOrderSummary, toReturnDto } from './order.mappers';
import { OrdersService } from './orders.service';

const actorOf = (u: AuthUser) => ({ id: u.id, name: u.name });

@ApiTags('checkout')
@Public()
@OptionalAuth()
@Controller()
export class CheckoutController {
  constructor(private readonly orders: OrdersService, private readonly carts: CartService, private readonly payments: PaymentsGateway, private readonly shipping: ShippingService, private readonly prisma: PrismaService) {}

  @Get('shipping/serviceability')
  serviceability(@Query(new ZodPipe(z.object({ pincode: pincodeSchema }))) q: { pincode: string }) {
    return this.shipping.serviceability(q.pincode);
  }

  @HttpCode(200) @Post('checkout/quote')
  quote(@Req() req: Request, @Body(new ZodPipe(z.object({ shippingMethod: z.enum(['STANDARD', 'EXPRESS']).default('STANDARD'), paymentMethod: z.enum(['ONLINE', 'COD']).default('ONLINE'), couponCode: z.string().trim().toUpperCase().max(30).nullish() }))) b: { shippingMethod: 'STANDARD' | 'EXPRESS'; paymentMethod: 'ONLINE' | 'COD'; couponCode?: string | null }, @CurrentUser() u?: AuthUser) {
    return this.orders.quote(this.carts.owner(req, u?.id), b, u?.email);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('checkout')
  checkout(@Req() req: Request, @Body(new ZodPipe(checkoutSchema)) b: CheckoutInput, @CurrentUser() u?: AuthUser) {
    return this.orders.checkout(this.carts.owner(req, u?.id), u ? { id: u.id, email: u.email, name: u.name } : undefined, b);
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

  @Get('orders/track')
  async track(@Query(new ZodPipe(z.object({ number: z.string().trim().toUpperCase().min(5).max(30), email: z.string().trim().toLowerCase().email() }))) q: { number: string; email: string }) {
    const o = await this.prisma.order.findUnique({ where: { number: q.number } });
    // Same response whether the number or the email is wrong (no enumeration).
    if (!o || o.customerEmail !== q.email) throw notFound('Order');
    return this.orders.detail({ id: o.id });
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

  @Post('returns')
  async createReturn(@CurrentUser() u: AuthUser, @Body(new ZodPipe(returnRequestSchema)) b: z.infer<typeof returnRequestSchema>) {
    const { r, number } = await this.orders.requestReturn(u.id, b);
    return toReturnDto(r, number);
  }

  @Get('returns')
  async returns(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.returnRequest.findMany({ where: { userId: u.id }, include: { items: { include: { orderItem: true } }, order: { select: { number: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => toReturnDto(r, r.order.number));
  }
}

const adminOrderQ = paginationSchema.extend({
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED']).optional(),
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
  async returns(@Query(new ZodPipe(paginationSchema.extend({ status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED']).optional() }))) q: { page: number; pageSize: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'REFUNDED' }) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.returnRequest.findMany({ where, include: { items: { include: { orderItem: true } }, order: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return paginated(rows.map((r) => toReturnDto(r, r.order.number)), total, q.page, q.pageSize);
  }

  @RequirePermissions('orders:write') @HttpCode(200) @Post('returns/:id/decision')
  async decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(returnDecisionSchema)) b: z.infer<typeof returnDecisionSchema>) {
    if (b.action === 'REFUND' && !u.permissions.includes('orders:refund')) throw new AppError('FORBIDDEN', 'Missing permission: orders:refund', 403);
    const { r, number } = await this.orders.decideReturn(id, b.action, b.note, b.restock, actorOf(u));
    return toReturnDto(r, number);
  }
}
