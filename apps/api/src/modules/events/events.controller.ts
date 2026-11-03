import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { analyticsEventsSchema } from '@vyra/shared';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, OptionalAuth, Public, type AuthUser } from '../auth/auth.decorators';
import { EventsService } from './events.service';

@ApiTags('analytics')
@Public()
@OptionalAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** Browser-reported funnel events (PRODUCT_VIEW, CHECKOUT_STARTED, QUICK_VIEW only). */
  @Throttle({ default: { limit: 60, ttl: 60_000 } }) @HttpCode(202) @Post()
  async ingest(@Req() req: Request, @Body(new ZodPipe(analyticsEventsSchema)) b: z.infer<typeof analyticsEventsSchema>, @CurrentUser() u?: AuthUser) {
    const ua = req.header('user-agent') ?? '';
    if (/bot|crawl|spider|headless/i.test(ua)) return { accepted: 0 };
    const accepted = await this.events.recordMany({ sessionId: b.sessionId, userId: u?.id ?? null, device: b.device ?? null, source: b.source || null }, b.events);
    return { accepted };
  }
}
