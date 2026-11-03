'use client';
import * as React from 'react';
import type { AdminProductRow } from '@vyra/shared';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@vyra/ui';
import { api } from '@/lib/api';

export interface PickedProduct { id: string; name: string }

/** Multi-select typeahead over GET /admin/products?q= (active products only). */
export function ProductPicker({ value, onChange, label = 'Find products' }: { value: PickedProduct[]; onChange: (v: PickedProduct[]) => void; label?: string }) {
  const [q, setQ] = React.useState('');
  const [rows, setRows] = React.useState<AdminProductRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api.get<AdminProductRow[]>('/products', { q: term, status: 'ACTIVE', pageSize: 10 }, ctrl.signal)
        .then(setRows)
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

  const chosen = new Set(value.map((p) => p.id));
  const visible = rows.filter((r) => !chosen.has(r.id));

  return (
    <div ref={boxRef}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input
          role="combobox" aria-expanded={open && visible.length > 0} aria-controls={listId} aria-label={label}
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Search product name…"
          className="h-11 w-full rounded-md border border-border-strong bg-bg pl-9 pr-9 text-sm placeholder:text-subtle focus:border-fg focus:outline-none sm:h-10"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" aria-hidden />}
        {open && q.trim().length >= 2 && !loading && (
          <ul id={listId} role="listbox" className="absolute left-0 right-0 top-12 z-40 max-h-72 overflow-y-auto rounded-md border border-border bg-bg p-1 shadow-pop">
            {visible.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">No products found.</li>}
            {visible.map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => { onChange([...value, { id: r.id, name: r.name }]); setQ(''); setOpen(false); }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-sm px-2.5 py-1.5 text-left hover:bg-surface-2">
                  <span className="size-8 shrink-0 overflow-hidden rounded bg-surface-2">{r.imageUrl && <img src={r.imageUrl} alt="" className="size-full object-cover" />}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                  <span className="text-xs text-muted">{r.variantCount} variants</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected products">
          {value.map((p) => (
            <li key={p.id} className={cn('inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-3 pr-0.5 text-xs')}>
              <span className="max-w-48 truncate">{p.name}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`} className="flex size-8 items-center justify-center rounded-full hover:bg-border">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
