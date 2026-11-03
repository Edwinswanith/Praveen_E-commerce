import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Shirt, FolderTree, Boxes, History, Truck, ClipboardList, Barcode, ScanLine,
  ShoppingBag, Undo2, Users, TicketPercent, BarChart3, Settings, Banknote, Filter, Megaphone,
} from 'lucide-react';
import { PERM } from '@/lib/permissions';

export interface NavItem { href: string; label: string; icon: LucideIcon; perm?: string; anyPerm?: string[]; exact?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true }] },
  {
    label: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: Shirt, perm: PERM.catalogRead },
      { href: '/categories', label: 'Categories', icon: FolderTree, perm: PERM.catalogRead },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock', icon: Boxes, perm: PERM.inventoryRead, exact: true },
      { href: '/inventory/movements', label: 'Movements', icon: History, perm: PERM.inventoryRead },
      { href: '/inventory/purchase-orders', label: 'Purchase orders', icon: ClipboardList, perm: PERM.inventoryWrite },
      { href: '/inventory/suppliers', label: 'Suppliers', icon: Truck, perm: PERM.inventoryRead },
      { href: '/barcodes', label: 'Barcodes', icon: Barcode, perm: PERM.inventoryRead },
      { href: '/scanner', label: 'Scanner', icon: ScanLine, perm: PERM.inventoryRead },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/orders', label: 'Orders', icon: ShoppingBag, perm: PERM.ordersRead },
      { href: '/returns', label: 'Returns', icon: Undo2, perm: PERM.ordersRead },
      { href: '/cod', label: 'COD & RTO', icon: Banknote, perm: PERM.ordersRead },
      { href: '/customers', label: 'Customers', icon: Users, perm: PERM.customersRead },
      { href: '/campaigns', label: 'Campaigns', icon: Megaphone, perm: PERM.promotionsRead },
      { href: '/promotions', label: 'Promotions', icon: TicketPercent, perm: PERM.promotionsRead },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3, perm: PERM.analyticsRead, exact: true },
      { href: '/analytics/conversion', label: 'Conversion', icon: Filter, perm: PERM.analyticsRead },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/settings', label: 'Settings', icon: Settings, anyPerm: [PERM.staffManage, PERM.catalogWrite, PERM.auditRead] }],
  },
];

export function isNavVisible(item: NavItem, can: (p: string) => boolean): boolean {
  if (item.perm && !can(item.perm)) return false;
  if (item.anyPerm && !item.anyPerm.some(can)) return false;
  return true;
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
