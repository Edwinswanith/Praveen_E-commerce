import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppError } from '../../common/http/errors';
import { OrdersService } from '../orders/orders.service';

/** Fields we rely on. Based on Shiprocket's tracking-webhook payload (unverified against a live account). */
export interface ShiprocketTrackingPayload {
  awb?: string | number;
  current_status?: string;
  shipment_status?: string;
  current_timestamp?: string;
  scans?: { date?: string; activity?: string; location?: string }[];
}

type Action = 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RTO' | 'IN_TRANSIT' | 'EVENT_ONLY';

/**
 * Shiprocket courier status → our action. Conservative on purpose: stock is
 * restocked only when the parcel is physically back ("RTO DELIVERED"); an RTO
 * that is merely initiated, or an NDR, is recorded as a shipment event for staff.
 */
export function shiprocketAction(status: string): Action {
  const s = status.trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (s === 'DELIVERED') return 'DELIVERED';
  if (s === 'OUT FOR DELIVERY') return 'OUT_FOR_DELIVERY';
  if (s === 'RTO DELIVERED') return 'RTO';
  if (['IN TRANSIT', 'PICKED UP', 'SHIPPED', 'REACHED AT DESTINATION HUB', 'IN TRANSIT AT DESTINATION HUB'].includes(s)) return 'IN_TRANSIT';
  return 'EVENT_ONLY';
}

const SYSTEM = { id: null, name: 'Shiprocket' };

@Injectable()
export class ShiprocketWebhookService {
  private readonly logger = new Logger('ShiprocketWebhook');

  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly orders: OrdersService) {}

  /** Constant-time token check. Without a configured token the endpoint refuses everything. */
  authenticate(token: string | undefined) {
    const expected = this.env.SHIPROCKET_WEBHOOK_TOKEN;
    if (!expected) throw new AppError('NOT_CONFIGURED', 'Shiprocket webhooks are pending configuration', 503);
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('FORBIDDEN', 'Invalid webhook token', 403);
  }

  async handle(p: ShiprocketTrackingPayload) {
    const awb = p.awb != null ? String(p.awb).trim() : '';
    const status = (p.current_status ?? p.shipment_status ?? '').trim();
    if (!awb || !status) return { applied: false, reason: 'missing awb or status' };
    const at = p.current_timestamp ?? '';
    // Replay-safe: the same AWB + status + timestamp is processed once.
    try {
      await this.prisma.webhookEvent.create({ data: { provider: 'shiprocket', eventId: `${awb}:${status.toUpperCase()}:${at}`, eventType: status, payload: p as Prisma.InputJsonValue } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { applied: false, duplicate: true };
      throw e;
    }
    const shipment = await this.prisma.shipment.findUnique({ where: { trackingNumber: awb }, include: { order: { select: { id: true, status: true } } } });
    if (!shipment) return { applied: false, reason: 'unknown awb' };
    const action = shiprocketAction(status);
    const scan = p.scans?.[p.scans.length - 1];
    const note = `Courier: ${status}${scan?.location ? ` (${scan.location})` : ''}`;
    try {
      if (action === 'DELIVERED') {
        if (shipment.order.status === 'SHIPPED') await this.orders.updateStatus(shipment.order.id, 'OUT_FOR_DELIVERY', 'Courier: out for delivery (implied by delivery scan)', SYSTEM);
        await this.orders.updateStatus(shipment.order.id, 'DELIVERED', note, SYSTEM);
      } else if (action === 'OUT_FOR_DELIVERY') {
        await this.orders.updateStatus(shipment.order.id, 'OUT_FOR_DELIVERY', note, SYSTEM);
      } else if (action === 'RTO') {
        await this.orders.markRto(shipment.order.id, note, SYSTEM);
      } else {
        await this.prisma.$transaction([
          ...(action === 'IN_TRANSIT' ? [this.prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'IN_TRANSIT' } })] : []),
          this.prisma.shipmentEvent.create({ data: { shipmentId: shipment.id, status: status.toUpperCase(), location: scan?.location ?? null, description: scan?.activity ?? status, occurredAt: at ? new Date(at.replace(' ', 'T') + '+05:30') : new Date() } }),
        ]);
      }
      return { applied: true, action };
    } catch (e) {
      // e.g. a delivery scan for an order staff already marked delivered: keep the event, don't fail the webhook.
      this.logger.warn(`Shiprocket ${awb} ${status}: ${(e as Error).message}`);
      await this.prisma.shipmentEvent.create({ data: { shipmentId: shipment.id, status: status.toUpperCase(), description: `${note} (not applied: ${(e as Error).message})`, occurredAt: new Date() } });
      return { applied: false, action, reason: (e as Error).message };
    }
  }
}
