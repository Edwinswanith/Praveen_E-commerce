import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface SentMessage { channel: 'sms' | 'whatsapp'; to: string; template: string; params: string[]; text: string }

/**
 * SMS + WhatsApp. Indian customers act on phone messages far more than email.
 *  - SMS (MSG91 OTP API) for one-time passwords. DLT-registered template required.
 *  - WhatsApp (Meta Cloud API) for order updates and opted-in cart reminders, using
 *    pre-approved templates named below.
 * Without credentials, messages are logged (dev) and recorded as `skipped`.
 * Every message is written to `notifications` for support/audit.
 */
export const WA_TEMPLATES = {
  orderConfirmed: 'vyra_order_confirmed',     // {{1}} name {{2}} order no {{3}} amount
  codConfirm: 'vyra_cod_confirm',             // {{1}} OTP {{2}} order no
  orderShipped: 'vyra_order_shipped',         // {{1}} order no {{2}} courier {{3}} tracking url
  orderDelivered: 'vyra_order_delivered',     // {{1}} order no
  cartReminder: 'vyra_cart_reminder',         // {{1}} name {{2}} item name {{3}} cart url
  saleLive: 'vyra_sale_live',                 // {{1}} sale name {{2}} "is live" / "early access is open" {{3}} sale url
  saleEnding: 'vyra_sale_ending',             // {{1}} sale name {{2}} ends at (IST) {{3}} sale url
} as const;

@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');
  /** Recent messages (console provider only) — lets tests and local dev read OTPs. */
  readonly outbox: SentMessage[] = [];

  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  get smsConfigured() {
    return this.env.SMS_PROVIDER === 'msg91' && !!this.env.MSG91_AUTH_KEY && !!this.env.MSG91_OTP_TEMPLATE_ID;
  }

  get whatsappConfigured() {
    return this.env.WHATSAPP_PROVIDER === 'meta' && !!this.env.WHATSAPP_TOKEN && !!this.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  /** True when OTPs are only logged locally (dev): the API may then echo the code to the client. */
  get devEcho() {
    return this.env.NODE_ENV !== 'production' && !this.smsConfigured;
  }

  private async record(channel: 'sms' | 'whatsapp', to: string, template: string, params: string[], status: string, error?: string) {
    // OTP values are never persisted.
    const safe = template.includes('otp') || template === WA_TEMPLATES.codConfirm ? params.map((p, i) => (i === 0 ? '******' : p)) : params;
    await this.prisma.notification.create({
      data: { channel, template, recipient: to, payload: { params: safe }, status, error, sentAt: status === 'sent' ? new Date() : null },
    }).catch(() => undefined);
  }

  private push(m: SentMessage) {
    this.outbox.push(m);
    if (this.outbox.length > 200) this.outbox.shift();
  }

  async sendOtp(phone: string, code: string, purpose: string) {
    const text = `${code} is your VYRA ${purpose === 'COD_CONFIRM' ? 'order confirmation' : 'login'} code. Valid for 5 minutes. Do not share it.`;
    if (!this.smsConfigured) {
      this.push({ channel: 'sms', to: phone, template: 'otp', params: [code], text });
      if (this.env.NODE_ENV === 'development') this.logger.log(`[SMS not configured] to=${phone}: ${text}`);
      await this.record('sms', phone, 'otp', [code], 'skipped', 'SMS provider pending configuration');
      return;
    }
    try {
      // MSG91 OTP API v5: the template (DLT approved) contains ##OTP##.
      const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(this.env.MSG91_OTP_TEMPLATE_ID!)}&mobile=91${phone}&otp=${code}`;
      const r = await fetch(url, { method: 'POST', headers: { authkey: this.env.MSG91_AUTH_KEY!, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`MSG91 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await this.record('sms', phone, 'otp', [code], 'sent');
    } catch (e) {
      this.logger.error(`OTP SMS failed: ${(e as Error).message}`);
      await this.record('sms', phone, 'otp', [code], 'failed', (e as Error).message.slice(0, 300));
      throw e;
    }
  }

  /** Best-effort WhatsApp template message; never throws into business flows. */
  async whatsapp(phone: string | null | undefined, template: string, params: string[]) {
    if (!phone) return;
    const text = `[${template}] ${params.join(' | ')}`;
    if (!this.whatsappConfigured) {
      this.push({ channel: 'whatsapp', to: phone, template, params, text });
      await this.record('whatsapp', phone, template, params, 'skipped', 'WhatsApp pending configuration');
      return;
    }
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: `91${phone}`, type: 'template',
          template: { name: template, language: { code: this.env.WHATSAPP_TEMPLATE_LANG }, components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: t.slice(0, 1000) })) }] },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await this.record('whatsapp', phone, template, params, 'sent');
    } catch (e) {
      this.logger.warn(`WhatsApp failed: ${(e as Error).message}`);
      await this.record('whatsapp', phone, template, params, 'failed', (e as Error).message.slice(0, 300));
    }
  }
}
