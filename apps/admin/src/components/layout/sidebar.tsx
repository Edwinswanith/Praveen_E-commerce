'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { VyraLogo, cn } from '@vyra/ui';
import { useAuth } from '@/features/auth/auth-context';
import { Tooltip } from '@/components/ui/controls';
import { NAV, isNavActive, isNavVisible } from './nav';

export function Sidebar({ collapsed, onToggle, onNavigate, mobile }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; mobile?: boolean }) {
  const pathname = usePathname();
  const { can } = useAuth();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => isNavVisible(i, can)) })).filter((g) => g.items.length);
  // With several "Inventory" items sharing a prefix, prefer the longest active match.
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((i) => isNavActive(i, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className={cn('flex h-14 shrink-0 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2" aria-label="VYRA Admin home">
          {collapsed ? (
            <span className="flex size-8 items-center justify-center rounded-md bg-fg text-sm font-extrabold text-white">V</span>
          ) : (
            <>
              <VyraLogo className="text-lg" />
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Admin</span>
            </>
          )}
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            {!collapsed && <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Tooltip content={item.label} disabled={!collapsed}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors',
                          collapsed ? 'justify-center p-2.5' : 'px-2.5 py-2',
                          active ? 'bg-brand-50 text-brand-700' : 'text-neutral-600 hover:bg-surface-2 hover:text-fg',
                        )}
                      >
                        <Icon className={cn('size-4 shrink-0', active ? 'text-brand-600' : 'text-subtle group-hover:text-fg')} aria-hidden />
                        {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                      </Link>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {!mobile && onToggle && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={onToggle}
            className={cn('flex w-full items-center gap-2 rounded-md p-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg', collapsed && 'justify-center')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
          </button>
        </div>
      )}
    </nav>
  );
}
