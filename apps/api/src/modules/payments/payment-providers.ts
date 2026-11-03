import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface ProviderPayment { id: string; orderId: string; amountPaise: number; status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'; method: string | null; error: string | null }

export interface PaymentProvider {
  readonly name: 'razorpay' | 'mock';
  readonly keyId: string;
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ providerOrderId: string }>;
  verifySignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean;
  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>;
  capture(providerPaymentId: string, amountPaise: number): Promise<ProviderPayment>;
  refund(providerPaymentId: string, amountPaise: number, notes: Record<string, string>): Promise<{ providerRefundId: string; status: 'pending' | 'processed' | 'failed' }>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
}

export function hmacHex(secret: string, payload: string | Buffer) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/**
 * Razorpay Orders API. Signature verification follows Razorpay's documented
 * scheme: HMAC_SHA256(order_id + "|" + payment_id, key_secret). Webhooks:
 * HMAC_SHA256(raw_body, webhook_secret) in the X-Razorpay-Signature header.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  private readonly base = 'https://api.razorpay.com/v1';

  constructor(readonly keyId: string, private readonly keySecret: string, private readonly webhookSecret: string | undefined) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new Error(`Razorpay ${res.status}: ${json.error?.description ?? 'request failed'}`);
    return json;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    const r = await this.call<{ id: string }>('POST', '/orders', { amount: input.amountPaise, currency: 'INR', receipt: input.receipt, notes: input.notes, payment_capture: 1 });
    return { providerOrderId: r.id };
  }

  verifySignature(i: { providerOrderId: string; providerPaymentId: string; signature: string }) {
    return /^[0-9a-f]{64}$/i.test(i.signature) && safeEqualHex(hmacHex(this.keySecret, `${i.providerOrderId}|${i.providerPaymentId}`), i.signature);
  }

  private map(p: { id: string; order_id: string; amount: number; status: ProviderPayment['status']; method?: string; error_description?: string | null }): ProviderPayment {
    return { id: p.id, orderId: p.order_id, amountPaise: p.amount, status: p.status, method: p.method ?? null, error: p.error_description ?? null };
  }

  async fetchPayment(id: string) {
    return this.map(await this.call('GET', `/payments/${encodeURIComponent(id)}`));
  }

  async capture(id: string, amountPaise: number) {
    return this.map(await this.call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount: amountPaise, currency: 'INR' }));
  }

  async refund(id: string, amountPaise: number, notes: Record<string, string>) {
    const r = await this.call<{ id: string; status: 'pending' | 'processed' | 'failed' }>('POST', `/payments/${encodeURIComponent(id)}/refund`, { amount: amountPaise, notes, speed: 'normal' });
    return { providerRefundId: r.id, status: r.status };
  }

  verifyWebhook(raw: Buffer, signature: string | undefined) {
    if (!this.webhookSecret || !signature) return false;
    return safeEqualHex(hmacHex(this.webhookSecret, raw), signature);
  }
}

/**
 * DEVELOPMENT/TEST ONLY (refused in production by env validation). Mirrors the
 * Razorpay contract exactly — including HMAC signatures — so the storefront's
 * verify path is exercised end-to-end without real money.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  readonly keyId = 'mock_key_test';
  private readonly secret = randomBytes(32).toString('hex');
  private readonly orders = new Map<string, number>();
  private readonly payments = new Map<string, ProviderPayment>();

  async createOrder(input: { amountPaise: number }) {
    const id = `order_mock_${randomBytes(8).toString('hex')}`;
    this.orders.set(id, input.amountPaise);
    return { providerOrderId: id };
  }

  /** Simulates the customer completing (or failing) payment in the widget. */
  authorize(providerOrderId: string, outcome: 'success' | 'failure') {
    const amount = this.orders.get(providerOrderId);
    if (amount === undefined) return null;
    const id = `pay_mock_${randomBytes(8).toString('hex')}`;
    this.payments.set(id, { id, orderId: providerOrderId, amountPaise: amount, status: outcome === 'success' ? 'captured' : 'failed', method: 'upi', error: outcome === 'failure' ? 'Payment declined by bank (simulated)' : null });
    return { providerOrderId, providerPaymentId: id, signature: hmacHex(this.secret, `${providerOrderId}|${id}`) };
  }

  verifySignature(i: { providerOrderId: string; providerPaymentId: string; signature: string }) {
    return safeEqualHex(hmacHex(this.secret, `${i.providerOrderId}|${i.providerPaymentId}`), i.signature);
  }

  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('Unknown mock payment');
    return p;
  }

  async capture(id: string) {
    return this.fetchPayment(id);
  }

  async refund(id: string) {
    const p = await this.fetchPayment(id);
    p.status = 'refunded';
    return { providerRefundId: `rfnd_mock_${randomBytes(6).toString('hex')}`, status: 'processed' as const };
  }

  signWebhook(raw: Buffer) {
    return hmacHex(this.secret, raw);
  }

  verifyWebhook(raw: Buffer, signature: string | undefined) {
    return !!signature && safeEqualHex(hmacHex(this.secret, raw), signature);
  }
}
