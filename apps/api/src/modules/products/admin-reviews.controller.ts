import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { adminReviewQuerySchema, reviewModerationSchema, type ReviewAdminDto } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { notFound } from '../../common/http/errors';
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { toReviewDto } from './products.controller';
import { refreshRating } from './review-rating';

const include = { user: { select: { name: true, email: true } }, images: true, product: { select: { id: true, name: true, slug: true } } } satisfies Prisma.ReviewInclude;
type Row = Prisma.ReviewGetPayload<{ include: typeof include }>;

/**
 * Post-moderation: reviews go live immediately (honest negative reviews are
 * never held back); staff can hide abusive, fake or off-topic ones and restore
 * them, always with a reason that lands in the audit log.
 */
@ApiTags('admin:reviews')
@StaffOnly()
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private dto(r: Row, moderators: Map<string, string>): ReviewAdminDto {
    return {
      ...toReviewDto(r, r.user.name), productId: r.product.id, productName: r.product.name, productSlug: r.product.slug, authorEmail: r.user.email,
      isPublished: r.isPublished, moderatedAt: r.moderatedAt?.toISOString() ?? null, moderatedBy: r.moderatedById ? moderators.get(r.moderatedById) ?? null : null, moderationNote: r.moderationNote,
    };
  }

  @RequirePermissions('reviews:moderate') @Get()
  async list(@Query(new ZodPipe(adminReviewQuerySchema)) q: z.infer<typeof adminReviewQuerySchema>) {
    const where: Prisma.ReviewWhereInput = {
      ...(q.status ? { isPublished: q.status === 'published' } : {}),
      ...(q.maxRating ? { rating: { lte: q.maxRating } } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }, { product: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.review.count({ where }),
    ]);
    const ids = [...new Set(rows.map((r) => r.moderatedById).filter((x): x is string => !!x))];
    const mods = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return paginated(rows.map((r) => this.dto(r, mods)), total, q.page, q.pageSize);
  }

  @RequirePermissions('reviews:moderate') @HttpCode(200) @Post(':id/hide')
  hide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewModerationSchema)) b: { reason: string }) {
    return this.moderate(u, id, false, b.reason);
  }

  @RequirePermissions('reviews:moderate') @HttpCode(200) @Post(':id/publish')
  publish(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewModerationSchema)) b: { reason: string }) {
    return this.moderate(u, id, true, b.reason);
  }

  private async moderate(u: AuthUser, id: string, publish: boolean, reason: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const before = await tx.review.findUnique({ where: { id } });
      if (!before) throw notFound('Review');
      const after = await tx.review.update({ where: { id }, data: { isPublished: publish, moderatedAt: new Date(), moderatedById: u.id, moderationNote: reason }, include });
      await refreshRating(tx, before.productId);
      await this.audit.log({ actorId: u.id, action: publish ? 'review.publish' : 'review.hide', entity: 'Review', entityId: id, before: { isPublished: before.isPublished }, after: { isPublished: publish, reason } }, tx);
      return after;
    });
    return this.dto(r, new Map([[u.id, u.name]]));
  }
}
