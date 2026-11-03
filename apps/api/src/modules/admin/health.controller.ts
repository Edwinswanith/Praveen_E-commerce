import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { MailService } from '../../common/mail/mail.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Public, StaffOnly } from '../auth/auth.decorators';
import type { HealthDto, PublicHealthDto } from '@vyra/shared';
import { PaymentsGateway } from '../payments/payments.gateway';
import { ShippingService } from '../shipping/shipping.service';
import { EmbeddingService } from '../ai/embedding.service';
import { MessagingService } from '../../common/messaging/messaging.service';

async function probe(prisma: PrismaService, queue: QueueService) {
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  return { db, redis: await queue.ping() };
}

@ApiTags('platform')
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService, private readonly queue: QueueService,
  ) {}

  /** Public liveness/readiness for load balancers and uptime checks: no version or configuration details. */
  @Get('health')
  async health(): Promise<PublicHealthDto> {
    const { db, redis } = await probe(this.prisma, this.queue);
    return { status: db ? 'ok' : 'degraded', db, redis };
  }
}

/** Staff-only: version and per-integration configuration ("pending" = credentials not configured). */
@ApiTags('admin:system')
@StaffOnly()
@Controller('admin')
export class SystemHealthController {
  constructor(
    @Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly queue: QueueService, private readonly mail: MailService,
    private readonly payments: PaymentsGateway, private readonly shipping: ShippingService, private readonly embeddings: EmbeddingService,
    private readonly messaging: MessagingService,
  ) {}

  /** Liveness + honest integration status ("pending" = credentials not configured). */
  @Get('system/health')
  async health(): Promise<HealthDto> {
    const { db, redis } = await probe(this.prisma, this.queue);
    const s = (ok: boolean) => (ok ? 'configured' : 'pending');
    return {
      status: db ? ('ok' as const) : ('degraded' as const), db, redis, version: this.env.APP_VERSION,
      integrations: {
        payments: this.payments.provider ? `${this.payments.provider.name}${this.payments.provider.name === 'mock' ? ' (test mode)' : ''}` : 'pending',
        cod: this.env.COD_ENABLED, shipping: this.env.SHIPPING_PROVIDER === 'shiprocket' ? s(this.shipping.shiprocket.configured) : 'manual',
        email: s(this.mail.configured), sms: s(this.messaging.smsConfigured), whatsapp: s(this.messaging.whatsappConfigured), embeddings: `${this.embeddings.provider.textModel}${this.embeddings.provider.configured ? '' : ' (pending)'}`, storage: this.env.STORAGE_DRIVER,
      },
    };
  }
}
