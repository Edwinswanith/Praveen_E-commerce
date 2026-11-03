import { Body, Controller, Get, HttpCode, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { newsletterSubscribeSchema, newsletterTokenSchema, paginationSchema } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { Public, RequirePermissions, StaffOnly } from '../auth/auth.decorators';
import { NewsletterService, toSubscriberDto } from './newsletter.service';

@ApiTags('newsletter')
@Public()
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  /** Starts double opt-in (sends a confirmation email). Same response whatever the address's state. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post()
  subscribe(@Body(new ZodPipe(newsletterSubscribeSchema)) b: z.infer<typeof newsletterSubscribeSchema>) {
    return this.newsletter.subscribe(b.email, b.source);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('confirm')
  confirm(@Body(new ZodPipe(newsletterTokenSchema)) b: { token: string }) {
    return this.newsletter.confirm(b.token);
  }

  /** One-click unsubscribe from an email link (no sign-in). */
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('unsubscribe')
  unsubscribe(@Body(new ZodPipe(newsletterTokenSchema)) b: { token: string }) {
    return this.newsletter.unsubscribe(b.token);
  }
}

const listQ = paginationSchema.extend({ status: z.enum(['PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED']).optional() });

@ApiTags('admin:newsletter')
@StaffOnly()
@RequirePermissions('customers:read')
@Controller('admin/newsletter')
export class AdminNewsletterController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(listQ)) q: z.infer<typeof listQ>) {
    const where: Prisma.NewsletterSubscriberWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.q ? { email: { contains: q.q.toLowerCase() } } : {}) };
    const [rows, total, counts] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.newsletterSubscriber.count({ where }),
      this.prisma.newsletterSubscriber.groupBy({ by: ['status'], _count: true }),
    ]);
    return paginated(rows.map(toSubscriberDto), total, q.page, q.pageSize, { counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) });
  }

  /** CSV of confirmed subscribers only (never pending or unsubscribed addresses). */
  @Get('export')
  async export(@Res({ passthrough: true }) res: Response) {
    const rows = await this.prisma.newsletterSubscriber.findMany({ where: { status: 'SUBSCRIBED' }, orderBy: { confirmedAt: 'asc' } });
    // Neutralise spreadsheet formula injection ("=cmd@x.in" is a valid email address).
    const cell = (v: string) => { const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = ['email,confirmed_at,source', ...rows.map((r) => [r.email, r.confirmedAt?.toISOString() ?? '', r.source ?? ''].map(cell).join(','))].join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vyra-newsletter-subscribers.csv"');
    return new StreamableFile(Buffer.from(csv));
  }
}
