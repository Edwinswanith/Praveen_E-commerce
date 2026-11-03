import type { SessionUser } from '@vyra/shared';

export const PERM = {
  analyticsRead: 'analytics:read',
  catalogRead: 'catalog:read',
  catalogWrite: 'catalog:write',
  catalogPublish: 'catalog:publish',
  inventoryRead: 'inventory:read',
  inventoryWrite: 'inventory:write',
  ordersRead: 'orders:read',
  ordersWrite: 'orders:write',
  ordersRefund: 'orders:refund',
  customersRead: 'customers:read',
  customersWrite: 'customers:write',
  reviewsModerate: 'reviews:moderate',
  promotionsRead: 'promotions:read',
  promotionsWrite: 'promotions:write',
  staffManage: 'staff:manage',
  auditRead: 'audit:read',
} as const;
export type Permission = (typeof PERM)[keyof typeof PERM];

export function hasPermission(user: Pick<SessionUser, 'permissions' | 'role'> | null | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = user.permissions ?? [];
  if (perms.includes('*') || perms.includes(perm)) return true;
  const [resource, action] = perm.split(':');
  if (perms.includes(`${resource}:*`)) return true;
  // A write grant implies read for the same resource.
  if (action === 'read' && (perms.includes(`${resource}:write`) || perms.includes(`${resource}:manage`))) return true;
  return false;
}
