import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as shared from '@vyra/shared';
import { assignableRoles, permissionsFor, ROLE_PERMISSIONS } from '../../src/modules/roles/permissions';
import { hmacHex, MockPaymentProvider, RazorpayProvider } from '../../src/modules/payments/payment-providers';
import { LocalEmbeddingProvider } from '../../src/modules/ai/providers';
import { sniffVideo } from '../../src/modules/media/media.service';
import { EmbeddingService } from '../../src/modules/ai/embedding.service';

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe('RBAC matrix', () => {
  it('gives customers no staff permissions and prevents escalation', () => {
    expect(permissionsFor('CUSTOMER')).toEqual([]);
    expect(ROLE_PERMISSIONS.INVENTORY_MANAGER).not.toContain('orders:refund');
    expect(ROLE_PERMISSIONS.ORDER_MANAGER).not.toContain('inventory:write');
    expect(ROLE_PERMISSIONS.ORDER_MANAGER).not.toContain('orders:refund');
    expect(assignableRoles('ADMIN')).not.toContain('ADMIN');
    expect(assignableRoles('ADMIN')).not.toContain('SUPER_ADMIN');
    expect(assignableRoles('INVENTORY_MANAGER')).toEqual([]);
  });
});

describe('Prisma enums stay in sync with @vyra/shared', () => {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const prismaEnum = (name: string) => {
    const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
    return m![1]!.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).sort();
  };
  it.each(['RoleName', 'ProductStatus', 'Gender', 'InventoryMovementType', 'OrderStatus', 'PaymentStatus', 'ShipmentStatus', 'ReturnStatus', 'RefundStatus', 'CouponType', 'ScanMode', 'EmbeddingKind', 'CodConfirmation', 'ReturnType', 'FitFeedback', 'OtpPurpose'])('%s', (name) => {
    expect(Object.values((shared as unknown as Record<string, Record<string, string>>)[name]!).sort()).toEqual(prismaEnum(name));
  });
});

describe('Razorpay signature verification', () => {
  const p = new RazorpayProvider('rzp_test_key', 'secret_123', 'whsec_456');
  it('accepts the documented HMAC(order|payment) and rejects tampering', () => {
    const sig = hmacHex('secret_123', 'order_A|pay_B');
    expect(p.verifySignature({ providerOrderId: 'order_A', providerPaymentId: 'pay_B', signature: sig })).toBe(true);
    expect(p.verifySignature({ providerOrderId: 'order_A', providerPaymentId: 'pay_C', signature: sig })).toBe(false);
    expect(p.verifySignature({ providerOrderId: 'order_A', providerPaymentId: 'pay_B', signature: 'not-hex' })).toBe(false);
  });
  it('verifies webhook bodies byte-for-byte', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(p.verifyWebhook(body, hmacHex('whsec_456', body))).toBe(true);
    expect(p.verifyWebhook(Buffer.from('{"event":"payment.captured" }'), hmacHex('whsec_456', body))).toBe(false);
    expect(p.verifyWebhook(body, undefined)).toBe(false);
  });
});

describe('Mock payment provider', () => {
  it('mirrors Razorpay semantics', async () => {
    const m = new MockPaymentProvider();
    const { providerOrderId } = await m.createOrder({ amountPaise: 79900 });
    const ok = m.authorize(providerOrderId, 'success')!;
    expect(m.verifySignature(ok)).toBe(true);
    expect((await m.fetchPayment(ok.providerPaymentId)).amountPaise).toBe(79900);
    const bad = m.authorize(providerOrderId, 'failure')!;
    expect((await m.fetchPayment(bad.providerPaymentId)).status).toBe('failed');
    expect(m.authorize('order_unknown', 'success')).toBeNull();
  });
});

describe('Local embedding provider', () => {
  it('ranks related fashion text above unrelated text and normalises synonyms', async () => {
    const e = new LocalEmbeddingProvider(768);
    const [q, tee, saree, dress] = await e.embedTexts(['oversized black tee', 'Oversized black cotton t-shirt', 'Silk saree with zari border', 'floral midi dress']);
    expect(cosine(q!, tee!)).toBeGreaterThan(cosine(q!, saree!));
    expect(cosine(q!, tee!)).toBeGreaterThan(cosine(q!, dress!));
    expect(Math.abs(cosine(tee!, tee!) - 1)).toBeLessThan(1e-9);
    expect(e.multimodal).toBe(false);
    expect(e.textModel).not.toEqual(e.imageModel);
  });
});

describe('Product embedding text', () => {
  it('includes the attributes customers search by', () => {
    const t = EmbeddingService.buildText({ name: 'Tee', brand: 'VYRA', gender: 'MEN', description: 'Soft.', tags: ['summer'], category: { name: 'T-Shirts' }, attributes: [{ key: 'fabric', value: 'Cotton' }], variants: [{ color: 'Black' }, { color: 'Black' }] }, ['Men', 'T-Shirts']);
    expect(t).toContain("men's Men > T-Shirts");
    expect(t).toContain('Colours: Black');
    expect(t).toContain('fabric: Cotton');
    expect(t).toContain('summer');
  });
});

describe('Upload sniffing', () => {
  it('detects real containers regardless of claimed mimetype', () => {
    expect(sniffVideo(Buffer.from('000000186674797069736f6d0000020069736f6d', 'hex'))).toBe('video/mp4');
    expect(sniffVideo(Buffer.from('1a45dfa3a3428680', 'hex'))).toBe('video/webm');
    expect(sniffVideo(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });
});
