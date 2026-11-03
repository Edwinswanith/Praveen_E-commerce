import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeCampaignPhase, discountPercent, fromPaise, resolveSalePrice,
  type CampaignBadgeDto, type CampaignPriceOffer, type PricingPromotion, type ResolvedPrice,
} from '@vyra/shared';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { decToNum, decToPaise, paiseToDec } from '../../common/money';
import { AuditService } from '../../common/audit/audit.service';

export interface PriceContext {
  at?: Date;
  /** Opted-in customers (marketing opt-in or "remind me") shop early access. */
  hasEarlyAccess?: boolean;
}

type Db = PrismaService | Tx;

/**
 * Single source of truth for "what does this variant cost right now".
 * Everything that shows or charges a price (cards, PDP, bag, checkout) goes
 * through here, so the storefront can never display a price checkout won't honour.
 */
@Injectable()
export class CampaignPricingService {
  private readonly logger = new Logger('CampaignPricing');

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Discount (paise) a campaign has given on non-cancelled orders: its sale prices plus its promotions and coupons. */
  async spend(campaignId: string): Promise<{ campaign: number; promotion: number; coupon: number }> {
    const rows = await this.prisma.$queryRaw<{ source: string; total: Prisma.Decimal | null }[]>`
      SELECT d.source, sum(d.amount) AS total
      FROM order_discounts d JOIN orders o ON o.id = d."orderId"
      WHERE o.status <> 'CANCELLED' AND (
        (d.source = 'CAMPAIGN_PRICE' AND d."sourceId" = ${campaignId})
        OR (d.source = 'PROMOTION' AND d."sourceId" IN (SELECT id FROM promotions WHERE "campaignId" = ${campaignId}))
        OR (d.source = 'COUPON' AND d."sourceId" IN (SELECT id FROM coupons WHERE "campaignId" = ${campaignId})))
      GROUP BY d.source`;
    const get = (src: string) => decToPaise(rows.find((r) => r.source === src)?.total ?? new Prisma.Decimal(0));
    return { campaign: get('CAMPAIGN_PRICE'), promotion: get('PROMOTION'), coupon: get('COUPON') };
  }

  /**
   * Auto-pauses campaigns whose discount budget is used up. Runs after each
   * order, so a budget can be overshot by at most the orders in flight.
   */
  async enforceBudgets(campaignIds: string[]) {
    for (const id of campaignIds) {
      const c = await this.prisma.campaign.findUnique({ where: { id } });
      if (!c?.budget || c.status !== 'SCHEDULED') continue;
      const s = await this.spend(id);
      const used = s.campaign + s.promotion + s.coupon;
      if (used < decToPaise(c.budget)) continue;
      const n = await this.prisma.campaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'PAUSED' } });
      if (n.count) {
        await this.refreshProducts(await this.productIdsOfCampaign(id));
        await this.audit.log({ actorId: null, action: 'campaign.auto_pause', entity: 'Campaign', entityId: id, after: { reason: 'budget used', used: fromPaise(used), budget: decToNum(c.budget) } });
        this.logger.warn(`Campaign ${c.slug} paused: discount budget used (₹${fromPaise(used)} of ₹${decToNum(c.budget)})`);
      }
    }
  }

  async hasEarlyAccess(userId?: string | null): Promise<boolean> {
    if (!userId) return false;
    const p = await this.prisma.customerProfile.findUnique({ where: { userId }, select: { marketingOptIn: true } });
    return !!p?.marketingOptIn || (await this.prisma.campaignSubscription.count({ where: { userId } })) > 0;
  }

  /** Campaign offers per variant for campaigns that can sell at `at` (early access or live). */
  async offersFor(variantIds: string[], at = new Date(), db: Db = this.prisma): Promise<Map<string, CampaignPriceOffer[]>> {
    const out = new Map<string, CampaignPriceOffer[]>();
    if (!variantIds.length) return out;
    const rows = await db.campaignPrice.findMany({
      where: {
        variantId: { in: variantIds },
        campaign: { status: 'SCHEDULED', endsAt: { gt: at }, OR: [{ startsAt: { lte: at } }, { earlyAccessStartsAt: { lte: at } }] },
      },
      include: { campaign: true },
    });
    for (const r of rows) {
      const c = r.campaign;
      const offer: CampaignPriceOffer = {
        campaignId: c.id, campaignName: c.name, campaignSlug: c.slug, priority: c.priority, salePrice: decToPaise(r.salePrice),
        phase: computeCampaignPhase(c, at), endsAt: c.endsAt, soldOut: r.stockCap != null && r.soldCount >= r.stockCap,
      };
      out.set(r.variantId, [...(out.get(r.variantId) ?? []), offer]);
    }
    return out;
  }

  /** Effective unit prices (paise) for these variants. */
  async resolve(variants: { id: string; price: Prisma.Decimal; mrp: Prisma.Decimal }[], ctx: PriceContext = {}, db: Db = this.prisma): Promise<Map<string, ResolvedPrice>> {
    const offers = await this.offersFor(variants.map((v) => v.id), ctx.at, db);
    return new Map(variants.map((v) => [v.id, resolveSalePrice({ price: decToPaise(v.price), mrp: decToPaise(v.mrp) }, offers.get(v.id) ?? [], { hasEarlyAccess: !!ctx.hasEarlyAccess })]));
  }

  /** Public (non early-access) campaign badge per product, for listing cards. */
  async badges(productIds: string[], at = new Date()): Promise<Map<string, CampaignBadgeDto>> {
    const out = new Map<string, CampaignBadgeDto>();
    if (!productIds.length) return out;
    const rows = await this.prisma.$queryRaw<{ productId: string; id: string; name: string; slug: string; endsAt: Date }[]>`
      SELECT DISTINCT ON (v."productId") v."productId", c.id, c.name, c.slug, c."endsAt"
      FROM campaign_prices cp
      JOIN campaigns c ON c.id = cp."campaignId"
      JOIN product_variants v ON v.id = cp."variantId"
      WHERE v."productId" IN (${Prisma.join(productIds)}) AND v."isActive"
        AND c.status = 'SCHEDULED' AND c."startsAt" <= ${at} AND c."endsAt" > ${at}
        AND cp."salePrice" < v.price AND (cp."stockCap" IS NULL OR cp."soldCount" < cp."stockCap")
      ORDER BY v."productId", c.priority DESC, cp."salePrice" ASC`;
    for (const r of rows) out.set(r.productId, { id: r.id, name: r.name, slug: r.slug, endsAt: r.endsAt.toISOString() });
    return out;
  }

  /**
   * Keeps the listing read model (Product.minPrice/minMrp/maxDiscount) on the
   * PUBLIC effective price, so sorting, price filters and the "Up to X% off"
   * claims match what a shopper actually pays. Called on campaign changes and
   * by the boundary sweep.
   */
  async refreshProducts(productIds: string[], db: Db = this.prisma, at = new Date()) {
    for (const productId of [...new Set(productIds)]) {
      const vs = await db.productVariant.findMany({ where: { productId, isActive: true }, select: { id: true, price: true, mrp: true } });
      if (!vs.length) {
        await db.product.update({ where: { id: productId }, data: { minPrice: 0, minMrp: 0, maxDiscount: 0 } });
        continue;
      }
      const prices = await this.resolve(vs, { at }, db);
      let best: { price: number; mrp: number } | null = null;
      let maxDiscount = 0;
      for (const v of vs) {
        const price = prices.get(v.id)!.price;
        const mrp = decToPaise(v.mrp);
        if (!best || price < best.price) best = { price, mrp };
        maxDiscount = Math.max(maxDiscount, discountPercent(fromPaise(mrp), fromPaise(price)));
      }
      await db.product.update({ where: { id: productId }, data: { minPrice: paiseToDec(best!.price), minMrp: paiseToDec(best!.mrp), maxDiscount } });
    }
  }

  async productIdsOfCampaign(campaignId: string, db: Db = this.prisma): Promise<string[]> {
    const rows = await db.campaignPrice.findMany({ where: { campaignId }, select: { variant: { select: { productId: true } } } });
    return [...new Set(rows.map((r) => r.variant.productId))];
  }

  /** Bundle promotions a bag can use right now (evergreen or of a live campaign). */
  async activePromotions(ctx: PriceContext = {}): Promise<PricingPromotion[]> {
    const at = ctx.at ?? new Date();
    const rows = await this.prisma.promotion.findMany({ where: { isActive: true }, include: { campaign: true } });
    return rows
      .filter((p) => {
        if (p.usageLimit != null && p.usedCount >= p.usageLimit) return false;
        if (p.campaign) {
          const phase = computeCampaignPhase(p.campaign, at);
          return phase === 'LIVE' || (phase === 'EARLY_ACCESS' && !!ctx.hasEarlyAccess);
        }
        return (!p.startsAt || p.startsAt <= at) && (!p.endsAt || p.endsAt > at);
      })
      .map((p) => ({
        id: p.id, name: p.name, minQuantity: p.minQuantity, percentOff: decToNum(p.percentOff),
        maxDiscount: p.maxDiscount ? decToPaise(p.maxDiscount) : null, categoryIds: p.categoryIds, productIds: p.productIds,
      }));
  }
}
