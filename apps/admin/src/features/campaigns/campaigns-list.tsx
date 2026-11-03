'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import type { CampaignAdminDto } from '@vyra/shared';
import { Badge, Button, cn } from '@vyra/ui';
import { Megaphone, Plus } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatINR, formatNumber } from '@/lib/format';
import { formatIstDateTime } from '@/lib/ist';
import { CAMPAIGN_PHASE_LABEL, CAMPAIGN_PHASE_TONE } from '@/lib/status';
import { DataTable } from '@/components/data-table/data-table';
import { PageHeader } from '@/components/ui/feedback';

export function PhaseBadge({ c }: { c: Pick<CampaignAdminDto, 'phase' | 'extended'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={CAMPAIGN_PHASE_TONE[c.phase]}>{CAMPAIGN_PHASE_LABEL[c.phase]}</Badge>
      {c.extended && <Badge tone="info">Extended</Badge>}
    </span>
  );
}

export function BudgetMeter({ used, budget }: { used: number; budget: number | null }) {
  if (budget == null) return <span className="tabular text-xs text-muted">{formatINR(used)} used · no budget</span>;
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  return (
    <span className="block min-w-32">
      <span className="tabular block text-xs">{formatINR(used)} / {formatINR(budget)}</span>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span className={cn('block h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-amber-500' : 'bg-violet-500')} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

const columns: ColumnDef<CampaignAdminDto, unknown>[] = [
  {
    header: 'Campaign', id: 'name',
    cell: ({ row: { original: c } }) => (
      <span className="block min-w-44">
        <Link href={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{c.name}</Link>
        <span className="block text-xs text-muted">{[c.festival, c.edition].filter(Boolean).join(' · ') || 'No festival set'}</span>
      </span>
    ),
  },
  { header: 'Phase', id: 'phase', cell: ({ row }) => <PhaseBadge c={row.original} /> },
  {
    header: 'Window (IST)', id: 'window',
    cell: ({ row: { original: c } }) => (
      <span className="block whitespace-nowrap text-xs">
        <span className="block">{formatIstDateTime(c.startsAt)}</span>
        <span className="block text-muted">to {formatIstDateTime(c.endsAt)}</span>
      </span>
    ),
  },
  { header: 'Deals', id: 'deals', meta: { align: 'right' }, cell: ({ row: { original: c } }) => <span className="whitespace-nowrap">{formatNumber(c.priceCount)}{c.promotions.length ? <span className="block text-xs text-muted">+{c.promotions.length} bundle</span> : null}</span> },
  { header: 'Budget used', id: 'budget', cell: ({ row: { original: c } }) => <BudgetMeter used={c.budgetUsed} budget={c.budget} /> },
  { header: 'Subscribers', id: 'subs', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.subscriberCount) },
];

export function CampaignsList() {
  const router = useRouter();
  const { can } = useAuth();
  const { data, error, isLoading, mutate } = useApi<CampaignAdminDto[]>('/campaigns');
  const canWrite = can(PERM.promotionsWrite);
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Festival sales: schedule, sale prices, bundle offers and results. All times are IST."
        actions={canWrite && <Button asChild size="sm" className="max-sm:h-11"><Link href="/campaigns/new"><Plus /> New campaign</Link></Button>}
      />
      <DataTable
        columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(c) => c.id}
        onRowClick={(c) => router.push(`/campaigns/${c.id}`)}
        empty={{ icon: <Megaphone />, title: 'No campaigns yet', description: 'Create a festival sale to schedule sale prices and bundle offers.', action: canWrite ? <Button asChild size="sm"><Link href="/campaigns/new"><Plus /> New campaign</Link></Button> : undefined }}
      />
    </>
  );
}
