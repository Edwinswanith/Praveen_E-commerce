import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { fromPaise, PRICING_RULES, priceCart, type CartDto, type CartItemDto, type CartTotalsDto, type PricingLine, type PricingResult, type ShippingMethod } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { badRequest, notFound, outOfStock } from '../../common/http/errors';
import { decToNum, decToPaise } from '../../common/money';
import { CouponsService } from '../coupons/coupons.service';

export const CART_COOKIE = 'vyra_cart';
const MAX_QTY = 10;

const itemInclude = {
  variant: {
    include: {
      inventory: true,
      product: { select: { id: true, slug: true, name: true, brand: true, status: true, deletedAt: true, categoryId: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { thumbUrl: true } } } },
    },
  },
} satisfies Prisma.CartItemInclude;
type LoadedItem = Prisma.CartItemGetPayload<{ include: typeof itemInclude }>;

export interface CartOwner { userId?: string | null; guestToken?: string | null }

@Injectable()
export class CartService {
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly coupons: CouponsService) {}

  /** Prepaid incentive configured via env (rupees → paise). */
  get prepaid() {
    return { percent: this.env.PREPAID_DISCOUNT_PERCENT, max: Math.round(this.env.PREPAID_DISCOUNT_MAX * 100) };
  }

  totalsDto(p: PricingResult, prepaidSavings: number, codUnavailableReason: string | null): CartTotalsDto {
    return {
      mrpTotal: fromPaise(p.mrpTotal), subtotal: fromPaise(p.subtotal), productDiscount: fromPaise(p.productDiscount), couponDiscount: fromPaise(p.couponDiscount),
      prepaidDiscount: fromPaise(p.prepaidDiscount), prepaidSavings: fromPaise(prepaidSavings),
      shippingFee: fromPaise(p.shippingFee), codFee: fromPaise(p.codFee), taxTotal: fromPaise(p.taxTotal), grandTotal: fromPaise(p.grandTotal),
      codAvailable: p.codAvailable && !codUnavailableReason && this.env.COD_ENABLED,
      codUnavailableReason: !this.env.COD_ENABLED ? 'Cash on Delivery is currently unavailable' : codUnavailableReason ?? (p.codAvailable ? null : `Cash on Delivery is available up to ₹${fromPaise(PRICING_RULES.codMaxOrderValue)}`),
      freeShippingThreshold: fromPaise(PRICING_RULES.freeShippingThreshold),
    };
  }

  owner(req: Request, userId?: string): CartOwner {
    if (userId) return { userId };
    const t = req.cookies?.[CART_COOKIE] as string | undefined;
    return { guestToken: t && /^[\w-]{20,64}$/.test(t) ? t : null };
  }

  private where(o: CartOwner) {
    return o.userId ? { userId: o.userId } : o.guestToken ? { guestToken: o.guestToken } : null;
  }

  async find(o: CartOwner) {
    const w = this.where(o);
    return w ? this.prisma.cart.findUnique({ where: w, include: { items: { include: itemInclude, orderBy: { createdAt: 'asc' } } } }) : null;
  }

  async getOrCreate(o: CartOwner, res: Response) {
    const existing = await this.find(o);
    if (existing) return existing;
    if (o.userId) return this.prisma.cart.create({ data: { userId: o.userId }, include: { items: { include: itemInclude } } });
    const guestToken = randomBytes(24).toString('base64url');
    res.cookie(CART_COOKIE, guestToken, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 30 * 86400_000, path: '/' });
    o.guestToken = guestToken;
    return this.prisma.cart.create({ data: { guestToken }, include: { items: { include: itemInclude } } });
  }

  private available(i: LoadedItem) {
    return i.variant.inventory ? Math.max(0, i.variant.inventory.onHand - i.variant.inventory.reserved) : 0;
  }

  private sellable(i: LoadedItem) {
    return i.variant.isActive && i.variant.product.status === 'ACTIVE' && !i.variant.product.deletedAt;
  }

  private toItem(i: LoadedItem): CartItemDto {
    const available = this.available(i);
    const unitPrice = decToNum(i.variant.price);
    return {
      id: i.id, variantId: i.variantId, productId: i.variant.product.id, productSlug: i.variant.product.slug, name: i.variant.product.name, brand: i.variant.product.brand,
      imageUrl: i.variant.product.images[0]?.thumbUrl ?? null, color: i.variant.color, size: i.variant.size, sku: i.variant.sku, quantity: i.quantity,
      unitPrice, unitMrp: decToNum(i.variant.mrp), lineTotal: fromPaise(decToPaise(i.variant.price) * i.quantity), available,
      purchasable: this.sellable(i) && available >= i.quantity, savedForLater: i.savedForLater,
    };
  }

  /** Lines that would be bought: active, not saved for later, and in stock. */
  pricingLines(items: LoadedItem[]): PricingLine[] {
    return items.filter((i) => !i.savedForLater && this.sellable(i) && this.available(i) >= i.quantity).map((i) => ({
      variantId: i.variantId, categoryIds: [i.variant.product.categoryId], unitPrice: decToPaise(i.variant.price), unitMrp: decToPaise(i.variant.mrp), quantity: i.quantity,
    }));
  }

  async quote(o: CartOwner, opts: { shippingMethod?: ShippingMethod; paymentMethod?: 'ONLINE' | 'COD'; couponCode?: string | null; email?: string | null }) {
    const cart = await this.find(o);
    const items = cart?.items ?? [];
    const lines = this.pricingLines(items);
    const code = opts.couponCode === undefined ? cart?.couponCode : opts.couponCode;
    let couponError: string | null = null;
    let coupon = null;
    if (code) {
      const r = await this.coupons.resolve(code, { userId: o.userId, email: opts.email });
      if ('error' in r) couponError = r.error;
      else coupon = r.coupon;
    }
    const pricing = priceCart({ lines, coupon, shippingMethod: opts.shippingMethod, paymentMethod: opts.paymentMethod, prepaid: this.prepaid });
    const prepaidSavings = opts.paymentMethod === 'ONLINE' ? pricing.prepaidDiscount : priceCart({ lines, coupon, shippingMethod: opts.shippingMethod, paymentMethod: 'ONLINE', prepaid: this.prepaid }).prepaidDiscount;
    return { cart, items, pricing, prepaidSavings, couponError: couponError ?? pricing.couponError };
  }

  async view(o: CartOwner): Promise<CartDto> {
    const { cart, items, pricing, prepaidSavings, couponError } = await this.quote(o, {});
    const dto = items.map((i) => this.toItem(i));
    return {
      id: cart?.id ?? '', items: dto.filter((i) => !i.savedForLater), savedItems: dto.filter((i) => i.savedForLater),
      couponCode: cart?.couponCode ?? null, couponError: cart?.couponCode ? couponError : null,
      totals: this.totalsDto(pricing, prepaidSavings, null),
      itemCount: dto.filter((i) => !i.savedForLater).reduce((s, i) => s + i.quantity, 0),
    };
  }

  private async assertStock(variantId: string, quantity: number) {
    const v = await this.prisma.productVariant.findUnique({ where: { id: variantId }, include: { inventory: true, product: true } });
    if (!v || !v.isActive || v.product.status !== 'ACTIVE' || v.product.deletedAt) throw notFound('Product variant');
    const available = v.inventory ? v.inventory.onHand - v.inventory.reserved : 0;
    if (available < quantity) throw outOfStock(available > 0 ? `Only ${available} left in ${v.color} / ${v.size}` : `${v.color} / ${v.size} is out of stock`, { available });
  }

  async add(o: CartOwner, res: Response, variantId: string, quantity: number) {
    const cart = await this.getOrCreate(o, res);
    const existing = cart.items.find((i) => i.variantId === variantId);
    const next = Math.min(MAX_QTY, (existing && !existing.savedForLater ? existing.quantity : 0) + quantity);
    await this.assertStock(variantId, next);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      create: { cartId: cart.id, variantId, quantity: next },
      update: { quantity: next, savedForLater: false },
    });
    return this.view(o);
  }

  private async ownedItem(o: CartOwner, itemId: string) {
    const cart = await this.find(o);
    const item = cart?.items.find((i) => i.id === itemId);
    if (!item) throw notFound('Bag item');
    return item;
  }

  async setQuantity(o: CartOwner, itemId: string, quantity: number) {
    const item = await this.ownedItem(o, itemId);
    if (quantity > MAX_QTY) throw badRequest(`You can buy at most ${MAX_QTY} of an item`);
    await this.assertStock(item.variantId, quantity);
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return this.view(o);
  }

  async remove(o: CartOwner, itemId: string) {
    await this.ownedItem(o, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.view(o);
  }

  async setSaved(o: CartOwner, itemId: string, saved: boolean) {
    const item = await this.ownedItem(o, itemId);
    if (!saved) await this.assertStock(item.variantId, item.quantity);
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { savedForLater: saved } });
    return this.view(o);
  }

  async applyCoupon(o: CartOwner, res: Response, code: string, email?: string) {
    const cart = await this.getOrCreate(o, res);
    const r = await this.coupons.resolve(code, { userId: o.userId, email });
    if ('error' in r) throw badRequest(r.error);
    const lines = this.pricingLines(cart.items);
    const priced = priceCart({ lines, coupon: r.coupon });
    if (priced.couponError) throw badRequest(priced.couponError);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: r.row.code } });
    return this.view(o);
  }

  async removeCoupon(o: CartOwner) {
    const cart = await this.find(o);
    if (cart) await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    return this.view(o);
  }

  /** On login: fold the guest cart into the user's cart (quantities summed, capped). */
  async mergeGuestCart(req: Request, res: Response, userId: string) {
    const token = req.cookies?.[CART_COOKIE] as string | undefined;
    if (!token) return;
    const guest = await this.prisma.cart.findUnique({ where: { guestToken: token }, include: { items: true } });
    res.clearCookie(CART_COOKIE, { path: '/' });
    if (!guest) return;
    await this.prisma.$transaction(async (tx) => {
      const userCart = (await tx.cart.findUnique({ where: { userId } })) ?? (await tx.cart.create({ data: { userId } }));
      for (const gi of guest.items) {
        const existing = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: userCart.id, variantId: gi.variantId } } });
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: userCart.id, variantId: gi.variantId } },
          create: { cartId: userCart.id, variantId: gi.variantId, quantity: gi.quantity, savedForLater: gi.savedForLater },
          update: { quantity: Math.min(MAX_QTY, (existing?.quantity ?? 0) + gi.quantity) },
        });
      }
      if (guest.couponCode && !userCart.couponCode) await tx.cart.update({ where: { id: userCart.id }, data: { couponCode: guest.couponCode } });
      await tx.cart.delete({ where: { id: guest.id } });
    });
  }

  async clearPurchased(cartId: string, variantIds: string[]) {
    await this.prisma.cartItem.deleteMany({ where: { cartId, variantId: { in: variantIds }, savedForLater: false } });
    await this.prisma.cart.update({ where: { id: cartId }, data: { couponCode: null } });
  }
}
