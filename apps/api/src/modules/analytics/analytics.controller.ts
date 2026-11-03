import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { RequirePermissions, StaffOnly } from '../auth/auth.decorators';
import { AnalyticsService } from './analytics.service';

const range = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 86400_000)),
  to: z.coerce.date().default(() => new Date()),
}).refine((r) => r.from < r.to && r.to.getTime() - r.from.getTime() <= 3 * 366 * 86400_000, { message: 'Invalid date range (max 3 years)' });
type Range = z.infer<typeof range>;
const salesQ = range.and(z.object({ granularity: z.enum(['day', 'week', 'month']).default('day') }));

@ApiTags('admin:analytics')
@StaffOnly()
@RequirePermissions('analytics:read')
@Controller('admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  dashboard() {
    return this.analytics.dashboard();
  }

  @Get('analytics/sales')
  sales(@Query(new ZodPipe(salesQ)) q: Range & { granularity: 'day' | 'week' | 'month' }) {
    return this.analytics.sales(q.from, q.to, q.granularity);
  }

  @Get('analytics/products')
  products(@Query(new ZodPipe(range)) q: Range) {
    return this.analytics.productPerformance(q.from, q.to);
  }

  @Get('analytics/inventory')
  inventory() {
    return this.analytics.inventoryReport();
  }

  @Get('analytics/cancellations')
  cancellations(@Query(new ZodPipe(range)) q: Range) {
    return this.analytics.cancellations(q.from, q.to);
  }

  @Get('analytics/cod')
  cod(@Query(new ZodPipe(range)) q: Range) {
    return this.analytics.cod(q.from, q.to);
  }

  @Get('analytics/return-rates')
  returnRates(@Query(new ZodPipe(range)) q: Range) {
    return this.analytics.returnRates(q.from, q.to);
  }

  @Get('analytics/returns')
  returns(@Query(new ZodPipe(range)) q: Range) {
    return this.analytics.returns(q.from, q.to);
  }

  @Get('analytics/export')
  async export(@Query(new ZodPipe(range.and(z.object({ report: z.enum(['sales', 'products', 'inventory']), format: z.enum(['csv', 'xlsx']).default('csv') })))) q: Range & { report: 'sales' | 'products' | 'inventory'; format: 'csv' | 'xlsx' }, @Res({ passthrough: true }) res: Response) {
    let rows: Record<string, unknown>[];
    if (q.report === 'sales') rows = (await this.analytics.sales(q.from, q.to, 'day')).series;
    else if (q.report === 'products') rows = (await this.analytics.productPerformance(q.from, q.to, 10_000)).map(({ imageUrl: _i, ...r }) => r);
    else rows = (await this.analytics.inventoryReport()).byCategory;
    const cols = rows[0] ? Object.keys(rows[0]) : ['empty'];
    const name = `vyra-${q.report}-${q.from.toISOString().slice(0, 10)}_${q.to.toISOString().slice(0, 10)}`;
    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(q.report);
      ws.columns = cols.map((c) => ({ header: c, key: c, width: 18 }));
      rows.forEach((r) => ws.addRow(r));
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition', `attachment; filename="${name}.xlsx"`);
      return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}.csv"`);
    return new StreamableFile(Buffer.from([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')));
  }
}
