import type { OrderStatus, PaymentStatus, ReturnStatus, SessionUser } from '@vyra/shared';

export { formatINR } from '@vyra/shared';

export function formatDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', opts).format(d);
}

export function formatDateTime(iso: string): string {
  return formatDate(iso, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Thu, 6 Nov" style date N days from today. */
export function deliveryDate(daysFromNow: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + daysFromNow);
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  RTO: 'Returned to sender',
};

export const ORDER_STATUS_TONE: Record<
  OrderStatus,
  'warning' | 'info' | 'success' | 'danger' | 'neutral'
> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'info',
  PACKED: 'info',
  SHIPPED: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  RETURNED: 'neutral',
  RTO: 'danger',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  CREATED: 'Awaiting payment',
  AUTHORIZED: 'Authorised',
  CAPTURED: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RECEIVED: 'Received',
  REFUNDED: 'Refunded',
  EXCHANGED: 'Exchanged',
};

export const RETURN_STATUS_TONE: Record<ReturnStatus, 'success' | 'info' | 'danger'> = {
  REQUESTED: 'info',
  APPROVED: 'info',
  REJECTED: 'danger',
  RECEIVED: 'info',
  REFUNDED: 'success',
  EXCHANGED: 'success',
};

export const FIT_LABEL = {
  RUNS_SMALL: 'Runs small',
  TRUE_TO_SIZE: 'True to size',
  RUNS_LARGE: 'Runs large',
} as const;

export const RETURN_REASONS = [
  { value: 'SIZE_ISSUE', label: 'Size or fit issue' },
  { value: 'DAMAGED', label: 'Item arrived damaged' },
  { value: 'WRONG_ITEM', label: 'Received a different item' },
  { value: 'QUALITY', label: 'Quality not as expected' },
  { value: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { value: 'OTHER', label: 'Other' },
] as const;

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "+91 98765 43210" for a 10-digit Indian mobile; anything else unchanged. */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^\d{10}$/.test(d) ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : phone;
}

/** What to show under the name in account menus: email, or phone for phone-only accounts. */
export function userContact(user: Pick<SessionUser, 'email' | 'phone'>): string {
  if (user.email) return user.email;
  return user.phone ? formatPhone(user.phone) : '';
}
