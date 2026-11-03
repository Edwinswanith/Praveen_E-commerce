'use client';
import * as React from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import type { CampaignAdminDto, CampaignChecklistDto } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton, cn } from '@vyra/ui';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { useUrlState } from '@/hooks/use-url-state';
import { formatINR, formatNumber } from '@/lib/format';
import { formatDuration, formatIstDateTime, istInputToIso, isoToIstInput } from '@/lib/ist';
import type { CampaignPreviewDto } from '@/lib/types';
import { ErrorState, KeyValue, PageHeader } from '@/components/ui/feedback';
import { CAMPAIGN_PHASE_LABEL, CAMPAIGN_PHASE_TONE } from '@/lib/status';
import { BudgetMeter, PhaseBadge } from './campaigns-list';
import { CampaignActions } from './campaign-actions';
import { budgetExhausted } from './campaign-rules';
import { PricesTab } from './prices-tab';
import { BundlesTab } from './bundles-tab';
import { ReportTab } from './report-tab';

const STOREFRONT = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const back = <Link href="/campaigns" className="mb-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted hover:text-fg sm:min-h-0"><ArrowLeft className="size-3.5" /> Campaigns</Link>;

type Tab = 'overview' | 'prices' | 'bundles' | 'checklist' | 'preview' | 'report';

function useNow(intervalMs = 30_000) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export function CampaignDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const { data: c, error, isLoading, mutate } = useApi<CampaignAdminDto>(`/campaigns/${id}`);
  const checklist = useApi<CampaignChecklistDto>(c?.status === 'DRAFT' ? `/campaigns/${id}/checklist` : null);
  const canWrite = can(PERM.promotionsWrite);
  const canReport = can(PERM.analyticsRead);
  const canReadCatalog = can(PERM.catalogRead);
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'prices', label: 'Prices' },
    { value: 'bundles', label: 'Bundle offers' },
    { value: 'checklist', label: 'Checklist' },
    { value: 'preview', label: 'Preview' },
    ...(canReport ? [{ value: 'report' as const, label: 'Report' }] : []),
  ];
  const [f, setF] = useUrlState({ tab: 'overview' });
  const tab = (tabs.find((t) => t.value === f.tab) ?? tabs[0]!).value;

  if (error && !c) return <>{back}<ErrorState error={error} onRetry={() => void mutate()} /></>;
  if (isLoading || !c) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-10 w-full" /><Skeleton className="h-80" /></div>;

  const refresh = () => { void mutate(); void checklist.mutate(); };
  const blocking = checklist.data?.problems.find((p) => p.level === 'error');
  const publishBlocked = c.status === 'DRAFT' ? (checklist.data ? (blocking ? `Fix the checklist first: ${blocking.message}` : null) : 'Checking readiness…') : null;

  return (
    <>
      <PageHeader
        back={back}
        title={c.name}
        description={<span className="flex flex-wrap items-center gap-2"><PhaseBadge c={c} /><span>{[c.festival, c.edition].filter(Boolean).join(' · ')}</span><span className="font-mono text-xs">/{c.slug}</span></span>}
        actions={<CampaignActions campaign={c} canWrite={canWrite} publishBlocked={publishBlocked} onChanged={(next) => { if (!next) return; void mutate({ data: next, extra: {} }, { revalidate: true }); void checklist.mutate(); }} />}
      />
      <Tabs.Root value={tab} onValueChange={(v) => setF({ tab: v })}>
        <div className="-mx-3 mb-5 overflow-x-auto border-b border-border px-3 scrollbar-thin sm:mx-0 sm:px-0">
          <Tabs.List aria-label="Campaign sections" className="flex min-w-max gap-1">
            {tabs.map((t) => (
              <Tabs.Trigger key={t.value} value={t.value} className="-mb-px flex min-h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted hover:text-fg data-[state=active]:border-brand-500 data-[state=active]:text-fg">
                {t.label}
                {t.value === 'checklist' && checklist.data && !checklist.data.ready && <span className="size-2 rounded-full bg-danger" aria-label="has blocking problems" />}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>
        <Tabs.Content value="overview"><Overview c={c} /></Tabs.Content>
        <Tabs.Content value="prices">{tab === 'prices' && <PricesTab campaign={c} canWrite={canWrite} canReadCatalog={canReadCatalog} onChanged={refresh} />}</Tabs.Content>
        <Tabs.Content value="bundles">{tab === 'bundles' && <BundlesTab campaign={c} canWrite={canWrite} canReadCatalog={canReadCatalog} onChanged={refresh} />}</Tabs.Content>
        <Tabs.Content value="checklist">{tab === 'checklist' && <ChecklistTab campaignId={c.id} status={c.status} />}</Tabs.Content>
        <Tabs.Content value="preview">{tab === 'preview' && <PreviewTab c={c} />}</Tabs.Content>
        {canReport && <Tabs.Content value="report">{tab === 'report' && <ReportTab campaignId={c.id} />}</Tabs.Content>}
      </Tabs.Root>
    </>
  );
}

function Overview({ c }: { c: CampaignAdminDto }) {
  const now = useNow();
  const target = c.countdownTo ? new Date(c.countdownTo) : null;
  const nextLabel = !target ? null
    : target.getTime() === new Date(c.endsAt).getTime() ? 'Sale ends'
    : target.getTime() === new Date(c.startsAt).getTime() ? 'Sale starts'
    : c.earlyAccessStartsAt && target.getTime() === new Date(c.earlyAccessStartsAt).getTime() ? 'Early access starts'
    : 'Teaser starts';
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {c.phase === 'PAUSED' && budgetExhausted(c) && <Alert tone="danger" title="Paused: discount budget used up">The sale paused itself when discounts reached {formatINR(c.budget ?? 0)}. Raise the budget (Edit) before resuming.</Alert>}
        {c.phase === 'PAUSED' && !budgetExhausted(c) && <Alert tone="warning">Paused. Sale prices and bundle offers are not applied and the banner is hidden.</Alert>}
        {c.status === 'DRAFT' && <Alert tone="info">Draft. Nothing is visible to customers until you publish.</Alert>}
        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">Phase now</p>
              <p className="mt-1"><PhaseBadge c={c} /></p>
            </div>
            <div>
              <p className="text-xs text-muted">{nextLabel ?? 'Countdown'}</p>
              <p className="tabular mt-1 text-lg font-semibold">{target ? `in ${formatDuration(target.getTime() - now.getTime())}` : 'None'}</p>
              {target && <p className="text-xs text-muted">{formatIstDateTime(target)}</p>}
            </div>
            <div>
              <p className="text-xs text-muted">Live claim</p>
              <p className="mt-1 text-lg font-semibold">{c.claim.upToPercent != null ? `Up to ${c.claim.upToPercent}% off` : 'No % claim'}</p>
              <p className="text-xs text-muted">{c.claim.upToPercent != null ? `Across ${formatNumber(c.claim.productCount)} in-stock product${c.claim.productCount === 1 ? '' : 's'}, from real prices` : 'Shown once in-stock deals reach the minimum discount'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Schedule (IST)</CardTitle>{c.extended && <Badge tone="info">Extended</Badge>}</CardHeader>
          <CardContent>
            <KeyValue items={[
              { label: 'Teaser', value: c.teaserStartsAt ? formatIstDateTime(c.teaserStartsAt) : 'None' },
              { label: 'Early access', value: c.earlyAccessStartsAt ? formatIstDateTime(c.earlyAccessStartsAt) : 'None' },
              { label: 'Sale starts', value: formatIstDateTime(c.startsAt) },
              { label: 'Sale ends', value: <>{formatIstDateTime(c.endsAt)}{c.extended && c.originalEndsAt && <span className="block text-xs text-muted">Originally {formatIstDateTime(c.originalEndsAt)}. Customers are told it was extended.</span>}</> },
              { label: 'Published', value: c.publishedAt ? formatIstDateTime(c.publishedAt) : 'Not yet' },
            ]} />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Numbers</CardTitle></CardHeader>
          <CardContent>
            <KeyValue items={[
              { label: 'Sale prices', value: formatNumber(c.priceCount) },
              { label: 'Bundle offers', value: c.promotions.length ? c.promotions.map((p) => p.name).join(', ') : 'None' },
              { label: 'Budget', value: <BudgetMeter used={c.budgetUsed} budget={c.budget} /> },
              { label: 'Subscribers', value: formatNumber(c.subscriberCount) },
              { label: 'Priority', value: c.priority },
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Banner</CardTitle>{c.publishedAt && <a href={`${STOREFRONT}/sale/${c.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-muted hover:text-fg sm:min-h-0">Storefront <ExternalLink className="size-3" /></a>}</CardHeader>
          <CardContent><BannerPreview c={c} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function BannerPreview({ c }: { c: Pick<CampaignAdminDto, 'name' | 'banner' | 'claim'> }) {
  const bg = c.banner.themeColor ?? '#171717';
  return (
    <div className="overflow-hidden rounded-md text-white" style={{ background: bg }}>
      {c.banner.imageUrl && <img src={c.banner.imageUrl} alt="" className="h-24 w-full object-cover opacity-80" />}
      <div className="p-4">
        <p className="text-base font-bold leading-tight">{c.banner.title ?? c.name}</p>
        {c.banner.subtitle && <p className="mt-0.5 text-sm opacity-90">{c.banner.subtitle}</p>}
        {c.claim.upToPercent != null && <p className="mt-2 inline-block rounded-sm bg-white/15 px-2 py-0.5 text-xs font-semibold">Up to {c.claim.upToPercent}% off</p>}
      </div>
    </div>
  );
}

function ChecklistTab({ campaignId, status }: { campaignId: string; status: CampaignAdminDto['status'] }) {
  const { data, error, isLoading, mutate, isValidating } = useApi<CampaignChecklistDto>(`/campaigns/${campaignId}/checklist`);
  if (error && !data) return <ErrorState error={error} onRetry={() => void mutate()} />;
  if (isLoading || !data) return <Skeleton className="h-48" />;
  const errors = data.problems.filter((p) => p.level === 'error');
  const warnings = data.problems.filter((p) => p.level === 'warning');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.ready ? 'Ready to publish' : 'Not ready to publish'}</CardTitle>
        <Button variant="outline" size="sm" className="max-sm:h-11" loading={isValidating} onClick={() => void mutate()}>Re-check</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {status !== 'DRAFT' && <p className="text-xs text-muted">Already published. The checklist still flags problems worth fixing.</p>}
        {data.ready && !warnings.length && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> No problems found.</p>}
        {errors.length > 0 && (
          <section aria-labelledby="ck-errors">
            <h4 id="ck-errors" className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">Must fix ({errors.length})</h4>
            <ul className="space-y-1.5">{errors.map((p) => <li key={p.message} className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"><XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{p.message}</li>)}</ul>
          </section>
        )}
        {warnings.length > 0 && (
          <section aria-labelledby="ck-warn">
            <h4 id="ck-warn" className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">Warnings ({warnings.length})</h4>
            <ul className="space-y-1.5">{warnings.map((p) => <li key={p.message} className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{p.message}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">Warnings do not block publishing.</p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewTab({ c }: { c: CampaignAdminDto }) {
  const [input, setInput] = React.useState(() => isoToIstInput(new Date()));
  const iso = istInputToIso(input);
  const { data, error, isLoading } = useApi<CampaignPreviewDto>(iso ? `/campaigns/${c.id}/preview` : null, { at: iso ?? undefined });
  const presets = [
    c.teaserStartsAt && { label: 'Teaser', at: c.teaserStartsAt },
    c.earlyAccessStartsAt && { label: 'Early access', at: c.earlyAccessStartsAt },
    { label: 'Sale start', at: c.startsAt },
    { label: '1 min before end', at: new Date(new Date(c.endsAt).getTime() - 60_000).toISOString() },
    { label: 'After end', at: c.endsAt },
  ].filter(Boolean) as { label: string; at: string }[];
  const p = data?.campaign;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader><CardTitle>Pick a moment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Date and time (IST)" htmlFor="pv-at" error={input && !iso ? 'Enter a valid date and time' : undefined}>
            <Input id="pv-at" type="datetime-local" value={input} onChange={(e) => setInput(e.target.value)} className="max-sm:h-11" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="subtle" size="sm" className="max-sm:h-11" onClick={() => setInput(isoToIstInput(new Date()))}>Now</Button>
            {presets.map((x) => <Button key={x.label} variant="subtle" size="sm" className="max-sm:h-11" onClick={() => setInput(isoToIstInput(x.at))}>{x.label}</Button>)}
          </div>
          <p className="text-xs text-muted">Shows what a shopper would see then{c.status === 'DRAFT' ? ', as if this draft were published' : ''}. Prices you change later still apply.</p>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Storefront at {iso ? formatIstDateTime(iso) : '...'}</CardTitle></CardHeader>
        <CardContent>
          {error ? <ErrorState error={error} /> : isLoading && !data ? <Skeleton className="h-40" /> : p && data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CAMPAIGN_PHASE_TONE[p.phase]}>{CAMPAIGN_PHASE_LABEL[p.phase]}</Badge>
                {p.extended && <Badge tone="info">Extended</Badge>}
              </div>
              <KeyValue items={[
                { label: 'Banner shown', value: ['TEASER', 'EARLY_ACCESS', 'LIVE'].includes(p.phase) ? 'Yes' : 'No' },
                { label: 'Sale prices', value: <span className={cn('font-semibold', data.salePriceApplies ? 'text-emerald-700' : 'text-muted')}>{data.salePriceApplies ? 'Apply for everyone' : data.earlyAccessApplies ? 'Early-access members only' : 'Not applied'}</span> },
                { label: 'Countdown to', value: p.countdownTo && iso ? `${formatIstDateTime(p.countdownTo)} (in ${formatDuration(new Date(p.countdownTo).getTime() - new Date(iso).getTime())})` : 'No countdown' },
                { label: 'Bundle offers', value: p.promotions.length ? p.promotions.map((x) => x.name).join(', ') : 'None' },
              ]} />
              {['TEASER', 'EARLY_ACCESS', 'LIVE'].includes(p.phase) && <BannerPreview c={{ name: p.name, banner: p.banner, claim: p.claim }} />}
              <p className="text-xs text-muted">The &quot;Up to X% off&quot; claim is calculated from current in-stock prices, so it may differ on the day.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
