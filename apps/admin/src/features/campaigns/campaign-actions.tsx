'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { CampaignAdminDto } from '@vyra/shared';
import { Alert, Button, Field, Input, Textarea } from '@vyra/ui';
import { CalendarPlus, Pause, Pencil, Play, Rocket, Trash2, XCircle } from 'lucide-react';
import { api, errorMessage, ApiError } from '@/lib/api';
import { formatIstDateTime, istInputToIso, isoToIstInput } from '@/lib/ist';
import { Dialog } from '@/components/ui/dialog';
import { campaignActions, type CampaignAction } from './campaign-rules';

type DialogKind = 'publish' | 'pause' | 'resume' | 'cancel' | 'extend' | 'delete';

const COPY: Record<Exclude<DialogKind, 'extend'>, { title: string; body: string; confirm: string; destructive?: boolean; note: boolean }> = {
  publish: { title: 'Publish campaign?', body: 'The schedule takes effect: teaser, early access and sale prices switch on automatically at their IST times. The URL slug is locked after publishing.', confirm: 'Publish', note: false },
  pause: { title: 'Pause campaign?', body: 'Sale prices and bundle offers stop applying immediately and the banner is hidden. You can resume until the end time.', confirm: 'Pause', note: true },
  resume: { title: 'Resume campaign?', body: 'Sale prices and bundle offers apply again straight away (if the sale window is open).', confirm: 'Resume', note: true },
  cancel: { title: 'Cancel campaign?', body: 'The sale stops for good and cannot be restarted. Orders already placed keep their prices.', confirm: 'Cancel campaign', destructive: true, note: true },
  delete: { title: 'Delete draft?', body: 'The draft, its sale prices and its bundle links are removed. This cannot be undone.', confirm: 'Delete draft', destructive: true, note: false },
};

const LABEL: Record<Exclude<CampaignAction, 'edit'>, string> = { publish: 'Publish', pause: 'Pause', resume: 'Resume', cancel: 'Cancel campaign', extend: 'Extend', delete: 'Delete draft' };
const ICON = { publish: Rocket, pause: Pause, resume: Play, cancel: XCircle, extend: CalendarPlus, delete: Trash2 } as const;

/** Lifecycle buttons gated by status/phase + permission, each behind a confirm dialog. */
export function CampaignActions({ campaign, canWrite, onChanged, publishBlocked }: {
  campaign: CampaignAdminDto; canWrite: boolean; onChanged: (c: CampaignAdminDto | null) => void; publishBlocked?: string | null;
}) {
  const actions = campaignActions(campaign, canWrite);
  const [open, setOpen] = React.useState<DialogKind | null>(null);
  const order: Exclude<CampaignAction, 'edit'>[] = ['publish', 'resume', 'pause', 'extend', 'cancel', 'delete'];
  const visible = order.filter((a) => actions[a].visible);
  if (!visible.length && !actions.edit.visible) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="campaign-actions">
      {actions.edit.visible && (
        <Button asChild variant="outline" size="sm" className="max-sm:h-11"><Link href={`/campaigns/${campaign.id}/edit`}><Pencil /> Edit</Link></Button>
      )}
      {visible.map((a) => {
        const Icon = ICON[a];
        const reason = a === 'publish' ? publishBlocked ?? actions[a].disabledReason : actions[a].disabledReason;
        const id = `ca-${a}-reason`;
        return (
          <span key={a} className="inline-flex flex-col">
            <Button
              size="sm"
              className="max-sm:h-11"
              variant={a === 'publish' || a === 'resume' ? 'primary' : a === 'cancel' || a === 'delete' ? 'outline' : 'outline'}
              disabled={!!reason}
              aria-describedby={reason ? id : undefined}
              data-action={a}
              onClick={() => setOpen(a)}
            >
              <Icon /> {LABEL[a]}
            </Button>
            {reason && <span id={id} className="mt-1 max-w-64 text-xs text-warning">{reason}</span>}
          </span>
        );
      })}
      {open === 'extend' && <ExtendDialog campaign={campaign} onClose={() => setOpen(null)} onDone={(c) => { setOpen(null); onChanged(c); }} />}
      {open && open !== 'extend' && <ActionDialog kind={open} campaign={campaign} onClose={() => setOpen(null)} onDone={(c) => { setOpen(null); onChanged(c); }} />}
    </div>
  );
}

function ActionDialog({ kind, campaign, onClose, onDone }: { kind: Exclude<DialogKind, 'extend'>; campaign: CampaignAdminDto; onClose: () => void; onDone: (c: CampaignAdminDto | null) => void }) {
  const router = useRouter();
  const copy = COPY[kind];
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string[] | null>(null);

  const run = async () => {
    setPending(true); setError(null);
    try {
      if (kind === 'delete') {
        await api.delete(`/campaigns/${campaign.id}`);
        toast.success('Draft deleted');
        onDone(null);
        router.push('/campaigns');
        return;
      }
      const body = copy.note && note.trim() ? { note: note.trim() } : {};
      const c = await api.post<CampaignAdminDto>(`/campaigns/${campaign.id}/${kind}`, body);
      toast.success({ publish: 'Campaign published', pause: 'Campaign paused', resume: 'Campaign resumed', cancel: 'Campaign cancelled' }[kind]);
      onDone(c);
    } catch (err) {
      const list = err instanceof ApiError && err.formErrors.length ? err.formErrors : [];
      // publish returns the checklist as details on 422
      const problems = err instanceof ApiError && err.details && typeof err.details === 'object' && 'problems' in err.details
        ? ((err.details as { problems: { level: string; message: string }[] }).problems.filter((p) => p.level === 'error').map((p) => p.message))
        : [];
      setError([errorMessage(err), ...list, ...problems].filter((m, i, a) => a.indexOf(m) === i));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={copy.title} size="sm"
      footer={<>
        <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose}>Back</Button>
        <Button variant={copy.destructive ? 'danger' : 'secondary'} size="sm" className="max-sm:h-11" loading={pending} onClick={() => void run()}>{copy.confirm}</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{copy.body}</p>
        {error && <Alert tone="danger"><ul className="list-inside list-disc space-y-0.5">{error.map((m) => <li key={m}>{m}</li>)}</ul></Alert>}
        {copy.note && (
          <Field label="Note (optional)" htmlFor="ca-note" hint="Saved to the audit log, e.g. why this was done">
            <Textarea id="ca-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function ExtendDialog({ campaign, onClose, onDone }: { campaign: CampaignAdminDto; onClose: () => void; onDone: (c: CampaignAdminDto) => void }) {
  const [endsAt, setEndsAt] = React.useState(() => isoToIstInput(new Date(new Date(campaign.endsAt).getTime() + 86400_000)));
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const iso = istInputToIso(endsAt);
  const problem = !iso ? 'Enter a valid date and time'
    : new Date(iso) <= new Date(campaign.endsAt) ? 'Must be later than the current end'
    : new Date(iso) <= new Date() ? 'Must be in the future'
    : null;
  const noteProblem = note.trim().length < 3 ? 'Add a short reason (at least 3 characters)' : null;

  const run = async () => {
    if (problem || noteProblem || !iso) { setError(problem ?? noteProblem); return; }
    setPending(true); setError(null);
    try {
      const c = await api.post<CampaignAdminDto>(`/campaigns/${campaign.id}/extend`, { endsAt: iso, note: note.trim() });
      toast.success('Sale extended');
      onDone(c);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Extend sale" size="sm" modalLock
      footer={<>
        <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose}>Back</Button>
        <Button variant="secondary" size="sm" className="max-sm:h-11" loading={pending} disabled={!!problem || !!noteProblem} onClick={() => void run()}>Extend</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Currently ends {formatIstDateTime(campaign.endsAt)}. Customers see that the sale was extended{campaign.originalEndsAt ? ` (originally ending ${formatIstDateTime(campaign.originalEndsAt)})` : ''}. The end can only move later.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="New end (IST)" htmlFor="ext-end" error={problem ?? undefined}>
          <Input id="ext-end" type="datetime-local" value={endsAt} invalid={!!problem} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="ext-note" hint="Required. Saved to the audit log" error={note && noteProblem ? noteProblem : undefined}>
          <Textarea id="ext-note" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
