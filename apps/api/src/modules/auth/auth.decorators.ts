import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { RoleName } from '@vyra/shared';
import type { Permission } from '../roles/permissions';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role: RoleName;
  audience: 'customer' | 'staff';
  permissions: Permission[];
}

export const IS_PUBLIC = 'is_public';
export const AUDIENCE = 'audience';
export const PERMISSIONS_KEY = 'permissions';
export const OPTIONAL_AUTH = 'optional_auth';

/** Endpoint needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Session is read if present but not required (guest cart, guest checkout). */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
/** Staff controllers: reads staff cookies, rejects customer tokens. */
export const StaffOnly = () => SetMetadata(AUDIENCE, 'staff');
/** Requires ALL listed permissions (staff only). */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest().user;
});
