import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  changePasswordSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, verifyEmailSchema,
} from '@vyra/shared';
import { ZodPipe } from '../../common/http/zod.pipe';
import { unauthorized } from '../../common/http/errors';
import { CartService } from '../carts/cart.service';
import { CurrentUser, Public, StaffOnly, type AuthUser } from './auth.decorators';
import { AuthService } from './auth.service';
import { COOKIE, TokenService } from './token.service';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent') });
const AUTH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly tokens: TokenService, private readonly carts: CartService) {}

  @Public() @Throttle(AUTH_LIMIT) @Post('register')
  async register(@Body(new ZodPipe(registerSchema)) body: ReturnType<typeof registerSchema.parse>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.register(body, meta(req));
    this.tokens.setCookies(res, 'customer', tokens);
    await this.carts.mergeGuestCart(req, res, user.id);
    return user;
  }

  @Public() @Throttle(AUTH_LIMIT) @HttpCode(200) @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(body, 'customer', meta(req));
    this.tokens.setCookies(res, 'customer', tokens);
    await this.carts.mergeGuestCart(req, res, user.id);
    return user;
  }

  @Public() @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[COOKIE.customer.refresh];
    const rotated = raw ? await this.tokens.rotate(raw, 'customer', meta(req)) : null;
    if (!rotated) {
      this.tokens.clearCookies(res, 'customer');
      throw unauthorized('Session expired');
    }
    this.tokens.setCookies(res, 'customer', rotated);
    return this.auth.me(rotated.user.id);
  }

  @Public() @HttpCode(200) @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revoke(req.cookies?.[COOKIE.customer.refresh]);
    this.tokens.clearCookies(res, 'customer');
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Public() @HttpCode(200) @Post('verify-email')
  async verify(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } }) @HttpCode(200) @Post('resend-verification')
  async resend(@CurrentUser() user: AuthUser) {
    await this.auth.sendVerification(user.id, user.email);
    return { ok: true };
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post('forgot-password')
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public() @Throttle(AUTH_LIMIT) @HttpCode(200) @Post('reset-password')
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @HttpCode(200) @Post('change-password')
  async change(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }
}

@ApiTags('admin:auth')
@StaffOnly()
@Controller('admin/auth')
export class StaffAuthController {
  constructor(private readonly auth: AuthService, private readonly tokens: TokenService) {}

  @Public() @Throttle(AUTH_LIMIT) @HttpCode(200) @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(body, 'staff', meta(req));
    this.tokens.setCookies(res, 'staff', tokens);
    return user;
  }

  @Public() @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[COOKIE.staff.refresh];
    const rotated = raw ? await this.tokens.rotate(raw, 'staff', meta(req)) : null;
    if (!rotated) {
      this.tokens.clearCookies(res, 'staff');
      throw unauthorized('Session expired');
    }
    this.tokens.setCookies(res, 'staff', rotated);
    return this.auth.me(rotated.user.id);
  }

  @Public() @HttpCode(200) @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revoke(req.cookies?.[COOKIE.staff.refresh]);
    this.tokens.clearCookies(res, 'staff');
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
