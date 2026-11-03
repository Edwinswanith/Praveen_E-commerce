import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { CustomerProfile, User, Role } from '@prisma/client';
import { STAFF_ROLES, type LoginInput, type RegisterInput, type RoleName, type SessionUser } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { AppError, badRequest, conflict, unauthorized } from '../../common/http/errors';
import { permissionsFor } from '../roles/permissions';
import { OtpService } from '../otp/otp.service';
import { sha256, TokenService, type Audience } from './token.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Pre-computed hash so login timing is the same whether or not the email exists.
let dummyHash: string | null = null;

export function toSessionUser(user: User & { role: Role; customerProfile?: CustomerProfile | null }): SessionUser {
  const role = user.role.name as RoleName;
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone, emailVerified: !!user.emailVerifiedAt,
    phoneVerified: !!user.phoneVerifiedAt, marketingOptIn: user.customerProfile?.marketingOptIn ?? false,
    role, permissions: permissionsFor(role),
  };
}

export const sessionInclude = { role: true, customerProfile: true } as const;

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly otp: OtpService,
  ) {}

  hash(password: string) {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async register(input: RegisterInput, meta: { ip?: string; userAgent?: string }) {
    const exists = await this.prisma.user.findFirst({ where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone, phoneVerifiedAt: { not: null } }] : [])] } });
    if (exists) throw conflict('An account with this email or phone already exists');
    // An unverified phone on another account is not a claim; free it.
    if (input.phone) await this.prisma.user.updateMany({ where: { phone: input.phone, phoneVerifiedAt: null }, data: { phone: null } });
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const user = await this.prisma.user.create({
      data: { name: input.name, email: input.email, phone: input.phone, passwordHash: await this.hash(input.password), roleId: role.id, customerProfile: { create: {} } },
      include: sessionInclude,
    });
    await this.sendVerification(user.id, user.email);
    const tokens = await this.tokens.createSession(user.id, role.name, 'customer', meta);
    return { user: toSessionUser(user), tokens };
  }

  async login(input: LoginInput, audience: Audience, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, include: sessionInclude });
    dummyHash ??= await this.hash('timing-equaliser-password-1');
    if (!user || user.deletedAt) {
      await argon2.verify(dummyHash, input.password).catch(() => false);
      throw unauthorized('Incorrect email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('RATE_LIMITED', 'Too many failed attempts. Try again in a few minutes.', 429);
    }
    const ok = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      throw unauthorized('Incorrect email or password');
    }
    if (!user.isActive) throw unauthorized('This account has been deactivated');
    const isStaff = STAFF_ROLES.includes(user.role.name as RoleName);
    // Staff and customer realms are separate: staff log in only at the admin app.
    if (audience === 'staff' && !isStaff) throw unauthorized('Incorrect email or password');
    if (audience === 'customer' && isStaff) throw badRequest('Staff accounts sign in at the admin dashboard');
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.tokens.createSession(user.id, user.role.name, audience, meta);
    return { user: toSessionUser(user), tokens };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: sessionInclude });
    return toSessionUser(user);
  }

  private async issueToken(userId: string, purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', ttlMinutes: number) {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.userToken.create({ data: { userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) } });
    return raw;
  }

  private async consumeToken(raw: string, purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
    const t = await this.prisma.userToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) throw badRequest('This link is invalid or has expired');
    await this.prisma.userToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
    return t.userId;
  }

  requestOtp(phone: string) {
    return this.otp.issue(phone, 'LOGIN');
  }

  /**
   * Phone + OTP sign-in / sign-up. An OTP proves phone ownership, so it may only
   * log into an account whose phone was VERIFIED before (or create a new one).
   * A phone typed into an email sign-up but never verified is detached instead
   * of trusted, so nobody can pre-register someone else's number and later share
   * that person's account.
   */
  async loginWithOtp(input: { phone: string; code: string; name?: string; marketingOptIn?: boolean }, meta: { ip?: string; userAgent?: string }) {
    let user = await this.prisma.user.findUnique({ where: { phone: input.phone }, include: sessionInclude });
    const willCreate = !user || !user.phoneVerifiedAt;
    // A correct code without a name (new account) is not consumed, so the customer isn't sent a second SMS.
    await this.otp.verify(input.phone, 'LOGIN', input.code, undefined, !(willCreate && !input.name));
    if (user && STAFF_ROLES.includes(user.role.name as RoleName)) throw badRequest('Staff accounts sign in at the admin dashboard');
    if (user && !user.phoneVerifiedAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { phone: null } });
      user = null;
    }
    let isNewUser = false;
    if (!user) {
      if (!input.name) throw new AppError('VALIDATION_FAILED', 'Tell us your name to create your account', 422, { fieldErrors: { name: ['Required for new accounts'] }, formErrors: [], needsName: true });
      const role = await this.prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
      // Phone-only accounts have no usable password; they always sign in with OTP.
      user = await this.prisma.user.create({
        data: { name: input.name, phone: input.phone, phoneVerifiedAt: new Date(), passwordHash: await this.hash(randomBytes(32).toString('hex')), roleId: role.id, customerProfile: { create: { marketingOptIn: !!input.marketingOptIn } } },
        include: sessionInclude,
      });
      isNewUser = true;
    } else {
      if (!user.isActive || user.deletedAt) throw unauthorized('This account has been deactivated');
      user = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }, include: sessionInclude });
    }
    const tokens = await this.tokens.createSession(user.id, user.role.name, 'customer', meta);
    return { user: toSessionUser(user), isNewUser, tokens };
  }

  async sendVerification(userId: string, email: string | null) {
    if (!email) return;
    const token = await this.issueToken(userId, 'EMAIL_VERIFICATION', 60 * 24);
    const link = `${this.env.STOREFRONT_URL}/verify-email?token=${token}`;
    await this.mail.send({ to: email, userId, template: 'verify-email', subject: 'Verify your VYRA account', text: `Welcome to VYRA! Verify your email: ${link}` });
  }

  async verifyEmail(token: string) {
    const userId = await this.consumeToken(token, 'EMAIL_VERIFICATION');
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return; // no account enumeration
    const token = await this.issueToken(user.id, 'PASSWORD_RESET', 30);
    const isStaff = (await this.prisma.role.findUnique({ where: { id: user.roleId } }))?.name !== 'CUSTOMER';
    const link = `${isStaff ? this.env.ADMIN_URL : this.env.STOREFRONT_URL}/reset-password?token=${token}`;
    await this.mail.send({ to: email, userId: user.id, template: 'reset-password', subject: 'Reset your VYRA password', text: `Reset your password (valid 30 minutes): ${link}\nIf you did not request this, ignore this email.` });
  }

  async resetPassword(token: string, password: string) {
    const userId = await this.consumeToken(token, 'PASSWORD_RESET');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hash(password), failedLogins: 0, lockedUntil: null } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, current).catch(() => false))) throw badRequest('Current password is incorrect');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hash(next) } });
  }
}
