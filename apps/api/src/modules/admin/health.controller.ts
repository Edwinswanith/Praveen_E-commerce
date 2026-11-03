import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { MailService } from '../../common/mail/mail.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Public } from '../auth/auth.decorators';
import { PaymentsGateway } from '../payments/payments.gateway';
import { ShippingService } from '../shipping/shipping.service';
import { EmbeddingService } from '../ai/embedding.service';
import { MessagingService } from '../../common/messaging/messaging.service';

@ApiTags('platform')
@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly queue: QueueService, private readonly mail: MailService,
    private readonly payments: PaymentsGateway, private readonly shipping: ShippingService, private readonly embeddings: EmbeddingService,
    private readonly messaging: MessagingService,
  ) {}

  /** Liveness + honest integration status ("pending" = credentials not configured). */
  @Get('health')
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = await this.queue.ping();
    const s = (ok: boolean) => (ok ? 'configured' : 'pending');
    return {
      status: db ? 'ok' : 'degraded', db, redis, version: this.env.APP_VERSION,
      integrations: {
        payments: this.payments.provider ? `${this.payments.provider.name}${this.payments.provider.name === 'mock' ? ' (test mode)' : ''}` : 'pending',
        cod: this.env.COD_ENABLED, shipping: this.env.SHIPPING_PROVIDER === 'shiprocket' ? s(this.shipping.shiprocket.configured) : 'manual',
        email: s(this.mail.configured), sms: s(this.messaging.smsConfigured), whatsapp: s(this.messaging.whatsappConfigured), embeddings: `${this.embeddings.provider.textModel}${this.embeddings.provider.configured ? '' : ' (pending)'}`, storage: this.env.STORAGE_DRIVER,
      },
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post('newsletter')
  async newsletter(@Body(new ZodPipe(z.object({ email: z.string().trim().toLowerCase().email() }))) b: { email: string }) {
    await this.prisma.newsletterSubscriber.upsert({ where: { email: b.email }, create: { email: b.email }, update: {} });
    return { ok: true };
  }
}
