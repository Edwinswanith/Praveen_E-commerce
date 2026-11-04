'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import type { NewsletterStatus, NewsletterSubscriberDto } from '@vyra/shared';
import { Badge, Button } from '@vyra/ui';
import { Download, Mail } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useUrlState } from '@/hooks/use-url-state';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { Tone } from '@/lib/status';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { Forbidden, PageHeader } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';

export const NEWSLETTER_EXPORT_PATH = '/newsletter/export';

const STATUS: Record<NewsletterStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Awaiting confirmation', tone: 'warning' },
  SUBSCRIBED: { label: 'Confirmed', tone: 'success' },
  UNSUBSCRIBED: { label: 'Unsubscribed', tone: 'neutral' },
};

const when = (v: string | null, fallback: string) => (v ? <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(v)}</span> : <span className="text-xs text-subtle">{fallback}</span>);

const columns: ColumnDef<NewsletterSubscriberDto, unknown>[] = [
  { header: 'Email', accessorKey: 'email', cell: ({ row }) => <span className="block min-w-48 break-all font-medium">{row.original.email}</span> },
  { header: 'Status', accessorKey: 'status', cell: ({ row }) => { const s = STATUS[row.original.status]; return <Badge tone={s?.tone ?? 'neutral'}>{s?.label ?? row.original.status}</Badge>; } },
  { header: 'Source', accessorKey: 'source', cell: ({ row }) => <span className="text-xs text-muted">{row.original.source ?? 'Not recorded'}</span> },
  { header: 'Consent given', accessorKey: 'consentAt', cell: ({ row }) => when(row.original.consentAt, 'Not recorded') },
  { header: 'Confirmed', accessorKey: 'confirmedAt', cell: ({ row }) => when(row.original.confirmedAt, 'Not yet') },
  { header: 'Unsubscribed', accessorKey: 'unsubscribedAt', cell: ({ row }) => when(row.original.unsubscribedAt, 'No') },
];

/** Downloads the CSV of confirmed (SUBSCRIBED) addresses only. */
export function NewsletterExportButton() {
  const [pending, setPending] = React.useState(false);
  const run = async () => {
    setPending(true);
    try { await downloadFile(NEWSLETTER_EXPORT_PATH, 'vyra-newsletter-subscribers.csv'); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setPending(false); }
  };
  return <Button variant="outline" size="sm" className="max-sm:h-11" loading={pending} onClick={() => void run()}><Download /> Export confirmed (CSV)</Button>;
}

type Filter = 'ALL' | NewsletterStatus;

export function NewsletterScreen() {
  const { can } = useAuth();
  const allowed = can(PERM.customersRead);
  const [f, setF] = useUrlState({ q: '', status: 'ALL', page: '1' });
  const { data, meta, extra, error, isLoading, isValidating, mutate } = useApi<NewsletterSubscriberDto[]>(allowed ? '/newsletter' : null, {
    q: f.q, status: f.status === 'ALL' ? undefined : f.status, page: f.page, pageSize: 25,
  });
  const counts = (extra?.counts ?? {}) as Partial<Record<NewsletterStatus, number>>;
  const total = (counts.PENDING ?? 0) + (counts.SUBSCRIBED ?? 0) + (counts.UNSUBSCRIBED ?? 0);
  const n = (v: number | undefined) => (extra ? ` (${formatNumber(v ?? 0)})` : '');

  if (!allowed) return <><PageHeader title="Newsletter" /><Forbidden /></>;

  return (
    <>
      <PageHeader title="Newsletter"
        description="Subscribers are added only after they confirm by email; unsubscribed addresses are kept so they are never emailed again."
        actions={<NewsletterExportButton />} />
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(s) => s.id}
        empty={{ icon: <Mail />, title: f.q || f.status !== 'ALL' ? 'No subscribers match' : 'No sign-ups yet', description: f.q ? 'Try another email address.' : undefined }}
        toolbar={
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
              <Segmented label="Subscription status" size="sm" value={f.status as Filter} onChange={(status) => setF({ status })}
                options={[
                  { value: 'ALL', label: `All${n(total)}` },
                  { value: 'SUBSCRIBED', label: `Confirmed${n(counts.SUBSCRIBED)}` },
                  { value: 'PENDING', label: `Pending${n(counts.PENDING)}` },
                  { value: 'UNSUBSCRIBED', label: `Unsubscribed${n(counts.UNSUBSCRIBED)}` },
                ]} />
            </div>
            <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Email address" label="Search subscribers by email" />
          </div>
        }
        footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setF({ page: String(p) })} />} />
    </>
  );
}
