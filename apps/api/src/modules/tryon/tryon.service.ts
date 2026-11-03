import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type { TryOnResponse } from '@vyra/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AppError, badRequest, notFound } from '../../common/http/errors';
import { ImageGenService } from '../ai/image-gen.service';
import { MediaService } from '../media/media.service';
import { EventsService, type EventContext } from '../events/events.service';

export const TRYON_DISCLAIMER = 'AI preview. Colour and fit are approximate; check the size guide before ordering.';

export type GarmentSlot = 'upper' | 'lower' | 'full' | 'head' | 'carry';

/** Which part of the outfit this product replaces, from its category/name. */
export function garmentSlot(categorySlug: string, name: string): GarmentSlot {
  const s = `${categorySlug} ${name}`.toLowerCase();
  if (/cap|hat/.test(s)) return 'head';
  if (/bag|tote|backpack/.test(s)) return 'carry';
  if (/jean|trouser|chino|jogger|short|pant/.test(s)) return 'lower';
  if (/dress|anarkali|saree|jumpsuit/.test(s)) return 'full';
  return 'upper';
}

export function tryOnPrompt(slot: GarmentSlot, garment: string): string {
  const keep = 'Keep the person IDENTICAL: same face, hair, skin tone, body shape and proportions, pose, expression, background, lighting and camera framing.';
  const what = {
    upper: `Replace only their upper-body garment with the ${garment} from image 2; keep their existing bottoms.`,
    lower: `Replace only their lower-body garment with the ${garment} from image 2; keep their existing top.`,
    full: `Replace their outfit with the ${garment} from image 2.`,
    head: `Put the ${garment} from image 2 on their head, naturally fitted; keep their clothes.`,
    carry: `Have them carry the ${garment} from image 2 naturally (on the shoulder or in hand); keep their clothes.`,
  }[slot];
  return [
    'Virtual try-on. Image 1 is the customer; image 2 shows a product.',
    what,
    'Reproduce the product exactly: same colour, fabric texture and sheen, collar/neckline, buttons, prints, sleeve and hem length.',
    'Fit it naturally to their body with realistic drape and folds, respecting their actual body size.',
    keep,
    'Photorealistic. Do not beautify or alter the person. No text, no watermark, no logos.',
  ].join(' ');
}

/**
 * Virtual try-on. The customer's photo is processed in memory and is NEVER
 * written to disk, the database or logs; only an anonymous TRY_ON event (no
 * image) is recorded. Cost is capped per session and globally per day.
 */
@Injectable()
export class TryOnService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly imageGen: ImageGenService,
    private readonly events: EventsService,
  ) {}

  private startOfIstDay() {
    const ist = new Date(Date.now() + 5.5 * 3600_000);
    ist.setUTCHours(0, 0, 0, 0);
    return new Date(ist.getTime() - 5.5 * 3600_000);
  }

  async usage(sessionId?: string) {
    const since = this.startOfIstDay();
    const [total, mine] = await Promise.all([
      this.prisma.analyticsEvent.count({ where: { type: 'TRY_ON', createdAt: { gte: since } } }),
      sessionId ? this.prisma.analyticsEvent.count({ where: { type: 'TRY_ON', sessionId, createdAt: { gte: since } } }) : 0,
    ]);
    return { total, mine };
  }

  async quota(sessionId?: string) {
    const { total, mine } = await this.usage(sessionId);
    const globalLeft = Math.max(0, this.env.TRYON_DAILY_LIMIT - total);
    return { remainingToday: Math.min(globalLeft, Math.max(0, this.env.TRYON_PER_SESSION_DAILY - mine)), available: this.imageGen.configured && globalLeft > 0 };
  }

  async tryOn(photo: Buffer, input: { productSlug: string; color?: string }, ctx: EventContext | null): Promise<TryOnResponse> {
    if (!this.imageGen.configured) throw new AppError('NOT_CONFIGURED', 'Virtual try-on is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    if (!ctx) throw badRequest('Refresh the page and try again');
    const product = await this.prisma.product.findFirst({
      where: { slug: input.productSlug, status: 'ACTIVE', deletedAt: null },
      include: { category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: { where: { isActive: true }, select: { color: true } } },
    });
    if (!product) throw notFound('Product');
    if (product.gender === 'KIDS') throw badRequest("Virtual try-on isn't available for kids' clothing");
    const { total, mine } = await this.usage(ctx.sessionId);
    if (total >= this.env.TRYON_DAILY_LIMIT) throw new AppError('RATE_LIMITED', 'Virtual try-on is very popular today. Please try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
    if (mine >= this.env.TRYON_PER_SESSION_DAILY) throw new AppError('RATE_LIMITED', `You've used today's ${this.env.TRYON_PER_SESSION_DAILY} free try-ons. Come back tomorrow!`, HttpStatus.TOO_MANY_REQUESTS);

    const colors = [...new Set(product.variants.map((v) => v.color))];
    const color = colors.find((c) => c.toLowerCase() === input.color?.toLowerCase()) ?? colors[0] ?? 'default';
    // Garment reference: the colour's hero image (first image for that colour), else the cover.
    const ref = product.images.find((i) => i.color?.toLowerCase() === color.toLowerCase()) ?? product.images[0];
    if (!ref) throw badRequest('This product has no photo to try on yet');

    const customer = await this.media.normaliseQueryImage(photo); // validates + strips EXIF, in memory only
    const garment = await sharp(await this.storage.get(ref.storageKey)).resize({ width: 768, height: 960, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    const prompt = tryOnPrompt(garmentSlot(product.category.slug, product.name), `${color.toLowerCase()} ${product.name.toLowerCase()}`);
    const out = await this.imageGen.generate(prompt, [{ data: customer, mimeType: 'image/jpeg' }, { data: garment, mimeType: 'image/jpeg' }]);
    const webp = await sharp(out).resize({ width: 1024, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();

    await this.events.record('TRY_ON', ctx, { productId: product.id });
    return {
      image: `data:image/webp;base64,${webp.toString('base64')}`,
      color, disclaimer: TRYON_DISCLAIMER,
      remainingToday: Math.max(0, this.env.TRYON_PER_SESSION_DAILY - mine - 1),
    };
  }
}
