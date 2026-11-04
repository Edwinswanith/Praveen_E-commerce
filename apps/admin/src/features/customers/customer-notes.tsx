'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Textarea, cn } from '@vyra/ui';
import { Pencil } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';

export const NOTES_MAX = 2000;

/**
 * Internal support notes on a customer (POST /admin/customers/:id/notes).
 * Staff only, never shown to the shopper. Editing needs customers:write; everyone else sees them read-only.
 */
export function CustomerNotesCard({ customerId, notes, canWrite, onSaved }: {
  customerId: string; notes: string | null; canWrite: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(notes ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const id = `customer-notes-${customerId}`;
  const length = value.trim().length;
  const tooLong = length > NOTES_MAX;

  React.useEffect(() => { if (!editing) setValue(notes ?? ''); }, [notes, editing]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooLong) return;
    setPending(true);
    setError(null);
    try {
      await api.post(`/customers/${encodeURIComponent(customerId)}/notes`, { notes: value.trim() });
      toast.success('Notes saved');
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support notes</CardTitle>
        {canWrite && !editing && (
          <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {editing ? (
          <form onSubmit={(e) => void save(e)} noValidate className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Notes" htmlFor={id} error={tooLong ? `Keep notes to ${NOTES_MAX} characters or fewer` : undefined}>
              <Textarea id={id} rows={6} value={value} invalid={tooLong} onChange={(e) => setValue(e.target.value)}
                aria-describedby={`${id}-count${tooLong ? ` ${id}-error` : ''}`} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id={`${id}-count`} aria-live="polite" className={cn('tabular text-xs', tooLong ? 'font-semibold text-danger' : 'text-muted')}>
                {length} / {NOTES_MAX} characters
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="max-sm:h-11" onClick={() => { setEditing(false); setError(null); setValue(notes ?? ''); }}>Cancel</Button>
                <Button type="submit" variant="secondary" size="sm" className="max-sm:h-11" loading={pending} disabled={tooLong}>Save notes</Button>
              </div>
            </div>
            <p className="text-xs text-muted">Visible to staff only. Every change is recorded in the audit log.</p>
          </form>
        ) : notes ? (
          <p className="whitespace-pre-wrap break-words">{notes}</p>
        ) : (
          <p className="text-muted">No notes yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
