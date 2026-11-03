'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, Shirt, ShoppingBag, User, Loader2 } from 'lucide-react';
import type { AdminProductRow, CustomerSummaryDto, OrderSummaryDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatINR } from '@/lib/format';

interface Result { id: string; group: 'Products' | 'Orders' | 'Customers'; title: string; subtitle: string; href: string }

const ICONS = { Products: Shirt, Orders: ShoppingBag, Customers: User } as const;

/** Searches products, orders and customers in parallel (only the ones the role can read). */
export function GlobalSearch() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<Result[]>([]);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, []);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const tasks: Promise<Result[]>[] = [];
      if (can(PERM.catalogRead)) {
        tasks.push(api.get<AdminProductRow[]>('/products', { q: term, pageSize: 5 }, ctrl.signal).then((rows) =>
          rows.map((p) => ({ id: p.id, group: 'Products' as const, title: p.name, subtitle: `${p.brand} · ${p.categoryName}`, href: `/products/${p.id}` }))));
      }
      if (can(PERM.ordersRead)) {
        tasks.push(api.get<OrderSummaryDto[]>('/orders', { q: term, pageSize: 5 }, ctrl.signal).then((rows) =>
          rows.map((o) => ({ id: o.id, group: 'Orders' as const, title: o.number, subtitle: `${o.customerName} · ${formatINR(o.grandTotal)}`, href: `/orders/${o.id}` }))));
      }
      if (can(PERM.customersRead)) {
        tasks.push(api.get<CustomerSummaryDto[]>('/customers', { q: term, pageSize: 5 }, ctrl.signal).then((rows) =>
          rows.map((c) => ({ id: c.id, group: 'Customers' as const, title: c.name, subtitle: c.email, href: `/customers/${c.id}` }))));
      }
      const settled = await Promise.allSettled(tasks);
      if (ctrl.signal.aborted) return;
      setResults(settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])));
      setActive(0);
      setLoading(false);
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, can]);

  const go = (r: Result) => { setOpen(false); setQ(''); router.push(r.href); };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open && q.length >= 2}
        aria-controls="global-search-results"
        aria-label="Search products, orders and customers"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) go(results[active]);
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
        }}
        placeholder="Search products, orders, customers"
        className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-14 text-sm placeholder:text-subtle focus:border-border-strong focus:bg-bg focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-bg px-1.5 text-[10px] font-medium text-subtle sm:block">Ctrl K</kbd>
      {open && q.trim().length >= 2 && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-md border border-border bg-bg p-1 shadow-pop">
          {loading && results.length === 0 && <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Searching…</p>}
          {!loading && results.length === 0 && <p className="px-3 py-3 text-sm text-muted">No matches for “{q.trim()}”.</p>}
          {(['Products', 'Orders', 'Customers'] as const).map((group) => {
            const items = results.filter((r) => r.group === group);
            if (!items.length) return null;
            const Icon = ICONS[group];
            return (
              <div key={group} className="py-1">
                <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle">{group}</p>
                {items.map((r) => {
                  const idx = results.indexOf(r);
                  return (
                    <button
                      key={`${r.group}-${r.id}`}
                      role="option"
                      aria-selected={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(r)}
                      className={cn('flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left', idx === active && 'bg-surface-2')}
                    >
                      <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
