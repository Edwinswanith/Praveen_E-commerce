import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AnalyticsEventType } from '@prisma/client';
import type { Request } from 'express';
import { sessionIdSchema } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime/i;
const RETENTION_DAYS = 180;

export interface EventContext { sessionId: string; userId?: string | null; device?: string | null; source?: string | null }

/**
 * First-party funnel analytics. Browsers send a random session id in the
 * X-Vyra-Session header (no cookies, no PII). Revenue-bearing events
 * (ADD_TO_CART, ORDER_PLACED, TRY_ON, SEARCH) are recorded server-side so they
 * can't be faked. Recording never throws into a business flow.
 */
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger('Events');

  constructor(private readonly prisma: PrismaService, private readonly queue: QueueService) {}

  async onModuleInit() {
    this.queue.process('analytics', async () => this.purgeOld(), 1);
    await this.queue.repeat('analytics', 'purge-old-events', 24 * 3600_000).catch(() => undefined);
  }

  /** Context from request headers; null for bots or requests without a valid session id. */
  context(req: Request, userId?: string | null): EventContext | null {
    if (BOT.test(req.header('user-agent') ?? '')) return null;
    const sid = sessionIdSchema.safeParse(req.header('x-vyra-session'));
    if (!sid.success) return null;
    const device = req.header('x-vyra-device');
    const source = req.header('x-vyra-source')?.toLowerCase();
    return {
      sessionId: sid.data, userId: userId ?? null,
      device: device && ['mobile', 'tablet', 'desktop'].includes(device) ? device : null,
      source: source && /^[a-z0-9_.-]{1,40}$/.test(source) ? source : null,
    };
  }

  async record(type: AnalyticsEventType, ctx: EventContext | null, data: { productId?: string | null; orderId?: string | null; value?: number | null } = {}) {
    if (!ctx) return;
    try {
      await this.prisma.analyticsEvent.create({
        data: { type, sessionId: ctx.sessionId, userId: ctx.userId ?? null, device: ctx.device, source: ctx.source, productId: data.productId ?? null, orderId: data.orderId ?? null, value: data.value ?? null },
      });
    } catch (e) {
      this.logger.warn(`event ${type} not recorded: ${(e as Error).message}`);
    }
  }

  async recordMany(ctx: EventContext, events: { type: AnalyticsEventType; productId?: string }[]) {
    const ids = [...new Set(events.map((e) => e.productId).filter((x): x is string => !!x))];
    const known = new Set(ids.length ? (await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id) : []);
    const rows = events.filter((e) => !e.productId || known.has(e.productId)).map((e) => ({ type: e.type, sessionId: ctx.sessionId, userId: ctx.userId ?? null, device: ctx.device, source: ctx.source, productId: e.productId ?? null }));
    if (rows.length) await this.prisma.analyticsEvent.createMany({ data: rows });
    return rows.length;
  }

  async purgeOld() {
    const r = await this.prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86400_000) } } });
    return { purged: r.count };
  }
}
