import { Injectable } from '@nestjs/common';
import type { Coupon } from '@prisma/client';
import { toPaise, type CouponDto, type PricingCoupon } from '@vyra/shared';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { decToNum, decToNumOrNull, decToPaise } from '../../common/money';

export function toCouponDto(c: Coupon): CouponDto {
  return {
    id: c.id, code: c.code, description: c.description, type: c.type, value: decToNum(c.value), maxDiscount: decToNumOrNull(c.maxDiscount),
    minOrderValue: decToNumOrNull(c.minOrderValue), startsAt: c.startsAt?.toISOString() ?? null, expiresAt: c.expiresAt?.toISOString() ?? null,
    usageLimit: c.usageLimit, perUserLimit: c.perUserLimit, usedCount: c.usedCount, categoryIds: c.categoryIds, isActive: c.isActive,
  };
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Checks the coupon's own rules (not cart contents). Returns a pricing coupon or a customer-facing error. */
  async resolve(code: string, who: { userId?: string | null; email?: string | null }, tx?: Tx): Promise<{ coupon: PricingCoupon; row: Coupon } | { error: string }> {
    const db = tx ?? this.prisma;
    const c = await db.coupon.findFirst({ where: { code: code.toUpperCase(), deletedAt: null } });
    const now = new Date();
    if (!c || !c.isActive) return { error: 'This coupon code is not valid' };
    if (c.startsAt && c.startsAt > now) return { error: 'This coupon is not active yet' };
    if (c.expiresAt && c.expiresAt < now) return { error: 'This coupon has expired' };
    if (c.usageLimit != null && c.usedCount >= c.usageLimit) return { error: 'This coupon has reached its usage limit' };
    if (who.userId || who.email) {
      const used = await db.couponUsage.count({ where: { couponId: c.id, OR: [...(who.userId ? [{ userId: who.userId }] : []), ...(who.email ? [{ email: who.email }] : [])], order: { status: { not: 'CANCELLED' } } } });
      if (used >= c.perUserLimit) return { error: 'You have already used this coupon' };
    }
    return {
      row: c,
      coupon: {
        code: c.code, type: c.type, value: c.type === 'PERCENTAGE' ? Number(c.value) : decToPaise(c.value),
        maxDiscount: c.maxDiscount ? decToPaise(c.maxDiscount) : null, minOrderValue: c.minOrderValue ? decToPaise(c.minOrderValue) : null, categoryIds: c.categoryIds,
      },
    };
  }

  /** Atomically consumes one use; returns false if the global limit was hit concurrently. */
  async consume(tx: Tx, couponId: string): Promise<boolean> {
    const n = await tx.$executeRaw`UPDATE coupons SET "usedCount" = "usedCount" + 1 WHERE id = ${couponId} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
    return n === 1;
  }

  async available(): Promise<CouponDto[]> {
    const now = new Date();
    const rows = await this.prisma.coupon.findMany({
      where: { isActive: true, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }] },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    return rows.filter((c) => c.usageLimit == null || c.usedCount < c.usageLimit).map(toCouponDto);
  }

  toPaiseValue(type: 'PERCENTAGE' | 'FIXED', value: number) {
    return type === 'PERCENTAGE' ? value : toPaise(value);
  }
}
