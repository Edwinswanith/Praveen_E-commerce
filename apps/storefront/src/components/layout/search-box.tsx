'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Camera, Search, X } from 'lucide-react';
import { formatINR } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { ProductImage } from '../product/product-image';

interface Suggestions {
  products: { slug: string; name: string; imageUrl: string | null; price: number }[];
  categories: { slug: string; name: string }[];
}

interface Option {
  key: string;
  href: string;
  label: string;
  kind: 'query' | 'category' | 'product';
  imageUrl?: string | null;
  price?: number;
}

export function SearchBox({
  onVisualSearch,
  className,
  autoFocus,
}: {
  onVisualSearch: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const debounced = useDebouncedValue(q.trim(), 200);
  const listId = React.useId();
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const key = debounced.length >= 2 ? `/search/suggest?q=${encodeURIComponent(debounced)}` : null;
  const { data } = useSWR<Suggestions>(key, { keepPreviousData: true, revalidateOnFocus: false });

  const options: Option[] = React.useMemo(() => {
    if (!q.trim()) return [];
    const list: Option[] = [
      {
        key: 'q',
        href: `/search?q=${encodeURIComponent(q.trim())}`,
        label: q.trim(),
        kind: 'query',
      },
    ];
    for (const c of data?.categories ?? [])
      list.push({ key: `c-${c.slug}`, href: `/c/${c.slug}`, label: c.name, kind: 'category' });
    for (const p of data?.products ?? [])
      list.push({
        key: `p-${p.slug}`,
        href: `/p/${p.slug}`,
        label: p.name,
        kind: 'product',
        imageUrl: p.imageUrl,
        price: p.price,
      });
    return list;
  }, [q, data]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter') {
      const opt = options[active];
      if (opt && active >= 0) {
        e.preventDefault();
        go(opt.href);
      }
    }
  };

  const showList = open && options.length > 0;

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
        className="flex h-10 items-center rounded-md bg-surface-2 pl-3 pr-1 ring-fg focus-within:bg-bg focus-within:ring-1"
      >
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search “black tee under 1000”"
          aria-label="Search products"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-fg placeholder:text-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="rounded-full p-1.5 text-muted hover:text-fg"
            aria-label="Clear search"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onVisualSearch}
          className="rounded-full p-1.5 text-muted hover:bg-bg hover:text-brand-600"
          aria-label="Search with a photo"
        >
          <Camera className="size-5" aria-hidden />
        </button>
      </form>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-bg py-1 shadow-pop"
        >
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <Link
                href={o.href}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm',
                  i === active && 'bg-surface-2',
                )}
              >
                {o.kind === 'product' ? (
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                    <ProductImage
                      src={o.imageUrl}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  </span>
                ) : (
                  <Search className="size-4 shrink-0 text-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {o.kind === 'query' ? (
                    <>
                      Search for “<strong>{o.label}</strong>”
                    </>
                  ) : (
                    o.label
                  )}
                </span>
                {o.kind === 'category' && <span className="text-xs text-muted">Category</span>}
                {o.kind === 'product' && o.price !== undefined && (
                  <span className="text-xs font-semibold">{formatINR(o.price)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
