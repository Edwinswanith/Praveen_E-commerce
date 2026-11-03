import { Body, Controller, Get, HttpCode, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodPipe, parseOrThrow } from '../../common/http/zod.pipe';
import { badRequest, notFound } from '../../common/http/errors';
import { CurrentUser, OptionalAuth, Public, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { CategoriesService } from '../categories/categories.service';
import { EmbeddingService } from '../ai/embedding.service';
import { MediaService } from '../media/media.service';
import { csv } from '../products/product-query';
import { SearchService } from './search.service';
import { EventsService } from '../events/events.service';

const searchQ = z.object({
  q: z.string().max(300).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(60).default(24),
  category: z.string().max(100).optional(), gender: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']).optional(), sizes: z.string().optional(), colors: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(), maxPrice: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'discount', 'popularity', 'rating']).default('relevance'), inStock: z.enum(['true', 'false']).optional(),
});

@ApiTags('search')
@Public()
@OptionalAuth()
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService, private readonly categories: CategoriesService, private readonly prisma: PrismaService, private readonly media: MediaService, private readonly events: EventsService) {}

  private async categoryIds(slug?: string) {
    if (!slug) return undefined;
    const c = await this.prisma.category.findFirst({ where: { slug, deletedAt: null } });
    if (!c) throw notFound('Category');
    return this.categories.descendantIds(c.id);
  }

  @Get('search')
  async text(@Req() req: Request, @Query(new ZodPipe(searchQ)) q: z.infer<typeof searchQ>, @CurrentUser() u?: AuthUser) {
    if (q.q && q.page === 1) void this.events.record('SEARCH', this.events.context(req, u?.id));
    return this.search.text({ ...q, categoryIds: await this.categoryIds(q.category), sizes: csv(q.sizes), colors: csv(q.colors), inStock: q.inStock === 'true' }, { userId: u?.id });
  }

  @Get('search/suggest')
  suggest(@Query(new ZodPipe(z.object({ q: z.string().max(100).default('') }))) q: { q: string }) {
    return this.search.suggest(q.q);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @HttpCode(200) @Post('visual-search') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  async visual(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, string>, @CurrentUser() u?: AuthUser) {
    if (!file) throw badRequest('Attach a photo as "image"');
    const b = parseOrThrow(z.object({ q: z.string().max(200).optional(), category: z.string().max(100).optional(), gender: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']).optional(), maxPrice: z.coerce.number().positive().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(60).default(24) }), body);
    const image = await this.media.normaliseQueryImage(file.buffer);
    return this.search.visual(image, { ...b, refine: b.q, categoryIds: await this.categoryIds(b.category) }, { userId: u?.id });
  }
}

@ApiTags('admin:ai')
@StaffOnly()
@Controller('admin/ai')
export class AdminAiController {
  constructor(private readonly embeddings: EmbeddingService, private readonly prisma: PrismaService) {}

  @RequirePermissions('catalog:read') @Get('status')
  status() {
    return this.embeddings.status();
  }

  @RequirePermissions('catalog:write') @HttpCode(200) @Post('reindex')
  async reindex(@Body(new ZodPipe(z.object({ productIds: z.array(z.string()).max(1000).optional() }))) b: { productIds?: string[] }) {
    const ids = b.productIds ?? (await this.prisma.product.findMany({ where: { deletedAt: null }, select: { id: true } })).map((p) => p.id);
    for (const id of ids) await this.embeddings.enqueue(id);
    return { queued: ids.length };
  }
}
