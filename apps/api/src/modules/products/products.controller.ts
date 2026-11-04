import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, StreamableFile, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  aiPhotoAcceptSchema, aiPhotoPreviewSchema, aiPhotoSchema, paginationSchema, productListQuerySchema, productSchema, productUpdateSchema, reviewSchema,
  type AiPhotoAcceptInput, type AiPhotoInput, type AiPhotoPreviewDto, type AiPhotoPreviewInput, type ProductImageDto, type ProductInput, type ProductListQuery, type ReviewDto,
} from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { parseOrThrow, ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { AppError, badRequest, notFound } from '../../common/http/errors';
import { StorageService } from '../../common/storage/storage.service';
import { CurrentUser, Public, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { EmbeddingService } from '../ai/embedding.service';
import { buildPhotoPrompt, ImageGenService, type PhotoStyle } from '../ai/image-gen.service';
import { PhotoPreviewStore } from '../ai/photo-preview.store';
import { edgeWhiteRatio, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MediaService } from '../media/media.service';
import { ProductsService } from './products.service';
import { ProductImportService } from './import.service';
import { refreshRating } from './review-rating';

const aiAlt = (name: string, color: string, style: PhotoStyle) => `${name} in ${color} (AI-styled ${style.toLowerCase()} photo)`;
const imageDto = (i: { id: string; url: string; thumbUrl: string; alt: string; color: string | null; sortOrder: number; width: number | null; height: number | null; aiGenerated: boolean; sourceImageId: string | null }): ProductImageDto => ({
  id: i.id, url: i.url, thumbUrl: i.thumbUrl, alt: i.alt, color: i.color, sortOrder: i.sortOrder, width: i.width, height: i.height, aiGenerated: i.aiGenerated, sourceImageId: i.sourceImageId,
});

const limitQ = z.object({ limit: z.coerce.number().int().min(1).max(24).default(12) });

@ApiTags('catalog')
@Public()
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService, private readonly prisma: PrismaService) {}

  @Get('home')
  home() {
    return this.products.home();
  }

  @Get('products')
  list(@Query(new ZodPipe(productListQuerySchema)) q: ProductListQuery) {
    return this.products.list(q);
  }

  @Get('products/by-ids')
  byIds(@Query(new ZodPipe(z.object({ ids: z.string().max(2000) }))) q: { ids: string }) {
    return this.products.cardsByIds(q.ids.split(',').filter(Boolean).slice(0, 50));
  }

  /** Tag scan target: SKU → product slug + variant (active products only; no stock or cost data). */
  @Get('products/by-sku/:sku')
  async bySku(@Param('sku') sku: string) {
    const v = await this.prisma.productVariant.findFirst({
      where: { sku: sku.toUpperCase(), product: { status: 'ACTIVE', deletedAt: null } },
      select: { id: true, color: true, size: true, isActive: true, product: { select: { slug: true } } },
    });
    if (!v) throw notFound('Product');
    return { slug: v.product.slug, variantId: v.id, color: v.color, size: v.size, isActive: v.isActive };
  }

  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.products.detailBySlug(slug);
  }

  @Get('products/:slug/similar')
  similar(@Param('slug') slug: string, @Query(new ZodPipe(limitQ)) q: { limit: number }) {
    return this.products.similar(slug, q.limit);
  }

  @Get('products/:slug/related')
  related(@Param('slug') slug: string, @Query(new ZodPipe(limitQ)) q: { limit: number }) {
    return this.products.related(slug, q.limit);
  }

  @Get('products/:slug/reviews')
  async reviews(@Param('slug') slug: string, @Query(new ZodPipe(paginationSchema)) q: { page: number; pageSize: number }) {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!p) throw notFound('Product');
    const where = { productId: p.id, isPublished: true };
    const [rows, total, dist] = await Promise.all([
      this.prisma.review.findMany({ where, include: { user: { select: { name: true } }, images: true }, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: true }),
    ]);
    const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((r) => [String(r), dist.find((d) => d.rating === r)?._count ?? 0]));
    const sum = dist.reduce((s, d) => s + d.rating * d._count, 0);
    const items: ReviewDto[] = rows.map((r) => toReviewDto(r, r.user.name));
    return { items, meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }, summary: { average: total ? Math.round((sum / total) * 10) / 10 : null, count: total, distribution } };
  }
}

export function toReviewDto(r: { id: string; rating: number; title: string | null; body: string | null; verifiedPurchase: boolean; createdAt: Date; fit: string | null; sizePurchased: string | null; images: { id: string; url: string; thumbUrl: string }[] }, authorName: string): ReviewDto {
  return {
    id: r.id, rating: r.rating, title: r.title, body: r.body, authorName: authorName.split(' ')[0] ?? 'Customer', verifiedPurchase: r.verifiedPurchase, createdAt: r.createdAt.toISOString(),
    fit: (r.fit as ReviewDto['fit']) ?? null, sizePurchased: r.sizePurchased, images: r.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl })),
  };
}

@ApiTags('reviews')
@Controller('products/:slug/reviews')
export class ReviewWriteController {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly storage: StorageService) {}

  /** multipart/form-data: rating, title?, body?, fit?, sizePurchased?, images[] (≤3 photos). JSON also accepted. */
  @Post() @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FilesInterceptor('images', 3, { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 3 } }))
  async create(@CurrentUser() u: AuthUser, @Param('slug') slug: string, @Body() raw: Record<string, unknown>, @UploadedFiles() files: Express.Multer.File[] = []): Promise<ReviewDto> {
    const body = parseOrThrow(reviewSchema, Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '')));
    // Validate/re-encode every photo BEFORE writing anything: a rejected photo must not leave a half-saved review.
    const photos = [];
    for (const f of files) photos.push(await this.media.processImage(f.buffer));
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!p) throw notFound('Product');
    // Verified = the customer actually received it (even if later returned or exchanged).
    const bought = await this.prisma.orderItem.findFirst({ where: { productId: p.id, order: { userId: u.id, deliveredAt: { not: null } } }, select: { size: true }, orderBy: { order: { deliveredAt: 'desc' } } });
    const data = { rating: body.rating, title: body.title, body: body.body, fit: body.fit ?? null, sizePurchased: body.sizePurchased ?? bought?.size ?? null, verifiedPurchase: !!bought };
    const review = await this.prisma.review.upsert({ where: { productId_userId: { productId: p.id, userId: u.id } }, create: { productId: p.id, userId: u.id, ...data }, update: data });
    if (photos.length) {
      // Photos were re-encoded (EXIF/GPS stripped) above; new photos replace old ones.
      const processed = [];
      for (const img of photos) processed.push(await this.media.storeReviewImage(review.id, img));
      const old = await this.prisma.reviewImage.findMany({ where: { reviewId: review.id } });
      await this.prisma.reviewImage.deleteMany({ where: { reviewId: review.id } });
      for (const o of old) await this.storage.delete(o.storageKey);
      await this.prisma.reviewImage.createMany({ data: processed.map((x) => ({ reviewId: review.id, storageKey: x.key, url: x.url, thumbUrl: x.thumbUrl })) });
    }
    await refreshRating(this.prisma, p.id);
    const full = await this.prisma.review.findUniqueOrThrow({ where: { id: review.id }, include: { images: true } });
    return toReviewDto(full, u.name);
  }
}

const adminListQ = paginationSchema.extend({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(), categoryId: z.string().optional() });
const uploadOpts = (max: number, files = 1) => ({ storage: memoryStorage(), limits: { fileSize: max, files } });

@ApiTags('admin:products')
@StaffOnly()
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly importer: ProductImportService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly embeddings: EmbeddingService,
    private readonly imageGen: ImageGenService,
    private readonly previews: PhotoPreviewStore,
  ) {}

  @RequirePermissions('catalog:read') @Get()
  async list(@Query(new ZodPipe(adminListQ)) q: z.infer<typeof adminListQ>) {
    const { items, total } = await this.products.adminList(q);
    return paginated(items, total, q.page, q.pageSize);
  }

  @RequirePermissions('catalog:read') @Get('import/template')
  template() {
    // Content type is set on the file itself, so error responses stay JSON.
    return new StreamableFile(Buffer.from(this.importer.template()), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="vyra-product-import-template.csv"' });
  }

  @RequirePermissions('catalog:write') @Post('import') @HttpCode(200) @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOpts(5 * 1024 * 1024)))
  async import(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun?: string) {
    if (!file) throw badRequest('Attach a CSV or XLSX file as "file"');
    const r = await this.importer.run(file.buffer, file.originalname, dryRun === 'true', u.id);
    if (!r.dryRun) await this.audit.log({ actorId: u.id, action: 'product.import', entity: 'Product', after: { file: file.originalname, created: r.created, updated: r.updated } });
    return r;
  }

  @RequirePermissions('catalog:publish') @Post('bulk') @HttpCode(200)
  async bulk(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ ids: z.array(z.string()).min(1).max(500), action: z.enum(['publish', 'unpublish', 'archive', 'feature', 'unfeature']) }))) body: { ids: string[]; action: string }) {
    const r = body.action === 'feature' || body.action === 'unfeature'
      ? await this.products.setFeatured(body.ids, body.action === 'feature')
      : await this.products.setStatus(body.ids, body.action === 'publish' ? 'ACTIVE' : body.action === 'archive' ? 'ARCHIVED' : 'DRAFT');
    await this.audit.log({ actorId: u.id, action: `product.bulk.${body.action}`, entity: 'Product', after: { ids: body.ids } });
    return r;
  }

  @RequirePermissions('catalog:read') @Get(':id')
  detail(@Param('id') id: string) {
    return this.products.adminDetail(id);
  }

  @RequirePermissions('catalog:write') @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(productSchema)) body: ProductInput) {
    const p = await this.products.create(body, u.id);
    await this.audit.log({ actorId: u.id, action: 'product.create', entity: 'Product', entityId: p.id, after: { name: p.name, variants: p.variants.map((v) => v.sku) } });
    return p;
  }

  @RequirePermissions('catalog:write') @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(productUpdateSchema)) body: z.infer<typeof productUpdateSchema>) {
    if (body.status && !u.permissions.includes('catalog:publish')) delete body.status;
    const p = await this.products.update(id, body, u.id);
    await this.audit.log({ actorId: u.id, action: 'product.update', entity: 'Product', entityId: id, after: body });
    return p;
  }

  @RequirePermissions('catalog:publish') @Post(':id/status') @HttpCode(200)
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']) }))) body: { status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' }) {
    await this.products.setStatus([id], body.status);
    await this.audit.log({ actorId: u.id, action: 'product.status', entity: 'Product', entityId: id, after: body });
    return this.products.adminDetail(id);
  }

  // -------- media
  @RequirePermissions('catalog:write') @Post(':id/images') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 12, uploadOpts(MAX_IMAGE_BYTES, 12)))
  async uploadImages(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @Body('color') color?: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { images: true } } } });
    if (!product) throw notFound('Product');
    if (!files?.length) throw badRequest('Attach one or more images as "files"');
    if (product._count.images + files.length > 20) throw badRequest('A product can have at most 20 images');
    const out = [];
    let order = product._count.images;
    for (const f of files) {
      const s = await this.media.storeProductImage(id, f.buffer);
      out.push(await this.prisma.productImage.create({
        data: { productId: id, storageKey: s.key, url: s.url, thumbUrl: s.thumbUrl, width: s.width, height: s.height, mimeType: 'image/webp', bytes: s.bytes, contentHash: s.hash, color: color || null, alt: product.name, sortOrder: order++ },
      }));
    }
    await this.embeddings.enqueue(id);
    return out.map(imageDto);
  }

  /**
   * AI studio photo. With `sourceImageId` (a real photo of the garment) Gemini
   * restyles the presentation while keeping the garment identical; without it,
   * it generates a representative image from product data (use for drafts/demo).
   * Images are flagged aiGenerated and disclosed on the storefront.
   */
  @RequirePermissions('catalog:write') @Post(':id/images/generate') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async generateImages(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(aiPhotoSchema)) body: AiPhotoInput) {
    const ctx = await this.aiContext(id, body.sourceImageId, body.color);
    const angles = (['front', 'detail'] as const).slice(0, body.count);
    let order = ctx.imageCount;
    const created = [];
    for (const angle of angles) {
      const { prompt, style } = buildPhotoPrompt(ctx.subject, body.style, { hasReference: ctx.refs.length > 0, angle, notes: body.notes });
      const img = await this.imageGen.generate(prompt, ctx.refs);
      const s = await this.media.storeProductImage(id, img);
      created.push(await this.prisma.productImage.create({
        data: {
          productId: id, storageKey: s.key, url: s.url, thumbUrl: s.thumbUrl, width: s.width, height: s.height, mimeType: 'image/webp', bytes: s.bytes, contentHash: s.hash,
          color: ctx.color, alt: aiAlt(ctx.name, ctx.color, style), sortOrder: order++, aiGenerated: true, aiPrompt: `${this.imageGen.model}: ${prompt}`.slice(0, 4000), sourceImageId: ctx.source?.id ?? null,
        },
      }));
    }
    await this.embeddings.enqueue(id);
    await this.audit.log({ actorId: u.id, action: 'product.image.ai_generate', entity: 'Product', entityId: id, after: { style: body.style, color: ctx.color, fromRealPhoto: !!ctx.source, count: created.length } });
    return created.map(imageDto);
  }

  /**
   * Generate ONE AI photo for review. The result is held server-side for 30 min
   * and is NOT part of the product: nothing is stored, listed or embedded until
   * staff accept it. The source photo is only read, never changed.
   * Regenerate = call again; keep original = discard (or let it expire).
   */
  @RequirePermissions('catalog:write') @Post(':id/images/ai-previews') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async previewImage(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(aiPhotoPreviewSchema)) body: AiPhotoPreviewInput): Promise<AiPhotoPreviewDto> {
    const ctx = await this.aiContext(id, body.sourceImageId, body.color);
    const { prompt, style } = buildPhotoPrompt(ctx.subject, body.style, { hasReference: ctx.refs.length > 0, angle: body.angle, notes: body.notes });
    const raw = await this.imageGen.generate(prompt, ctx.refs);
    const processed = await this.media.processImage(raw); // what accept will store, byte for byte
    const { id: previewId, expiresAt } = await this.previews.put({
      productId: id, sourceImageId: ctx.source?.id ?? null, style, color: ctx.color, alt: aiAlt(ctx.name, ctx.color, style),
      aiPrompt: `${this.imageGen.model}: ${prompt}`.slice(0, 4000), actorId: u.id, createdAt: new Date().toISOString(),
    }, raw);
    await this.audit.log({ actorId: u.id, action: 'product.image.ai_preview', entity: 'Product', entityId: id, after: { previewId, style, color: ctx.color, sourceImageId: ctx.source?.id ?? null } });
    return {
      previewId, dataUrl: `data:image/webp;base64,${processed.buffer.toString('base64')}`, width: processed.width, height: processed.height, bytes: processed.bytes,
      style, color: ctx.color, edgeWhiteRatio: await edgeWhiteRatio(processed.buffer), expiresAt: expiresAt.toISOString(),
      source: ctx.source ? { id: ctx.source.id, url: ctx.source.url, thumbUrl: ctx.source.thumbUrl, width: ctx.source.width, height: ctx.source.height } : null,
    };
  }

  /** Save a reviewed preview as a new product image (the original stays as it is). */
  @RequirePermissions('catalog:write') @Post(':id/images/ai-previews/:previewId/accept')
  async acceptPreview(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('previewId') previewId: string, @Body(new ZodPipe(aiPhotoAcceptSchema)) body: AiPhotoAcceptInput): Promise<ProductImageDto> {
    const p = await this.previews.get(previewId);
    if (!p || p.meta.productId !== id) throw notFound('Preview (it may have expired; generate it again)');
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { images: true } } } });
    if (!product) throw notFound('Product');
    if (product._count.images >= 20) throw badRequest('A product can have at most 20 images');
    // The source may have been deleted while the preview was open: keep the link only if it still exists.
    const source = p.meta.sourceImageId ? await this.prisma.productImage.findFirst({ where: { id: p.meta.sourceImageId, productId: id }, select: { id: true } }) : null;
    if (product.status === 'ACTIVE' && !source) throw badRequest('The real photo this was generated from has been deleted. Live products need AI photos made from a real photo.');
    if (!(await this.previews.take(previewId))) throw notFound('Preview (it was already accepted or discarded)');
    const s = await this.media.storeProductImage(id, p.image);
    const img = await this.prisma.$transaction(async (tx) => {
      if (body.placement === 'PRIMARY') await tx.productImage.updateMany({ where: { productId: id }, data: { sortOrder: { increment: 1 } } });
      const last = await tx.productImage.aggregate({ where: { productId: id }, _max: { sortOrder: true } });
      return tx.productImage.create({
        data: {
          productId: id, storageKey: s.key, url: s.url, thumbUrl: s.thumbUrl, width: s.width, height: s.height, mimeType: 'image/webp', bytes: s.bytes, contentHash: s.hash,
          color: p.meta.color, alt: p.meta.alt, aiGenerated: true, aiPrompt: p.meta.aiPrompt, sourceImageId: source?.id ?? null,
          sortOrder: body.placement === 'PRIMARY' ? 0 : (last._max.sortOrder ?? -1) + 1,
        },
      });
    });
    await this.embeddings.enqueue(id);
    await this.audit.log({ actorId: u.id, action: 'product.image.ai_accept', entity: 'ProductImage', entityId: img.id, after: { productId: id, previewId, placement: body.placement, style: p.meta.style, sourceImageId: img.sourceImageId } });
    return imageDto(img);
  }

  /** "Keep original": drop the preview. Idempotent; nothing was saved to the product. */
  @RequirePermissions('catalog:write') @Delete(':id/images/ai-previews/:previewId')
  async discardPreview(@Param('id') id: string, @Param('previewId') previewId: string) {
    const p = await this.previews.get(previewId);
    if (p && p.meta.productId === id) await this.previews.take(previewId);
    return { ok: true };
  }

  /**
   * Loads what an AI photo needs and enforces CLAUDE.md rule 15: a live product's
   * AI photos are made only from a real (non-AI) photo of the garment.
   */
  private async aiContext(id: string, sourceImageId: string | undefined, colorIn: string | undefined) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { category: true, attributes: true, images: true, variants: { where: { isActive: true }, select: { color: true }, take: 1 } },
    });
    if (!product) throw notFound('Product');
    const source = sourceImageId ? product.images.find((i) => i.id === sourceImageId) : undefined;
    if (sourceImageId && !source) throw notFound('Source image');
    if (source?.aiGenerated) throw badRequest('Choose a real photo of the garment as the source, not an AI image');
    if (!source && product.status === 'ACTIVE') throw badRequest('Live products need a real photo of the garment: upload one and select it as the source');
    if (!this.imageGen.configured) throw new AppError('NOT_CONFIGURED', 'AI photography needs GEMINI_API_KEY', HttpStatus.SERVICE_UNAVAILABLE);
    const color = colorIn ?? source?.color ?? product.variants[0]?.color ?? 'neutral';
    const subject = { name: product.name, gender: product.gender, category: product.category.name, color, description: product.description, attributes: Object.fromEntries(product.attributes.map((a) => [a.key, a.value])) };
    const refs = source ? [{ data: await this.storage.get(source.storageKey), mimeType: source.mimeType }] : [];
    return { name: product.name, source, subject, refs, color, imageCount: product.images.length };
  }

  @RequirePermissions('catalog:write') @Patch(':id/images/:imageId')
  async updateImage(@Param('id') id: string, @Param('imageId') imageId: string, @Body(new ZodPipe(z.object({ alt: z.string().max(200).optional(), color: z.string().max(40).nullable().optional(), sortOrder: z.coerce.number().int().min(0).max(100).optional() }))) body: { alt?: string; color?: string | null; sortOrder?: number }) {
    const img = await this.prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!img) throw notFound('Image');
    const i = await this.prisma.productImage.update({ where: { id: imageId }, data: body });
    return imageDto(i);
  }

  @RequirePermissions('catalog:write') @Delete(':id/images/:imageId')
  async deleteImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    const img = await this.prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!img) throw notFound('Image');
    await this.prisma.productImage.delete({ where: { id: imageId } }); // cascades its embeddings
    await this.storage.delete(img.storageKey);
    await this.storage.delete(img.storageKey.replace(/\.webp$/, '_thumb.webp'));
    return { ok: true };
  }

  @RequirePermissions('catalog:write') @Post(':id/videos') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOpts(MAX_VIDEO_BYTES)))
  async uploadVideo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw badRequest('Attach a video as "file"');
    if (!(await this.prisma.product.findFirst({ where: { id, deletedAt: null } }))) throw notFound('Product');
    const s = await this.media.storeProductVideo(id, file.buffer);
    const v = await this.prisma.productVideo.create({ data: { productId: id, storageKey: s.key, url: s.url, mimeType: s.mime, bytes: s.bytes } });
    return { id: v.id, url: v.url, posterUrl: v.posterUrl };
  }

  @RequirePermissions('catalog:write') @Delete(':id/videos/:videoId')
  async deleteVideo(@Param('id') id: string, @Param('videoId') videoId: string) {
    const v = await this.prisma.productVideo.findFirst({ where: { id: videoId, productId: id } });
    if (!v) throw notFound('Video');
    await this.prisma.productVideo.delete({ where: { id: videoId } });
    await this.storage.delete(v.storageKey);
    return { ok: true };
  }
}
