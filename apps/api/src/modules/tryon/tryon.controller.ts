import { Body, Controller, Get, HttpCode, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { tryOnSchema } from '@vyra/shared';
import { parseOrThrow } from '../../common/http/zod.pipe';
import { badRequest } from '../../common/http/errors';
import { CurrentUser, OptionalAuth, Public, type AuthUser } from '../auth/auth.decorators';
import { EventsService } from '../events/events.service';
import { TryOnService } from './tryon.service';

@ApiTags('try-on')
@Public()
@OptionalAuth()
@Controller('try-on')
export class TryOnController {
  constructor(private readonly tryon: TryOnService, private readonly events: EventsService) {}

  /** multipart: photo (≤8MB jpeg/png/webp), productSlug, color?, consent="true". Photo is never stored. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post() @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  async create(@Req() req: Request, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, string>, @CurrentUser() u?: AuthUser) {
    const input = parseOrThrow(tryOnSchema, body);
    if (!file) throw badRequest('Add a photo of yourself to try this on');
    return this.tryon.tryOn(file.buffer, input, this.events.context(req, u?.id));
  }

  @Get('quota')
  async quota(@Req() req: Request) {
    return this.tryon.quota(this.events.context(req)?.sessionId);
  }
}
