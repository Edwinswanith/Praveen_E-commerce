import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/http/errors';
import { decToNum } from '../../common/money';

const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * GST tax invoice. Intra-state supply → CGST + SGST (half each); inter-state → IGST.
 * Prices are GST-inclusive; taxable value = line total − tax.
 */
@Injectable()
export class InvoiceService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  async pdf(orderId: string): Promise<Buffer> {
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!o) throw notFound('Order');
    const addr = o.shippingAddress as Record<string, string>;
    const intra = addr.state?.toLowerCase() === this.env.SELLER_STATE.toLowerCase();
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${o.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#FF3F6C').text('VYRA', 40, 40);
    doc.font('Helvetica').fontSize(8).fillColor('#737373').text('WEAR YOUR VIBE.', 40, 63);
    doc.fillColor('#171717').font('Helvetica-Bold').fontSize(14).text('TAX INVOICE', 380, 40, { align: 'right', width: 175 });
    doc.font('Helvetica').fontSize(9)
      .text(`Invoice No: INV-${o.number}`, 380, 60, { align: 'right', width: 175 })
      .text(`Order No: ${o.number}`, { align: 'right', width: 175 })
      .text(`Date: ${o.createdAt.toLocaleDateString('en-IN')}`, { align: 'right', width: 175 })
      .text(`Payment: ${o.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Prepaid'}`, { align: 'right', width: 175 });

    doc.font('Helvetica-Bold').fontSize(9).text('Sold by', 40, 110);
    doc.font('Helvetica').text(this.env.SELLER_NAME).text(this.env.SELLER_ADDRESS).text(`GSTIN: ${this.env.SELLER_GSTIN ?? 'PENDING CONFIGURATION'}`).text(`State: ${this.env.SELLER_STATE}`);
    doc.font('Helvetica-Bold').text('Ship to / Bill to', 320, 110);
    doc.font('Helvetica').text(addr.fullName ?? '', 320).text([addr.line1, addr.line2].filter(Boolean).join(', '), 320, undefined, { width: 235 }).text(`${addr.city}, ${addr.state} - ${addr.pincode}`, 320).text(`Phone: ${addr.phone}`, 320);

    let y = 200;
    const cols = [40, 210, 250, 285, 345, 395, 455];
    const head = ['Item', 'HSN', 'Qty', 'Taxable', 'GST %', intra ? 'CGST+SGST' : 'IGST', 'Total'];
    doc.rect(40, y - 4, 515, 18).fill('#F8F8FA').fillColor('#171717').font('Helvetica-Bold').fontSize(8);
    head.forEach((h, i) => doc.text(h, cols[i]!, y, { width: (cols[i + 1] ?? 555) - cols[i]! - 4, align: i === 0 ? 'left' : 'right' }));
    y += 20;
    doc.font('Helvetica').fontSize(8);
    let taxable = 0, tax = 0;
    for (const it of o.items) {
      const total = decToNum(it.lineTotal), t = decToNum(it.taxAmount), base = Math.round((total - t) * 100) / 100;
      taxable += base; tax += t;
      const row = [`${it.productName} (${it.color}/${it.size})\nSKU ${it.sku}`, it.hsnCode, String(it.quantity), rs(base), `${Number(it.taxRate)}%`, intra ? `${rs(t / 2)} + ${rs(t / 2)}` : rs(t), rs(total)];
      row.forEach((c, i) => doc.text(c, cols[i]!, y, { width: (cols[i + 1] ?? 555) - cols[i]! - 4, align: i === 0 ? 'left' : 'right' }));
      y += 30;
      if (y > 720) { doc.addPage(); y = 50; }
    }
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#EAEAEA').stroke();
    y += 10;
    const summary: [string, number][] = [['Taxable value', taxable], [intra ? 'CGST' : 'IGST', intra ? tax / 2 : tax], ...(intra ? [['SGST', tax / 2] as [string, number]] : []), ['Shipping', decToNum(o.shippingFee)], ['COD fee', decToNum(o.codFee)], ['Grand total', decToNum(o.grandTotal)]];
    for (const [k, v] of summary) {
      if (!v && k !== 'Grand total') continue;
      doc.font(k === 'Grand total' ? 'Helvetica-Bold' : 'Helvetica').text(k, 340, y, { width: 110, align: 'right' }).text(rs(Math.round(v * 100) / 100), 455, y, { width: 100, align: 'right' });
      y += 14;
    }
    doc.font('Helvetica').fontSize(7).fillColor('#737373').text('This is a computer-generated invoice. Prices are inclusive of GST.', 40, 780, { align: 'center', width: 515 });
    doc.end();
    return done;
  }
}
