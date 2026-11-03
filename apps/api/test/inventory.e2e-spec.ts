import type { INestApplication } from '@nestjs/common';
import { isValidEan13 } from '@vyra/shared';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { InventoryService, InsufficientStockError } from '../src/modules/inventory/inventory.service';
import { bootApp, createCategory, createStaff, H, productInput } from './helpers';

describe('Catalog, barcodes and inventory (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inv: Awaited<ReturnType<typeof createStaff>>;
  let product: { id: string; variants: { id: string; sku: string; barcode: string | null; barcodes: { symbology: string; value: string }[] }[] };

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    inv = await createStaff(app, 'INVENTORY_MANAGER');
    const cat = await createCategory(prisma);
    const res = await inv.post('/api/v1/admin/products').set(H).send(productInput(cat.id)).expect(201);
    product = res.body.data;
  });
  afterAll(() => app.close());

  it('generates a unique SKU, valid EAN-13 and Code128 per variant', () => {
    expect(product.variants).toHaveLength(3);
    const skus = product.variants.map((v) => v.sku);
    expect(new Set(skus).size).toBe(3);
    expect(skus).toContain('VY-TSH-00001-BLK-M');
    for (const v of product.variants) {
      expect(isValidEan13(v.barcode!)).toBe(true);
      expect(v.barcode!.startsWith('20')).toBe(true);
      expect(v.barcodes.find((b) => b.symbology === 'CODE128')?.value).toBe(v.sku);
    }
    expect(new Set(product.variants.map((v) => v.barcode)).size).toBe(3);
  });

  it('rejects duplicate size/colour combinations and price above MRP', async () => {
    const cat = await prisma.category.findFirstOrThrow();
    const dup = productInput(cat.id);
    dup.variants = [dup.variants[0]!, { ...dup.variants[0]! }];
    await inv.post('/api/v1/admin/products').set(H).send(dup).expect(400);
    const bad = productInput(cat.id);
    bad.variants = [{ ...bad.variants[0]!, price: 2000 }];
    const r = await inv.post('/api/v1/admin/products').set(H).send(bad).expect(422);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('identifies a variant from EAN-13, SKU or QR payload without touching stock', async () => {
    const v = product.variants[0]!;
    for (const code of [v.barcode!, v.sku, `VYRA:${v.sku}`, `]E0${v.barcode}`]) {
      const r = await inv.post('/api/v1/admin/scans').set(H).send({ code, mode: 'RECEIVE', device: 'USB' }).expect(200);
      expect(r.body.data.found).toBe(true);
      expect(r.body.data.variant.id).toBe(v.id);
    }
    const miss = await inv.post('/api/v1/admin/scans').set(H).send({ code: '9999999999999', mode: 'IDENTIFY' }).expect(200);
    expect(miss.body.data.found).toBe(false);
    const stock = await prisma.inventory.findUniqueOrThrow({ where: { variantId: v.id } });
    expect(stock.onHand).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(0);
  });

  it('records explicit stock operations in the ledger and blocks negative stock', async () => {
    const v = product.variants[0]!;
    await inv.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_IN', quantity: 10, reason: 'Received PO' }).expect(201);
    await inv.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'ADJUSTMENT', quantity: -3, reason: 'Damaged in store' }).expect(201);
    const over = await inv.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_OUT', quantity: 50, reason: 'Oops' }).expect(409);
    expect(over.body.error.code).toBe('OUT_OF_STOCK');
    await inv.post('/api/v1/admin/inventory/movements').set(H).send({ variantId: v.id, type: 'STOCK_IN', quantity: 1 }).expect(422); // reason required
    const ledger = await inv.get(`/api/v1/admin/inventory/movements?variantId=${v.id}`).expect(200);
    expect(ledger.body.data.map((m: { quantity: number }) => m.quantity)).toEqual([-3, 10]);
    expect(ledger.body.data[0].onHandAfter).toBe(7);
  });

  it('keeps the ledger append-only at the database level', async () => {
    await expect(prisma.inventoryMovement.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('never oversells under concurrent reservations', async () => {
    const v = product.variants[1]!;
    const svc = app.get(InventoryService);
    await prisma.$transaction((tx) => svc.apply(tx, { variantId: v.id, type: 'STOCK_IN', onHandDelta: 5, reservedDelta: 0, reason: 'test' }));
    const attempts = await Promise.allSettled(Array.from({ length: 25 }, (_, i) =>
      prisma.$transaction((tx) => svc.apply(tx, { variantId: v.id, type: 'RESERVATION', onHandDelta: 0, reservedDelta: 1, orderId: `o${i}`, reason: 'race' }), { maxWait: 20_000, timeout: 20_000 }),
    ));
    const ok = attempts.filter((a) => a.status === 'fulfilled').length;
    const failed = attempts.filter((a) => a.status === 'rejected');
    expect(ok).toBe(5);
    expect(failed.every((f) => (f as PromiseRejectedResult).reason instanceof InsufficientStockError)).toBe(true);
    const stock = await prisma.inventory.findUniqueOrThrow({ where: { variantId: v.id } });
    expect(stock).toMatchObject({ onHand: 5, reserved: 5 });
    expect(await prisma.inventoryMovement.count({ where: { variantId: v.id, type: 'RESERVATION' } })).toBe(5);
  });

  it('produces barcode PNGs and a label PDF', async () => {
    const v = product.variants[0]!;
    const png = await inv.get(`/api/v1/admin/barcodes/${v.id}.png?symbology=EAN13`).buffer(true).expect(200);
    expect(png.headers['content-type']).toContain('image/png');
    const pdf = await inv.post('/api/v1/admin/barcodes/labels').set(H).send({ items: [{ variantId: v.id, copies: 30 }], format: 'A4_3x8', symbology: 'CODE128' }).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('deactivates (never deletes) variants omitted on update', async () => {
    const cat = await prisma.category.findFirstOrThrow();
    const input = productInput(cat.id);
    const keep = product.variants.slice(0, 2).map((v, i) => ({ ...input.variants[i]!, id: v.id }));
    const r = await inv.patch(`/api/v1/admin/products/${product.id}`).set(H).send({ variants: keep }).expect(200);
    const all = await prisma.productVariant.findMany({ where: { productId: product.id } });
    expect(all).toHaveLength(3);
    expect(all.filter((v) => !v.isActive)).toHaveLength(1);
    expect(r.body.data.variants.filter((v: { isActive: boolean }) => v.isActive)).toHaveLength(2);
  });
});

describe('Ledger reconciliation (integration)', () => {
  it('reports consistency and detects stock edited outside the ledger', async () => {
    const { bootApp: boot, createStaff: staff } = await import('./helpers');
    const { app, prisma } = await boot();
    try {
      const inv = await staff(app, 'INVENTORY_MANAGER');
      const cat = await prisma.category.create({ data: { name: 'x', slug: 'x', code: 'XXX' } });
      const { productInput } = await import('./helpers');
      const p = (await inv.post('/api/v1/admin/products').set({ 'X-Requested-With': 'vyra' }).send(productInput(cat.id)).expect(201)).body.data;
      await inv.post('/api/v1/admin/inventory/movements').set({ 'X-Requested-With': 'vyra' }).send({ variantId: p.variants[0].id, type: 'STOCK_IN', quantity: 4, reason: 'test' }).expect(201);
      expect((await inv.get('/api/v1/admin/inventory/reconcile').expect(200)).body.data).toMatchObject({ consistent: true, checkedVariants: 3 });
      await prisma.$executeRaw`UPDATE inventory SET "onHand" = 99 WHERE "variantId" = ${p.variants[0].id}`; // simulate a rogue edit
      const r = (await inv.get('/api/v1/admin/inventory/reconcile').expect(200)).body.data;
      expect(r.consistent).toBe(false);
      expect(r.drift[0]).toMatchObject({ onHand: 99, ledgerOnHand: 4 });
    } finally {
      await app.close();
    }
  });
});
