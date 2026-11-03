'use client';
import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import type { EmbeddingStatusDto, RoleName } from '@vyra/shared';
import { staffUserSchema } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@vyra/ui';
import { Plus, RefreshCw, Sparkles, UserX, UserCheck } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, parseOrSetErrors } from '@/lib/forms';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { useUrlState } from '@/hooks/use-url-state';
import type { AuditLogDto, StaffUserDto } from '@vyra/shared';
import { formatDateTime, formatNumber, humanize } from '@/lib/format';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { ErrorState, Forbidden, PageHeader, StatCard } from '@/components/ui/feedback';
import { Select } from '@/components/ui/controls';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { IntegrationsCard } from './integrations';

type Tab = 'staff' | 'ai' | 'audit' | 'integrations';

export function SettingsScreen() {
  const { can } = useAuth();
  const available: { value: Tab; label: string; perm: string | null }[] = [
    { value: 'staff', label: 'Staff', perm: PERM.staffManage },
    { value: 'ai', label: 'AI search', perm: PERM.catalogWrite },
    { value: 'audit', label: 'Audit log', perm: PERM.auditRead },
    { value: 'integrations', label: 'Integrations', perm: null },
  ].filter((t) => t.perm === null || can(t.perm)) as { value: Tab; label: string; perm: string | null }[];
  const [f, setF] = useUrlState({ tab: '' });
  const tab = (available.find((t) => t.value === f.tab) ?? available[0])?.value;
  if (!tab) return <><PageHeader title="Settings" /><Forbidden /></>;
  return (
    <>
      <PageHeader title="Settings" description="Team access, AI search index, audit trail and integration status." />
      <Tabs.Root value={tab} onValueChange={(v) => setF({ tab: v })}>
        <Tabs.List aria-label="Settings sections" className="mb-5 flex gap-1 border-b border-border">
          {available.map((t) => (
            <Tabs.Trigger key={t.value} value={t.value} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-fg data-[state=active]:border-brand-500 data-[state=active]:text-fg">{t.label}</Tabs.Trigger>
          ))}
        </Tabs.List>
        {available.some((t) => t.value === 'staff') && <Tabs.Content value="staff"><StaffTab /></Tabs.Content>}
        {available.some((t) => t.value === 'ai') && <Tabs.Content value="ai"><AiTab /></Tabs.Content>}
        {available.some((t) => t.value === 'audit') && <Tabs.Content value="audit"><AuditTab /></Tabs.Content>}
        <Tabs.Content value="integrations"><IntegrationsCard /></Tabs.Content>
      </Tabs.Root>
    </>
  );
}

/** Mirrors the API's no-escalation rule: only SUPER_ADMIN may create/manage ADMINs. */
function assignableRoles(actor: RoleName): ('ADMIN' | 'INVENTORY_MANAGER' | 'ORDER_MANAGER')[] {
  if (actor === 'SUPER_ADMIN') return ['ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'];
  if (actor === 'ADMIN') return ['INVENTORY_MANAGER', 'ORDER_MANAGER'];
  return [];
}

function StaffTab() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [page, setPage] = React.useState(1);
  const { data, meta, error, isLoading, mutate } = useApi<StaffUserDto[]>('/users', { page, pageSize: 25 });
  const [creating, setCreating] = React.useState(false);
  const ASSIGNABLE = React.useMemo(() => assignableRoles(user.role), [user.role]);

  const patch = React.useCallback(async (u: StaffUserDto, body: { role?: RoleName; isActive?: boolean }) => {
    if (body.isActive === false && !(await confirm({ title: `Deactivate ${u.name}?`, description: 'They will be signed out and unable to log in.', confirmLabel: 'Deactivate', destructive: true }))) return;
    if (body.role && !(await confirm({ title: `Change ${u.name}'s role to ${humanize(body.role)}?`, confirmLabel: 'Change role' }))) { void mutate(); return; }
    try { await api.patch(`/users/${u.id}`, body); toast.success('Staff user updated'); void mutate(); }
    catch (err) { toast.error(errorMessage(err)); void mutate(); }
  }, [confirm, mutate]);

  const columns = React.useMemo<ColumnDef<StaffUserDto, unknown>[]>(() => [
    { header: 'Name', id: 'name', cell: ({ row: { original: u } }) => <span className="block"><span className="block font-medium">{u.name}{u.id === user.id && <span className="ml-1.5 text-xs text-muted">(you)</span>}</span><span className="text-xs text-muted">{u.email ?? u.phone}</span></span> },
    {
      header: 'Role', accessorKey: 'role',
      cell: ({ row: { original: u } }) => !ASSIGNABLE.includes(u.role as never) || u.id === user.id ? <Badge tone="neutral">{humanize(u.role)}</Badge> : (
        <Select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => void patch(u, { role: e.target.value as RoleName })} className="w-48">
          {ASSIGNABLE.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
        </Select>
      ),
    },
    { header: 'Status', accessorKey: 'isActive', cell: ({ row }) => <Badge tone={row.original.isActive ? 'success' : 'neutral'}>{row.original.isActive ? 'Active' : 'Deactivated'}</Badge> },
    { header: 'Last login', accessorKey: 'lastLoginAt', cell: ({ row }) => <span className="text-muted">{formatDateTime(row.original.lastLoginAt)}</span> },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: u } }) => u.id === user.id || !ASSIGNABLE.includes(u.role as never) ? null : (
        <div className="flex justify-end">
          {u.isActive
            ? <Button variant="ghost" size="sm" className="text-danger" onClick={() => void patch(u, { isActive: false })}><UserX /> Deactivate</Button>
            : <Button variant="ghost" size="sm" onClick={() => void patch(u, { isActive: true })}><UserCheck /> Reactivate</Button>}
        </div>
      ),
    },
  ], [patch, user.id, ASSIGNABLE]);

  return (
    <>
      <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setCreating(true)}><Plus /> Add staff user</Button></div>
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(u) => u.id} empty={{ title: 'No staff users' }} footer={<Pagination meta={meta} onPageChange={setPage} />} />
      {creating && <CreateStaffDialog roles={ASSIGNABLE} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void mutate(); }} />}
    </>
  );
}

interface StaffValues { name: string; email: string; password: string; role: 'ADMIN' | 'INVENTORY_MANAGER' | 'ORDER_MANAGER' }

function CreateStaffDialog({ roles, onClose, onDone }: { roles: StaffValues['role'][]; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<StaffValues>({ defaultValues: { name: '', email: '', password: '', role: 'INVENTORY_MANAGER' } });
  const submit = handleSubmit(async (v) => {
    const parsed = parseOrSetErrors(staffUserSchema, v, setError);
    if (!parsed) return;
    try { await api.post('/users', parsed); toast.success(`${parsed.name} added`); onDone(); }
    catch (err) { if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) }); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add staff user" description="Share the temporary password securely; ask them to change it after first login." modalLock
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={isSubmitting} onClick={() => void submit()}>Create user</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
        <Field label="Name" htmlFor="su-name" error={errors.name?.message}><Input id="su-name" invalid={!!errors.name} {...register('name')} /></Field>
        <Field label="Email" htmlFor="su-email" error={errors.email?.message}><Input id="su-email" type="email" autoComplete="off" invalid={!!errors.email} {...register('email')} /></Field>
        <Field label="Temporary password" htmlFor="su-pass" error={errors.password?.message} hint="8+ characters with a letter and a number"><Input id="su-pass" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} /></Field>
        <Field label="Role" htmlFor="su-role" error={errors.role?.message}>
          <Select id="su-role" {...register('role')}>{roles.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select>
        </Field>
      </form>
    </Dialog>
  );
}

function AiTab() {
  const { data, error, isLoading, mutate } = useApi<EmbeddingStatusDto>('/ai/status', undefined, { refreshInterval: 15_000 });
  const confirm = useConfirm();
  const [pending, setPending] = React.useState(false);
  const reindex = async () => {
    if (!(await confirm({ title: 'Re-index the whole catalog?', description: 'Text and image embeddings are regenerated for every product. This uses the embedding provider quota and runs in the background.', confirmLabel: 'Start re-index' }))) return;
    setPending(true);
    try { await api.post('/ai/reindex', {}); toast.success('Re-index queued'); void mutate(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setPending(false); }
  };
  if (error && !data) return <ErrorState error={error} onRetry={() => void mutate()} />;
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const pct = data.productsTotal ? Math.round((data.productsIndexed / data.productsTotal) * 100) : 0;
  return (
    <div className="space-y-5">
      {!data.configured && <Alert tone="warning" title="Embedding provider not configured">Semantic and visual search fall back to keyword search until an embedding provider is configured on the API.</Alert>}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-violet-500" /> Search index</CardTitle><Button size="sm" variant="outline" loading={pending} disabled={!data.configured} onClick={() => void reindex()}><RefreshCw /> Re-index all</Button></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div><p className="text-xs text-muted">Provider</p><p className="font-medium">{data.provider}</p></div>
            <div><p className="text-xs text-muted">Model</p><p className="font-medium break-all">{data.model}</p></div>
            <div><p className="text-xs text-muted">Dimensions</p><p className="tabular font-medium">{formatNumber(data.dimensions)}</p></div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-sm"><span>Products indexed</span><span className="tabular font-semibold">{formatNumber(data.productsIndexed)} / {formatNumber(data.productsTotal)} ({pct}%)</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Products indexed"><div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} /></div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending jobs" value={formatNumber(data.counts.pending)} />
        <StatCard label="Processing" value={formatNumber(data.counts.processing)} />
        <StatCard label="Completed" value={formatNumber(data.counts.completed)} />
        <StatCard label="Failed" value={formatNumber(data.counts.failed)} tone={data.counts.failed ? 'danger' : 'default'} />
      </div>
    </div>
  );
}

function AuditTab() {
  const [entity, setEntity] = React.useState('');
  const [page, setPage] = React.useState(1);
  const { data, meta, error, isLoading, mutate } = useApi<AuditLogDto[]>('/audit-logs', { entity, page, pageSize: 30 });
  const [open, setOpen] = React.useState<AuditLogDto | null>(null);
  const columns = React.useMemo<ColumnDef<AuditLogDto, unknown>[]>(() => [
    { header: 'When', accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(row.original.createdAt)}</span> },
    { header: 'Actor', id: 'actor', cell: ({ row }) => row.original.actorName ?? 'System' },
    { header: 'Action', accessorKey: 'action', cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span> },
    { header: 'Entity', accessorKey: 'entity', cell: ({ row }) => <span className="text-xs">{row.original.entity}{row.original.entityId && <span className="block font-mono text-muted">{row.original.entityId}</span>}</span> },
  ], []);
  return (
    <>
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(r) => r.id} dense onRowClick={setOpen} empty={{ title: 'No audit entries' }}
        toolbar={
          <Select aria-label="Entity" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="w-56">
            <option value="">All entities</option>
            {['Product', 'Variant', 'Category', 'Inventory', 'Order', 'Return', 'Coupon', 'User', 'Supplier', 'PurchaseOrder'].map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        }
        footer={<Pagination meta={meta} onPageChange={setPage} />} />
      {open && (
        <Sheet open onOpenChange={(o) => !o && setOpen(null)} title={open.action} description={`${open.entity}${open.entityId ? ` · ${open.entityId}` : ''}`}>
          <p className="mb-3 text-sm text-muted">{formatDateTime(open.createdAt)} · {open.actorName ?? 'System'}</p>
          <div className="space-y-3">
            {(['before', 'after'] as const).map((k) => (
              <div key={k}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{k}</p>
                <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs leading-relaxed">{open[k] === undefined || open[k] === null ? '—' : JSON.stringify(open[k], null, 2)}</pre>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
