import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { STAFF_ROLES, type RoleName } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { forbidden, unauthorized } from '../../common/http/errors';
import { permissionsFor, type Permission } from '../roles/permissions';
import { AUDIENCE, IS_PUBLIC, OPTIONAL_AUTH, PERMISSIONS_KEY, type AuthUser } from './auth.decorators';
import { COOKIE, TokenService, type Audience } from './token.service';

/**
 * Global guard. Resolution order:
 *  1. Audience is "staff" for controllers marked @StaffOnly (all /admin routes),
 *     otherwise "customer". Each audience has its own cookie — a customer token
 *     is never accepted on a staff route and vice versa.
 *  2. @Public routes skip auth. @OptionalAuth attaches a user if present.
 *  3. Staff routes require a staff role AND every @RequirePermissions entry.
 *  4. The user row is re-read on each request so deactivation is immediate.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets);
    const audience: Audience = this.reflector.getAllAndOverride<Audience>(AUDIENCE, targets) ?? 'customer';
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    if (isPublic && !optional) return true;

    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.cookies?.[COOKIE[audience].access] as string | undefined);
    const payload = token ? this.tokens.verifyAccess(token) : null;

    if (!payload || payload.aud !== audience) {
      if (optional || isPublic) return true;
      throw unauthorized();
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user || !user.isActive || user.deletedAt) {
      if (optional) return true;
      throw unauthorized('Your session has ended. Please sign in again.');
    }
    const role = user.role.name as RoleName;
    req.user = { id: user.id, email: user.email, phone: user.phone, name: user.name, role, audience, permissions: permissionsFor(role) };

    if (audience === 'staff') {
      if (!STAFF_ROLES.includes(role)) throw forbidden();
      const missing = required.filter((p) => !req.user!.permissions.includes(p));
      if (missing.length) throw forbidden(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
