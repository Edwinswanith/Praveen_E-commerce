'use client';
import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import type { ReviewAdminDto } from '@vyra/shared';
import { Badge, Button, cn } from '@vyra/ui';
import { BadgeCheck, Eye, EyeOff, ImageIcon, MessageSquareText, Star } from 'lucide-react';
import { useApi } from '@/lib/swr';
import type { ApiEnvelope } from '@/lib/api';
import { useUrlState } from '@/hooks/use-url-state';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatDate, formatDateTime } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { Forbidden, PageHeader } from '@/components/ui/feedback';
import { Select } from '@/components/ui/controls';
import { ModerationDialog, type ModerationAction } from './moderation-dialog';

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden className={cn('size-3.5', i <= rating ? 'fill-sun-400 text-sun-400' : 'text-border-strong')} />
      ))}
    </span>
  );
}

export function ReviewsScreen() {
  const { can } = useAuth();
  const allowed = can(PERM.reviewsModerate);
  const [f, setF] = useUrlState({ q: '', status: '', maxRating: '', page: '1' });
  const { data, meta, error, isLoading, isValidating, mutate } = useApi<ReviewAdminDto[]>(allowed ? '/reviews' : null, {
    q: f.q, status: f.status, maxRating: f.maxRating, page: f.page, pageSize: 20,
  });
  const [acting, setActing] = React.useState<{ review: ReviewAdminDto; action: ModerationAction } | null>(null);

  const replaceRow = React.useCallback((r: ReviewAdminDto) => {
    void mutate((cur: ApiEnvelope<ReviewAdminDto[]> | undefined) => (cur ? { ...cur, data: cur.data.map((x) => (x.id === r.id ? r : x)) } : cur), { revalidate: false });
  }, [mutate]);

  const columns = React.useMemo<ColumnDef<ReviewAdminDto, unknown>[]>(() => [
    {
      id: 'review', header: 'Review',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-64 max-w-md">
          <Link href={`/products/${r.productId}`} className="block truncate text-xs font-medium text-muted hover:text-fg hover:underline">{r.productName}</Link>
          <div className="mt-0.5 flex items-center gap-2"><Stars rating={r.rating} /><span className="text-xs text-muted">{formatDate(r.createdAt)}</span></div>
          {r.title && <p className="mt-1 font-medium">{r.title}</p>}
          {r.body && <p className="mt-0.5 line-clamp-2 text-muted">{r.body}</p>}
        </div>
      ),
    },
    {
      id: 'author', header: 'Author',
      cell: ({ row: { original: r } }) => (
        <span className="block min-w-36">
          <span className="block font-medium">{r.authorName}</span>
          {r.authorEmail && <span className="block max-w-48 truncate text-xs text-muted">{r.authorEmail}</span>}
          {r.verifiedPurchase
            ? <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-success"><BadgeCheck className="size-3.5" aria-hidden />Verified purchase</span>
            : <span className="mt-0.5 block text-xs text-subtle">Not verified</span>}
        </span>
      ),
    },
    {
      id: 'photos', header: 'Photos', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => r.images.length
        ? <span className="inline-flex items-center gap-1" aria-label={`${r.images.length} photo${r.images.length === 1 ? '' : 's'}`}><ImageIcon className="size-3.5 text-muted" aria-hidden />{r.images.length}</span>
        : <span className="text-subtle" aria-label="No photos">0</span>,
    },
    {
      id: 'status', header: 'Status',
      cell: ({ row: { original: r } }) => <Badge tone={r.isPublished ? 'success' : 'warning'}>{r.isPublished ? 'Published' : 'Hidden'}</Badge>,
    },
    {
      id: 'moderation', header: 'Moderation note',
      cell: ({ row: { original: r } }) => r.moderatedAt ? (
        <span className="block min-w-44 max-w-64 text-xs">
          {r.moderationNote && <span className="block text-fg">{r.moderationNote}</span>}
          <span className="block text-muted">{r.moderatedBy ?? 'Staff'}, {formatDateTime(r.moderatedAt)}</span>
        </span>
      ) : <span className="text-xs text-subtle">Not moderated</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: r } }) => (
        <div className="flex justify-end">
          {r.isPublished
            ? <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => setActing({ review: r, action: 'hide' })} aria-label={`Hide review${r.title ? ` "${r.title}"` : ''} by ${r.authorName} on ${r.productName}`}><EyeOff /> Hide</Button>
            : <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => setActing({ review: r, action: 'publish' })} aria-label={`Restore review${r.title ? ` "${r.title}"` : ''} by ${r.authorName} on ${r.productName}`}><Eye /> Restore</Button>}
        </div>
      ),
    },
  ], []);

  if (!allowed) return <><PageHeader title="Reviews" /><Forbidden /></>;

  const filtered = !!(f.q || f.status || f.maxRating);
  return (
    <>
      <PageHeader title="Reviews" description="Reviews go live as soon as they are posted. Hide only abusive, fake or off-topic ones; honest negative reviews stay up." />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(r) => r.id}
        empty={{ icon: <MessageSquareText />, title: filtered ? 'No reviews match these filters' : 'No reviews yet', description: filtered ? 'Try clearing the search or filters.' : 'Customer reviews will appear here as soon as they are posted.' }}
        toolbar={
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Title, text or product" label="Search reviews" />
            <div className="grid grid-cols-2 gap-2 md:flex">
              <Select aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value })} className="md:w-40">
                <option value="">All statuses</option>
                <option value="published">Published</option>
                <option value="hidden">Hidden</option>
              </Select>
              <Select aria-label="Maximum rating" value={f.maxRating} onChange={(e) => setF({ maxRating: e.target.value })} className="md:w-40">
                <option value="">Any rating</option>
                <option value="1">1 star</option>
                <option value="2">2 stars or less</option>
                <option value="3">3 stars or less</option>
                <option value="4">4 stars or less</option>
              </Select>
            </div>
          </div>
        }
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setF({ page: String(p) })} />} />
      {acting && (
        <ModerationDialog review={acting.review} action={acting.action} onClose={() => setActing(null)}
          onDone={(r) => { setActing(null); replaceRow(r); }} />
      )}
    </>
  );
}
