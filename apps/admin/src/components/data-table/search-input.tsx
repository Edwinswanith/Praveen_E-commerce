'use client';
import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@vyra/ui';

/** Debounced search box. Calls onChange ~300ms after typing stops. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus, label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; label?: string;
}) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  React.useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        aria-label={label ?? placeholder}
        value={local}
        autoFocus={autoFocus}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange(local); }}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border-strong bg-bg pl-9 pr-8 text-sm placeholder:text-subtle focus:border-fg focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button type="button" onClick={() => { setLocal(''); onChange(''); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-subtle hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
