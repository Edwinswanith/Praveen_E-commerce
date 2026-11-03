import type { PrismaService, Tx } from '../../common/prisma/prisma.service';

/** Product rating shown on cards/PDP counts published reviews only. */
export async function refreshRating(db: PrismaService | Tx, productId: string) {
  const agg = await db.review.aggregate({ where: { productId, isPublished: true }, _avg: { rating: true }, _count: true });
  await db.product.update({ where: { id: productId }, data: { ratingAvg: agg._avg.rating ?? null, ratingCount: agg._count } });
}

