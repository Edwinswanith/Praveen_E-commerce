'use client';
import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { usePathname } from 'next/navigation';
import { Menu as MenuIcon, LogOut, UserCircle2 } from 'lucide-react';
import { cn } from '@vyra/ui';
import { useAuth } from '@/features/auth/auth-context';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { TooltipProvider } from '@/components/ui/controls';
import { humanize } from '@/lib/format';
import { Sidebar } from './sidebar';
import { GlobalSearch } from './global-search';

const COLLAPSE_KEY = 'vyra.admin.sidebar.collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* storage unavailable */ }
  }, []);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
    return !c;
  });

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-surface">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-bg focus:px-3 focus:py-2 focus:shadow-pop">Skip to content</a>
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 hidden border-r border-border bg-bg transition-[width] duration-200 lg:block',
            collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
          )}
        >
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </aside>

        <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-neutral-900/30 lg:hidden" />
            <D.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-bg shadow-pop lg:hidden">
              <D.Title className="sr-only">Navigation</D.Title>
              <D.Description className="sr-only">Main navigation</D.Description>
              <Sidebar collapsed={false} mobile onNavigate={() => setMobileOpen(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>

        <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-sidebar-collapsed' : 'lg:pl-sidebar')}>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-3 backdrop-blur sm:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} className="rounded-md p-2 text-muted hover:bg-surface-2 lg:hidden" aria-label="Open navigation">
              <MenuIcon className="size-5" />
            </button>
            <div className="flex min-w-0 flex-1"><GlobalSearch /></div>
            <UserMenu />
          </header>
          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-6 sm:py-7">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Menu>
      <MenuTrigger className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-surface-2" aria-label="Account menu">
        <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-fg ring-1 ring-border">{initials || <UserCircle2 className="size-4" />}</span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-36 truncate text-xs font-semibold leading-tight">{user.name}</span>
          <span className="block text-[11px] leading-tight text-muted">{humanize(user.role)}</span>
        </span>
      </MenuTrigger>
      <MenuContent className="w-60">
        <MenuLabel>
          <span className="block truncate font-medium text-fg">{user.name}</span>
          <span className="block truncate">{user.email ?? user.phone ?? ''}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => void logout()}><LogOut /> Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}
