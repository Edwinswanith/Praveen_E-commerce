'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { formatNumber } from '@/lib/format';

export function Pagination({ meta, onPageChange, isValidating }: { meta: PageMeta | undefined; onPageChange: (p: number) => void; isValidating?: boolean }) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <span className="tabular" aria-live="polite">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(meta.total)}
        {isValidating && <span className="ml-2 text-subtle">Updating…</span>}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular px-1">Page {meta.page} / {Math.max(meta.totalPages, 1)}</span>
        <Button variant="ghost" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
