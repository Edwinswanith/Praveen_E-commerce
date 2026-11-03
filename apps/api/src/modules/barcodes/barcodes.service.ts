import { Inject, Injectable } from '@nestjs/common';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { buildEan13, isValidEan13, normalizeScan, skuFromTagPayload, type BarcodeSymbology } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { badRequest, notFound } from '../../common/http/errors';
import { decToNum } from '../../common/money';
import { formatINR } from '@vyra/shared';

export const QR_PREFIX = 'VYRA:';

@Injectable()
export class BarcodesService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  /** Atomically reserves `count` sequence numbers for the configured EAN prefix. */
  private async allocate(tx: Tx, count: number): Promise<number> {
    const prefix = this.env.BARCODE_EAN_PREFIX;
    const rows = await tx.$queryRaw<{ next: number }[]>`
      INSERT INTO barcode_sequences (prefix, next) VALUES (${prefix}, ${count + 1})
      ON CONFLICT (prefix) DO UPDATE SET next = barcode_sequences.next + ${count}
      RETURNING next`;
    return rows[0]!.next - count; // first allocated number
  }

  /**
   * Issues an internal EAN-13 (primary, printed on tags) and a CODE128 that
   * encodes the SKU for every variant lacking them. Idempotent.
   */
  async ensureForVariants(tx: Tx, variantIds: string[]) {
    if (!variantIds.length) return;
    const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds } }, include: { barcodes: true }, orderBy: { createdAt: 'asc' } });
    const needEan = variants.filter((v) => !v.barcodes.some((b) => b.symbology === 'EAN13'));
    let seq = needEan.length ? await this.allocate(tx, needEan.length) : 0;
    for (const v of needEan) {
      await tx.barcode.create({ data: { variantId: v.id, symbology: 'EAN13', value: buildEan13(this.env.BARCODE_EAN_PREFIX, seq++), isPrimary: true } });
    }
    for (const v of variants.filter((x) => !x.barcodes.some((b) => b.symbology === 'CODE128'))) {
      await tx.barcode.create({ data: { variantId: v.id, symbology: 'CODE128', value: v.sku, isPrimary: false } });
    }
  }

  /** Resolve scanned input (EAN-13, Code128 SKU, or VYRA: QR) to a variant. */
  async resolve(raw: string) {
    let code = normalizeScan(raw);
    // QR tags carry a customer link (…/s/<SKU>); older labels carry "VYRA:<SKU>".
    const tagSku = skuFromTagPayload(code);
    if (tagSku) code = tagSku;
    const barcode = await this.prisma.barcode.findUnique({ where: { value: code } });
    const symbology: BarcodeSymbology | null = barcode?.symbology ?? (isValidEan13(code) ? 'EAN13' : null);
    const variantId = barcode?.variantId ?? (await this.prisma.productVariant.findUnique({ where: { sku: code.toUpperCase() } }))?.id;
    return { code, symbology: variantId && !barcode ? ('CODE128' as const) : symbology, variantId: variantId ?? null };
  }

  /** Public link printed in QR tags: opens the product page with this colour/size selected. */
  tagUrl(sku: string) {
    return `${this.env.STOREFRONT_URL.replace(/\/$/, '')}/s/${encodeURIComponent(sku)}`;
  }

  async png(variantId: string, symbology: BarcodeSymbology): Promise<Buffer> {
    const v = await this.prisma.productVariant.findUnique({ where: { id: variantId }, include: { barcodes: true } });
    if (!v) throw notFound('Variant');
    return this.render(symbology, this.valueFor(v, symbology), { scale: 3, height: 14, text: true });
  }

  private valueFor(v: { sku: string; barcodes: { symbology: string; value: string }[] }, symbology: BarcodeSymbology) {
    if (symbology === 'QR') return this.tagUrl(v.sku);
    const b = v.barcodes.find((x) => x.symbology === symbology);
    if (!b) throw badRequest(`Variant ${v.sku} has no ${symbology} barcode yet`);
    return b.value;
  }

  render(symbology: BarcodeSymbology, value: string, o: { scale: number; height: number; text: boolean }): Promise<Buffer> {
    const bcid = symbology === 'EAN13' ? 'ean13' : symbology === 'CODE128' ? 'code128' : 'qrcode';
    return bwipjs.toBuffer({
      bcid, text: value, scale: o.scale, includetext: o.text && symbology !== 'QR', textxalign: 'center',
      // Quiet zone: scanners need a white margin (EAN-13 ≥ 11 modules left / 7 right). Without it
      // a standalone PNG printed edge-to-edge will not scan.
      paddingwidth: symbology === 'QR' ? 4 : 12, paddingheight: symbology === 'QR' ? 4 : 2, backgroundcolor: 'FFFFFF',
      ...(symbology === 'QR' ? { eclevel: 'M' } : { height: o.height }),
      ...(symbology === 'EAN13' ? { guardwhitespace: true } : {}),
    } as Parameters<typeof bwipjs.toBuffer>[0]);
  }

  /** Printable label sheet. A4_3x8 = 24 labels/page (63.5×33.9mm); THERMAL_50x25 = one label per page. */
  async labelsPdf(items: { variantId: string; copies: number }[], format: 'A4_3x8' | 'THERMAL_50x25', symbology: BarcodeSymbology): Promise<Buffer> {
    const total = items.reduce((s, i) => s + i.copies, 0);
    if (total > 2000) throw badRequest('Print at most 2000 labels per batch');
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: items.map((i) => i.variantId) } }, include: { barcodes: true, product: { select: { name: true, brand: true } } },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const missing = items.filter((i) => !byId.has(i.variantId));
    if (missing.length) throw notFound(`Variant ${missing[0]!.variantId}`);

    const mm = (n: number) => (n * 72) / 25.4;
    const thermal = format === 'THERMAL_50x25';
    const doc = new PDFDocument({ size: thermal ? [mm(50), mm(25)] : 'A4', margin: 0, autoFirstPage: false, info: { Title: 'VYRA barcode labels' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const cols = 3, rows = 8, lw = mm(63.5), lh = mm(33.9), left = mm(7.2), top = mm(13.1), gap = mm(2.5);
    let slot = 0;
    const imgCache = new Map<string, Buffer>();
    for (const item of items) {
      const v = byId.get(item.variantId)!;
      const value = this.valueFor(v, symbology);
      if (!imgCache.has(v.id)) imgCache.set(v.id, await this.render(symbology, value, { scale: 4, height: 10, text: true }));
      const png = imgCache.get(v.id)!;
      for (let c = 0; c < item.copies; c++) {
        let x: number, y: number, w: number, h: number;
        if (thermal) {
          doc.addPage();
          x = mm(2); y = mm(1.5); w = mm(46); h = mm(22);
        } else {
          if (slot % (cols * rows) === 0) doc.addPage();
          const i = slot % (cols * rows);
          x = left + (i % cols) * (lw + gap); y = top + Math.floor(i / cols) * lh; w = lw - mm(4); h = lh - mm(3);
          x += mm(2); y += mm(1.5);
        }
        doc.font('Helvetica-Bold').fontSize(thermal ? 6.5 : 7.5).fillColor('#171717')
          .text(`${v.product.brand} · ${v.product.name}`.slice(0, 48), x, y, { width: w, lineBreak: false, ellipsis: true });
        doc.font('Helvetica').fontSize(thermal ? 6 : 7)
          // Legal Metrology (Packaged Commodities) Rules: retail labels must show MRP inclusive of all taxes.
          .text(`${v.color} / ${v.size}   MRP ${formatINR(decToNum(v.mrp)).replace('₹', 'Rs.')} (incl. of all taxes)`, x, y + (thermal ? 8 : 10), { width: w, lineBreak: false, ellipsis: true });
        const imgTop = y + (thermal ? 16 : 20);
        const imgH = h - (thermal ? 16 : 20);
        doc.image(png, symbology === 'QR' ? x + (w - imgH) / 2 : x, imgTop, symbology === 'QR' ? { fit: [imgH, imgH] } : { fit: [w, imgH], align: 'center' });
        slot++;
      }
    }
    doc.end();
    return done;
  }
}
