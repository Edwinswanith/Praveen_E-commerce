'use client';

import * as React from 'react';
import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import type { CheckoutResponse, OrderDetailDto } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { MockPaymentDialog } from './mock-payment-dialog';
import { payWithMock, payWithRazorpay, PaymentDismissed } from './payment';

/** Resume payment for a PENDING_PAYMENT order via POST /orders/:number/pay. */
export function PayNowButton({
  order,
  onPaid,
}: {
  order: OrderDetailDto;
  onPaid: (o: OrderDetailDto) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [mock, setMock] = React.useState<CheckoutResponse | null>(null);
  const [mockError, setMockError] = React.useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    try {
      const res = await api<CheckoutResponse>(`/orders/${encodeURIComponent(order.number)}/pay`, {
        method: 'POST',
      });
      if (!res.payment) {
        onPaid(res.order);
        return;
      }
      if (res.payment.provider === 'mock') {
        setMockError(null);
        setMock(res);
        return;
      }
      const verified = await payWithRazorpay(res.order, res.payment);
      toast.success('Payment received');
      onPaid(verified);
    } catch (e) {
      if (!(e instanceof PaymentDismissed))
        toast.error(errorMessage(e, 'Payment failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => void start()} loading={busy}>
        <CreditCard aria-hidden />
        Pay now
      </Button>
      {mock?.payment && (
        <MockPaymentDialog
          open
          onOpenChange={(o) => !o && setMock(null)}
          amountPaise={mock.payment.amount}
          orderNumber={mock.order.number}
          error={mockError}
          onOutcome={async (outcome) => {
            try {
              const verified = await payWithMock(
                mock.order,
                mock.payment!.providerOrderId,
                outcome,
              );
              setMock(null);
              toast.success('Payment received');
              onPaid(verified);
            } catch (e) {
              setMockError(errorMessage(e, 'Payment failed.'));
            }
          }}
        />
      )}
    </>
  );
}
