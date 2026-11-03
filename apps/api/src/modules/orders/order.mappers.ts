import type { Prisma } from '@prisma/client';
import { CUSTOMER_CANCELLABLE, RETURN_WINDOW_DAYS, type OrderDetailDto, type OrderSummaryDto, type ReturnRequestDto } from '@vyra/shared';
import { decToNum, decToPaise } from '../../common/money';

export const orderDetailInclude = {
  items: true,
  discounts: { select: { source: true, amount: true } },
  events: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  shipment: { include: { events: { orderBy: { occurredAt: 'desc' } } } },
  returnRequests: { include: { items: { include: { orderItem: true } } }, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

export const returnInclude = { items: { include: { orderItem: true } } } satisfies Prisma.ReturnRequestInclude;

/** Extra lookups the plain include can't express (exchange variants, linked order numbers). */
export interface OrderExtras {
  variants: Map<string, { sku: string; color: string; size: string }>;
  orderNumbers: Map<string, string>;
}
export const emptyExtras = (): OrderExtras => ({ variants: new Map(), orderNumbers: new Map() });

export type DetailOrder = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

export function toReturnDto(r: Prisma.ReturnRequestGetPayload<{ include: typeof returnInclude }>, orderNumber: string, extras: OrderExtras = emptyExtras()): ReturnRequestDto {
  return {
    id: r.id, orderId: r.orderId, orderNumber, status: r.status, type: r.type, reason: r.reason, comments: r.comments, refundAmount: decToNum(r.refundAmount),
    replacementOrderNumber: r.replacementOrderId ? extras.orderNumbers.get(r.replacementOrderId) ?? null : null,
    items: r.items.map((i) => {
      const v = i.exchangeVariantId ? extras.variants.get(i.exchangeVariantId) : undefined;
      return { orderItemId: i.orderItemId, name: i.orderItem.productName, sku: i.orderItem.sku, quantity: i.quantity, color: i.orderItem.color, size: i.orderItem.size, exchangeFor: i.exchangeVariantId && v ? { variantId: i.exchangeVariantId, ...v } : null };
    }),
    createdAt: r.createdAt.toISOString(),
  };
}

/** Loads the variant + order-number lookups that return DTOs need. */
export async function loadExtras(prisma: { productVariant: { findMany: Function }; order: { findMany: Function } }, returns: { replacementOrderId: string | null; items: { exchangeVariantId: string | null }[] }[], orderIds: (string | null)[] = []): Promise<OrderExtras> {
  const vIds = [...new Set(returns.flatMap((r) => r.items.map((i) => i.exchangeVariantId).filter((x): x is string => !!x)))];
  const oIds = [...new Set([...returns.map((r) => r.replacementOrderId), ...orderIds].filter((x): x is string => !!x))];
  const [vs, os] = await Promise.all([
    vIds.length ? (prisma.productVariant.findMany({ where: { id: { in: vIds } }, select: { id: true, sku: true, color: true, size: true } }) as Promise<{ id: string; sku: string; color: string; size: string }[]>) : [],
    oIds.length ? (prisma.order.findMany({ where: { id: { in: oIds } }, select: { id: true, number: true } }) as Promise<{ id: string; number: string }[]>) : [],
  ]);
  return { variants: new Map(vs.map((v) => [v.id, { sku: v.sku, color: v.color, size: v.size }])), orderNumbers: new Map(os.map((o) => [o.id, o.number])) };
}

export function toOrderSummary(o: Prisma.OrderGetPayload<{ include: { items: true; payments: true } }>): OrderSummaryDto {
  const last = o.payments[o.payments.length - 1];
  return {
    id: o.id, number: o.number, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: last?.status ?? null, codConfirmation: o.codConfirmation, grandTotal: decToNum(o.grandTotal),
    itemCount: o.items.reduce((s, i) => s + i.quantity, 0), customerName: o.customerName, customerEmail: o.customerEmail, createdAt: o.createdAt.toISOString(),
    previewImages: o.items.map((i) => i.imageUrl).filter((x): x is string => !!x).slice(0, 4),
  };
}

/** Discount breakdown from the ledger (orders before the ledger fall back to order totals). */
function savingsOf(o: DetailOrder): OrderDetailDto['savings'] {
  const by = (src: string) => o.discounts.filter((d) => d.source === src).reduce((s, d) => s + decToPaise(d.amount), 0) / 100;
  if (!o.discounts.length) return { campaign: 0, promotion: decToNum(o.promotionDiscount), coupon: decToNum(o.couponDiscount), prepaid: decToNum(o.prepaidDiscount) };
  return { campaign: by('CAMPAIGN_PRICE'), promotion: by('PROMOTION'), coupon: by('COUPON'), prepaid: by('PREPAID') };
}

export function toOrderDetail(o: DetailOrder, extras: OrderExtras = emptyExtras()): OrderDetailDto {
  const addr = o.shippingAddress as Record<string, string | null>;
  const withinWindow = o.deliveredAt ? Date.now() - o.deliveredAt.getTime() <= RETURN_WINDOW_DAYS * 86400_000 : false;
  const returnable = o.items.some((i) => i.quantity - i.returnedQuantity > 0);
  const openReturn = o.returnRequests.some((r) => ['REQUESTED', 'APPROVED', 'RECEIVED'].includes(r.status));
  return {
    ...toOrderSummary(o),
    items: o.items.map((i) => ({
      id: i.id, variantId: i.variantId, productSlug: i.productSlug, name: i.productName, sku: i.sku, color: i.color, size: i.size, imageUrl: i.imageUrl, quantity: i.quantity,
      unitPrice: decToNum(i.unitPrice), unitMrp: decToNum(i.unitMrp), discount: decToNum(i.discount), taxRate: Number(i.taxRate), taxAmount: decToNum(i.taxAmount),
      lineTotal: decToNum(i.lineTotal), returnedQuantity: i.returnedQuantity,
    })),
    shippingAddress: {
      fullName: addr.fullName ?? '', phone: addr.phone ?? '', line1: addr.line1 ?? '', line2: addr.line2 ?? null, landmark: addr.landmark ?? null,
      city: addr.city ?? '', state: addr.state ?? '', pincode: addr.pincode ?? '', type: (addr.type as 'HOME' | 'WORK' | 'OTHER') ?? 'HOME',
    },
    mrpTotal: decToNum(o.mrpTotal), subtotal: decToNum(o.subtotal), couponCode: o.couponCode, couponDiscount: decToNum(o.couponDiscount),
    prepaidDiscount: decToNum(o.prepaidDiscount), promotionDiscount: decToNum(o.promotionDiscount), codConfirmation: o.codConfirmation,
    savings: savingsOf(o),
    exchangeForOrderNumber: o.exchangeForOrderId ? extras.orderNumbers.get(o.exchangeForOrderId) ?? null : null,
    shippingFee: decToNum(o.shippingFee), codFee: decToNum(o.codFee), taxTotal: decToNum(o.taxTotal), shippingMethod: o.shippingMethod,
    events: o.events.map((e) => ({ status: e.status, note: e.note, createdAt: e.createdAt.toISOString(), actor: e.actorName })),
    payments: o.payments.map((p) => ({ id: p.id, provider: p.provider, method: p.method, status: p.status, amount: decToNum(p.amount), providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, createdAt: p.createdAt.toISOString() })),
    refunds: o.refunds.map((r) => ({ id: r.id, amount: decToNum(r.amount), status: r.status, reason: r.reason, providerRefundId: r.providerRefundId, createdAt: r.createdAt.toISOString() })),
    shipment: o.shipment ? {
      id: o.shipment.id, provider: o.shipment.provider, status: o.shipment.status, courierName: o.shipment.courierName, trackingNumber: o.shipment.trackingNumber,
      trackingUrl: o.shipment.trackingUrl, labelUrl: o.shipment.labelUrl, shippedAt: o.shipment.shippedAt?.toISOString() ?? null, deliveredAt: o.shipment.deliveredAt?.toISOString() ?? null,
      events: o.shipment.events.map((e) => ({ status: e.status, location: e.location, description: e.description, occurredAt: e.occurredAt.toISOString() })),
    } : null,
    returns: o.returnRequests.map((r) => toReturnDto(r, o.number, extras)),
    canCancel: CUSTOMER_CANCELLABLE.includes(o.status),
    canReturn: o.status === 'DELIVERED' && withinWindow && returnable && !openReturn,
  };
}
