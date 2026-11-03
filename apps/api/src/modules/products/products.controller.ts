import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  paginationSchema, productListQuerySchema, productSchema, productUpdateSchema, reviewSchema,
  type ProductInput, type ProductListQuery, type ReviewDto,
} from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { parseOrThrow, ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { badRequest, notFound } from '../../common/http/errors';
import { StorageService } from '../../common/storage/storage.service';
import { CurrentUser, Public, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { EmbeddingService } from '../ai/embedding.service';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MediaService } from '../media/media.service';
import { ProductsService } from './products.service';
import { ProductImportService } from './import.service';

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
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!p) throw notFound('Product');
    // Verified = the customer actually received it (even if later returned or exchanged).
    const bought = await this.prisma.orderItem.findFirst({ where: { productId: p.id, order: { userId: u.id, deliveredAt: { not: null } } }, select: { size: true }, orderBy: { order: { deliveredAt: 'desc' } } });
    const data = { rating: body.rating, title: body.title, body: body.body, fit: body.fit ?? null, sizePurchased: body.sizePurchased ?? bought?.size ?? null, verifiedPurchase: !!bought };
    const review = await this.prisma.review.upsert({ where: { productId_userId: { productId: p.id, userId: u.id } }, create: { productId: p.id, userId: u.id, ...data }, update: data });
    if (files.length) {
      // Photos are re-encoded (EXIF/GPS stripped) before storage; new photos replace old ones.
      const processed = [];
      for (const f of files) processed.push(await this.media.storeReviewImage(review.id, f.buffer));
      const old = await this.prisma.reviewImage.findMany({ where: { reviewId: review.id } });
      await this.prisma.reviewImage.deleteMany({ where: { reviewId: review.id } });
      for (const o of old) await this.storage.delete(o.storageKey);
      await this.prisma.reviewImage.createMany({ data: processed.map((x) => ({ reviewId: review.id, storageKey: x.key, url: x.url, thumbUrl: x.thumbUrl })) });
    }
    const agg = await this.prisma.review.aggregate({ where: { productId: p.id, isPublished: true }, _avg: { rating: true }, _count: true });
    await this.prisma.product.update({ where: { id: p.id }, data: { ratingAvg: agg._avg.rating ?? null, ratingCount: agg._count } });
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
  ) {}

  @RequirePermissions('catalog:read') @Get()
  async list(@Query(new ZodPipe(adminListQ)) q: z.infer<typeof adminListQ>) {
    const { items, total } = await this.products.adminList(q);
    return paginated(items, total, q.page, q.pageSize);
  }

  @RequirePermissions('catalog:read') @Get('import/template') @Header('content-type', 'text/csv') @Header('content-disposition', 'attachment; filename="vyra-product-import-template.csv"')
  template() {
    return this.importer.template();
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
    const p = await this.products.update(id, body);
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
    return out.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, alt: i.alt, color: i.color, sortOrder: i.sortOrder, width: i.width, height: i.height }));
  }

  @RequirePermissions('catalog:write') @Patch(':id/images/:imageId')
  async updateImage(@Param('id') id: string, @Param('imageId') imageId: string, @Body(new ZodPipe(z.object({ alt: z.string().max(200).optional(), color: z.string().max(40).nullable().optional(), sortOrder: z.coerce.number().int().min(0).max(100).optional() }))) body: { alt?: string; color?: string | null; sortOrder?: number }) {
    const img = await this.prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!img) throw notFound('Image');
    const i = await this.prisma.productImage.update({ where: { id: imageId }, data: body });
    return { id: i.id, url: i.url, thumbUrl: i.thumbUrl, alt: i.alt, color: i.color, sortOrder: i.sortOrder, width: i.width, height: i.height };
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
