'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { CheckCircle2, XCircle } from 'lucide-react';
import { addressSchema, INDIAN_STATES, pincodeSchema, type AddressInput } from '@vyra/shared';
import { Alert, Button, Field, Input, cn } from '@vyra/ui';
import { applyApiErrors } from '@/lib/form-errors';
import { NativeSelect } from '../ui/select';
import { checkServiceability, type Serviceability } from '../pdp/pincode-check';

const FIELDS = [
  'fullName',
  'phone',
  'line1',
  'line2',
  'landmark',
  'city',
  'state',
  'pincode',
  'type',
  'isDefault',
] as const;

type FormIn = z.input<typeof addressSchema>;

export function AddressForm({
  defaultValues,
  onSubmit,
  submitLabel = 'Save address',
  onCancel,
  showDefault = true,
  onServiceability,
  onDraftChange,
}: {
  defaultValues?: Partial<AddressInput>;
  onSubmit: (values: AddressInput) => Promise<unknown>;
  submitLabel?: string;
  onCancel?: () => void;
  showDefault?: boolean;
  onServiceability?: (s: Serviceability | null) => void;
  /** Reports the parsed values whenever the form is valid (null otherwise), so a parent can submit without an extra click. */
  onDraftChange?: (values: AddressInput | null) => void;
}) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [svc, setSvc] = React.useState<{
    loading: boolean;
    data: Serviceability | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, AddressInput>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      type: 'HOME',
      isDefault: false,
      line2: '',
      landmark: '',
      ...defaultValues,
    } as FormIn,
  });
  const pincode = watch('pincode');
  const all = watch();
  const draftKey = JSON.stringify(all);

  React.useEffect(() => {
    if (!onDraftChange) return;
    const parsed = addressSchema.safeParse(all);
    onDraftChange(parsed.success ? parsed.data : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on serialised values
  }, [draftKey]);

  React.useEffect(() => {
    const parsed = pincodeSchema.safeParse(pincode ?? '');
    if (!parsed.success) {
      setSvc({ loading: false, data: null, error: null });
      onServiceability?.(null);
      return;
    }
    const ac = new AbortController();
    setSvc((s) => ({ ...s, loading: true, error: null }));
    checkServiceability(parsed.data, ac.signal)
      .then((data) => {
        setSvc({ loading: false, data, error: null });
        onServiceability?.(data);
        if (data.city && !getValues('city')) setValue('city', data.city);
        const st = data.state;
        if (st && !getValues('state') && (INDIAN_STATES as readonly string[]).includes(st))
          setValue('state', st as AddressInput['state']);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setSvc({ loading: false, data: null, error: 'Couldn’t check delivery for this PIN' });
        onServiceability?.(null);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when the PIN changes
  }, [pincode]);

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    if (svc.data && !svc.data.serviceable) {
      setError('pincode', { message: 'We don’t deliver to this PIN code yet' });
      return;
    }
    try {
      await onSubmit(values);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="ad-name" error={errors.fullName?.message}>
        <Input
          id="ad-name"
          autoComplete="name"
          {...register('fullName')}
          invalid={!!errors.fullName}
        />
      </Field>
      <Field
        label="Mobile number"
        htmlFor="ad-phone"
        error={errors.phone?.message}
        hint="For delivery updates"
      >
        <Input
          id="ad-phone"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel-national"
          {...register('phone')}
          invalid={!!errors.phone}
        />
      </Field>
      <Field label="PIN code" htmlFor="ad-pin" error={errors.pincode?.message}>
        <Input
          id="ad-pin"
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          {...register('pincode')}
          invalid={!!errors.pincode}
          aria-describedby="ad-pin-svc"
        />
        <p id="ad-pin-svc" aria-live="polite" className="mt-1 min-h-4 text-xs">
          {svc.loading && <span className="text-muted">Checking delivery…</span>}
          {svc.error && <span className="text-danger">{svc.error}</span>}
          {svc.data &&
            (svc.data.serviceable ? (
              <span className="inline-flex items-center gap-1 text-teal-600">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Delivers in {svc.data.estimatedDays.min}–{svc.data.estimatedDays.max} days
                {svc.data.codAvailable ? ' · COD available' : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-danger">
                <XCircle className="size-3.5" aria-hidden />
                Not serviceable
              </span>
            ))}
        </p>
      </Field>
      <Field label="City" htmlFor="ad-city" error={errors.city?.message}>
        <Input
          id="ad-city"
          autoComplete="address-level2"
          {...register('city')}
          invalid={!!errors.city}
        />
      </Field>
      <Field
        label="Address (house no, building, street)"
        htmlFor="ad-line1"
        error={errors.line1?.message}
        className="sm:col-span-2"
      >
        <Input
          id="ad-line1"
          autoComplete="address-line1"
          {...register('line1')}
          invalid={!!errors.line1}
        />
      </Field>
      <Field label="Locality / area (optional)" htmlFor="ad-line2" error={errors.line2?.message}>
        <Input id="ad-line2" autoComplete="address-line2" {...register('line2')} />
      </Field>
      <Field label="Landmark (optional)" htmlFor="ad-landmark" error={errors.landmark?.message}>
        <Input id="ad-landmark" {...register('landmark')} />
      </Field>
      <Field
        label="State"
        htmlFor="ad-state"
        error={errors.state?.message}
        className="sm:col-span-2"
      >
        <NativeSelect
          id="ad-state"
          autoComplete="address-level1"
          {...register('state')}
          invalid={!!errors.state}
          defaultValue=""
        >
          <option value="" disabled>
            Select state
          </option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Address type
        </legend>
        <div className="flex gap-2">
          {(['HOME', 'WORK', 'OTHER'] as const).map((t) => (
            <label
              key={t}
              className={cn(
                'cursor-pointer rounded-full border px-4 py-1.5 text-sm font-medium has-[:checked]:border-brand-500 has-[:checked]:text-brand-600 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
                'border-border-strong',
              )}
            >
              <input type="radio" value={t} {...register('type')} className="sr-only" />
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>
      {showDefault && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('isDefault')} className="size-4 accent-brand-500" />{' '}
          Make this my default address
        </label>
      )}
      {formError && (
        <Alert tone="danger" className="sm:col-span-2">
          {formError}
        </Alert>
      )}
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
