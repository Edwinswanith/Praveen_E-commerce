'use client';

import * as React from 'react';
import useSWR from 'swr';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AddressDto, AddressInput } from '@vyra/shared';
import { Alert, Badge, Button, EmptyState, Skeleton } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { AddressForm } from '../checkout/address-form';
import { Modal } from '../ui/dialog';
import { PageHeader } from '../ui/page-header';

const KEY = '/users/me/addresses';

export function AddressesPage() {
  const { data, error, isLoading, mutate } = useSWR<AddressDto[]>(KEY);
  const [editing, setEditing] = React.useState<AddressDto | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<AddressDto | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async (values: AddressInput) => {
    if (editing === 'new') await api<AddressDto>(KEY, { method: 'POST', body: values });
    else if (editing)
      await api<AddressDto>(`${KEY}/${editing.id}`, { method: 'PATCH', body: values });
    await mutate();
    setEditing(null);
    toast.success('Address saved');
  };
  const makeDefault = async (a: AddressDto) => {
    try {
      await api(`${KEY}/${a.id}`, { method: 'PATCH', body: { isDefault: true } });
      await mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await mutate(
        async (cur) => {
          await api(`${KEY}/${deleting.id}`, { method: 'DELETE' });
          return (cur ?? []).filter((x) => x.id !== deleting.id);
        },
        { revalidate: true },
      );
      toast.success('Address removed');
      setDeleting(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saved addresses"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            Add address
          </Button>
        }
      />
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      )}
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {data && data.length === 0 && (
        <EmptyState
          icon={<MapPin />}
          title="No saved addresses"
          description="Add an address for faster checkout."
          action={<Button onClick={() => setEditing('new')}>Add address</Button>}
        />
      )}
      {data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.map((a) => (
            <li key={a.id} className="flex flex-col rounded-lg border border-border p-4 text-sm">
              <div className="flex items-center gap-2">
                <p className="font-bold">{a.fullName}</p>
                <Badge>{a.type}</Badge>
                {a.isDefault && <Badge tone="success">Default</Badge>}
              </div>
              <p className="mt-2 text-muted">
                {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
              </p>
              <p className="text-muted">
                {a.city}, {a.state} — {a.pincode}
              </p>
              <p className="mt-1 text-muted">Mobile: {a.phone}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                  <Pencil aria-hidden />
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>
                  <Trash2 aria-hidden />
                  Remove
                </Button>
                {!a.isDefault && (
                  <Button size="sm" variant="link" onClick={() => void makeDefault(a)}>
                    Set as default
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add address' : 'Edit address'}
        size="lg"
      >
        <div className="p-5">
          {editing !== null && (
            <AddressForm
              key={editing === 'new' ? 'new' : editing.id}
              defaultValues={
                editing === 'new'
                  ? undefined
                  : {
                      ...editing,
                      line2: editing.line2 ?? '',
                      landmark: editing.landmark ?? '',
                      state: editing.state as AddressInput['state'],
                    }
              }
              onSubmit={save}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
      </Modal>
      <Modal
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove address?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        }
      >
        <p className="p-5 text-sm text-muted">
          {deleting?.fullName}, {deleting?.line1}, {deleting?.city} will be removed from your saved
          addresses.
        </p>
      </Modal>
    </div>
  );
}
