import { Injectable } from '@nestjs/common';
import { Prisma, type InventoryMovementType } from '@prisma/client';
import type { InventoryMovementInput, InventoryRowDto } from '@vyra/shared';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { badRequest, notFound, outOfStock } from '../../common/http/errors';
import { decToNum, decToNumOrNull, paiseToDec } from '../../common/money';
import { toPaise } from '@vyra/shared';

export interface MovementRequest {
  variantId: string;
  type: InventoryMovementType;
  onHandDelta: number;
  reservedDelta: number;
  reason?: string | null;
  reference?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  unitCost?: number | null;
  scanId?: string | null;
  actorId?: string | null;
}

export class InsufficientStockError extends Error {
  constructor(public readonly variantId: string, public readonly requested: number, public readonly available: number) {
    super(`Insufficient stock for ${variantId}`);
  }
}

/**
 * The ONLY code path allowed to change stock.
 *
 * Concurrency model: each change is a single guarded UPDATE
 *   SET onHand = onHand + d1, reserved = reserved + d2
 *   WHERE onHand + d1 >= 0 AND reserved + d2 >= 0 AND reserved + d2 <= onHand + d1
 * Postgres takes a row lock and re-evaluates the WHERE clause after any
 * concurrent writer commits, so two customers racing for the last unit cannot
 * both succeed — one UPDATE matches 0 rows. CHECK constraints on the table
 * back this up. Callers that touch several variants must sort by variantId to
 * avoid deadlocks (see reserveMany).
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(tx: Tx, m: MovementRequest) {
    if (!Number.isInteger(m.onHandDelta) || !Number.isInteger(m.reservedDelta)) throw badRequest('Quantities must be integers');
    const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
      UPDATE "inventory"
         SET "onHand" = "onHand" + ${m.onHandDelta}, "reserved" = "reserved" + ${m.reservedDelta},
             "version" = "version" + 1, "updatedAt" = now()
       WHERE "variantId" = ${m.variantId}
         AND "onHand" + ${m.onHandDelta} >= 0
         AND "reserved" + ${m.reservedDelta} >= 0
         AND "reserved" + ${m.reservedDelta} <= "onHand" + ${m.onHandDelta}
   RETURNING "onHand", "reserved"`;
    if (rows.length === 0) {
      const inv = await tx.inventory.findUnique({ where: { variantId: m.variantId } });
      if (!inv) throw notFound('Inventory record');
      const requested = m.reservedDelta > 0 ? m.reservedDelta : -m.onHandDelta;
      throw new InsufficientStockError(m.variantId, requested, Math.max(0, inv.onHand - inv.reserved));
    }
    const after = rows[0]!;
    const movement = await tx.inventoryMovement.create({
      data: {
        variantId: m.variantId, type: m.type, onHandDelta: m.onHandDelta, reservedDelta: m.reservedDelta,
        onHandAfter: after.onHand, reservedAfter: after.reserved, reason: m.reason ?? null, reference: m.reference ?? null,
        orderId: m.orderId ?? null, supplierId: m.supplierId ?? null, scanId: m.scanId ?? null, actorId: m.actorId ?? null,
        unitCost: m.unitCost != null ? paiseToDec(toPaise(m.unitCost)) : null,
      },
    });
    return { ...after, movement };
  }

  /** Reserve stock for several lines atomically; all-or-nothing. */
  async reserveMany(tx: Tx, lines: { variantId: string; quantity: number }[], orderId: string, reference: string) {
    const sorted = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    const shortfalls: { variantId: string; requested: number; available: number }[] = [];
    for (const l of sorted) {
      try {
        await this.apply(tx, { variantId: l.variantId, type: 'RESERVATION', onHandDelta: 0, reservedDelta: l.quantity, orderId, reference, reason: 'Order placed' });
      } catch (e) {
        if (e instanceof InsufficientStockError) shortfalls.push({ variantId: e.variantId, requested: e.requested, available: e.available });
        else throw e;
      }
    }
    // Throwing rolls back the whole transaction, including reservations that succeeded.
    if (shortfalls.length) throw outOfStock('Some items in your bag are no longer available in the requested quantity', { items: shortfalls });
  }

  async releaseMany(tx: Tx, lines: { variantId: string; quantity: number }[], orderId: string, reason: string, actorId?: string | null) {
    for (const l of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await this.apply(tx, { variantId: l.variantId, type: 'RELEASE', onHandDelta: 0, reservedDelta: -l.quantity, orderId, reason, actorId });
    }
  }

  /** Goods physically leave the warehouse: reserved and on-hand both drop. */
  async fulfilMany(tx: Tx, lines: { variantId: string; quantity: number }[], orderId: string, actorId?: string | null) {
    for (const l of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await this.apply(tx, { variantId: l.variantId, type: 'FULFILLMENT', onHandDelta: -l.quantity, reservedDelta: -l.quantity, orderId, reason: 'Shipped', actorId });
    }
  }

  /** Manual staff operation (stock in / out / adjustment). Always audited via the ledger. */
  async recordManual(input: InventoryMovementInput, actorId: string) {
    let onHandDelta: number;
    if (input.type === 'STOCK_IN') {
      if (input.quantity <= 0) throw badRequest('Stock in quantity must be positive');
      onHandDelta = input.quantity;
    } else if (input.type === 'STOCK_OUT') {
      if (input.quantity <= 0) throw badRequest('Stock out quantity must be positive');
      onHandDelta = -input.quantity;
    } else {
      onHandDelta = input.quantity; // signed adjustment
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
        if (!variant) throw notFound('Variant');
        if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId } }))) throw notFound('Supplier');
        if (input.type === 'STOCK_IN' && input.unitCost != null) {
          await tx.productVariant.update({ where: { id: variant.id }, data: { costPrice: paiseToDec(toPaise(input.unitCost)) } });
        }
        return this.apply(tx, {
          variantId: input.variantId, type: input.type, onHandDelta, reservedDelta: 0, reason: input.reason,
          reference: input.reference, supplierId: input.supplierId, unitCost: input.unitCost, scanId: input.scanId, actorId,
        });
      });
    } catch (e) {
      if (e instanceof InsufficientStockError) {
        throw outOfStock(`Cannot remove ${e.requested} units: only ${e.available} are unreserved`, { available: e.available });
      }
      throw e;
    }
  }

  async row(variantId: string): Promise<InventoryRowDto> {
    const rows = await this.rows({ variantIds: [variantId] }, 1, 1);
    if (!rows.items[0]) throw notFound('Variant');
    return rows.items[0];
  }

  async rows(filter: { q?: string; status?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'; variantIds?: string[] }, page: number, pageSize: number) {
    const q = filter.q?.trim();
    const where: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];
    if (filter.variantIds) where.push(Prisma.sql`v.id IN (${Prisma.join(filter.variantIds)})`);
    if (q) {
      const like = `%${q}%`;
      where.push(Prisma.sql`(v.sku ILIKE ${like} OR p.name ILIKE ${like} OR EXISTS (SELECT 1 FROM barcodes b WHERE b."variantId" = v.id AND b.value = ${q}))`);
    }
    const avail = Prisma.sql`(i."onHand" - i.reserved)`;
    if (filter.status === 'OUT_OF_STOCK') where.push(Prisma.sql`${avail} <= 0`);
    if (filter.status === 'LOW_STOCK') where.push(Prisma.sql`${avail} > 0 AND ${avail} <= v."lowStockThreshold"`);
    if (filter.status === 'IN_STOCK') where.push(Prisma.sql`${avail} > v."lowStockThreshold"`);
    const whereSql = Prisma.join(where, ' AND ');
    type Row = { variantId: string; productId: string; productName: string; sku: string; color: string; size: string; onHand: number; reserved: number; lowStockThreshold: number; costPrice: Prisma.Decimal | null; price: Prisma.Decimal; updatedAt: Date; barcode: string | null };
    const [items, totals] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT v.id AS "variantId", p.id AS "productId", p.name AS "productName", v.sku, v.color, v.size,
               i."onHand", i.reserved, v."lowStockThreshold", v."costPrice", v.price, i."updatedAt",
               (SELECT b.value FROM barcodes b WHERE b."variantId" = v.id AND b."isPrimary" LIMIT 1) AS barcode
          FROM product_variants v JOIN products p ON p.id = v."productId" JOIN inventory i ON i."variantId" = v.id
         WHERE ${whereSql}
         ORDER BY ${avail} ASC, p.name ASC, v."sizeOrder" ASC
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*)::bigint AS total FROM product_variants v JOIN products p ON p.id = v."productId" JOIN inventory i ON i."variantId" = v.id WHERE ${whereSql}`,
    ]);
    return {
      total: Number(totals[0]?.total ?? 0),
      items: items.map((r): InventoryRowDto => {
        const available = r.onHand - r.reserved;
        const cost = decToNumOrNull(r.costPrice);
        return {
          variantId: r.variantId, productId: r.productId, productName: r.productName, sku: r.sku, barcode: r.barcode, color: r.color, size: r.size,
          onHand: r.onHand, reserved: r.reserved, available, lowStockThreshold: r.lowStockThreshold,
          status: available <= 0 ? 'OUT_OF_STOCK' : available <= r.lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK',
          costPrice: cost, price: decToNum(r.price), stockValue: Math.round((cost ?? decToNum(r.price)) * r.onHand * 100) / 100,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    };
  }

  async summary() {
    const [s] = await this.prisma.$queryRaw<{ units: bigint; reserved: bigint; low: bigint; out: bigint; valuation: Prisma.Decimal | null; retail: Prisma.Decimal | null }[]>`
      SELECT coalesce(sum(i."onHand"),0)::bigint AS units, coalesce(sum(i.reserved),0)::bigint AS reserved,
             count(*) FILTER (WHERE i."onHand" - i.reserved > 0 AND i."onHand" - i.reserved <= v."lowStockThreshold")::bigint AS low,
             count(*) FILTER (WHERE i."onHand" - i.reserved <= 0)::bigint AS out,
             sum(i."onHand" * coalesce(v."costPrice", v.price)) AS valuation,
             sum(i."onHand" * v.price) AS retail
        FROM inventory i JOIN product_variants v ON v.id = i."variantId" JOIN products p ON p.id = v."productId"
       WHERE v."isActive" AND p."deletedAt" IS NULL AND p.status <> 'ARCHIVED'`;
    const units = Number(s?.units ?? 0);
    const reserved = Number(s?.reserved ?? 0);
    return { units, reserved, available: units - reserved, lowStock: Number(s?.low ?? 0), outOfStock: Number(s?.out ?? 0), valuation: decToNum(s?.valuation ?? 0), retailValue: decToNum(s?.retail ?? 0) };
  }
}
