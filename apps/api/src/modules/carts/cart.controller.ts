import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { addToCartSchema, applyCouponSchema, updateCartItemSchema } from '@vyra/shared';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentUser, OptionalAuth, Public, type AuthUser } from '../auth/auth.decorators';
import { CouponsService } from '../coupons/coupons.service';
import { CartService } from './cart.service';

@ApiTags('cart')
@Public()
@OptionalAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Get()
  get(@Req() req: Request, @CurrentUser() u?: AuthUser) {
    return this.carts.view(this.carts.owner(req, u?.id));
  }

  @Post('items')
  add(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(addToCartSchema)) b: z.infer<typeof addToCartSchema>, @CurrentUser() u?: AuthUser) {
    return this.carts.add(this.carts.owner(req, u?.id), res, b.variantId, b.quantity);
  }

  @Patch('items/:id')
  qty(@Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(updateCartItemSchema)) b: { quantity: number }, @CurrentUser() u?: AuthUser) {
    return this.carts.setQuantity(this.carts.owner(req, u?.id), id, b.quantity);
  }

  @Delete('items/:id')
  remove(@Req() req: Request, @Param('id') id: string, @CurrentUser() u?: AuthUser) {
    return this.carts.remove(this.carts.owner(req, u?.id), id);
  }

  @HttpCode(200) @Post('items/:id/save-for-later')
  save(@Req() req: Request, @Param('id') id: string, @CurrentUser() u?: AuthUser) {
    return this.carts.setSaved(this.carts.owner(req, u?.id), id, true);
  }

  @HttpCode(200) @Post('items/:id/move-to-cart')
  unsave(@Req() req: Request, @Param('id') id: string, @CurrentUser() u?: AuthUser) {
    return this.carts.setSaved(this.carts.owner(req, u?.id), id, false);
  }

  @HttpCode(200) @Post('coupon')
  coupon(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(applyCouponSchema)) b: { code: string }, @CurrentUser() u?: AuthUser) {
    return this.carts.applyCoupon(this.carts.owner(req, u?.id), res, b.code, u?.email ?? undefined);
  }

  @Delete('coupon')
  uncoupon(@Req() req: Request, @CurrentUser() u?: AuthUser) {
    return this.carts.removeCoupon(this.carts.owner(req, u?.id));
  }
}

@ApiTags('coupons')
@Public()
@Controller('coupons')
export class PublicCouponsController {
  constructor(private readonly coupons: CouponsService) {}
  @Get('available')
  available() {
    return this.coupons.available();
  }
}
