'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { CodRiskDto } from '@vyra/shared';
import { Alert, Button, Field, Textarea } from '@vyra/ui';
import { ShieldBan, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';

/** Block / unblock Cash on Delivery for one phone number (PATCH /admin/cod/risks/:phone). */
export function CodBlockButton({ phone, blocked, onDone, size = 'sm' }: { phone: string; blocked: boolean; onDone: (r: CodRiskDto) => void; size?: 'sm' | 'md' }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const next = !blocked;
  const submit = async () => {
    const n = note.trim();
    if (n.length > 300) { setError('Keep the note under 300 characters'); return; }
    setPending(true);
    setError(null);
    try {
      const r = await api.patch<CodRiskDto>(`/cod/risks/${encodeURIComponent(phone)}`, { codBlocked: next, ...(n ? { note: n } : {}) });
      toast.success(next ? `COD blocked for ${phone}` : `COD unblocked for ${phone}`);
      setOpen(false);
      setNote('');
      onDone(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Button type="button" size={size} variant="outline" className={next ? 'text-danger hover:border-danger' : undefined} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        {next ? <ShieldBan /> : <ShieldCheck />}{next ? 'Block COD' : 'Unblock COD'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} size="sm" title={next ? `Block COD for ${phone}?` : `Allow COD for ${phone} again?`}
        description={next ? 'This phone will only be able to pay online at checkout.' : 'Cash on Delivery will be offered to this phone again (subject to PIN code rules).'}
        footer={<><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button variant={next ? 'danger' : 'secondary'} size="sm" loading={pending} onClick={() => void submit()}>{next ? 'Block COD' : 'Unblock COD'}</Button></>}>
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Note (optional)" htmlFor={`cod-risk-note-${phone}`} hint="Visible to staff only.">
            <Textarea id={`cod-risk-note-${phone}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
