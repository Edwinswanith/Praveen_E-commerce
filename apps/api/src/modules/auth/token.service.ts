import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response, CookieOptions } from 'express';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { API_PREFIX } from '@vyra/shared';

export type Audience = 'customer' | 'staff';

export const COOKIE = {
  customer: { access: 'vyra_at', refresh: 'vyra_rt' },
  staff: { access: 'vyra_staff_at', refresh: 'vyra_staff_rt' },
} as const;

export interface AccessPayload { sub: string; aud: Audience; role: string; sid: string }

/** Window in which a just-rotated refresh token may still be used once more (parallel tabs). */
export const ROTATION_GRACE_MS = 30_000;

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
   * Rotates a refresh token. The old session is claimed atomically (only one
   * request can rotate it). A token that was rotated moments ago (another tab
   * refreshing at the same time) gets a sibling session instead of tripping theft
   * detection. Reuse after the grace window, or of a logged-out token, revokes
   * every session of that user (token theft detection).
   */
  async rotate(refresh: string, audience: Audience, meta: { ip?: string; userAgent?: string }) {
    const hash = sha256(refresh);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: { include: { role: true } } } });
    if (!session || session.audience !== audience) return null;
    if (session.expiresAt < new Date() || !session.user.isActive || session.user.deletedAt) return null;
    const role = session.user.role.name;
    if (!session.revokedAt) {
      const next = await this.createSession(session.userId, role, audience, meta);
      const claimed = await this.prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), replacedById: next.sessionId } });
      if (claimed.count === 1) return { ...next, user: session.user };
      // Lost the race to a concurrent refresh: drop our unused session and fall through.
      await this.prisma.session.delete({ where: { id: next.sessionId } });
    }
    const current = await this.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    const rotatedRecently = current.replacedById && current.revokedAt && Date.now() - current.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (rotatedRecently) return { ...(await this.createSession(session.userId, role, audience, meta)), user: session.user };
    await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
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
      ...this.base(audience === 'staff' ? `${API_PREFIX}/admin/auth` : `${API_PREFIX}/auth`),
      maxAge: this.env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
    });
  }

  clearCookies(res: Response, audience: Audience) {
    const names = COOKIE[audience];
    res.clearCookie(names.access, this.base('/'));
    res.clearCookie(names.refresh, this.base(audience === 'staff' ? `${API_PREFIX}/admin/auth` : `${API_PREFIX}/auth`));
  }
}
