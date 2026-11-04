import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { productSchema, type ProductInput } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { badRequest } from '../../common/http/errors';
import { InventoryService } from '../inventory/inventory.service';
import { ProductsService, slugify } from './products.service';

export const IMPORT_COLUMNS = [
  'product_slug', 'name', 'description', 'brand', 'gender', 'category_slug', 'status', 'tags', 'fabric', 'fit', 'occasion',
  'pattern', 'sleeve', 'neck', 'care', 'hsn_code', 'color', 'color_hex', 'size', 'mrp', 'price', 'cost_price', 'weight_grams', 'initial_stock',
] as const;

type Row = Record<(typeof IMPORT_COLUMNS)[number], string>;

/**
 * Bulk import: one row per variant, grouped into products by product_slug
 * (or slugified name). Existing products (same slug) are updated; new variants
 * appended. Validation uses the same zod schema as the admin form. initial_stock
 * is recorded as a STOCK_IN ledger movement for NEW variants only.
 */
@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService, private readonly products: ProductsService, private readonly inventory: InventoryService) {}

  template() {
    const example = ['oversized-cotton-tee', 'Oversized Cotton Tee', '240 GSM combed cotton, drop shoulders, relaxed fit.', 'VYRA', 'MEN', 'men-tshirts', 'DRAFT', 'oversized|streetwear', '100% Cotton', 'Oversized', 'Casual', 'Solid', 'Short sleeve', 'Round neck', 'Machine wash cold', '6109', 'Black', '#111111', 'M', '1299', '799', '320', '260', '20'];
    // RFC 4180: quote fields containing commas, quotes or newlines (the example description has commas).
    const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return `${IMPORT_COLUMNS.join(',')}\n${example.map(cell).join(',')}\n`;
  }

  async parseFile(buf: Buffer, filename: string): Promise<Row[]> {
    if (buf.length > 5 * 1024 * 1024) throw badRequest('Import files must be 5 MB or smaller');
    let records: Record<string, unknown>[];
    if (/\.xlsx$/i.test(filename)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) throw badRequest('Workbook has no sheets');
      const header = (ws.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? '').trim().toLowerCase());
      records = [];
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const vals = (row.values as unknown[]).slice(1);
        records.push(Object.fromEntries(header.map((h, j) => [h, vals[j] instanceof Object && 'text' in (vals[j] as object) ? (vals[j] as { text: string }).text : vals[j]])));
      });
    } else if (/\.csv$/i.test(filename)) {
      records = parse(buf, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
    } else throw badRequest('Upload a .csv or .xlsx file');
    if (records.length > 5000) throw badRequest('At most 5000 rows per import');
    return records.map((r) => Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, r[c] == null ? '' : String(r[c]).trim()])) as Row);
  }

  async run(buf: Buffer, filename: string, dryRun: boolean, actorId: string) {
    const rows = await this.parseFile(buf, filename);
    const errors: { row: number; message: string }[] = [];
    const groups = new Map<string, { rows: { row: Row; line: number }[] }>();
    rows.forEach((row, i) => {
      const key = row.product_slug || slugify(row.name);
      if (!key) return errors.push({ row: i + 2, message: 'product_slug or name is required' });
      (groups.get(key) ?? groups.set(key, { rows: [] }).get(key)!).rows.push({ row, line: i + 2 });
    });
    const categories = new Map((await this.prisma.category.findMany({ where: { deletedAt: null } })).map((c) => [c.slug, c.id]));

    const plans: { slug: string; input: ProductInput; existingId: string | null; stock: Map<string, number> }[] = [];
    for (const [slug, g] of groups) {
      const first = g.rows[0]!.row;
      const categoryId = categories.get(first.category_slug);
      if (!categoryId) { errors.push({ row: g.rows[0]!.line, message: `Unknown category_slug "${first.category_slug}"` }); continue; }
      const stock = new Map<string, number>();
      const candidate = {
        name: first.name, slug, description: first.description, brand: first.brand || 'VYRA', gender: first.gender.toUpperCase(), categoryId,
        status: (first.status || 'DRAFT').toUpperCase(), tags: first.tags ? first.tags.split('|') : [], hsnCode: first.hsn_code || '6109',
        attributes: Object.fromEntries((['fabric', 'fit', 'occasion', 'pattern', 'sleeve', 'neck', 'care'] as const).filter((k) => first[k]).map((k) => [k, first[k]])),
        variants: g.rows.map(({ row }) => {
          const n = Number(row.initial_stock || 0);
          if (n) stock.set(`${row.color.toLowerCase()}|${row.size.toUpperCase()}`, n);
          return { color: row.color, colorHex: row.color_hex || null, size: row.size, mrp: row.mrp, price: row.price, costPrice: row.cost_price || null, weightGrams: row.weight_grams || 300 };
        }),
      };
      const parsed = productSchema.safeParse(candidate);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        errors.push({ row: g.rows[0]!.line, message: `${slug}: ${issue.path.join('.')} ${issue.message}` });
        continue;
      }
      const existing = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
      plans.push({ slug, input: parsed.data, existingId: existing?.id ?? null, stock });
    }

    if (dryRun || errors.length) {
      return { dryRun: true, created: plans.filter((p) => !p.existingId).length, updated: plans.filter((p) => p.existingId).length, errors };
    }
    let created = 0, updated = 0;
    for (const plan of plans) {
      let before = new Set<string>();
      let detail;
      if (plan.existingId) {
        const cur = await this.prisma.productVariant.findMany({ where: { productId: plan.existingId }, select: { id: true, color: true, size: true, isActive: true } });
        before = new Set(cur.map((v) => v.id));
        // Merge: keep existing active variants not mentioned in the file.
        const mentioned = new Set(plan.input.variants.map((v) => `${v.color.toLowerCase()}|${v.size.toUpperCase()}`));
        const keepIds = cur.filter((v) => v.isActive && !mentioned.has(`${v.color.toLowerCase()}|${v.size}`)).map((v) => v.id);
        const keepRows = await this.prisma.productVariant.findMany({ where: { id: { in: keepIds } } });
        const variants = [...plan.input.variants, ...keepRows.map((v) => ({ id: v.id, color: v.color, colorHex: v.colorHex, size: v.size, mrp: Number(v.mrp), price: Number(v.price), costPrice: v.costPrice ? Number(v.costPrice) : null, weightGrams: v.weightGrams, lowStockThreshold: v.lowStockThreshold, isActive: true }))];
        detail = await this.products.update(plan.existingId, { ...plan.input, variants });
        updated++;
      } else {
        detail = await this.products.create(plan.input, actorId);
        created++;
      }
      for (const v of detail.variants) {
        const qty = plan.stock.get(`${v.color.toLowerCase()}|${v.size}`);
        if (qty && qty > 0 && !before.has(v.id)) {
          await this.inventory.recordManual({ variantId: v.id, type: 'STOCK_IN', quantity: qty, reason: `Bulk import ${filename}`, reference: 'IMPORT' }, actorId);
        }
      }
    }
    return { dryRun: false, created, updated, errors };
  }
}
