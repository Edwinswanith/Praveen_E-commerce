import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  campaignBulkPriceSchema, campaignExtendSchema, campaignPricesSchema, campaignSchema, promotionSchema, remindMeSchema,
  type CampaignInput, type PromotionInput,
} from '@vyra/shared';
import { parseOrThrow, ZodPipe } from '../../common/http/zod.pipe';

/**
 * PATCH bodies: zod 4 `.partial()` still fills defaults, which would silently
 * reset omitted fields (priority → 0, scope → []). Keep only keys the client sent.
 */
function patchOf<T extends z.ZodType>(schema: T, raw: unknown): Partial<z.infer<T>> {
  const data = parseOrThrow((schema as unknown as z.ZodObject).partial(), raw);
  const sent = new Set(Object.keys((raw ?? {}) as object));
  return Object.fromEntries(Object.entries(data as object).filter(([k]) => sent.has(k))) as Partial<z.infer<T>>;
}
import { CurrentUser, OptionalAuth, Public, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { ProductsService } from '../products/products.service';
import { CampaignsService } from './campaigns.service';

const actorOf = (u: AuthUser) => ({ id: u.id, name: u.name });
const noteSchema = z.object({ note: z.string().trim().max(300).optional() });
const atSchema = z.object({ at: z.coerce.date() });
const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(48) });

@ApiTags('campaigns')
@Public()
@OptionalAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService, private readonly products: ProductsService) {}

  /** Sales to show now (teaser, early access or live). Prices are never part of this payload. */
  @Get('current')
  current(@CurrentUser() u?: AuthUser) {
    return this.campaigns.current({ userId: u?.audience === 'customer' ? u.id : null });
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string, @CurrentUser() u?: AuthUser) {
    return this.campaigns.bySlug(slug, { userId: u?.audience === 'customer' ? u.id : null });
  }

  @Get(':slug/products')
  async products_(@Param('slug') slug: string, @Query(new ZodPipe(limitSchema)) q: { limit: number }) {
    return this.products.cardsByIds(await this.campaigns.productIds(slug, q.limit));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post(':slug/remind-me')
  remindMe(@Param('slug') slug: string, @Body(new ZodPipe(remindMeSchema)) b: z.infer<typeof remindMeSchema>, @CurrentUser() u?: AuthUser) {
    return this.campaigns.remindMe(slug, { userId: u?.audience === 'customer' ? u.id : null, phone: b.phone, email: b.email });
  }
}

@ApiTags('admin:campaigns')
@StaffOnly()
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @RequirePermissions('promotions:read') @Get()
  list() { return this.campaigns.list(); }

  @RequirePermissions('promotions:write') @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(campaignSchema)) b: CampaignInput) { return this.campaigns.create(b, actorOf(u)); }

  @RequirePermissions('promotions:read') @Get(':id')
  get(@Param('id') id: string) { return this.campaigns.get(id); }

  @RequirePermissions('promotions:write') @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() raw: unknown) { return this.campaigns.update(id, patchOf(campaignSchema, raw) as Partial<CampaignInput>, actorOf(u)); }

  @RequirePermissions('promotions:write') @HttpCode(204) @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.campaigns.remove(id, actorOf(u)); }

  @RequirePermissions('promotions:write') @HttpCode(200) @Post(':id/publish')
  publish(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.campaigns.publish(id, actorOf(u)); }

  @RequirePermissions('promotions:write') @HttpCode(200) @Post(':id/pause')
  pause(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(noteSchema)) b: { note?: string }) { return this.campaigns.setStatus(id, 'pause', actorOf(u), b.note); }

  @RequirePermissions('promotions:write') @HttpCode(200) @Post(':id/resume')
  resume(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(noteSchema)) b: { note?: string }) { return this.campaigns.setStatus(id, 'resume', actorOf(u), b.note); }

  @RequirePermissions('promotions:write') @HttpCode(200) @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(noteSchema)) b: { note?: string }) { return this.campaigns.setStatus(id, 'cancel', actorOf(u), b.note); }

  @RequirePermissions('promotions:write') @HttpCode(200) @Post(':id/extend')
  extend(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(campaignExtendSchema)) b: z.infer<typeof campaignExtendSchema>) { return this.campaigns.extend(id, b.endsAt, b.note, actorOf(u)); }

  @RequirePermissions('promotions:read') @Get(':id/prices')
  prices(@Param('id') id: string) { return this.campaigns.prices(id); }

  @RequirePermissions('promotions:write') @Put(':id/prices')
  setPrices(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(campaignPricesSchema)) b: z.infer<typeof campaignPricesSchema>) { return this.campaigns.setPrices(id, b.items, actorOf(u)); }

  @RequirePermissions('promotions:write') @HttpCode(200) @Post(':id/prices/bulk')
  bulk(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(campaignBulkPriceSchema)) b: z.infer<typeof campaignBulkPriceSchema>) { return this.campaigns.bulkPrices(id, b, actorOf(u)); }

  @RequirePermissions('promotions:write') @HttpCode(204) @Delete(':id/prices/:variantId')
  removePrice(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('variantId') variantId: string) { return this.campaigns.removePrice(id, variantId, actorOf(u)); }

  @RequirePermissions('promotions:read') @Get(':id/checklist')
  checklist(@Param('id') id: string) { return this.campaigns.checklist(id); }

  @RequirePermissions('promotions:read') @Get(':id/preview')
  preview(@Param('id') id: string, @Query(new ZodPipe(atSchema)) q: { at: Date }) { return this.campaigns.preview(id, q.at); }

  @RequirePermissions('analytics:read') @Get(':id/report')
  report(@Param('id') id: string) { return this.campaigns.report(id); }
}

@ApiTags('admin:promotions')
@StaffOnly()
@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @RequirePermissions('promotions:read') @Get()
  list(@Query('campaignId') campaignId?: string) { return this.campaigns.listPromotions(campaignId); }

  @RequirePermissions('promotions:write') @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(promotionSchema)) b: PromotionInput) { return this.campaigns.createPromotion(b, actorOf(u)); }

  @RequirePermissions('promotions:write') @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() raw: unknown) { return this.campaigns.updatePromotion(id, patchOf(promotionSchema, raw) as Partial<PromotionInput>, actorOf(u)); }

  @RequirePermissions('promotions:write') @HttpCode(204) @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.campaigns.removePromotion(id, actorOf(u)); }
}
