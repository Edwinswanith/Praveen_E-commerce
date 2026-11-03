import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response, CookieOptions } from 'express';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';

export type Audience = 'customer' | 'staff';

export const COOKIE = {
  customer: { access: 'vyra_at', refresh: 'vyra_rt' },
  staff: { access: 'vyra_staff_at', refresh: 'vyra_staff_rt' },
} as const;

export interface AccessPayload { sub: string; aud: Audience; role: string; sid: string }

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class TokenService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  signAccess(payload: AccessPayload): string {
    return jwt.sign(payload, this.env.JWT_ACCESS_SECRET, { expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS, issuer: 'vyra-api' });
  }

  verifyAccess(token: string): AccessPayload | null {
    try {
      return jwt.verify(token, this.env.JWT_ACCESS_SECRET, { issuer: 'vyra-api' }) as AccessPayload;
    } catch {
      return null;
    }
  }

  /** Creates a session with an opaque refresh token (only its hash is stored). */
  async createSession(userId: string, role: string, audience: Audience, meta: { ip?: string; userAgent?: string }) {
    const refresh = randomBytes(48).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId, audience, refreshTokenHash: sha256(refresh), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
      },
    });
    return { access: this.signAccess({ sub: userId, aud: audience, role, sid: session.id }), refresh, sessionId: session.id };
  }

  /**
   * Rotates a refresh token. Reuse of an already-rotated token revokes every
   * session of that user (token theft detection).
   */
  async rotate(refresh: string, audience: Audience, meta: { ip?: string; userAgent?: string }) {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refresh) }, include: { user: { include: { role: true } } } });
    if (!session || session.audience !== audience) return null;
    if (session.revokedAt) {
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      return null;
    }
    if (session.expiresAt < new Date() || !session.user.isActive || session.user.deletedAt) return null;
    const next = await this.createSession(session.userId, session.user.role.name, audience, meta);
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), replacedById: next.sessionId } });
    return { ...next, user: session.user };
  }

  async revoke(refresh: string | undefined) {
    if (!refresh) return;
    await this.prisma.session.updateMany({ where: { refreshTokenHash: sha256(refresh), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private base(path: string): CookieOptions {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', domain: this.env.COOKIE_DOMAIN, path };
  }

  setCookies(res: Response, audience: Audience, tokens: { access: string; refresh: string }) {
    const names = COOKIE[audience];
    res.cookie(names.access, tokens.access, { ...this.base('/'), maxAge: this.env.ACCESS_TOKEN_TTL_SECONDS * 1000 });
    res.cookie(names.refresh, tokens.refresh, {
      ...this.base(audience === 'staff' ? '/api/v1/admin/auth' : '/api/v1/auth'),
      maxAge: this.env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
    });
  }

  clearCookies(res: Response, audience: Audience) {
    const names = COOKIE[audience];
    res.clearCookie(names.access, this.base('/'));
    res.clearCookie(names.refresh, this.base(audience === 'staff' ? '/api/v1/admin/auth' : '/api/v1/auth'));
  }
}
