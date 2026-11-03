import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type Campaign, type CampaignPrice } from '@prisma/client';
import {
  bulkSalePrice, computeCampaignPhase, discountPercent, formatIST, fromPaise, nextBoundary, toPaise, upToDiscountClaim, validateCampaignWindow, VISIBLE_PHASES,
  type CampaignAdminDto, type CampaignChecklistDto, type CampaignInput, type CampaignPhase, type CampaignPriceRowDto, type CampaignPublicDto, type CampaignReportDto,
  type PromotionInput,
} from '@vyra/shared';
import { z } from 'zod';
import { campaignBulkPriceSchema, campaignPricesSchema } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppError, badRequest, conflict, notFound } from '../../common/http/errors';
import { decToNum, decToNumOrNull, decToPaise, paiseToDec } from '../../common/money';
import { AuditService } from '../../common/audit/audit.service';
import { QueueService } from '../../common/queue/queue.service';
import { MailService } from '../../common/mail/mail.service';
import { MessagingService, WA_TEMPLATES } from '../../common/messaging/messaging.service';
import { CategoriesService } from '../categories/categories.service';
import { CampaignPricingService } from './campaign-pricing.service';

const QUEUE = 'campaigns';
/** Boundary sweep cadence. Prices are resolved live anyway; this only refreshes listing read models + sends notices. */
const SWEEP_MS = 60_000;
const ENDING_SOON_MS = 3 * 3600_000;

type Actor = { id: string | null; name?: string };
type PriceItems = z.infer<typeof campaignPricesSchema>['items'];
type BulkInput = z.infer<typeof campaignBulkPriceSchema>;

/** Phases during which the sale price is (or may be) charged: prices may only go down. */
const SELLING: CampaignPhase[] = ['EARLY_ACCESS', 'LIVE'];

@Injectable()
export class CampaignsService implements OnModuleInit {
  private readonly logger = new Logger('Campaigns');
  private lastSweep = new Date(Date.now() - 5 * 60_000);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly pricing: CampaignPricingService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly mail: MailService,
    private readonly messaging: MessagingService,
    private readonly categories: CategoriesService,
  ) {}

  async onModuleInit() {
    this.queue.process(QUEUE, async () => this.sweep(), 1);
    await this.queue.repeat(QUEUE, 'boundary-sweep', SWEEP_MS).catch((e) => this.logger.warn(`Scheduler: ${(e as Error).message}`));
  }

  // ------------------------------------------------------------------ mapping

  private async claim(campaignId: string) {
    const rows = await this.prisma.$queryRaw<{ productId: string; mrp: Prisma.Decimal; salePrice: Prisma.Decimal }[]>`
      SELECT v."productId", v.mrp, cp."salePrice"
      FROM campaign_prices cp JOIN product_variants v ON v.id = cp."variantId" JOIN products p ON p.id = v."productId"
      LEFT JOIN inventory i ON i."variantId" = v.id
      WHERE cp."campaignId" = ${campaignId} AND v."isActive" AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL
        AND cp."salePrice" < v.price AND COALESCE(i."onHand" - i.reserved, 0) > 0
        AND (cp."stockCap" IS NULL OR cp."soldCount" < cp."stockCap")`;
    const max = rows.reduce((m, r) => Math.max(m, discountPercent(decToNum(r.mrp), decToNum(r.salePrice))), 0);
    return { upToPercent: upToDiscountClaim(max), productCount: new Set(rows.map((r) => r.productId)).size };
  }

  private async toPublic(c: Campaign, viewer: { userId?: string | null } = {}, at = new Date()): Promise<CampaignPublicDto> {
    const phase = computeCampaignPhase(c, at);
    const [claim, promotions, hasEarlyAccess, subscribed] = await Promise.all([
      this.claim(c.id),
      this.prisma.promotion.findMany({ where: { campaignId: c.id, isActive: true }, orderBy: { minQuantity: 'asc' } }),
      this.pricing.hasEarlyAccess(viewer.userId),
      viewer.userId ? this.prisma.campaignSubscription.count({ where: { campaignId: c.id, userId: viewer.userId } }).then((n) => n > 0) : Promise.resolve(false),
    ]);
    return {
      id: c.id, slug: c.slug, name: c.name, edition: c.edition, festival: c.festival, description: c.description, phase,
      teaserStartsAt: c.teaserStartsAt?.toISOString() ?? null, earlyAccessStartsAt: c.earlyAccessStartsAt?.toISOString() ?? null,
      startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(),
      extended: !!c.originalEndsAt && c.endsAt > c.originalEndsAt, originalEndsAt: c.originalEndsAt?.toISOString() ?? null,
      countdownTo: phase === 'PAUSED' || phase === 'ENDED' || phase === 'CANCELLED' || phase === 'DRAFT' ? null : nextBoundary(c, at)?.toISOString() ?? null,
      banner: { title: c.bannerTitle, subtitle: c.bannerSubtitle, imageUrl: c.bannerImageUrl, themeColor: c.themeColor },
      claim, promotions: promotions.map((p) => ({ id: p.id, name: p.name, minQuantity: p.minQuantity, percentOff: decToNum(p.percentOff) })),
      hasEarlyAccess, subscribed,
    };
  }

  private async toAdmin(c: Campaign, at = new Date()): Promise<CampaignAdminDto> {
    const [pub, spend, priceCount, subscriberCount] = await Promise.all([
      this.toPublic(c, {}, at), this.pricing.spend(c.id),
      this.prisma.campaignPrice.count({ where: { campaignId: c.id } }), this.prisma.campaignSubscription.count({ where: { campaignId: c.id } }),
    ]);
    return {
      ...pub, status: c.status, priority: c.priority, budget: decToNumOrNull(c.budget), budgetUsed: fromPaise(spend.campaign + spend.promotion + spend.coupon),
      priceCount, subscriberCount, publishedAt: c.publishedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
    };
  }

  private async load(id: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw notFound('Campaign');
    return c;
  }

  private async refresh(campaignId: string) {
    await this.pricing.refreshProducts(await this.pricing.productIdsOfCampaign(campaignId));
  }

  // ------------------------------------------------------------------ admin: lifecycle

  async list(): Promise<CampaignAdminDto[]> {
    const rows = await this.prisma.campaign.findMany({ orderBy: [{ startsAt: 'desc' }] });
    return Promise.all(rows.map((c) => this.toAdmin(c)));
  }

  async get(id: string) {
    return this.toAdmin(await this.load(id));
  }

  private windowOrThrow(c: { teaserStartsAt?: Date | null; earlyAccessStartsAt?: Date | null; startsAt: Date; endsAt: Date }) {
    const problems = validateCampaignWindow(c);
    if (problems.length) {
      throw new AppError('VALIDATION_FAILED', problems[0]!.message, 422, { fieldErrors: Object.fromEntries(problems.map((p) => [p.field, [p.message]])), formErrors: [] });
    }
  }

  private data(b: Partial<CampaignInput>) {
    return { ...b, budget: b.budget === undefined ? undefined : b.budget === null ? null : paiseToDec(toPaise(b.budget)) };
  }

  async create(b: CampaignInput, actor: Actor) {
    this.windowOrThrow(b);
    if (await this.prisma.campaign.findUnique({ where: { slug: b.slug } })) throw conflict('That campaign URL is already used');
    const c = await this.prisma.campaign.create({ data: { ...this.data(b), status: 'DRAFT', createdById: actor.id } as Prisma.CampaignUncheckedCreateInput });
    await this.audit.log({ actorId: actor.id, action: 'campaign.create', entity: 'Campaign', entityId: c.id, after: b });
    return this.toAdmin(c);
  }

  /**
   * Edits. Once selling has started the start can't move and the end can only
   * move through `extend` (which is disclosed). Ended/cancelled campaigns are
   * read-only so reports stay truthful.
   */
  async update(id: string, b: Partial<CampaignInput>, actor: Actor) {
    const c = await this.load(id);
    const phase = computeCampaignPhase(c);
    if (phase === 'ENDED' || phase === 'CANCELLED') throw badRequest('An ended or cancelled campaign cannot be edited. Duplicate it instead.');
    const started = c.status !== 'DRAFT' && (SELLING.includes(phase) || (phase === 'PAUSED' && c.startsAt <= new Date()));
    if (started) {
      if (b.startsAt && b.startsAt.getTime() !== c.startsAt.getTime()) throw badRequest('The start of a running sale cannot change');
      if (b.earlyAccessStartsAt !== undefined && (b.earlyAccessStartsAt?.getTime() ?? null) !== (c.earlyAccessStartsAt?.getTime() ?? null)) throw badRequest('Early access of a running sale cannot change');
      if (b.endsAt && b.endsAt.getTime() !== c.endsAt.getTime()) throw badRequest('Use "Extend" to change the end of a running sale (customers are told)');
    }
    if (b.slug && b.slug !== c.slug) {
      if (c.publishedAt) throw badRequest('The URL of a published campaign cannot change (links are already shared)');
      if (await this.prisma.campaign.findUnique({ where: { slug: b.slug } })) throw conflict('That campaign URL is already used');
    }
    this.windowOrThrow({
      teaserStartsAt: b.teaserStartsAt !== undefined ? b.teaserStartsAt : c.teaserStartsAt,
      earlyAccessStartsAt: b.earlyAccessStartsAt !== undefined ? b.earlyAccessStartsAt : c.earlyAccessStartsAt,
      startsAt: b.startsAt ?? c.startsAt, endsAt: b.endsAt ?? c.endsAt,
    });
    const u = await this.prisma.campaign.update({ where: { id }, data: this.data(b) as Prisma.CampaignUpdateInput });
    await this.refresh(id);
    await this.audit.log({ actorId: actor.id, action: 'campaign.update', entity: 'Campaign', entityId: id, before: { startsAt: c.startsAt, endsAt: c.endsAt }, after: b });
    return this.toAdmin(u);
  }

  async remove(id: string, actor: Actor) {
    const c = await this.load(id);
    if (c.status !== 'DRAFT') throw badRequest('Only drafts can be deleted. Cancel a published campaign instead.');
    await this.prisma.campaign.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: 'campaign.delete', entity: 'Campaign', entityId: id, before: { name: c.name } });
  }

  async publish(id: string, actor: Actor) {
    const c = await this.load(id);
    if (c.status !== 'DRAFT') throw badRequest('Only drafts can be published');
    const check = await this.checklist(id);
    if (!check.ready) throw new AppError('VALIDATION_FAILED', check.problems.find((p) => p.level === 'error')!.message, 422, check);
    const u = await this.prisma.campaign.update({ where: { id }, data: { status: 'SCHEDULED', publishedAt: new Date() } });
    await this.refresh(id);
    await this.audit.log({ actorId: actor.id, action: 'campaign.publish', entity: 'Campaign', entityId: id, after: { warnings: check.problems.filter((p) => p.level === 'warning').map((p) => p.message) } });
    return this.toAdmin(u);
  }

  async setStatus(id: string, action: 'pause' | 'resume' | 'cancel', actor: Actor, note?: string) {
    const c = await this.load(id);
    const allowed = { pause: ['SCHEDULED'], resume: ['PAUSED'], cancel: ['SCHEDULED', 'PAUSED'] } as const;
    if (!(allowed[action] as readonly string[]).includes(c.status)) throw badRequest(`Cannot ${action} a campaign that is ${c.status.toLowerCase()}`);
    if (computeCampaignPhase(c) === 'ENDED') throw badRequest('This campaign has already ended');
    const status = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'SCHEDULED' : 'CANCELLED';
    if (action === 'resume' && c.budget) {
      const s = await this.pricing.spend(id);
      if (s.campaign + s.promotion + s.coupon >= decToPaise(c.budget)) throw badRequest('The discount budget is used up. Raise the budget before resuming.');
    }
    const u = await this.prisma.campaign.update({ where: { id }, data: { status } });
    await this.refresh(id);
    await this.audit.log({ actorId: actor.id, action: `campaign.${action}`, entity: 'Campaign', entityId: id, after: { note } });
    return this.toAdmin(u);
  }

  /** Extending is allowed (later end only) but always disclosed: originalEndsAt is kept and shown. */
  async extend(id: string, endsAt: Date, note: string, actor: Actor) {
    const c = await this.load(id);
    if (c.status === 'DRAFT') throw badRequest('Edit the end date of a draft directly');
    if (c.status === 'CANCELLED') throw badRequest('A cancelled campaign cannot be extended');
    if (endsAt <= c.endsAt) throw badRequest('An extension must end later than the current end');
    if (endsAt <= new Date()) throw badRequest('The new end must be in the future');
    this.windowOrThrow({ teaserStartsAt: c.teaserStartsAt, earlyAccessStartsAt: c.earlyAccessStartsAt, startsAt: c.startsAt, endsAt });
    const u = await this.prisma.campaign.update({ where: { id }, data: { endsAt, originalEndsAt: c.originalEndsAt ?? c.endsAt } });
    // Re-allow the "ending soon" notice for the new end.
    await this.prisma.$executeRaw`UPDATE campaign_subscriptions SET notified = array_remove(notified, 'ending_soon') WHERE "campaignId" = ${id}`;
    await this.refresh(id);
    await this.audit.log({ actorId: actor.id, action: 'campaign.extend', entity: 'Campaign', entityId: id, before: { endsAt: c.endsAt }, after: { endsAt, note } });
    return this.toAdmin(u);
  }

  // ------------------------------------------------------------------ admin: prices

  async prices(id: string): Promise<CampaignPriceRowDto[]> {
    await this.load(id);
    const rows = await this.prisma.campaignPrice.findMany({
      where: { campaignId: id },
      include: { variant: { include: { inventory: true, product: { select: { id: true, name: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { thumbUrl: true } } } } } } },
      orderBy: [{ variant: { product: { name: 'asc' } } }, { variant: { sku: 'asc' } }],
    });
    return rows.map((r) => this.priceRow(r));
  }

  private priceRow(r: CampaignPrice & { variant: Prisma.ProductVariantGetPayload<{ include: { inventory: true; product: { select: { id: true; name: true; images: { select: { thumbUrl: true } } } } } }> }): CampaignPriceRowDto {
    const v = r.variant;
    const sale = decToNum(r.salePrice), regular = decToNum(v.price), mrp = decToNum(v.mrp), cost = decToNumOrNull(v.costPrice);
    const available = v.inventory ? Math.max(0, v.inventory.onHand - v.inventory.reserved) : 0;
    const warnings: string[] = [];
    if (sale >= regular) warnings.push('Not below the regular price: this deal will not apply');
    if (cost != null && sale < cost) warnings.push('Below cost price');
    if (!v.isActive) warnings.push('Variant is inactive');
    if (available === 0) warnings.push('Out of stock');
    if (r.stockCap != null && r.stockCap > available) warnings.push(`Deal cap ${r.stockCap} exceeds stock ${available}`);
    return {
      variantId: v.id, productId: v.product.id, productName: v.product.name, sku: v.sku, color: v.color, size: v.size, imageUrl: v.product.images[0]?.thumbUrl ?? null,
      mrp, regularPrice: regular, costPrice: cost, salePrice: sale, percentOffRegular: discountPercent(regular, sale), percentOffMrp: discountPercent(mrp, sale),
      stockCap: r.stockCap, soldCount: r.soldCount, perCustomerLimit: r.perCustomerLimit, available, warnings,
    };
  }

  /**
   * Upserts sale prices. Hard rules (decided with the business): never below
   * cost, always below the regular price, and while a sale is selling, prices
   * may only go DOWN (raising a price mid-sale would break the advertised deal).
   */
  async setPrices(id: string, items: PriceItems, actor: Actor) {
    const c = await this.load(id);
    const phase = computeCampaignPhase(c);
    if (phase === 'ENDED' || phase === 'CANCELLED') throw badRequest('Prices of an ended or cancelled campaign cannot change');
    const selling = c.status !== 'DRAFT' && (SELLING.includes(phase) || phase === 'PAUSED');
    const variants = await this.prisma.productVariant.findMany({ where: { id: { in: items.map((i) => i.variantId) } }, include: { product: { select: { name: true } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const existing = new Map((await this.prisma.campaignPrice.findMany({ where: { campaignId: id, variantId: { in: items.map((i) => i.variantId) } } })).map((p) => [p.variantId, p]));
    const errors: string[] = [];
    const writes: { variantId: string; salePrice: number; stockCap: number | null | undefined; perCustomerLimit: number | null | undefined }[] = [];
    for (const it of items) {
      const v = byId.get(it.variantId);
      if (!v) { errors.push(`Unknown variant ${it.variantId}`); continue; }
      const regular = decToPaise(v.price);
      const sale = it.salePrice != null ? toPaise(it.salePrice) : bulkSalePrice(regular, it.percentOff!, false);
      const label = `${v.product.name} ${v.color}/${v.size}`;
      if (sale >= regular) errors.push(`${label}: sale price must be below the regular price ₹${fromPaise(regular)}`);
      if (v.costPrice && sale < decToPaise(v.costPrice)) errors.push(`${label}: ₹${fromPaise(sale)} is below cost ₹${decToNum(v.costPrice)}`);
      const prev = existing.get(v.id);
      if (selling && prev && sale > decToPaise(prev.salePrice)) errors.push(`${label}: a running sale's price can only go down (now ₹${decToNum(prev.salePrice)})`);
      if (selling && prev && it.stockCap != null && it.stockCap < prev.soldCount) errors.push(`${label}: cap can't be below the ${prev.soldCount} already sold`);
      writes.push({ variantId: v.id, salePrice: sale, stockCap: it.stockCap, perCustomerLimit: it.perCustomerLimit });
    }
    if (errors.length) throw new AppError('VALIDATION_FAILED', errors[0]!, 422, { fieldErrors: {}, formErrors: errors.slice(0, 50) });
    await this.prisma.$transaction(async (tx) => {
      for (const w of writes) {
        await tx.campaignPrice.upsert({
          where: { campaignId_variantId: { campaignId: id, variantId: w.variantId } },
          create: { campaignId: id, variantId: w.variantId, salePrice: paiseToDec(w.salePrice), stockCap: w.stockCap ?? null, perCustomerLimit: w.perCustomerLimit ?? null },
          update: { salePrice: paiseToDec(w.salePrice), ...(w.stockCap !== undefined ? { stockCap: w.stockCap } : {}), ...(w.perCustomerLimit !== undefined ? { perCustomerLimit: w.perCustomerLimit } : {}) },
        });
      }
      await this.pricing.refreshProducts([...new Set(variants.map((v) => v.productId))], tx);
    });
    await this.audit.log({ actorId: actor.id, action: 'campaign.prices', entity: 'Campaign', entityId: id, after: { count: writes.length } });
    return this.prices(id);
  }

  /** "30% off the regular price of these categories/products" → individual sale prices (rounded down, optionally to ₹…9). */
  async bulkPrices(id: string, b: BulkInput, actor: Actor) {
    const catIds = (await Promise.all(b.categoryIds.map((cid) => this.categories.descendantIds(cid)))).flat();
    const variants = await this.prisma.productVariant.findMany({
      where: { isActive: true, product: { deletedAt: null, status: 'ACTIVE', OR: [...(catIds.length ? [{ categoryId: { in: catIds } }] : []), ...(b.productIds.length ? [{ id: { in: b.productIds } }] : [])] } },
      select: { id: true, price: true, costPrice: true },
    });
    if (!variants.length) throw badRequest('No active products match');
    // Skip (and report) variants where the percentage would go below cost, instead of failing the whole batch.
    const items: PriceItems = [];
    let skippedBelowCost = 0;
    for (const v of variants) {
      const sale = bulkSalePrice(decToPaise(v.price), b.percentOff, b.roundToNine);
      if (v.costPrice && sale < decToPaise(v.costPrice)) { skippedBelowCost++; continue; }
      if (sale >= decToPaise(v.price) || sale <= 0) continue;
      items.push({ variantId: v.id, salePrice: fromPaise(sale), stockCap: b.stockCap ?? null, perCustomerLimit: b.perCustomerLimit ?? null });
    }
    const rows = items.length ? await this.setPrices(id, items, actor) : await this.prices(id);
    return { rows, applied: items.length, skippedBelowCost };
  }

  async removePrice(id: string, variantId: string, actor: Actor) {
    const c = await this.load(id);
    const phase = computeCampaignPhase(c);
    if (c.status !== 'DRAFT' && SELLING.includes(phase)) throw badRequest('A deal cannot be removed while the sale is running (it was advertised). Set a stock cap instead.');
    const p = await this.prisma.campaignPrice.findUnique({ where: { campaignId_variantId: { campaignId: id, variantId } }, include: { variant: true } });
    if (!p) throw notFound('Campaign price');
    await this.prisma.campaignPrice.delete({ where: { id: p.id } });
    await this.pricing.refreshProducts([p.variant.productId]);
    await this.audit.log({ actorId: actor.id, action: 'campaign.price_remove', entity: 'Campaign', entityId: id, after: { variantId } });
  }

  // ------------------------------------------------------------------ admin: checks, preview, report

  async checklist(id: string): Promise<CampaignChecklistDto> {
    const c = await this.load(id);
    const problems: CampaignChecklistDto['problems'] = [];
    const err = (message: string) => problems.push({ level: 'error', message });
    const warn = (message: string) => problems.push({ level: 'warning', message });
    for (const p of validateCampaignWindow(c)) err(p.message);
    if (c.endsAt <= new Date()) err('The end is in the past');
    const rows = await this.prices(id);
    const promos = await this.prisma.promotion.count({ where: { campaignId: id, isActive: true } });
    if (!rows.length && !promos) err('Add at least one sale price or bundle offer');
    const below = rows.filter((r) => r.costPrice != null && r.salePrice < r.costPrice);
    if (below.length) err(`${below.length} price(s) below cost, e.g. ${below[0]!.productName} ${below[0]!.color}/${below[0]!.size}`);
    const notLower = rows.filter((r) => r.salePrice >= r.regularPrice);
    if (notLower.length) warn(`${notLower.length} price(s) are not below the regular price and will be ignored`);
    const noStock = rows.filter((r) => r.available === 0);
    if (noStock.length) warn(`${noStock.length} deal variant(s) are out of stock`);
    const noCost = rows.filter((r) => r.costPrice == null);
    if (noCost.length) warn(`${noCost.length} variant(s) have no cost price, so margins can't be protected`);
    if (!c.bannerTitle) warn('No banner title: the storefront will show the campaign name');
    if (c.startsAt <= new Date()) warn('The start is in the past: publishing makes the sale live immediately');
    if (c.teaserStartsAt && rows.length === 0) warn('Teaser without products');
    // Pre-sale price hikes make "was" prices misleading (and are a dark pattern). Only MRP is struck through, but flag it anyway.
    if (rows.length) {
      const since = new Date(c.startsAt.getTime() - 30 * 86400_000);
      const raised = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(DISTINCT h."variantId") AS n FROM price_history h
        WHERE h."variantId" IN (${Prisma.join(rows.map((r) => r.variantId))}) AND h."effectiveFrom" >= ${since}
          AND EXISTS (SELECT 1 FROM price_history h2 WHERE h2."variantId" = h."variantId" AND h2."effectiveFrom" < h."effectiveFrom" AND h2.price < h.price)`;
      const n = Number(raised[0]?.n ?? 0);
      if (n) warn(`${n} variant(s) had their regular price raised in the 30 days before the sale. Raising prices just before a sale misleads customers.`);
    }
    // Overlaps: same variant in another campaign at the same time (lowest price wins; tell the admin).
    if (rows.length) {
      const clash = await this.prisma.campaignPrice.findMany({
        where: { variantId: { in: rows.map((r) => r.variantId) }, campaignId: { not: id }, campaign: { status: { in: ['SCHEDULED', 'PAUSED'] }, startsAt: { lt: c.endsAt }, endsAt: { gt: c.earlyAccessStartsAt ?? c.startsAt } } },
        include: { campaign: { select: { name: true } } },
      });
      if (clash.length) warn(`${clash.length} variant(s) are also in ${[...new Set(clash.map((x) => x.campaign.name))].join(', ')} at overlapping times. The lowest price applies.`);
    }
    if (c.budget && rows.length) {
      const potential = rows.reduce((s, r) => s + Math.max(0, r.regularPrice - r.salePrice) * (r.stockCap ?? r.available), 0);
      if (potential > decToNum(c.budget)) warn(`Selling all deal stock would give about ₹${Math.round(potential)} in discounts, over the ₹${decToNum(c.budget)} budget: the sale auto-pauses when the budget is used`);
    }
    return { ready: !problems.some((p) => p.level === 'error'), problems };
  }

  /** What the storefront would show at a given instant (QA the teaser → live → end flow before it happens). */
  async preview(id: string, at: Date) {
    const c = await this.load(id);
    const asIf = c.status === 'DRAFT' ? { ...c, status: 'SCHEDULED' as const } : c;
    const pub = await this.toPublic(asIf, {}, at);
    return { at: at.toISOString(), campaign: pub, salePriceApplies: pub.phase === 'LIVE', earlyAccessApplies: pub.phase === 'EARLY_ACCESS' };
  }

  async report(id: string): Promise<CampaignReportDto> {
    const c = await this.load(id);
    const orders = await this.prisma.order.findMany({
      where: { items: { some: { campaignId: id } } },
      select: { id: true, status: true, createdAt: true, grandTotal: true, items: { select: { productId: true, productName: true, quantity: true, returnedQuantity: true, lineTotal: true, campaignId: true } } },
    });
    const live = orders.filter((o) => o.status !== 'CANCELLED');
    const spend = await this.pricing.spend(id);
    const prepaidRows = live.length ? await this.prisma.orderDiscount.aggregate({ _sum: { amount: true }, where: { orderId: { in: live.map((o) => o.id) }, source: 'PREPAID' } }) : null;
    const prepaid = prepaidRows?._sum.amount ? decToPaise(prepaidRows._sum.amount) : 0;
    let units = 0, returned = 0, revenue = 0;
    const products = new Map<string, { productId: string; name: string; units: number; revenue: number }>();
    const days = new Map<string, { date: string; orders: number; revenue: number; discount: number }>();
    for (const o of live) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(o.createdAt);
      const d = days.get(day) ?? { date: day, orders: 0, revenue: 0, discount: 0 };
      d.orders++;
      for (const i of o.items.filter((x) => x.campaignId === id)) {
        const v = decToPaise(i.lineTotal);
        units += i.quantity; returned += i.returnedQuantity; revenue += v; d.revenue += v;
        const p = products.get(i.productId) ?? { productId: i.productId, name: i.productName, units: 0, revenue: 0 };
        p.units += i.quantity; p.revenue += v;
        products.set(i.productId, p);
      }
      days.set(day, d);
    }
    const dayDiscounts = live.length ? await this.prisma.$queryRaw<{ day: string; total: Prisma.Decimal }[]>`
      SELECT to_char(o."createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, sum(d.amount) AS total
      FROM order_discounts d JOIN orders o ON o.id = d."orderId" JOIN order_items oi ON oi.id = d."orderItemId"
      WHERE oi."campaignId" = ${id} AND o.status <> 'CANCELLED' GROUP BY 1` : [];
    for (const r of dayDiscounts) { const d = days.get(r.day); if (d) d.discount = decToPaise(r.total); }
    const sell = await this.prisma.campaignPrice.findMany({ where: { campaignId: id }, include: { variant: { select: { sku: true, product: { select: { name: true } } } } }, orderBy: { soldCount: 'desc' }, take: 50 });
    const total = spend.campaign + spend.promotion + spend.coupon + prepaid;
    const budget = decToNumOrNull(c.budget);
    return {
      campaignId: id, phase: computeCampaignPhase(c),
      orders: live.length, units, revenue: fromPaise(revenue), aov: live.length ? fromPaise(Math.round(revenue / live.length)) : 0,
      cancelledOrders: orders.length - live.length, returnedUnits: returned,
      discount: { campaign: fromPaise(spend.campaign), promotion: fromPaise(spend.promotion), coupon: fromPaise(spend.coupon), prepaid: fromPaise(prepaid), total: fromPaise(total) },
      budget, budgetUsedPercent: budget ? Math.round(((spend.campaign + spend.promotion + spend.coupon) / 100 / budget) * 1000) / 10 : null,
      subscribers: await this.prisma.campaignSubscription.count({ where: { campaignId: id } }),
      topProducts: [...products.values()].sort((a, b) => b.units - a.units).slice(0, 10).map((p) => ({ ...p, revenue: fromPaise(p.revenue) })),
      sellThrough: sell.map((s) => ({ variantId: s.variantId, sku: s.variant.sku, productName: s.variant.product.name, soldCount: s.soldCount, stockCap: s.stockCap })),
      daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, revenue: fromPaise(d.revenue), discount: fromPaise(d.discount) })),
    };
  }

  // ------------------------------------------------------------------ promotions

  private promoData(b: Partial<PromotionInput>) {
    return { ...b, maxDiscount: b.maxDiscount === undefined ? undefined : b.maxDiscount === null ? null : paiseToDec(toPaise(b.maxDiscount)), percentOff: b.percentOff === undefined ? undefined : new Prisma.Decimal(b.percentOff) };
  }

  toPromotionDto(p: Prisma.PromotionGetPayload<object>) {
    return {
      id: p.id, campaignId: p.campaignId, name: p.name, minQuantity: p.minQuantity, percentOff: decToNum(p.percentOff), maxDiscount: decToNumOrNull(p.maxDiscount),
      categoryIds: p.categoryIds, productIds: p.productIds, startsAt: p.startsAt?.toISOString() ?? null, endsAt: p.endsAt?.toISOString() ?? null,
      isActive: p.isActive, usageLimit: p.usageLimit, usedCount: p.usedCount, createdAt: p.createdAt.toISOString(),
    };
  }

  async listPromotions(campaignId?: string) {
    return (await this.prisma.promotion.findMany({ where: campaignId ? { campaignId } : {}, orderBy: { createdAt: 'desc' } })).map((p) => this.toPromotionDto(p));
  }

  async createPromotion(b: PromotionInput, actor: Actor) {
    if (b.campaignId) await this.load(b.campaignId);
    if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) throw badRequest('End must be after start');
    const p = await this.prisma.promotion.create({ data: this.promoData(b) as Prisma.PromotionUncheckedCreateInput });
    await this.audit.log({ actorId: actor.id, action: 'promotion.create', entity: 'Promotion', entityId: p.id, after: b });
    return this.toPromotionDto(p);
  }

  async updatePromotion(id: string, b: Partial<PromotionInput>, actor: Actor) {
    const p = await this.prisma.promotion.findUnique({ where: { id }, include: { campaign: true } });
    if (!p) throw notFound('Promotion');
    // A running sale's bundle can't get worse for customers (they were promised it).
    if (p.campaign && SELLING.includes(computeCampaignPhase(p.campaign))) {
      if ((b.percentOff != null && b.percentOff < decToNum(p.percentOff)) || (b.minQuantity != null && b.minQuantity > p.minQuantity)) throw badRequest('A running sale\'s bundle offer can only get better');
    }
    const u = await this.prisma.promotion.update({ where: { id }, data: this.promoData(b) as Prisma.PromotionUncheckedUpdateInput });
    await this.audit.log({ actorId: actor.id, action: 'promotion.update', entity: 'Promotion', entityId: id, after: b });
    return this.toPromotionDto(u);
  }

  async removePromotion(id: string, actor: Actor) {
    const used = await this.prisma.orderDiscount.count({ where: { source: 'PROMOTION', sourceId: id } });
    if (used) await this.prisma.promotion.update({ where: { id }, data: { isActive: false } });
    else await this.prisma.promotion.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: used ? 'promotion.deactivate' : 'promotion.delete', entity: 'Promotion', entityId: id });
  }

  // ------------------------------------------------------------------ public

  /** Campaigns the storefront may show now (teaser, early access, live). */
  async current(viewer: { userId?: string | null }): Promise<CampaignPublicDto[]> {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({ where: { status: 'SCHEDULED', endsAt: { gt: now } }, orderBy: [{ priority: 'desc' }, { startsAt: 'asc' }] });
    const visible = rows.filter((c) => VISIBLE_PHASES.includes(computeCampaignPhase(c, now)));
    return Promise.all(visible.map((c) => this.toPublic(c, viewer, now)));
  }

  async bySlug(slug: string, viewer: { userId?: string | null }): Promise<CampaignPublicDto> {
    const c = await this.prisma.campaign.findUnique({ where: { slug } });
    // Drafts are invisible; upcoming (pre-teaser) campaigns are not announced yet.
    if (!c || c.status === 'DRAFT' || computeCampaignPhase(c) === 'UPCOMING') throw notFound('Sale');
    return this.toPublic(c, viewer);
  }

  /** Product ids of the campaign, best in-stock deals first. */
  async productIds(slug: string, limit: number): Promise<string[]> {
    const c = await this.prisma.campaign.findUnique({ where: { slug } });
    if (!c || c.status === 'DRAFT' || computeCampaignPhase(c) === 'UPCOMING') throw notFound('Sale');
    const rows = await this.prisma.$queryRaw<{ productId: string }[]>`
      SELECT v."productId", max(1 - cp."salePrice" / NULLIF(v.mrp, 0)) AS best, bool_or(COALESCE(i."onHand" - i.reserved, 0) > 0) AS stocked
      FROM campaign_prices cp JOIN product_variants v ON v.id = cp."variantId" JOIN products p ON p.id = v."productId"
      LEFT JOIN inventory i ON i."variantId" = v.id
      WHERE cp."campaignId" = ${c.id} AND v."isActive" AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL
      GROUP BY v."productId" ORDER BY stocked DESC, best DESC LIMIT ${limit}`;
    return rows.map((r) => r.productId);
  }

  /** "Remind me": opt-in for a sale (also grants early access to signed-in customers). */
  async remindMe(slug: string, who: { userId?: string | null; phone?: string; email?: string }) {
    const c = await this.prisma.campaign.findUnique({ where: { slug } });
    if (!c || c.status === 'DRAFT') throw notFound('Sale');
    const phase = computeCampaignPhase(c);
    if (phase === 'ENDED' || phase === 'CANCELLED') throw badRequest('This sale has ended');
    if (!who.userId && !who.phone) throw badRequest('Sign in or give a mobile number for the reminder');
    const user = who.userId ? await this.prisma.user.findUnique({ where: { id: who.userId }, select: { phone: true, email: true } }) : null;
    const phone = who.phone ?? user?.phone ?? null;
    const email = who.email ?? user?.email ?? null;
    const existing = await this.prisma.campaignSubscription.findFirst({ where: { campaignId: c.id, OR: [...(who.userId ? [{ userId: who.userId }] : []), ...(phone ? [{ phone }] : [])] } });
    if (existing) await this.prisma.campaignSubscription.update({ where: { id: existing.id }, data: { userId: existing.userId ?? who.userId ?? null, phone: existing.phone ?? phone, email: existing.email ?? email } });
    else await this.prisma.campaignSubscription.create({ data: { campaignId: c.id, userId: who.userId ?? null, phone, email } });
    return { subscribed: true, earlyAccess: !!who.userId && !!c.earlyAccessStartsAt };
  }

  // ------------------------------------------------------------------ boundary sweep

  /**
   * Runs every minute. Phase is always derived from the clock, so this job is
   * NOT what turns a sale on or off; it only refreshes the listing read model
   * (sort/filter by price) at phase boundaries and sends opted-in reminders.
   * Idempotent: running it twice changes nothing.
   */
  async sweep(now = new Date()) {
    const since = new Date(Math.min(this.lastSweep.getTime(), now.getTime() - 2 * SWEEP_MS));
    this.lastSweep = now;
    const crossed = await this.prisma.campaign.findMany({
      where: {
        status: { in: ['SCHEDULED', 'PAUSED', 'CANCELLED'] },
        OR: [{ startsAt: { gt: since, lte: now } }, { endsAt: { gt: since, lte: now } }, { earlyAccessStartsAt: { gt: since, lte: now } }],
      },
    });
    for (const c of crossed) await this.refresh(c.id);
    await this.notifySubscribers(now);
    return { refreshed: crossed.length };
  }

  private saleUrl(slug: string) {
    return `${this.env.STOREFRONT_URL}/sale/${slug}`;
  }

  async notifySubscribers(now = new Date()) {
    const campaigns = await this.prisma.campaign.findMany({ where: { status: 'SCHEDULED', endsAt: { gt: now } } });
    for (const c of campaigns) {
      const phase = computeCampaignPhase(c, now);
      const kind = c.endsAt.getTime() - now.getTime() <= ENDING_SOON_MS && phase === 'LIVE' ? 'ending_soon' : phase === 'LIVE' ? 'live' : phase === 'EARLY_ACCESS' ? 'early_access' : null;
      if (!kind) continue;
      const subs = await this.prisma.campaignSubscription.findMany({ where: { campaignId: c.id, NOT: { notified: { has: kind } } }, take: 500 });
      for (const s of subs) {
        // Early access is only for signed-in subscribers; skip "live" if they already got "ending soon" etc.
        if (kind === 'early_access' && !s.userId) continue;
        if (kind === 'live' && s.notified.includes('ending_soon')) continue;
        const n = await this.prisma.campaignSubscription.updateMany({ where: { id: s.id, NOT: { notified: { has: kind } } }, data: { notified: { push: kind } } });
        if (!n.count) continue; // another worker got it
        const url = this.saleUrl(c.slug);
        if (kind === 'ending_soon') {
          await this.messaging.whatsapp(s.phone, WA_TEMPLATES.saleEnding, [c.name, formatIST(c.endsAt), url]);
          if (s.email) await this.mail.send({ to: s.email, subject: `${c.name} ends ${formatIST(c.endsAt)}`, template: 'sale-ending', text: `${c.name} ends ${formatIST(c.endsAt)}. Shop now: ${url}` }).catch(() => undefined);
        } else {
          const what = kind === 'early_access' ? 'early access is open for you' : 'is live';
          await this.messaging.whatsapp(s.phone, WA_TEMPLATES.saleLive, [c.name, what, url]);
          if (s.email) await this.mail.send({ to: s.email, subject: `${c.name} ${what}`, template: 'sale-live', text: `${c.name} ${what}. Ends ${formatIST(c.endsAt)}. Shop now: ${url}` }).catch(() => undefined);
        }
      }
    }
  }
}
