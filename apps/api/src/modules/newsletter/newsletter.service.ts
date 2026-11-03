import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NewsletterSubscriber } from '@prisma/client';
import type { NewsletterSubscriberDto } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { AttemptLimiter } from '../../common/ratelimit/attempt-limiter.service';
import { badRequest } from '../../common/http/errors';

type Purpose = 'confirm' | 'unsubscribe';

export function toSubscriberDto(s: NewsletterSubscriber): NewsletterSubscriberDto {
  return {
    id: s.id, email: s.email, status: s.status, source: s.source, consentAt: s.consentAt?.toISOString() ?? null,
    confirmedAt: s.confirmedAt?.toISOString() ?? null, unsubscribedAt: s.unsubscribedAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Newsletter with double opt-in. Signing up never subscribes directly: it
 * sends a confirmation link and the address is PENDING until its owner clicks
 * it. Unsubscribe links are signed per subscriber (one click, no login), and
 * UNSUBSCRIBED rows are kept so the address is suppressed until it re-consents.
 * Responses never reveal whether an address is already on the list.
 */
@Injectable()
export class NewsletterService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly mail: MailService, private readonly limiter: AttemptLimiter) {}

  private sign(purpose: Purpose, id: string, email: string) {
    const key = createHmac('sha256', this.env.JWT_ACCESS_SECRET).update('newsletter-token-key').digest();
    return createHmac('sha256', key).update(`${purpose}:${id}:${email}`).digest('hex');
  }

  /** `<id>.<hmac>`; carries no data beyond the row id and can't be forged. */
  token(purpose: Purpose, s: { id: string; email: string }) {
    return `${s.id}.${this.sign(purpose, s.id, s.email)}`;
  }

  private async fromToken(purpose: Purpose, token: string) {
    const [id, mac] = token.split('.');
    const s = id ? await this.prisma.newsletterSubscriber.findUnique({ where: { id } }) : null;
    const expected = s ? Buffer.from(this.sign(purpose, s.id, s.email)) : null;
    if (!s || !expected || !mac || expected.length !== mac.length || !timingSafeEqual(expected, Buffer.from(mac))) throw badRequest('This link is invalid or has expired');
    return s;
  }

  unsubscribeLink(s: { id: string; email: string }) {
    return `${this.env.STOREFRONT_URL}/newsletter/unsubscribe?token=${this.token('unsubscribe', s)}`;
  }

  async subscribe(email: string, source?: string) {
    const now = new Date();
    const existing = await this.prisma.newsletterSubscriber.findUnique({ where: { email } });
    if (existing?.status === 'SUBSCRIBED') return { ok: true as const };
    // At most 3 confirmation emails per address per day, whoever asks.
    if ((await this.limiter.hit('newsletter-confirm', email, 86400)) > 3) return { ok: true as const };
    const s = existing
      ? await this.prisma.newsletterSubscriber.update({ where: { id: existing.id }, data: { status: 'PENDING', source: source ?? existing.source, consentAt: now, unsubscribedAt: null } })
      : await this.prisma.newsletterSubscriber.create({ data: { email, status: 'PENDING', source: source ?? null, consentAt: now } });
    const link = `${this.env.STOREFRONT_URL}/newsletter/confirm?token=${this.token('confirm', s)}`;
    await this.mail.send({
      to: email, template: 'newsletter-confirm', subject: 'Confirm your VYRA newsletter subscription',
      text: `Confirm that you want VYRA offers and new arrivals by email: ${link}\nIf you didn't sign up, ignore this email and you won't hear from us.`,
    });
    return { ok: true as const };
  }

  async confirm(token: string) {
    const s = await this.fromToken('confirm', token);
    if (s.status === 'UNSUBSCRIBED') throw badRequest('This address has unsubscribed. Sign up again to restart.');
    const u = s.status === 'SUBSCRIBED' ? s : await this.prisma.newsletterSubscriber.update({ where: { id: s.id }, data: { status: 'SUBSCRIBED', confirmedAt: new Date() } });
    return { status: u.status };
  }

  async unsubscribe(token: string) {
    const s = await this.fromToken('unsubscribe', token);
    if (s.status !== 'UNSUBSCRIBED') await this.prisma.newsletterSubscriber.update({ where: { id: s.id }, data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() } });
    return { status: 'UNSUBSCRIBED' as const };
  }
}
