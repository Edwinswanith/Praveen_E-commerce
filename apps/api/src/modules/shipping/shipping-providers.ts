import { Logger } from '@nestjs/common';

export interface Serviceability { serviceable: boolean; codAvailable: boolean; estimatedDays: { min: number; max: number }; expressAvailable: boolean; city: string | null; state: string | null }

export interface CreateShipmentInput {
  orderNumber: string; orderDate: Date; paymentMethod: 'ONLINE' | 'COD'; amount: number; weightGrams: number;
  customer: { name: string; email: string; phone: string };
  address: { line1: string; line2?: string | null; city: string; state: string; pincode: string };
  items: { name: string; sku: string; units: number; sellingPrice: number; hsn: string }[];
}

export interface ShippingProvider {
  readonly name: 'MANUAL' | 'SHIPROCKET';
  readonly configured: boolean;
  serviceability(pincode: string, cod: boolean): Promise<Serviceability>;
  createShipment(input: CreateShipmentInput): Promise<{ providerShipmentId: string | null; courierName: string | null; trackingNumber: string | null; trackingUrl: string | null; labelUrl: string | null }>;
  track(trackingNumber: string): Promise<{ status: string; events: { status: string; location: string | null; description: string | null; occurredAt: Date }[] } | null>;
}

/** Zone-based estimate from the first PIN digit (postal region) — used when no courier API is configured. */
const REGION: Record<string, { name: string; days: [number, number] }> = {
  '1': { name: 'North', days: [3, 6] }, '2': { name: 'North', days: [3, 6] }, '3': { name: 'West', days: [3, 5] }, '4': { name: 'West', days: [2, 5] },
  '5': { name: 'South', days: [2, 4] }, '6': { name: 'South', days: [2, 5] }, '7': { name: 'East', days: [4, 7] }, '8': { name: 'East', days: [4, 7] },
  '9': { name: 'Army Postal Service', days: [7, 12] },
};

/**
 * Manual fulfilment: staff book the courier themselves and enter the AWB.
 * Serviceability is an honest regional estimate, not a courier promise.
 */
export class ManualShippingProvider implements ShippingProvider {
  readonly name = 'MANUAL' as const;
  readonly configured = true;

  async serviceability(pincode: string): Promise<Serviceability> {
    const r = REGION[pincode[0] ?? ''];
    if (!r || pincode[0] === '9') return { serviceable: false, codAvailable: false, estimatedDays: { min: 0, max: 0 }, expressAvailable: false, city: null, state: null };
    return { serviceable: true, codAvailable: true, estimatedDays: { min: r.days[0], max: r.days[1] }, expressAvailable: true, city: null, state: null };
  }

  async createShipment() {
    return { providerShipmentId: null, courierName: null, trackingNumber: null, trackingUrl: null, labelUrl: null };
  }

  async track() {
    return null;
  }
}

/**
 * Shiprocket API v1 (https://apiv2.shiprocket.in/v1/external). PENDING
 * CONFIGURATION: implemented against the public API docs but not yet verified
 * with live credentials. Requires SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD (an API
 * user) and a pickup location name + PIN configured in the Shiprocket panel.
 */
export class ShiprocketProvider implements ShippingProvider {
  readonly name = 'SHIPROCKET' as const;
  private readonly logger = new Logger('Shiprocket');
  private readonly base = 'https://apiv2.shiprocket.in/v1/external';
  private token: { value: string; expires: number } | null = null;

  constructor(private readonly email?: string, private readonly password?: string, private readonly pickupLocation = 'Primary', private readonly pickupPincode?: string) {}

  get configured() {
    return !!(this.email && this.password && this.pickupPincode);
  }

  private async auth() {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    const r = await fetch(`${this.base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: this.password }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Shiprocket auth failed (${r.status})`);
    const j = (await r.json()) as { token: string };
    this.token = { value: j.token, expires: Date.now() + 8 * 86400_000 }; // tokens last 10 days
    return j.token;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.auth()}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const j = (await r.json().catch(() => ({}))) as T & { message?: string };
    if (!r.ok) throw new Error(`Shiprocket ${r.status}: ${j.message ?? 'request failed'}`);
    return j;
  }

  async serviceability(pincode: string, cod: boolean): Promise<Serviceability> {
    const r = await this.call<{ data?: { available_courier_companies?: { estimated_delivery_days: string; cod: number; city: string; state: string }[] } }>(
      'GET', `/courier/serviceability/?pickup_postcode=${this.pickupPincode}&delivery_postcode=${pincode}&weight=0.5&cod=${cod ? 1 : 0}`,
    );
    const list = r.data?.available_courier_companies ?? [];
    if (!list.length) return { serviceable: false, codAvailable: false, estimatedDays: { min: 0, max: 0 }, expressAvailable: false, city: null, state: null };
    const days = list.map((c) => Number(c.estimated_delivery_days) || 5);
    return { serviceable: true, codAvailable: list.some((c) => c.cod === 1), estimatedDays: { min: Math.min(...days), max: Math.max(...days) }, expressAvailable: Math.min(...days) <= 2, city: list[0]!.city ?? null, state: list[0]!.state ?? null };
  }

  async createShipment(i: CreateShipmentInput) {
    const order = await this.call<{ order_id: number; shipment_id: number }>('POST', '/orders/create/adhoc', {
      order_id: i.orderNumber, order_date: i.orderDate.toISOString().slice(0, 16).replace('T', ' '), pickup_location: this.pickupLocation,
      billing_customer_name: i.customer.name, billing_last_name: '', billing_address: i.address.line1, billing_address_2: i.address.line2 ?? '',
      billing_city: i.address.city, billing_pincode: i.address.pincode, billing_state: i.address.state, billing_country: 'India',
      billing_email: i.customer.email, billing_phone: i.customer.phone, shipping_is_billing: true,
      order_items: i.items.map((x) => ({ name: x.name, sku: x.sku, units: x.units, selling_price: x.sellingPrice, hsn: x.hsn })),
      payment_method: i.paymentMethod === 'COD' ? 'COD' : 'Prepaid', sub_total: i.amount, length: 30, breadth: 25, height: 5, weight: Math.max(0.1, i.weightGrams / 1000),
    });
    const awb = await this.call<{ response?: { data?: { awb_code?: string; courier_name?: string } } }>('POST', '/courier/assign/awb', { shipment_id: order.shipment_id });
    const code = awb.response?.data?.awb_code ?? null;
    let labelUrl: string | null = null;
    try {
      const label = await this.call<{ label_url?: string }>('POST', '/courier/generate/label', { shipment_id: [order.shipment_id] });
      labelUrl = label.label_url ?? null;
    } catch (e) {
      this.logger.warn(`Label generation failed: ${(e as Error).message}`);
    }
    return { providerShipmentId: String(order.shipment_id), courierName: awb.response?.data?.courier_name ?? null, trackingNumber: code, trackingUrl: code ? `https://shiprocket.co/tracking/${code}` : null, labelUrl };
  }

  async track(awb: string) {
    const r = await this.call<{ tracking_data?: { shipment_status?: number; shipment_track_activities?: { date: string; activity: string; location: string; 'sr-status-label'?: string }[] } }>('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
    const acts = r.tracking_data?.shipment_track_activities ?? [];
    return { status: acts[0]?.['sr-status-label'] ?? 'IN_TRANSIT', events: acts.map((a) => ({ status: a['sr-status-label'] ?? a.activity, location: a.location, description: a.activity, occurredAt: new Date(a.date) })) };
  }
}
