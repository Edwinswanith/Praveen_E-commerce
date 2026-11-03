import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { couponSchema, paginationSchema, toPaise, type CustomerSummaryDto } from '@vyra/shared';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { notFound } from '../../common/http/errors';
import { decToNum, paiseToDec } from '../../common/money';
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { toCouponDto } from '../coupons/coupons.service';
import { toOrderSummary } from '../orders/order.mappers';
import { toAddressDto } from '../users/users.controller';

type CouponInput = z.infer<typeof couponSchema>;
function couponData(c: Partial<CouponInput>) {
  return {
    ...c,
    value: c.value === undefined ? undefined : c.type === 'FIXED' ? paiseToDec(toPaise(c.value)) : new Prisma.Decimal(c.value),
    maxDiscount: c.maxDiscount === undefined ? undefined : c.maxDiscount === null ? null : paiseToDec(toPaise(c.maxDiscount)),
    minOrderValue: c.minOrderValue === undefined ? undefined : c.minOrderValue === null ? null : paiseToDec(toPaise(c.minOrderValue)),
  };
}

@ApiTags('admin:coupons')
@StaffOnly()
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @RequirePermissions('promotions:read') @Get()
  async list() {
    return (await this.prisma.coupon.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } })).map(toCouponDto);
  }

  @RequirePermissions('promotions:write') @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(couponSchema)) b: CouponInput) {
    const c = await this.prisma.coupon.create({ data: couponData(b) as Prisma.CouponCreateInput });
    await this.audit.log({ actorId: u.id, action: 'coupon.create', entity: 'Coupon', entityId: c.id, after: b });
    return toCouponDto(c);
  }

  @RequirePermissions('promotions:write') @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({}).passthrough())) raw: Record<string, unknown>) {
    const existing = await this.prisma.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw notFound('Coupon');
    // Validate the merged result so type/value combinations stay consistent.
    const merged = couponSchema.parse({ ...toCouponDto(existing), ...raw });
    const c = await this.prisma.coupon.update({ where: { id }, data: couponData(merged) as Prisma.CouponUpdateInput });
    await this.audit.log({ actorId: u.id, action: 'coupon.update', entity: 'Coupon', entityId: id, after: raw });
    return toCouponDto(c);
  }

  @RequirePermissions('promotions:write') @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.coupon.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, code: `DELETED-${Date.now()}` } });
    await this.audit.log({ actorId: u.id, action: 'coupon.delete', entity: 'Coupon', entityId: id });
    return { ok: true };
  }
}

@ApiTags('admin:customers')
@StaffOnly()
@RequirePermissions('customers:read')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(paginationSchema)) q: { page: number; pageSize: number; q?: string }) {
    const where: Prisma.UserWhereInput = {
      role: { name: 'CUSTOMER' }, deletedAt: null,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    const stats = users.length ? await this.prisma.order.groupBy({ by: ['userId'], where: { userId: { in: users.map((u) => u.id) }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } }, _count: true, _sum: { grandTotal: true }, _max: { createdAt: true } }) : [];
    const items: CustomerSummaryDto[] = users.map((u) => {
      const s = stats.find((x) => x.userId === u.id);
      return { id: u.id, name: u.name, email: u.email, phone: u.phone, orders: s?._count ?? 0, totalSpent: decToNum(s?._sum.grandTotal ?? 0), lastOrderAt: s?._max.createdAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() };
    });
    return paginated(items, total, q.page, q.pageSize);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, role: { name: 'CUSTOMER' } }, include: { customerProfile: true, addresses: { where: { deletedAt: null } } } });
    if (!u) throw notFound('Customer');
    const [orders, agg, returns, searches] = await Promise.all([
      this.prisma.order.findMany({ where: { userId: id }, include: { items: true, payments: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.order.aggregate({ where: { userId: id, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } }, _sum: { grandTotal: true }, _count: true }),
      this.prisma.returnRequest.count({ where: { userId: id } }),
      this.prisma.searchHistory.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { query: true, mode: true, createdAt: true } }),
    ]);
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, emailVerified: !!u.emailVerifiedAt, isActive: u.isActive, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      notes: u.customerProfile?.notes ?? null, addresses: u.addresses.map(toAddressDto), orders: orders.map(toOrderSummary),
      stats: { orders: agg._count, totalSpent: decToNum(agg._sum.grandTotal ?? 0), returns }, recentSearches: searches,
    };
  }

  @HttpCode(200) @Post(':id/notes')
  async notes(@Param('id') id: string, @Body(new ZodPipe(z.object({ notes: z.string().max(2000) }))) b: { notes: string }) {
    await this.prisma.customerProfile.upsert({ where: { userId: id }, create: { userId: id, notes: b.notes }, update: { notes: b.notes } });
    return { ok: true };
  }
}
