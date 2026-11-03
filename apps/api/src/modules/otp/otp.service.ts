import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import type { OtpPurpose } from '@prisma/client';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MessagingService } from '../../common/messaging/messaging.service';
import { AppError, badRequest } from '../../common/http/errors';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 30;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export const maskPhone = (p: string) => `+91 ${p.slice(0, 2)}••••••${p.slice(-2)}`;

/**
 * 6-digit OTPs. Only a peppered SHA-256 is stored; codes expire in 5 minutes,
 * allow 5 wrong attempts, and sending is limited to 1 per 30s and 5 per hour
 * per phone+purpose (SMS costs money and is an abuse vector).
 */
@Injectable()
export class OtpService {
  private readonly pepper: string;

  constructor(@Inject(ENV) env: Env, private readonly prisma: PrismaService, private readonly messaging: MessagingService) {
    this.pepper = env.OTP_PEPPER ?? env.JWT_ACCESS_SECRET;
  }

  private hash(phone: string, purpose: string, code: string) {
    return createHash('sha256').update(`${this.pepper}:${purpose}:${phone}:${code}`).digest('hex');
  }

  async issue(phone: string, purpose: OtpPurpose, orderId?: string) {
    const recent = await this.prisma.otpCode.findMany({ where: { phone, purpose, createdAt: { gte: new Date(Date.now() - 3600_000) } }, orderBy: { createdAt: 'desc' } });
    const last = recent[0];
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
      const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new AppError('RATE_LIMITED', `Please wait ${wait}s before requesting another code`, HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds: wait });
    }
    if (recent.length >= MAX_PER_HOUR) throw new AppError('RATE_LIMITED', 'Too many codes requested. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpCode.updateMany({ where: { phone, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.otpCode.create({ data: { phone, purpose, orderId, codeHash: this.hash(phone, purpose, code), expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000) } });
    await this.messaging.sendOtp(phone, code, purpose);
    return {
      phoneMasked: maskPhone(phone), expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_SECONDS,
      ...(this.messaging.devEcho ? { devCode: code } : {}),
    };
  }

  /**
   * Checks a code; consumes it unless `consume` is false (e.g. a new user who
   * still has to enter their name keeps the same code). Wrong codes always count
   * toward the attempt limit.
   */
  async verify(phone: string, purpose: OtpPurpose, code: string, orderId?: string, consume = true) {
    const otp = await this.prisma.otpCode.findFirst({ where: { phone, purpose, consumedAt: null, ...(orderId ? { orderId } : {}) }, orderBy: { createdAt: 'desc' } });
    if (!otp || otp.expiresAt < new Date()) throw badRequest('This code has expired. Request a new one.');
    if (otp.attempts >= MAX_ATTEMPTS) throw new AppError('RATE_LIMITED', 'Too many wrong attempts. Request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    if (otp.codeHash !== this.hash(phone, purpose, code)) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw badRequest(`Incorrect code. ${MAX_ATTEMPTS - otp.attempts - 1} attempts left.`);
    }
    if (!consume) return;
    // Conditional update makes concurrent double-submits consume once.
    const n = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (n.count !== 1) throw badRequest('This code was already used');
  }
}
