'use client';
import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { ReturnRequestDto, ReturnStatus } from '@vyra/shared';
import { returnDecisionSchema } from '@vyra/shared';
import { Alert, Badge, Button, Field, Textarea, cn } from '@vyra/ui';
import { Undo2 } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { useUrlState } from '@/hooks/use-url-state';
import { formatDateTime, formatINR, humanize } from '@/lib/format';
import { RETURN_STATUS_TONE, RETURN_TYPE_LABEL, RETURN_TYPE_TONE } from '@/lib/status';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/controls';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { exchangeLabel, type ReturnItem } from './exchange';

type Action = 'APPROVE' | 'REJECT' | 'RECEIVE' | 'REFUND';
const ACTIONS_FOR: Record<ReturnStatus, Action[]> = { REQUESTED: ['APPROVE', 'REJECT'], APPROVED: ['RECEIVE', 'REJECT'], RECEIVED: ['REFUND'], REJECTED: [], REFUNDED: [], EXCHANGED: [] };
const ACTION_LABEL: Record<Action, string> = { APPROVE: 'Approve', REJECT: 'Reject', RECEIVE: 'Mark received', REFUND: 'Refund' };
const TABS: ('ALL' | ReturnStatus)[] = ['ALL', 'REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED', 'EXCHANGED', 'REJECTED'];

/** Valid decisions for a return. Exchanges are fulfilled by a replacement order, so they are never refunded once one exists. */
export function returnActions(r: Pick<ReturnRequestDto, 'status' | 'type' | 'replacementOrderNumber'>): Action[] {
  const actions = ACTIONS_FOR[r.status] ?? [];
  return r.replacementOrderNumber ? actions.filter((a) => a !== 'REFUND') : actions;
}

export function actionLabel(r: Pick<ReturnRequestDto, 'type'>, a: Action): string {
  if (a === 'RECEIVE' && r.type === 'EXCHANGE') return 'Receive & create replacement';
  return ACTION_LABEL[a];
}

export function ReturnsScreen() {
  const { can } = useAuth();
  const canWrite = can(PERM.ordersWrite);
  const [f, setF] = useUrlState({ status: 'REQUESTED', page: '1' });
  const { data, meta, error, isLoading, isValidating, mutate } = useApi<ReturnRequestDto[]>('/returns', { status: f.status === 'ALL' ? undefined : f.status, page: f.page, pageSize: 25 });
  const [decision, setDecision] = React.useState<{ ret: ReturnRequestDto; action: Action } | null>(null);

  const columns = React.useMemo<ColumnDef<ReturnRequestDto, unknown>[]>(() => [
    {
      header: 'Order', accessorKey: 'orderNumber',
      cell: ({ row: { original: r } }) => (
        <span className="block whitespace-nowrap">
          <Link href={`/orders/${r.orderId}`} className="font-medium hover:underline">{r.orderNumber}</Link>
          {r.replacementOrderNumber && <span className="block text-xs text-muted">Replacement <Link href={`/orders/${r.replacementOrderNumber}`} className="font-medium text-brand-600 hover:underline">{r.replacementOrderNumber}</Link></span>}
        </span>
      ),
    },
    { header: 'Type', accessorKey: 'type', cell: ({ row }) => <Badge tone={RETURN_TYPE_TONE[row.original.type]}>{RETURN_TYPE_LABEL[row.original.type]}</Badge> },
    { header: 'Requested', accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDateTime(row.original.createdAt)}</span> },
    { header: 'Reason', accessorKey: 'reason', cell: ({ row }) => <span className="block max-w-64"><span className="block">{humanize(row.original.reason)}</span>{row.original.comments && <span className="block truncate text-xs text-muted" title={row.original.comments}>{row.original.comments}</span>}</span> },
    { header: 'Items', id: 'items', cell: ({ row }) => <ReturnItems items={row.original.items} /> },
    { header: 'Refund', accessorKey: 'refundAmount', meta: { align: 'right' }, cell: ({ row }) => row.original.type === 'EXCHANGE' ? <span className="text-xs text-muted">Exchange</span> : formatINR(row.original.refundAmount) },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge value={row.original.status} tone={RETURN_STATUS_TONE[row.original.status]} /> },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: r } }) => (
        <div className="flex justify-end gap-1.5">
          {canWrite && returnActions(r).map((a) => (
            <Button key={a} size="sm" variant={a === 'REJECT' ? 'ghost' : 'outline'} className={a === 'REJECT' ? 'text-danger' : undefined} onClick={() => setDecision({ ret: r, action: a })}>{actionLabel(r, a)}</Button>
          ))}
        </div>
      ),
    },
  ], [canWrite]);

  return (
    <>
      <PageHeader title="Returns" description="Approve, receive and refund returns; receive exchanges to ship the replacement size or colour." />
      <div role="tablist" aria-label="Return status" className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={f.status === t} onClick={() => setF({ status: t })}
            className={cn('shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg', f.status === t && 'bg-bg text-fg shadow-sm ring-1 ring-border')}>
            {t === 'ALL' ? 'All' : humanize(t)}
          </button>
        ))}
      </div>
      <DataTable columns={columns} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(r) => r.id}
        empty={{ icon: <Undo2 />, title: 'No returns here' }} footer={<Pagination meta={meta} isValidating={isValidating} onPageChange={(p) => setF({ page: String(p) })} />} />
      {decision && <DecisionDialog ret={decision.ret} action={decision.action} onClose={() => setDecision(null)} onDone={() => { setDecision(null); void mutate(); }} />}
    </>
  );
}

function DecisionDialog({ ret, action, onClose, onDone }: { ret: ReturnRequestDto; action: Action; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = React.useState('');
  const [restock, setRestock] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async () => {
    const parsed = returnDecisionSchema.safeParse({ action, note: note.trim() || undefined, restock });
    if (!parsed.success) { setErr(parsed.error.issues[0]?.message ?? 'Invalid'); return; }
    setPending(true);
    try {
      await api.post(`/returns/${ret.id}/decision`, parsed.data);
      toast.success(action === 'RECEIVE' && ret.type === 'EXCHANGE' ? 'Exchange received; replacement order created' : `Return ${ACTION_LABEL[action].toLowerCase()}${action === 'REFUND' ? 'ed' : ''}`);
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  const copy: Record<Action, string> = {
    APPROVE: ret.type === 'EXCHANGE' ? 'The customer will be asked to send the items back; the replacement ships once they arrive.' : 'The customer will be asked to send the items back.',
    REJECT: 'The request is closed and the customer notified. Include a reason.',
    RECEIVE: ret.type === 'EXCHANGE' ? 'Confirm the items have arrived. A replacement order is created for the new size/colour and reserves its stock.' : 'Confirm the items have arrived at the warehouse.',
    REFUND: `Refund ${formatINR(ret.refundAmount)} to the customer's original payment method.`,
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${actionLabel(ret, action)}: ${RETURN_TYPE_LABEL[ret.type].toLowerCase()} for ${ret.orderNumber}`} description={copy[action]}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" variant={action === 'REJECT' || action === 'REFUND' ? 'danger' : 'secondary'} loading={pending} onClick={() => void submit()}>{actionLabel(ret, action)}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="danger">{err}</Alert>}
        <ul className="rounded-md border border-border text-sm">
          {ret.items.map((i) => <li key={i.orderItemId} className="flex justify-between gap-3 border-b border-border px-3 py-2 last:border-0"><span>{i.name} <span className="font-mono text-xs text-muted">{i.sku}</span>{i.exchangeFor && <span className="block text-xs text-violet-700">Exchange for {exchangeLabel(i)}</span>}</span><span className="tabular font-medium">×{i.quantity}</span></li>)}
        </ul>
        {action === 'RECEIVE' && (
          <div className="flex items-start gap-3 rounded-md bg-surface p-3">
            <Switch id="restock" checked={restock} onCheckedChange={setRestock} />
            <label htmlFor="restock" className="text-sm"><span className="font-medium">Restock items</span><span className="block text-xs text-muted">Adds the returned units back to sellable stock. Turn off for damaged items.</span></label>
          </div>
        )}
        <Field label={action === 'REJECT' ? 'Reason' : 'Note (optional)'} htmlFor="ret-note"><Textarea id="ret-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function ReturnItems({ items }: { items: ReturnItem[] }) {
  return (
    <span className="block max-w-64 text-xs">
      {items.map((i) => (
        <span key={i.orderItemId} className="block">
          <span className="block truncate"><span className="font-semibold">{i.quantity}×</span> {i.name} <span className="font-mono text-muted">{i.sku}</span></span>
          {i.exchangeFor && <span className="block font-medium text-violet-700">→ {exchangeLabel(i)} <span className="font-mono font-normal text-muted">{i.exchangeFor.sku}</span></span>}
        </span>
      ))}
    </span>
  );
}
