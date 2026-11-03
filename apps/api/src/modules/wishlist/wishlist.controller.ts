import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { WishlistItemDto } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { notFound } from '../../common/http/errors';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators';
import { cardInclude, toProductCard } from '../products/product.mappers';

@ApiTags('wishlist')
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly prisma: PrismaService) {}

  private async wishlist(userId: string) {
    return (await this.prisma.wishlist.findUnique({ where: { userId } })) ?? this.prisma.wishlist.create({ data: { userId } });
  }

  @Get()
  async list(@CurrentUser() u: AuthUser): Promise<WishlistItemDto[]> {
    const items = await this.prisma.wishlistItem.findMany({
      where: { wishlist: { userId: u.id }, product: { deletedAt: null, status: 'ACTIVE' } }, include: { product: { include: cardInclude } }, orderBy: { createdAt: 'desc' },
    });
    return items.map((i) => ({ id: i.id, product: toProductCard(i.product), addedAt: i.createdAt.toISOString() }));
  }

  @Get('ids')
  async ids(@CurrentUser() u: AuthUser) {
    const items = await this.prisma.wishlistItem.findMany({ where: { wishlist: { userId: u.id } }, select: { productId: true } });
    return items.map((i) => i.productId);
  }

  @Post()
  async add(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ productId: z.string().min(1) }))) b: { productId: string }) {
    const p = await this.prisma.product.findFirst({ where: { id: b.productId, status: 'ACTIVE', deletedAt: null } });
    if (!p) throw notFound('Product');
    const w = await this.wishlist(u.id);
    await this.prisma.wishlistItem.upsert({ where: { wishlistId_productId: { wishlistId: w.id, productId: p.id } }, create: { wishlistId: w.id, productId: p.id }, update: {} });
    return { ok: true };
  }

  @Delete(':productId')
  async remove(@CurrentUser() u: AuthUser, @Param('productId') productId: string) {
    await this.prisma.wishlistItem.deleteMany({ where: { wishlist: { userId: u.id }, productId } });
    return { ok: true };
  }
}
