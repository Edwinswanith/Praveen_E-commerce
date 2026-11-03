import { Inject, Injectable } from '@nestjs/common';
import type { CodRisk } from '@prisma/client';
import type { CodRiskDto, CodSettingsDto } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';

export const toCodRiskDto = (r: CodRisk): CodRiskDto => ({ phone: r.phone, rtoCount: r.rtoCount, codBlocked: r.codBlocked, note: r.note, lastRtoAt: r.lastRtoAt?.toISOString() ?? null });

/**
 * Cash-on-Delivery risk controls. In Indian fashion e-commerce 15-30% of COD
 * parcels can come back undelivered (RTO), and every one costs forward + return
 * shipping. Controls, cheapest first:
 *   1. PIN codes with chronic refusals can be COD-blocked by staff.
 *   2. A phone number that refused COD_RTO_BLOCK_THRESHOLD parcels loses COD automatically.
 *   3. Every COD order must be confirmed by OTP (or a staff call) before packing.
 *   4. Online payment earns a small prepaid discount.
 */
@Injectable()
export class CodService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  /** null = COD allowed; otherwise a customer-facing reason. */
  async blockReason(phone?: string | null, pincode?: string | null): Promise<string | null> {
    if (!this.env.COD_ENABLED) return 'Cash on Delivery is currently unavailable';
    if (pincode && (await this.prisma.codBlockedPincode.findUnique({ where: { pincode } }))) return `Cash on Delivery isn't available for PIN ${pincode}. Pay online instead.`;
    if (phone) {
      const risk = await this.prisma.codRisk.findUnique({ where: { phone } });
      if (risk?.codBlocked) return 'Cash on Delivery is unavailable for this account because earlier COD parcels were not accepted. Pay online instead.';
    }
    return null;
  }

  /** Called when a COD parcel is returned undelivered. Auto-blocks at the threshold. */
  async recordRto(tx: Tx, phone: string) {
    const r = await tx.codRisk.upsert({
      where: { phone }, create: { phone, rtoCount: 1, lastRtoAt: new Date() }, update: { rtoCount: { increment: 1 }, lastRtoAt: new Date() },
    });
    if (r.rtoCount >= this.env.COD_RTO_BLOCK_THRESHOLD && !r.codBlocked) {
      await tx.codRisk.update({ where: { phone }, data: { codBlocked: true, note: `Auto-blocked after ${r.rtoCount} undelivered COD parcels` } });
    }
  }

  async settings(): Promise<CodSettingsDto> {
    const pins = await this.prisma.codBlockedPincode.findMany({ orderBy: { createdAt: 'desc' } });
    return {
      enabled: this.env.COD_ENABLED, rtoBlockThreshold: this.env.COD_RTO_BLOCK_THRESHOLD, confirmWindowHours: this.env.COD_CONFIRM_WINDOW_HOURS,
      prepaidDiscountPercent: this.env.PREPAID_DISCOUNT_PERCENT, prepaidDiscountMax: this.env.PREPAID_DISCOUNT_MAX,
      blockedPincodes: pins.map((p) => ({ pincode: p.pincode, reason: p.reason, createdAt: p.createdAt.toISOString() })),
    };
  }
}
