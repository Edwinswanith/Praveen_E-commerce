'use client';
import * as React from 'react';
import type { InventoryRowDto } from '@vyra/shared';
import { Loader2, Plus, Search } from 'lucide-react';
import { cn } from '@vyra/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';

/** Typeahead over GET /admin/inventory?q= (SKU, barcode or product name). */
export function VariantPicker({ onPick, placeholder = 'Search SKU, barcode or product…', excludeIds, autoFocus }: {
  onPick: (row: InventoryRowDto) => void; placeholder?: string; excludeIds?: Set<string>; autoFocus?: boolean;
}) {
  const [q, setQ] = React.useState('');
  const [rows, setRows] = React.useState<InventoryRowDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api.get<InventoryRowDto[]>('/inventory', { q: term, pageSize: 10 }, ctrl.signal)
        .then((r) => { setRows(r); setActive(0); })
        .catch(() => { if (!ctrl.signal.aborted) setRows([]); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const visible = rows.filter((r) => !excludeIds?.has(r.variantId));
  const pick = (r: InventoryRowDto) => { onPick(r); setQ(''); setRows([]); setOpen(false); };

  return (
    <div ref={boxRef} className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        role="combobox"
        aria-expanded={open && visible.length > 0}
        aria-controls={listId}
        aria-label="Find variant"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, visible.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); const r = visible[active]; if (r) pick(r); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-border-strong bg-bg pl-9 pr-9 text-sm placeholder:text-subtle focus:border-fg focus:outline-none"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" aria-hidden />}
      {open && q.trim().length >= 2 && !loading && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-11 z-40 max-h-80 overflow-y-auto rounded-md border border-border bg-bg p-1 shadow-pop">
          {visible.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">No variants found.</li>}
          {visible.map((r, i) => (
            <li key={r.variantId} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(r)} className={cn('flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left', i === active && 'bg-surface-2')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.productName}</span>
                  <span className="block truncate font-mono text-xs text-muted">{r.sku} · {r.color} / {r.size}</span>
                </span>
                <span className="tabular text-xs text-muted">{formatNumber(r.available)} avail.</span>
                <Plus className="size-4 text-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
