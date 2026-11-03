'use client';

import * as React from 'react';
import { MapPin, Truck } from 'lucide-react';
import { pincodeSchema } from '@vyra/shared';
import { Button, Input } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { deliveryDate } from '@/lib/format';
import { getSavedPincode, savePincode } from '@/lib/recently-viewed';

export interface Serviceability {
  pincode: string;
  serviceable: boolean;
  codAvailable: boolean;
  estimatedDays: { min: number; max: number };
  expressAvailable: boolean;
  city: string | null;
  state: string | null;
  /** 'shiprocket' = live courier quote; 'estimate' = zone-based estimate. */
  source?: 'shiprocket' | 'estimate';
}

export function checkServiceability(pincode: string, signal?: AbortSignal) {
  return api<Serviceability>('/shipping/serviceability', { query: { pincode }, signal });
}

export function PincodeCheck() {
  const [pin, setPin] = React.useState('');
  const [result, setResult] = React.useState<Serviceability | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const id = React.useId();

  const check = React.useCallback(async (value: string) => {
    const parsed = pincodeSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid PIN code');
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await checkServiceability(parsed.data);
      setResult(r);
      savePincode(parsed.data);
    } catch (e) {
      setError(errorMessage(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const saved = getSavedPincode();
    if (saved) {
      setPin(saved);
      void check(saved);
    }
  }, [check]);

  return (
    <div>
      <label htmlFor={id} className="mb-2 flex items-center gap-2 text-sm font-bold">
        <Truck className="size-4" aria-hidden />
        Delivery options
      </label>
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void check(pin);
        }}
      >
        <Input
          id={id}
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          placeholder="Enter PIN code"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          invalid={!!error}
          aria-describedby={`${id}-result`}
        />
        <Button type="submit" variant="outline" loading={loading}>
          Check
        </Button>
      </form>
      <div id={`${id}-result`} aria-live="polite" className="mt-2 text-sm">
        {error && <p className="text-danger">{error}</p>}
        {result &&
          (result.serviceable ? (
            <ul className="space-y-1">
              <li className="flex items-center gap-1.5 text-fg">
                <MapPin className="size-3.5 text-muted" aria-hidden />
                {[result.city, result.state].filter(Boolean).join(', ') || result.pincode}
              </li>
              <li>
                Get it by <strong>{deliveryDate(result.estimatedDays.max)}</strong>
                {result.estimatedDays.min !== result.estimatedDays.max && (
                  <span className="text-muted">
                    {' '}
                    (as early as {deliveryDate(result.estimatedDays.min)})
                  </span>
                )}
              </li>
              <li className={result.codAvailable ? 'text-success' : 'text-muted'}>
                {result.codAvailable
                  ? 'Pay on delivery available'
                  : 'Pay on delivery not available'}
              </li>
              {result.expressAvailable && (
                <li className="text-muted">Express delivery available at checkout</li>
              )}
              {result.source === 'estimate' && (
                <li className="text-xs text-subtle">
                  Estimated delivery time; exact dates confirmed at dispatch.
                </li>
              )}
            </ul>
          ) : (
            <p className="text-danger">Sorry, we don’t deliver to {result.pincode} yet.</p>
          ))}
        {!result && !error && (
          <p className="text-xs text-muted">
            Check delivery dates and pay-on-delivery availability.
          </p>
        )}
      </div>
    </div>
  );
}
