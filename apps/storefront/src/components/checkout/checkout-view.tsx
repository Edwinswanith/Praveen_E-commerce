'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { z } from 'zod';
import { Banknote, CreditCard, Lock, MapPin, Plus, ShoppingBag, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AddressDto,
  AddressInput,
  CartDto,
  CartTotalsDto,
  CheckoutResponse,
  OrderDetailDto,
} from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Alert, Button, EmptyState, Field, Input, Skeleton, Spinner, cn } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { clearIdempotencyKey, getIdempotencyKey, rememberOrder } from '@/lib/checkout-session';
import { deliveryDate } from '@/lib/format';
import { useAuth } from '@/hooks/use-auth';
import { useCart } from '@/hooks/use-cart';
import { PriceSummary } from '../cart/price-summary';
import { ProductImage } from '../product/product-image';
import { AddressForm } from './address-form';
import { MockPaymentDialog } from './mock-payment-dialog';
import { payWithMock, payWithRazorpay, PaymentDismissed } from './payment';
import { checkServiceability, type Serviceability } from '../pdp/pincode-check';

type ShippingMethod = 'STANDARD' | 'EXPRESS';
type PaymentMethod = 'ONLINE' | 'COD';
type Quote = CartTotalsDto & { couponError: string | null };
interface StockShortfall {
  variantId: string;
  requested: number;
  available: number;
}

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

function Step({
  n,
  title,
  icon,
  children,
  done,
}: {
  n: number;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  done?: boolean;
}) {
  return (
    <section aria-labelledby={`step-${n}`} className="rounded-lg border border-border p-4 sm:p-5">
      <h2
        id={`step-${n}`}
        className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider"
      >
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-xs text-white',
            done ? 'bg-teal-500' : 'bg-fg',
          )}
        >
          {n}
        </span>
        <span className="text-muted [&_svg]:size-4">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
        checked ? 'border-brand-500 bg-brand-50/50' : 'border-border-strong hover:border-fg',
        disabled && 'cursor-not-allowed opacity-50 hover:border-border-strong',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1 size-4 accent-brand-500"
      />
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </label>
  );
}

function AddressSummary({
  a,
}: {
  a: Pick<
    AddressDto,
    'fullName' | 'phone' | 'line1' | 'line2' | 'landmark' | 'city' | 'state' | 'pincode' | 'type'
  >;
}) {
  return (
    <>
      <p className="font-semibold">
        {a.fullName}{' '}
        <span className="ml-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
          {a.type}
        </span>
      </p>
      <p className="mt-0.5 text-muted">
        {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
      </p>
      <p className="text-muted">
        {a.city}, {a.state} — {a.pincode}
      </p>
      <p className="mt-0.5 text-muted">Mobile: {a.phone}</p>
    </>
  );
}

export function CheckoutView() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { cart, error: cartError, isLoading: cartLoading, refresh: refreshCart } = useCart();

  const [guestEmail, setGuestEmail] = React.useState('');
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = React.useState<string | null>(null);
  const [newAddress, setNewAddress] = React.useState<AddressInput | null>(null);
  // A complete, valid address the guest typed but didn't explicitly confirm.
  const [draftAddress, setDraftAddress] = React.useState<AddressInput | null>(null);
  const guestAddress = newAddress ?? draftAddress;
  const [addingAddress, setAddingAddress] = React.useState(false);
  const [svc, setSvc] = React.useState<Serviceability | null>(null);
  const [shipping, setShipping] = React.useState<ShippingMethod>('STANDARD');
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('ONLINE');
  const [placing, setPlacing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shortfall, setShortfall] = React.useState<StockShortfall[] | null>(null);
  const [mock, setMock] = React.useState<{
    order: OrderDetailDto;
    payment: NonNullable<CheckoutResponse['payment']>;
  } | null>(null);
  const [mockError, setMockError] = React.useState<string | null>(null);

  const {
    data: addresses,
    isLoading: addrLoading,
    mutate: mutateAddresses,
  } = useSWR<AddressDto[]>(user ? '/users/me/addresses' : null);

  // Pick the default saved address once loaded.
  React.useEffect(() => {
    if (!addresses || selectedAddressId) return;
    const def = addresses.find((a) => a.isDefault) ?? addresses[0];
    if (def) setSelectedAddressId(def.id);
    else setAddingAddress(true);
  }, [addresses, selectedAddressId]);
  React.useEffect(() => {
    if (!authLoading && !user) setAddingAddress(true);
  }, [authLoading, user]);

  const selectedAddress = addresses?.find((a) => a.id === selectedAddressId) ?? null;
  const activePincode = user ? selectedAddress?.pincode : guestAddress?.pincode;

  // Serviceability for the chosen address.
  React.useEffect(() => {
    if (!activePincode) {
      if (user) setSvc(null);
      return;
    }
    const ac = new AbortController();
    checkServiceability(activePincode, ac.signal)
      .then(setSvc)
      .catch(() => undefined);
    return () => ac.abort();
  }, [activePincode, user]);

  React.useEffect(() => {
    if (svc && !svc.expressAvailable && shipping === 'EXPRESS') setShipping('STANDARD');
  }, [svc, shipping]);

  const hasItems = (cart?.items.length ?? 0) > 0;
  const quoteKey = hasItems
    ? ([
        'checkout-quote',
        shipping,
        paymentMethod,
        cart?.couponCode ?? '',
        cart?.totals.subtotal ?? 0,
        cart?.itemCount ?? 0,
      ] as const)
    : null;
  const {
    data: quote,
    isLoading: quoteLoading,
    error: quoteError,
  } = useSWR<Quote>(
    quoteKey,
    ([, s, p, c]: readonly [string, ShippingMethod, PaymentMethod, string, number, number]) =>
      api<Quote>('/checkout/quote', {
        method: 'POST',
        body: { shippingMethod: s, paymentMethod: p, couponCode: c || undefined },
      }),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const codAvailable =
    (quote?.codAvailable ?? cart?.totals.codAvailable ?? false) && (svc ? svc.codAvailable : true);
  React.useEffect(() => {
    if (!codAvailable && paymentMethod === 'COD') setPaymentMethod('ONLINE');
  }, [codAvailable, paymentMethod]);

  const finish = React.useCallback(
    async (order: OrderDetailDto) => {
      clearIdempotencyKey();
      rememberOrder(order);
      await refreshCart();
      router.replace(`/order/${encodeURIComponent(order.number)}/confirmation`);
    },
    [refreshCart, router],
  );

  const describeShortfall = (items: StockShortfall[], c: CartDto | undefined) =>
    items.map((s) => {
      const line = c?.items.find((i) => i.variantId === s.variantId);
      return {
        key: s.variantId,
        label: line ? `${line.name} (${line.color}, ${line.size})` : 'An item',
        available: s.available,
        requested: s.requested,
      };
    });

  const placeOrder = async () => {
    setError(null);
    setShortfall(null);
    let email: string | undefined;
    if (!user) {
      const parsed = emailSchema.safeParse(guestEmail);
      if (!parsed.success) {
        setEmailError(parsed.error.issues[0]?.message ?? 'Enter your email');
        document.getElementById('guest-email')?.focus();
        return;
      }
      email = parsed.data;
    }
    if (user ? !selectedAddress : !guestAddress) {
      setError('Please complete your delivery address.');
      return;
    }
    if (svc && !svc.serviceable) {
      setError(`Sorry, we don’t deliver to ${svc.pincode} yet. Choose a different address.`);
      return;
    }
    setPlacing(true);
    try {
      const res = await api<CheckoutResponse>('/checkout', {
        method: 'POST',
        body: {
          ...(user
            ? { addressId: selectedAddress!.id }
            : { address: guestAddress, guestEmail: email }),
          shippingMethod: shipping,
          paymentMethod,
          couponCode: cart?.couponCode ?? undefined,
          idempotencyKey: getIdempotencyKey(),
        },
      });
      if (!res.payment) {
        await finish(res.order);
        return;
      }
      if (res.payment.provider === 'mock') {
        setMockError(null);
        setMock({ order: res.order, payment: res.payment });
        return;
      }
      try {
        const verified = await payWithRazorpay(res.order, res.payment);
        await finish(verified);
      } catch (e) {
        setError(
          e instanceof PaymentDismissed
            ? `Payment not completed. Your order ${res.order.number} is reserved for 30 minutes — tap “Pay now” to try again.`
            : errorMessage(e, 'Payment failed. You can try again.'),
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OUT_OF_STOCK') {
        const items = (e.details as { items?: StockShortfall[] } | undefined)?.items ?? [];
        setShortfall(items);
        setError('Some items in your bag are no longer available in the requested quantity.');
        void refreshCart();
      } else if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
        const fe = e.fieldErrors;
        const first = Object.entries(fe)[0];
        setError(first ? `${first[0]}: ${first[1]?.[0] ?? 'invalid'}` : e.message);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setPlacing(false);
    }
  };

  const onMockOutcome = async (outcome: 'success' | 'failure') => {
    if (!mock) return;
    setMockError(null);
    try {
      const verified = await payWithMock(mock.order, mock.payment.providerOrderId, outcome);
      setMock(null);
      await finish(verified);
    } catch (e) {
      setMockError(errorMessage(e, 'Payment failed.'));
    }
  };

  if ((cartLoading && !cart) || authLoading) {
    return (
      <div className="grid gap-6 py-6 lg:grid-cols-[1fr_380px]" aria-busy="true">
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!cart && cartError) {
    return (
      <Alert tone="danger" title="We couldn’t load your bag" className="my-8">
        {errorMessage(cartError)}{' '}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => void refreshCart()}
        >
          Retry
        </button>
      </Alert>
    );
  }
  if (!cart || !hasItems) {
    return (
      <EmptyState
        className="py-24"
        icon={<ShoppingBag />}
        title="Your bag is empty"
        description="Add something you love before checking out."
        action={
          <Button asChild>
            <Link href="/products">Continue shopping</Link>
          </Button>
        }
      />
    );
  }
  const blocked = cart.items.some((i) => !i.purchasable);
  const totals = quote ?? cart.totals;
  const etaDays = svc?.serviceable
    ? shipping === 'EXPRESS'
      ? Math.max(1, svc.estimatedDays.min - 1)
      : svc.estimatedDays.max
    : null;

  return (
    <div className="grid gap-6 py-6 lg:grid-cols-[1fr_380px] lg:gap-8">
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 font-display text-xl font-extrabold">
          <Lock className="size-5 text-teal-600" aria-hidden />
          Secure checkout
        </h1>

        <Step
          n={1}
          title="Contact"
          icon={<User />}
          done={!!user || emailSchema.safeParse(guestEmail).success}
        >
          {user ? (
            <p className="text-sm">
              Signed in as <strong>{user.name}</strong>{' '}
              <span className="text-muted">({user.email})</span>
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field
                label="Email for order updates"
                htmlFor="guest-email"
                error={emailError ?? undefined}
                hint="We’ll send your order confirmation and tracking here."
              >
                <Input
                  id="guest-email"
                  type="email"
                  autoComplete="email"
                  value={guestEmail}
                  invalid={!!emailError}
                  onChange={(e) => {
                    setGuestEmail(e.target.value);
                    setEmailError(null);
                  }}
                />
              </Field>
              <p className="text-sm text-muted sm:pb-6">
                or{' '}
                <Link
                  href="/login?next=/checkout"
                  className="font-semibold text-brand-600 hover:underline"
                >
                  sign in
                </Link>{' '}
                for faster checkout
              </p>
            </div>
          )}
        </Step>

        <Step
          n={2}
          title="Delivery address"
          icon={<MapPin />}
          done={user ? !!selectedAddress : !!guestAddress}
        >
          {user && addrLoading && <Skeleton className="h-24" />}
          {user && addresses && addresses.length > 0 && !addingAddress && (
            <div className="space-y-2" role="radiogroup" aria-label="Saved addresses">
              {addresses.map((a) => (
                <RadioCard
                  key={a.id}
                  name="address"
                  value={a.id}
                  checked={selectedAddressId === a.id}
                  onChange={() => setSelectedAddressId(a.id)}
                >
                  <AddressSummary a={a} />
                </RadioCard>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setAddingAddress(true)}>
                <Plus aria-hidden />
                Add a new address
              </Button>
            </div>
          )}
          {user && addingAddress && (
            <AddressForm
              submitLabel="Save and deliver here"
              onCancel={
                addresses && addresses.length > 0 ? () => setAddingAddress(false) : undefined
              }
              onSubmit={async (values) => {
                const created = await api<AddressDto>('/users/me/addresses', {
                  method: 'POST',
                  body: values,
                });
                await mutateAddresses();
                setSelectedAddressId(created.id);
                setAddingAddress(false);
                toast.success('Address saved');
              }}
            />
          )}
          {!user &&
            (newAddress && !addingAddress ? (
              <div className="flex items-start justify-between gap-3 rounded-md border border-brand-500 bg-brand-50/50 p-3 text-sm">
                <div>
                  <AddressSummary
                    a={{
                      ...newAddress,
                      line2: newAddress.line2 ?? null,
                      landmark: newAddress.landmark ?? null,
                    }}
                  />
                </div>
                <Button variant="link" size="sm" onClick={() => setAddingAddress(true)}>
                  Change
                </Button>
              </div>
            ) : (
              <AddressForm
                showDefault={false}
                defaultValues={newAddress ?? undefined}
                submitLabel="Deliver to this address"
                onServiceability={setSvc}
                onDraftChange={setDraftAddress}
                onSubmit={async (values) => {
                  setNewAddress(values);
                  setAddingAddress(false);
                }}
              />
            ))}
          {svc && (
            <p
              className={cn('mt-3 text-sm', svc.serviceable ? 'text-teal-600' : 'text-danger')}
              aria-live="polite"
            >
              {svc.serviceable ? (
                <>
                  Estimated delivery by <strong>{deliveryDate(svc.estimatedDays.max)}</strong>
                </>
              ) : (
                `We don’t deliver to ${svc.pincode} yet.`
              )}
            </p>
          )}
        </Step>

        <Step n={3} title="Delivery method" icon={<Truck />} done>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Delivery method">
            <RadioCard
              name="ship"
              value="STANDARD"
              checked={shipping === 'STANDARD'}
              onChange={() => setShipping('STANDARD')}
            >
              <p className="font-semibold">Standard</p>
              <p className="text-muted">
                {svc?.serviceable
                  ? `${svc.estimatedDays.min}–${svc.estimatedDays.max} days`
                  : '3–7 days'}{' '}
                · Free above {formatINR(cart.totals.freeShippingThreshold)}
              </p>
            </RadioCard>
            <RadioCard
              name="ship"
              value="EXPRESS"
              checked={shipping === 'EXPRESS'}
              onChange={() => setShipping('EXPRESS')}
              disabled={svc ? !svc.expressAvailable : false}
            >
              <p className="font-semibold">Express</p>
              <p className="text-muted">
                {svc && !svc.expressAvailable
                  ? 'Not available for this PIN'
                  : 'Faster delivery · fee shown in summary'}
              </p>
            </RadioCard>
          </div>
          {etaDays !== null && (
            <p className="mt-2 text-xs text-muted">Arrives by {deliveryDate(etaDays)}</p>
          )}
        </Step>

        <Step n={4} title="Payment" icon={<CreditCard />} done>
          <div className="space-y-2" role="radiogroup" aria-label="Payment method">
            <RadioCard
              name="pay"
              value="ONLINE"
              checked={paymentMethod === 'ONLINE'}
              onChange={() => setPaymentMethod('ONLINE')}
            >
              <p className="flex items-center gap-2 font-semibold">
                <CreditCard className="size-4" aria-hidden />
                Pay online
              </p>
              <p className="text-muted">UPI, cards, net banking and wallets</p>
            </RadioCard>
            <RadioCard
              name="pay"
              value="COD"
              checked={paymentMethod === 'COD'}
              onChange={() => setPaymentMethod('COD')}
              disabled={!codAvailable}
            >
              <p className="flex items-center gap-2 font-semibold">
                <Banknote className="size-4" aria-hidden />
                Cash on delivery
              </p>
              <p className="text-muted">
                {codAvailable
                  ? 'Pay when your order arrives · small COD fee applies'
                  : 'Not available for this order or PIN code'}
              </p>
            </RadioCard>
          </div>
        </Step>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-lg border border-border p-4 sm:p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
            Order summary
          </h2>
          <ul className="mb-4 max-h-60 space-y-3 overflow-y-auto">
            {cart.items.map((i) => (
              <li key={i.id} className="flex gap-3 text-sm">
                <span className="relative aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                  <ProductImage
                    src={i.imageUrl}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{i.name}</span>
                  <span className="block text-xs text-muted">
                    {i.color} · {i.size} · Qty {i.quantity}
                  </span>
                  {!i.purchasable && (
                    <span className="block text-xs font-semibold text-danger">Unavailable</span>
                  )}
                </span>
                <span className="tabular-nums">{formatINR(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="relative">
            {quoteLoading && (
              <span className="absolute right-0 top-0">
                <Spinner className="size-4" />
              </span>
            )}
            <PriceSummary totals={totals} itemCount={cart.itemCount} couponCode={cart.couponCode} />
          </div>
          {quote?.couponError && <p className="mt-2 text-xs text-danger">{quote.couponError}</p>}
          {quoteError && (
            <p className="mt-2 text-xs text-warning">
              Showing bag totals — live quote unavailable.
            </p>
          )}
        </div>

        {shortfall && shortfall.length > 0 && (
          <Alert tone="danger" title="Out of stock">
            <ul className="mt-1 list-disc pl-4">
              {describeShortfall(shortfall, cart).map((s) => (
                <li key={s.key}>
                  {s.label}:{' '}
                  {s.available <= 0
                    ? 'sold out'
                    : `only ${s.available} left (you asked for ${s.requested})`}
                </li>
              ))}
            </ul>
            <Link href="/cart" className="mt-2 inline-block font-semibold underline">
              Update bag
            </Link>
          </Alert>
        )}
        {error && !shortfall && <Alert tone="danger">{error}</Alert>}
        {blocked && (
          <Alert tone="warning">
            Some items are unavailable.{' '}
            <Link href="/cart" className="font-semibold underline">
              Review your bag
            </Link>
          </Alert>
        )}

        <Button
          size="lg"
          block
          onClick={() => void placeOrder()}
          loading={placing}
          disabled={blocked || placing}
        >
          {paymentMethod === 'COD' ? 'Place order' : `Pay ${formatINR(totals.grandTotal)}`}
        </Button>
        <p className="text-center text-xs text-muted">
          By placing your order you agree to VYRA’s terms and returns policy.
        </p>
      </aside>

      {mock && (
        <MockPaymentDialog
          open={!!mock}
          onOpenChange={(o) => {
            if (!o) {
              setError(
                `Payment not completed. Your order ${mock.order.number} is reserved for 30 minutes — tap “Pay” to try again.`,
              );
              setMock(null);
            }
          }}
          amountPaise={mock.payment.amount}
          orderNumber={mock.order.number}
          onOutcome={onMockOutcome}
          error={mockError}
        />
      )}
    </div>
  );
}
