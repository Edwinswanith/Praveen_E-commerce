import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CodAnalyticsDto, DashboardDto, ProductReturnRateDto } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decToNum } from '../../common/money';
import { InventoryService } from '../inventory/inventory.service';
import { toOrderSummary } from '../orders/order.mappers';

/** Revenue = confirmed-or-later orders (excludes unpaid and cancelled), net of processed refunds. Days are IST. */
const COUNTED = Prisma.sql`o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED')`;
const TZ = 'Asia/Kolkata';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService) {}

  private async revenueBetween(from?: Date, to?: Date) {
    const range = Prisma.sql`${from ? Prisma.sql`AND o."createdAt" >= ${from}` : Prisma.empty} ${to ? Prisma.sql`AND o."createdAt" < ${to}` : Prisma.empty}`;
    const [r] = await this.prisma.$queryRaw<{ gross: Prisma.Decimal | null; refunds: Prisma.Decimal | null }[]>`
      SELECT (SELECT sum(o."grandTotal") FROM orders o WHERE ${COUNTED} ${range}) AS gross,
             (SELECT sum(r.amount) FROM refunds r JOIN orders o ON o.id = r."orderId" WHERE r.status = 'PROCESSED' ${range}) AS refunds`;
    return decToNum(r?.gross ?? 0) - decToNum(r?.refunds ?? 0);
  }

  private startOfIstDay(d = new Date()) {
    const ist = new Date(d.getTime() + 5.5 * 3600_000);
    ist.setUTCHours(0, 0, 0, 0);
    return new Date(ist.getTime() - 5.5 * 3600_000);
  }

  async dashboard(): Promise<DashboardDto> {
    const today = this.startOfIstDay();
    const d30 = new Date(Date.now() - 30 * 86400_000);
    const [total, todayRev, last30, orders, pending, todayOrders, customers, newCustomers, products, activeProducts, variants, inv, series, best, cats, recent] = await Promise.all([
      this.revenueBetween(), this.revenueBetween(today), this.revenueBetween(d30),
      this.prisma.order.count({ where: { status: { notIn: ['PENDING_PAYMENT'] } } }),
      this.prisma.order.count({ where: { status: { in: ['CONFIRMED', 'PACKED'] } } }),
      this.prisma.order.count({ where: { createdAt: { gte: today }, status: { not: 'PENDING_PAYMENT' } } }),
      this.prisma.user.count({ where: { role: { name: 'CUSTOMER' }, deletedAt: null } }),
      this.prisma.user.count({ where: { role: { name: 'CUSTOMER' }, createdAt: { gte: d30 } } }),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.product.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.productVariant.count({ where: { isActive: true } }),
      this.inventory.summary(),
      this.sales(d30, new Date(), 'day'),
      this.productPerformance(d30, new Date(), 5),
      this.prisma.$queryRaw<{ category: string; revenue: Prisma.Decimal; units: bigint }[]>`
        SELECT coalesce(parent.name, c.name) AS category, sum(oi."lineTotal") AS revenue, sum(oi.quantity)::bigint AS units
          FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN products p ON p.id = oi."productId" JOIN categories c ON c.id = p."categoryId" LEFT JOIN categories parent ON parent.id = c."parentId"
         WHERE ${COUNTED} AND o."createdAt" >= ${d30} GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
      this.prisma.order.findMany({ where: { status: { not: 'PENDING_PAYMENT' } }, include: { items: true, payments: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);
    return {
      revenue: { total, today: todayRev, last30Days: last30 },
      orders: { total: orders, pending, today: todayOrders },
      customers: { total: customers, newLast30Days: newCustomers },
      catalog: { products, activeProducts, variants },
      inventory: { totalUnits: inv.units, reservedUnits: inv.reserved, lowStock: inv.lowStock, outOfStock: inv.outOfStock, valuation: inv.valuation },
      revenueSeries: series.series.map((s) => ({ date: s.period, revenue: s.revenue, orders: s.orders })),
      bestSellers: best.map((b) => ({ productId: b.productId, name: b.name, units: b.units, revenue: b.revenue, imageUrl: b.imageUrl })),
      categoryPerformance: cats.map((c) => ({ category: c.category, revenue: decToNum(c.revenue), units: Number(c.units) })),
      recentOrders: recent.map(toOrderSummary),
    };
  }

  async sales(from: Date, to: Date, granularity: 'day' | 'week' | 'month') {
    const unit = Prisma.raw(`'${granularity}'`);
    const rows = await this.prisma.$queryRaw<{ period: Date; revenue: Prisma.Decimal | null; orders: bigint; units: bigint }[]>`
      WITH periods AS (
        SELECT generate_series(date_trunc(${unit}, ${from}::timestamptz AT TIME ZONE ${TZ}), date_trunc(${unit}, ${to}::timestamptz AT TIME ZONE ${TZ}), ('1 ' || ${granularity})::interval) AS period
      ), agg AS (
        SELECT date_trunc(${unit}, o."createdAt" AT TIME ZONE ${TZ}) AS period, sum(o."grandTotal") AS revenue, count(*)::bigint AS orders,
               (SELECT coalesce(sum(oi.quantity),0) FROM order_items oi WHERE oi."orderId" = ANY(array_agg(o.id)))::bigint AS units
          FROM orders o WHERE ${COUNTED} AND o."createdAt" >= ${from} AND o."createdAt" < ${to} GROUP BY 1
      )
      SELECT p.period, a.revenue, coalesce(a.orders, 0)::bigint AS orders, coalesce(a.units, 0)::bigint AS units FROM periods p LEFT JOIN agg a ON a.period = p.period ORDER BY p.period`;
    const series = rows.map((r) => {
      const revenue = decToNum(r.revenue ?? 0), orders = Number(r.orders);
      return { period: r.period.toISOString().slice(0, 10), revenue, orders, units: Number(r.units), aov: orders ? Math.round((revenue / orders) * 100) / 100 : 0 };
    });
    const totals = series.reduce((t, s) => ({ revenue: t.revenue + s.revenue, orders: t.orders + s.orders, units: t.units + s.units }), { revenue: 0, orders: 0, units: 0 });
    return { series, totals: { ...totals, revenue: Math.round(totals.revenue * 100) / 100, aov: totals.orders ? Math.round((totals.revenue / totals.orders) * 100) / 100 : 0 } };
  }

  async productPerformance(from: Date, to: Date, limit = 100) {
    const rows = await this.prisma.$queryRaw<{ productId: string; name: string; units: bigint; revenue: Prisma.Decimal; returns: bigint; imageUrl: string | null }[]>`
      SELECT oi."productId", max(oi."productName") AS name, sum(oi.quantity)::bigint AS units, sum(oi."lineTotal") AS revenue, sum(oi."returnedQuantity")::bigint AS returns,
             (SELECT i."thumbUrl" FROM product_images i WHERE i."productId" = oi."productId" ORDER BY i."sortOrder" LIMIT 1) AS "imageUrl"
        FROM order_items oi JOIN orders o ON o.id = oi."orderId"
       WHERE ${COUNTED} AND o."createdAt" >= ${from} AND o."createdAt" < ${to}
       GROUP BY oi."productId" ORDER BY units DESC LIMIT ${limit}`;
    return rows.map((r) => ({ productId: r.productId, name: r.name, units: Number(r.units), revenue: decToNum(r.revenue), returns: Number(r.returns), imageUrl: r.imageUrl }));
  }

  async inventoryReport() {
    const s = await this.inventory.summary();
    const byCategory = await this.prisma.$queryRaw<{ category: string; units: bigint; value: Prisma.Decimal | null }[]>`
      SELECT coalesce(parent.name, c.name) AS category, sum(i."onHand")::bigint AS units, sum(i."onHand" * coalesce(v."costPrice", v.price)) AS value
        FROM inventory i JOIN product_variants v ON v.id = i."variantId" JOIN products p ON p.id = v."productId" JOIN categories c ON c.id = p."categoryId" LEFT JOIN categories parent ON parent.id = c."parentId"
       WHERE v."isActive" AND p."deletedAt" IS NULL GROUP BY 1 ORDER BY value DESC NULLS LAST`;
    return { valuationCost: s.valuation, valuationRetail: s.retailValue, units: s.units, reserved: s.reserved, byCategory: byCategory.map((b) => ({ category: b.category, units: Number(b.units), value: decToNum(b.value ?? 0) })) };
  }

  async cancellations(from: Date, to: Date) {
    const rows = await this.prisma.order.groupBy({ by: ['cancelReason'], where: { status: 'CANCELLED', cancelledAt: { gte: from, lt: to } }, _count: true, _sum: { grandTotal: true } });
    const total = await this.prisma.order.count({ where: { createdAt: { gte: from, lt: to } } });
    const cancelled = rows.reduce((s, r) => s + r._count, 0);
    return { total, cancelled, rate: total ? Math.round((cancelled / total) * 1000) / 10 : 0, byReason: rows.map((r) => ({ reason: r.cancelReason ?? 'Unspecified', count: r._count, value: decToNum(r._sum.grandTotal ?? 0) })).sort((a, b) => b.count - a.count) };
  }

  /** COD health: share, confirmation rate, RTO rate and the PIN codes that refuse most. */
  async cod(from: Date, to: Date): Promise<CodAnalyticsDto> {
    const [r] = await this.prisma.$queryRaw<{ cod: bigint; prepaid: bigint; confirmed: bigint; autocancelled: bigint; rto: bigint; rtovalue: Prisma.Decimal | null; shippedcod: bigint }[]>`
      SELECT count(*) FILTER (WHERE "paymentMethod" = 'COD')::bigint AS cod,
             count(*) FILTER (WHERE "paymentMethod" = 'ONLINE' AND "exchangeForOrderId" IS NULL AND status <> 'PENDING_PAYMENT')::bigint AS prepaid,
             count(*) FILTER (WHERE "paymentMethod" = 'COD' AND "codConfirmation" = 'CONFIRMED')::bigint AS confirmed,
             count(*) FILTER (WHERE "paymentMethod" = 'COD' AND status = 'CANCELLED' AND "cancelReason" = 'Cash on Delivery order was not confirmed')::bigint AS autocancelled,
             count(*) FILTER (WHERE "paymentMethod" = 'COD' AND status = 'RTO')::bigint AS rto,
             sum("grandTotal") FILTER (WHERE "paymentMethod" = 'COD' AND status = 'RTO') AS rtovalue,
             count(*) FILTER (WHERE "paymentMethod" = 'COD' AND status IN ('SHIPPED','OUT_FOR_DELIVERY','DELIVERED','RTO','RETURNED'))::bigint AS shippedcod
        FROM orders WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`;
    const pins = await this.prisma.$queryRaw<{ pincode: string; rto: bigint; orders: bigint }[]>`
      SELECT "shippingAddress"->>'pincode' AS pincode, count(*) FILTER (WHERE status = 'RTO')::bigint AS rto, count(*)::bigint AS orders
        FROM orders WHERE "paymentMethod" = 'COD' AND "createdAt" >= ${from} AND "createdAt" < ${to}
       GROUP BY 1 HAVING count(*) FILTER (WHERE status = 'RTO') > 0 ORDER BY rto DESC, orders DESC LIMIT 10`;
    const n = (b: bigint | undefined) => Number(b ?? 0);
    const cod = n(r?.cod), prepaid = n(r?.prepaid), shipped = n(r?.shippedcod), rto = n(r?.rto);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    return {
      codOrders: cod, prepaidOrders: prepaid, codShare: pct(cod, cod + prepaid), confirmedRate: pct(n(r?.confirmed), cod), autoCancelled: n(r?.autocancelled),
      rtoOrders: rto, rtoRate: pct(rto, shipped), rtoValue: decToNum(r?.rtovalue ?? 0),
      topRtoPincodes: pins.map((p) => ({ pincode: p.pincode, rto: n(p.rto), orders: n(p.orders) })),
    };
  }

  /** Per-product return rate (returns + exchanges) with the most common reason: drop or fix bad products. */
  async returnRates(from: Date, to: Date): Promise<ProductReturnRateDto[]> {
    const rows = await this.prisma.$queryRaw<{ productId: string; name: string; sold: bigint; returned: bigint; exchanges: bigint; topReason: string | null }[]>`
      WITH sold AS (
        SELECT oi."productId", max(oi."productName") AS name, sum(oi.quantity)::bigint AS sold
          FROM order_items oi JOIN orders o ON o.id = oi."orderId"
         WHERE o.status IN ('DELIVERED','RETURNED') AND o."exchangeForOrderId" IS NULL AND o."createdAt" >= ${from} AND o."createdAt" < ${to}
         GROUP BY 1
      ), ret AS (
        SELECT oi."productId", sum(ri.quantity)::bigint AS returned,
               sum(ri.quantity) FILTER (WHERE rr.type = 'EXCHANGE')::bigint AS exchanges,
               mode() WITHIN GROUP (ORDER BY rr.reason) AS "topReason"
          FROM return_items ri JOIN return_requests rr ON rr.id = ri."returnRequestId" JOIN order_items oi ON oi.id = ri."orderItemId"
         WHERE rr.status <> 'REJECTED' GROUP BY 1
      )
      SELECT s."productId", s.name, s.sold, coalesce(r.returned, 0)::bigint AS returned, coalesce(r.exchanges, 0)::bigint AS exchanges, r."topReason"
        FROM sold s LEFT JOIN ret r ON r."productId" = s."productId"
       ORDER BY coalesce(r.returned, 0)::float / greatest(s.sold, 1) DESC, s.sold DESC LIMIT 200`;
    return rows.map((r) => {
      const sold = Number(r.sold), returned = Number(r.returned);
      return { productId: r.productId, name: r.name, unitsSold: sold, unitsReturned: returned, returnRate: sold ? Math.round((returned / sold) * 1000) / 10 : 0, topReason: r.topReason, exchanges: Number(r.exchanges) };
    });
  }

  async returns(from: Date, to: Date) {
    const rows = await this.prisma.returnRequest.groupBy({ by: ['reason', 'status'], where: { createdAt: { gte: from, lt: to } }, _count: true, _sum: { refundAmount: true } });
    return { requests: rows.reduce((s, r) => s + r._count, 0), refunded: decToNum(rows.filter((r) => r.status === 'REFUNDED').reduce((s, r) => s + Number(r._sum.refundAmount ?? 0), 0)), byReason: rows.map((r) => ({ reason: r.reason, status: r.status, count: r._count })) };
  }
}
