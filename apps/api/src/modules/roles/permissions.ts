import type { RoleName } from '@vyra/shared';

/**
 * Least-privilege permission matrix. This file is the source of truth; the seed
 * mirrors it into the roles/permissions tables for reporting and future UI editing.
 */
export const PERMISSIONS = {
  'catalog:read': 'View products, categories and media',
  'catalog:write': 'Create and edit products, variants, categories and media',
  'catalog:publish': 'Publish, unpublish and archive products',
  'inventory:read': 'View stock, ledger, barcodes and scan products',
  'inventory:write': 'Record stock movements, suppliers and purchase orders',
  'orders:read': 'View orders, shipments and returns',
  'orders:write': 'Update order status, fulfil, cancel, process returns',
  'orders:refund': 'Issue refunds',
  'customers:read': 'View customer profiles and history',
  'customers:write': 'Write internal support notes on customer profiles',
  'promotions:read': 'View coupons',
  'promotions:write': 'Create and edit coupons',
  'analytics:read': 'View revenue dashboards and reports',
  'staff:manage': 'Create staff accounts and assign roles',
  'audit:read': 'View the audit log',
} as const;

export type Permission = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SUPER_ADMIN: ALL,
  ADMIN: ALL,
  INVENTORY_MANAGER: ['catalog:read', 'catalog:write', 'inventory:read', 'inventory:write', 'orders:read'],
  // Order managers handle COD calls and RTO follow-ups, so they keep the ability to note customers.
  ORDER_MANAGER: ['catalog:read', 'inventory:read', 'orders:read', 'orders:write', 'customers:read', 'customers:write', 'promotions:read'],
  CUSTOMER: [],
};

export function permissionsFor(role: RoleName): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Roles a given role may assign when managing staff (no privilege escalation). */
export function assignableRoles(actor: RoleName): RoleName[] {
  if (actor === 'SUPER_ADMIN') return ['ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'];
  if (actor === 'ADMIN') return ['INVENTORY_MANAGER', 'ORDER_MANAGER'];
  return [];
}
