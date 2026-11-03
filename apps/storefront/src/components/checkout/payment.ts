import type { CheckoutResponse, OrderDetailDto } from '@vyra/shared';
import { api } from '@/lib/api';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  order_id: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string; method?: 'upi' | 'card' | 'netbanking' | 'wallet' };
  config?: { display?: { preferences?: { show_default_blocks?: boolean } } };
  theme?: { color?: string };
  handler: (resp: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', cb: (resp: { error?: { description?: string } }) => void) => void;
}
declare global {
  interface Window {
    Razorpay?: new (opts: RazorpayOptions) => RazorpayInstance;
  }
}

const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loader: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = RAZORPAY_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loader = null;
        reject(
          new Error('Could not load the payment gateway. Check your connection and try again.'),
        );
      };
      document.body.appendChild(s);
    });
  }
  return loader;
}

export class PaymentDismissed extends Error {
  constructor(message = 'Payment was not completed.') {
    super(message);
    this.name = 'PaymentDismissed';
  }
}

export function verifyPayment(
  orderId: string,
  providerOrderId: string,
  providerPaymentId: string,
  signature: string,
) {
  return api<OrderDetailDto>('/payments/verify', {
    method: 'POST',
    body: { orderId, providerOrderId, providerPaymentId, signature },
  });
}

/** Opens Razorpay Checkout and resolves with the verified order (server checks the HMAC signature). */
export async function payWithRazorpay(
  order: OrderDetailDto,
  payment: NonNullable<CheckoutResponse['payment']>,
): Promise<OrderDetailDto> {
  await loadRazorpay();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Payment gateway unavailable.');
  const resp = await new Promise<RazorpaySuccess>((resolve, reject) => {
    const rzp = new Razorpay({
      key: payment.keyId,
      amount: payment.amount,
      currency: payment.currency,
      name: payment.name,
      order_id: payment.providerOrderId,
      description: `Order ${order.number}`,
      // UPI first (most Indian shoppers pay this way); all other methods stay available.
      prefill: { ...payment.prefill, method: 'upi' },
      config: { display: { preferences: { show_default_blocks: true } } },
      theme: { color: '#ff3f6c' },
      handler: resolve,
      modal: { ondismiss: () => reject(new PaymentDismissed()) },
    });
    rzp.on('payment.failed', (r) => reject(new Error(r.error?.description ?? 'Payment failed.')));
    rzp.open();
  });
  return verifyPayment(
    order.id,
    resp.razorpay_order_id,
    resp.razorpay_payment_id,
    resp.razorpay_signature,
  );
}

/** Development-only mock gateway: authorise (success/failure) then verify server-side. */
export async function payWithMock(
  order: OrderDetailDto,
  providerOrderId: string,
  outcome: 'success' | 'failure',
): Promise<OrderDetailDto> {
  const auth = await api<{ providerOrderId: string; providerPaymentId: string; signature: string }>(
    '/payments/mock/authorize',
    {
      method: 'POST',
      body: { providerOrderId, outcome },
    },
  );
  return verifyPayment(order.id, auth.providerOrderId, auth.providerPaymentId, auth.signature);
}
