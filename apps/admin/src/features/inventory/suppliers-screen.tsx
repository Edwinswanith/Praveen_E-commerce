'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { supplierSchema } from '@vyra/shared';
import { Alert, Button, Field, Input, Textarea } from '@vyra/ui';
import { Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, blankToNull, parseOrSetErrors } from '@/lib/forms';
import type { SupplierDto } from '@vyra/shared';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { DataTable } from '@/components/data-table/data-table';
import { SearchInput } from '@/components/data-table/search-input';
import { PageHeader } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';

export function SuppliersScreen() {
  const { can } = useAuth();
  const canWrite = can(PERM.inventoryWrite);
  const confirm = useConfirm();
  const [q, setQ] = React.useState('');
  const { data: all, error, isLoading, mutate } = useApi<SupplierDto[]>('/suppliers');
  // The suppliers endpoint returns the full active list; search is client-side.
  const data = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all?.filter((s) => [s.name, s.contactName, s.email, s.phone, s.gstin].some((v) => v?.toLowerCase().includes(term)));
  }, [all, q]);
  const [editing, setEditing] = React.useState<SupplierDto | 'new' | null>(null);

  const remove = React.useCallback(async (s: SupplierDto) => {
    if (!(await confirm({ title: `Delete supplier “${s.name}”?`, description: 'The supplier is deactivated and hidden from pickers; history is kept.', confirmLabel: 'Delete', destructive: true }))) return;
    try { await api.delete(`/suppliers/${s.id}`); toast.success('Supplier deleted'); void mutate(); }
    catch (err) { toast.error(errorMessage(err)); }
  }, [confirm, mutate]);

  const columns = React.useMemo<ColumnDef<SupplierDto, unknown>[]>(() => [
    { header: 'Name', accessorKey: 'name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { header: 'Contact', accessorKey: 'contactName', cell: ({ row }) => row.original.contactName ?? '—' },
    { header: 'Email', accessorKey: 'email', cell: ({ row }) => row.original.email ? <a href={`mailto:${row.original.email}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.email}</a> : '—' },
    { header: 'Phone', accessorKey: 'phone', cell: ({ row }) => row.original.phone ?? '—' },
    { header: 'GSTIN', accessorKey: 'gstin', cell: ({ row }) => <span className="font-mono text-xs">{row.original.gstin ?? '—'}</span> },
    ...(canWrite ? [{
      id: 'actions', header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }: { row: { original: SupplierDto } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)} aria-label={`Edit ${row.original.name}`}><Pencil /></Button>
          <Button variant="ghost" size="sm" onClick={() => void remove(row.original)} aria-label={`Delete ${row.original.name}`}><Trash2 /></Button>
        </div>
      ),
    } satisfies ColumnDef<SupplierDto, unknown>] : []),
  ], [canWrite, remove]);

  return (
    <>
      <PageHeader title="Suppliers" description="Vendors you receive stock from." actions={canWrite && <Button size="sm" onClick={() => setEditing('new')}><Plus /> New supplier</Button>} />
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
        getRowId={(s) => s.id}
        onRowClick={canWrite ? (s) => setEditing(s) : undefined}
        empty={{ icon: <Truck />, title: 'No suppliers yet' }}
        toolbar={<SearchInput value={q} onChange={setQ} placeholder="Search suppliers" />}
      />
      {editing && <SupplierDialog supplier={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </>
  );
}

interface Values { name: string; contactName: string; email: string; phone: string; gstin: string; address: string }

function SupplierDialog({ supplier, onClose, onSaved }: { supplier?: SupplierDto; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    defaultValues: {
      name: supplier?.name ?? '', contactName: supplier?.contactName ?? '', email: supplier?.email ?? '', phone: supplier?.phone ?? '',
      gstin: supplier?.gstin ?? '', address: supplier?.address ?? '',
    },
  });
  const onSubmit = handleSubmit(async (v) => {
    const parsed = parseOrSetErrors(supplierSchema, blankToNull({ ...v, gstin: v.gstin.toUpperCase() }), setError);
    if (!parsed) return;
    try {
      if (supplier) await api.patch(`/suppliers/${supplier.id}`, parsed);
      else await api.post('/suppliers', parsed);
      toast.success(supplier ? 'Supplier updated' : 'Supplier created');
      onSaved();
    } catch (err) {
      if (!applyApiErrors(err, setError)) toast.error(errorMessage(err));
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={supplier ? `Edit ${supplier.name}` : 'New supplier'} modalLock
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={isSubmitting} onClick={() => void onSubmit()}>Save</Button></>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {errors.root?.server && <Alert tone="danger" className="sm:col-span-2">{errors.root.server.message}</Alert>}
        <Field label="Name" htmlFor="s-name" error={errors.name?.message} className="sm:col-span-2"><Input id="s-name" invalid={!!errors.name} {...register('name')} /></Field>
        <Field label="Contact person" htmlFor="s-contact" error={errors.contactName?.message}><Input id="s-contact" {...register('contactName')} /></Field>
        <Field label="Phone" htmlFor="s-phone" error={errors.phone?.message}><Input id="s-phone" type="tel" {...register('phone')} /></Field>
        <Field label="Email" htmlFor="s-email" error={errors.email?.message}><Input id="s-email" type="email" invalid={!!errors.email} {...register('email')} /></Field>
        <Field label="GSTIN" htmlFor="s-gstin" error={errors.gstin?.message}><Input id="s-gstin" className="uppercase" maxLength={15} invalid={!!errors.gstin} {...register('gstin')} /></Field>
        <Field label="Address" htmlFor="s-addr" error={errors.address?.message} className="sm:col-span-2"><Textarea id="s-addr" rows={3} {...register('address')} /></Field>
      </form>
    </Dialog>
  );
}
