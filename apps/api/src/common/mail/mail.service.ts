import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Transactional email. Every message is recorded in `notifications`.
 * Without SMTP credentials messages are recorded with status "skipped" and the
 * body is logged in development, so flows (verification, reset) stay testable.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;

  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      });
    }
  }

  get configured() {
    return this.transporter !== null;
  }

  async send(opts: { to: string; subject: string; template: string; text: string; html?: string; userId?: string; payload?: Record<string, unknown> }) {
    const n = await this.prisma.notification.create({
      data: { channel: 'email', template: opts.template, recipient: opts.to, subject: opts.subject, userId: opts.userId, payload: (opts.payload ?? {}) as object },
    });
    if (!this.transporter) {
      if (this.env.NODE_ENV !== 'production') this.logger.log(`[SMTP not configured] to=${opts.to} subject="${opts.subject}"\n${opts.text}`);
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'skipped', error: 'SMTP pending configuration' } });
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.env.MAIL_FROM, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'sent', sentAt: new Date() } });
    } catch (e) {
      this.logger.error(`Mail failed: ${(e as Error).message}`);
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'failed', error: (e as Error).message.slice(0, 500) } });
    }
  }
}
