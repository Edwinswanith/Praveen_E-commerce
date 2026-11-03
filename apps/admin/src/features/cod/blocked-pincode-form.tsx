'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { codPincodeSchema, type CodSettingsDto } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, parseOrSetErrors } from '@/lib/forms';

interface Values { pincode: string; reason: string }

/** Adds a PIN code to the COD blocklist (POST /admin/cod/blocked-pincodes). */
export function BlockedPincodeForm({ onSaved, initialPincode = '' }: { onSaved: (s: CodSettingsDto) => void; initialPincode?: string }) {
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { pincode: initialPincode, reason: '' } });
  const submit = handleSubmit(async (v) => {
    const parsed = parseOrSetErrors(codPincodeSchema, { pincode: v.pincode.trim(), ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) }, setError);
    if (!parsed) return;
    try {
      const s = await api.post<CodSettingsDto>('/cod/blocked-pincodes', parsed);
      toast.success(`COD blocked for PIN ${parsed.pincode}`);
      reset({ pincode: '', reason: '' });
      onSaved(s);
    } catch (err) {
      if (!applyApiErrors(err, setError)) setError('root.server', { message: errorMessage(err) });
    }
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Block a PIN code">
      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
        <Field label="PIN code" htmlFor="cod-pin" error={errors.pincode?.message}>
          <Input id="cod-pin" inputMode="numeric" maxLength={6} placeholder="560001" className="font-mono" invalid={!!errors.pincode} {...register('pincode')} />
        </Field>
        <Field label="Reason (optional)" htmlFor="cod-pin-reason" error={errors.reason?.message}>
          <Input id="cod-pin-reason" placeholder="High refusal rate" invalid={!!errors.reason} {...register('reason')} />
        </Field>
        <Button type="submit" size="sm" className="sm:mt-6" loading={isSubmitting}><Plus /> Block PIN</Button>
      </div>
    </form>
  );
}
