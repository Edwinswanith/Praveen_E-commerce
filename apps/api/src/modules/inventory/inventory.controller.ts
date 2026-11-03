import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  barcodeLabelsSchema, inventoryMovementSchema, paginationSchema, purchaseOrderSchema, scanLookupSchema, supplierSchema,
  toPaise, type InventoryMovementDto, type PurchaseOrderDetailDto, type InventoryMovementInput, type ScanResultDto,
} from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { badRequest, notFound } from '../../common/http/errors';
import { decToNum, paiseToDec } from '../../common/money';
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { BarcodesService } from '../barcodes/barcodes.service';
import { InventoryService } from './inventory.service';

const invQ = paginationSchema.extend({ status: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional() });
const movQ = paginationSchema.extend({ variantId: z.string().optional(), type: z.enum(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'FULFILLMENT', 'RETURN_RESTOCK']).optional(), orderId: z.string().optional() });

@ApiTags('admin:inventory')
@StaffOnly()
@Controller('admin/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService, private readonly prisma: PrismaService) {}

  @RequirePermissions('inventory:read') @Get()
  async list(@Query(new ZodPipe(invQ)) q: z.infer<typeof invQ>) {
    const [{ items, total }, summary] = await Promise.all([this.inventory.rows({ q: q.q, status: q.status }, q.page, q.pageSize), this.inventory.summary()]);
    return paginated(items, total, q.page, q.pageSize, { summary });
  }

  @RequirePermissions('inventory:write') @Post('movements')
  async move(@CurrentUser() u: AuthUser, @Body(new ZodPipe(inventoryMovementSchema)) body: InventoryMovementInput) {
    await this.inventory.recordManual(body, u.id);
    return this.inventory.row(body.variantId);
  }

  @RequirePermissions('inventory:read') @Get('movements')
  async movements(@Query(new ZodPipe(movQ)) q: z.infer<typeof movQ>) {
    const where = { ...(q.variantId ? { variantId: q.variantId } : {}), ...(q.type ? { type: q.type } : {}), ...(q.orderId ? { orderId: q.orderId } : {}), ...(q.q ? { variant: { sku: { contains: q.q, mode: 'insensitive' as const } } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({ where, include: { variant: { select: { sku: true, product: { select: { name: true } } } }, actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    const items: InventoryMovementDto[] = rows.map((m) => ({
      id: m.id, variantId: m.variantId, sku: m.variant.sku, productName: m.variant.product.name, type: m.type,
      quantity: m.type === 'RESERVATION' || m.type === 'RELEASE' ? m.reservedDelta : m.onHandDelta,
      onHandAfter: m.onHandAfter, reservedAfter: m.reservedAfter, reason: m.reason, reference: m.reference, actorName: m.actor?.name ?? 'System', createdAt: m.createdAt.toISOString(),
    }));
    return paginated(items, total, q.page, q.pageSize);
  }

  @RequirePermissions('inventory:read') @Get('reconcile')
  reconcile() {
    return this.inventory.reconcile();
  }

  @RequirePermissions('inventory:read') @Get('export')
  async export(@Query('format') format: string | undefined, @Res({ passthrough: true }) res: Response) {
    const { items } = await this.inventory.rows({}, 1, 100_000);
    const cols = ['sku', 'barcode', 'productName', 'color', 'size', 'onHand', 'reserved', 'available', 'lowStockThreshold', 'status', 'costPrice', 'price', 'stockValue'] as const;
    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Inventory');
      ws.columns = cols.map((c) => ({ header: c, key: c, width: 16 }));
      items.forEach((i) => ws.addRow(i));
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition', `attachment; filename="vyra-inventory-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="vyra-inventory-${new Date().toISOString().slice(0, 10)}.csv"`);
    return new StreamableFile(Buffer.from([cols.join(','), ...items.map((i) => cols.map((c) => esc(i[c])).join(','))].join('\n')));
  }
}

@ApiTags('admin:barcodes')
@StaffOnly()
@Controller('admin')
export class BarcodesController {
  constructor(private readonly barcodes: BarcodesService, private readonly prisma: PrismaService, private readonly inventory: InventoryService) {}

  @RequirePermissions('inventory:read') @Get('barcodes/:file')
  async png(@Param('file') file: string, @Query('symbology') symbology: string | undefined) {
    const variantId = file.replace(/\.png$/, '');
    const sym = z.enum(['EAN13', 'CODE128', 'QR']).catch('EAN13').parse(symbology);
    return new StreamableFile(await this.barcodes.png(variantId, sym), { type: 'image/png' });
  }

  @RequirePermissions('inventory:read') @Post('barcodes/labels') @HttpCode(200) @Header('content-type', 'application/pdf')
  async labels(@Body(new ZodPipe(barcodeLabelsSchema)) body: z.infer<typeof barcodeLabelsSchema>) {
    return new StreamableFile(await this.barcodes.labelsPdf(body.items, body.format, body.symbology), { type: 'application/pdf', disposition: 'inline; filename="vyra-labels.pdf"' });
  }

  @RequirePermissions('catalog:write') @Post('barcodes/generate-missing') @HttpCode(200)
  async generateMissing() {
    const vs = await this.prisma.productVariant.findMany({ where: { barcodes: { none: { symbology: 'EAN13' } } }, select: { id: true } });
    await this.prisma.$transaction((tx) => this.barcodes.ensureForVariants(tx, vs.map((v) => v.id)));
    return { generated: vs.length };
  }

  /**
   * Identify a scanned code. Records scan history. NEVER changes stock: the
   * client must follow up with an explicit POST /admin/inventory/movements
   * (carrying scanId) for receive/adjust/return operations.
   */
  @RequirePermissions('inventory:read') @Post('scans') @HttpCode(200)
  async scan(@CurrentUser() u: AuthUser, @Body(new ZodPipe(scanLookupSchema)) body: z.infer<typeof scanLookupSchema>): Promise<ScanResultDto> {
    const r = await this.barcodes.resolve(body.code);
    let orderId: string | null = null;
    if (body.mode === 'DISPATCH') {
      if (!body.orderId) throw badRequest('Select the order you are packing');
      const o = await this.prisma.order.findFirst({ where: { OR: [{ id: body.orderId }, { number: body.orderId }] } });
      if (!o) throw notFound('Order');
      orderId = o.id;
    }
    const scan = await this.prisma.scanEvent.create({ data: { code: r.code, mode: body.mode, device: body.device, variantId: r.variantId, orderId, found: !!r.variantId, actorId: u.id } });
    if (!r.variantId) return { scanId: scan.id, found: false, code: r.code, symbology: r.symbology, variant: null };
    const v = await this.prisma.productVariant.findUniqueOrThrow({ where: { id: r.variantId }, include: { inventory: true, product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } } });
    const result: ScanResultDto = {
      scanId: scan.id, found: true, code: r.code, symbology: r.symbology,
      variant: {
        id: v.id, sku: v.sku, color: v.color, size: v.size, price: decToNum(v.price), mrp: decToNum(v.mrp), productId: v.productId, productName: v.product.name,
        imageUrl: v.product.images[0]?.thumbUrl ?? null, onHand: v.inventory?.onHand ?? 0, reserved: v.inventory?.reserved ?? 0,
        available: (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0),
      },
    };
    if (orderId) {
      const item = await this.prisma.orderItem.aggregate({ where: { orderId, variantId: v.id }, _sum: { quantity: true } });
      const scanned = await this.prisma.scanEvent.count({ where: { orderId, variantId: v.id, mode: 'DISPATCH', found: true } });
      result.dispatch = { orderId, matches: (item._sum.quantity ?? 0) > 0, expected: item._sum.quantity ?? 0, scanned };
    }
    return result;
  }

  @RequirePermissions('inventory:read') @Get('scans')
  async history(@Query(new ZodPipe(paginationSchema)) q: { page: number; pageSize: number }) {
    const [rows, total] = await Promise.all([
      this.prisma.scanEvent.findMany({ include: { variant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } }, actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.scanEvent.count(),
    ]);
    return paginated(rows.map((s) => ({ id: s.id, code: s.code, mode: s.mode, device: s.device, found: s.found, orderId: s.orderId, sku: s.variant?.sku ?? null, productName: s.variant?.product.name ?? null, color: s.variant?.color ?? null, size: s.variant?.size ?? null, actorName: s.actor.name, createdAt: s.createdAt.toISOString() })), total, q.page, q.pageSize);
  }

  // -------- suppliers
  @RequirePermissions('inventory:read') @Get('suppliers')
  suppliers() {
    return this.prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  @RequirePermissions('inventory:write') @Post('suppliers')
  createSupplier(@Body(new ZodPipe(supplierSchema)) body: z.infer<typeof supplierSchema>) {
    return this.prisma.supplier.create({ data: body });
  }

  @RequirePermissions('inventory:write') @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body(new ZodPipe(supplierSchema.partial())) body: Partial<z.infer<typeof supplierSchema>>) {
    return this.prisma.supplier.update({ where: { id }, data: body });
  }

  @RequirePermissions('inventory:write') @Delete('suppliers/:id')
  async deleteSupplier(@Param('id') id: string) {
    await this.prisma.supplier.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  // -------- purchase orders
  @RequirePermissions('inventory:read') @Get('purchase-orders')
  async purchaseOrders(@Query(new ZodPipe(paginationSchema)) q: { page: number; pageSize: number }) {
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ include: { supplier: { select: { name: true } }, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.purchaseOrder.count(),
    ]);
    return paginated(rows.map((p) => ({ id: p.id, number: p.number, supplierName: p.supplier.name, status: p.status, reference: p.reference, totalCost: decToNum(p.totalCost), itemCount: p._count.items, orderedAt: p.orderedAt.toISOString(), receivedAt: p.receivedAt?.toISOString() ?? null })), total, q.page, q.pageSize);
  }

  @RequirePermissions('inventory:read') @Get('purchase-orders/:id')
  async purchaseOrder(@Param('id') id: string): Promise<PurchaseOrderDetailDto> {
    const p = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, items: { include: { variant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } } } } } });
    if (!p) throw notFound('Purchase order');
    return {
      id: p.id, number: p.number, status: p.status, reference: p.reference, notes: p.notes, totalCost: decToNum(p.totalCost), orderedAt: p.orderedAt.toISOString(), receivedAt: p.receivedAt?.toISOString() ?? null,
      supplier: { ...p.supplier, createdAt: p.supplier.createdAt.toISOString(), updatedAt: p.supplier.updatedAt.toISOString() },
      items: p.items.map((i) => ({ id: i.id, variantId: i.variantId, sku: i.variant.sku, productName: i.variant.product.name, color: i.variant.color, size: i.variant.size, quantity: i.quantity, receivedQuantity: i.receivedQuantity, unitCost: decToNum(i.unitCost) })) };
  }

  @RequirePermissions('inventory:write') @Post('purchase-orders')
  async createPo(@CurrentUser() u: AuthUser, @Body(new ZodPipe(purchaseOrderSchema)) body: z.infer<typeof purchaseOrderSchema>) {
    const count = await this.prisma.purchaseOrder.count();
    const total = body.items.reduce((s, i) => s + toPaise(i.unitCost) * i.quantity, 0);
    return this.prisma.purchaseOrder.create({
      data: {
        number: `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`, supplierId: body.supplierId, reference: body.reference, notes: body.notes,
        createdById: u.id, totalCost: paiseToDec(total), items: { create: body.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitCost: paiseToDec(toPaise(i.unitCost)) })) },
      },
    });
  }

  /** Receiving goods against a PO writes STOCK_IN ledger rows (one per line). */
  @RequirePermissions('inventory:write') @Post('purchase-orders/:id/receive') @HttpCode(200)
  async receive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ items: z.array(z.object({ itemId: z.string(), quantity: z.coerce.number().int().positive() })).min(1) }))) body: { items: { itemId: string; quantity: number }[] }) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!po) throw notFound('Purchase order');
      if (po.status === 'RECEIVED' || po.status === 'CANCELLED') throw badRequest(`Purchase order is ${po.status.toLowerCase()}`);
      for (const r of body.items) {
        const item = po.items.find((i) => i.id === r.itemId);
        if (!item) throw notFound('Purchase order line');
        if (item.receivedQuantity + r.quantity > item.quantity) throw badRequest(`Receiving more than ordered for line ${item.id}`);
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: r.quantity } } });
        await this.inventory.apply(tx, { variantId: item.variantId, type: 'STOCK_IN', onHandDelta: r.quantity, reservedDelta: 0, reason: `Received against ${po.number}`, reference: po.number, supplierId: po.supplierId, unitCost: decToNum(item.unitCost), actorId: u.id });
        await tx.productVariant.update({ where: { id: item.variantId }, data: { costPrice: item.unitCost } });
      }
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      const complete = items.every((i) => i.receivedQuantity >= i.quantity);
      return tx.purchaseOrder.update({ where: { id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', receivedAt: complete ? new Date() : null } });
    });
  }
}
