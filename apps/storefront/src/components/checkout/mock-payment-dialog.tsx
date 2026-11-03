'use client';

import * as React from 'react';
import { FlaskConical } from 'lucide-react';
import { formatINR } from '@vyra/shared';
import { Alert, Button } from '@vyra/ui';
import { Modal } from '../ui/dialog';

export function MockPaymentDialog({
  open,
  onOpenChange,
  amountPaise,
  orderNumber,
  onOutcome,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  amountPaise: number;
  orderNumber: string;
  onOutcome: (o: 'success' | 'failure') => Promise<void>;
  error: string | null;
}) {
  const [busy, setBusy] = React.useState<'success' | 'failure' | null>(null);
  const run = async (o: 'success' | 'failure') => {
    setBusy(o);
    try {
      await onOutcome(o);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Test payment"
      size="sm"
    >
      <div className="space-y-4 p-5">
        <div
          className="flex items-center gap-3 rounded-md border-2 border-dashed border-warning bg-amber-50 px-4 py-3 text-amber-800"
          role="note"
        >
          <FlaskConical className="size-6 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-extrabold tracking-wide">TEST MODE — no real money</p>
            <p className="text-xs">
              The mock payment provider is enabled. Choose an outcome to simulate.
            </p>
          </div>
        </div>
        <dl className="flex justify-between text-sm">
          <dt className="text-muted">Order</dt>
          <dd className="font-semibold">{orderNumber}</dd>
        </dl>
        <dl className="flex justify-between text-sm">
          <dt className="text-muted">Amount</dt>
          <dd className="font-bold">{formatINR(amountPaise / 100)}</dd>
        </dl>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            onClick={() => void run('failure')}
            loading={busy === 'failure'}
            disabled={busy !== null}
          >
            Simulate failure
          </Button>
          <Button
            onClick={() => void run('success')}
            loading={busy === 'success'}
            disabled={busy !== null}
          >
            Simulate success
          </Button>
        </div>
      </div>
    </Modal>
  );
}
