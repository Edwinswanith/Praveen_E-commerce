import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { StorageService } from '../../common/storage/storage.service';
import { badRequest } from '../../common/http/errors';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);

/** Magic-number check: never trust the client-declared mimetype. */
export function sniffVideo(buf: Buffer): 'video/mp4' | 'video/webm' | null {
  if (buf.length > 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return null;
}

export interface ProcessedImage { buffer: Buffer; thumb: Buffer; width: number; height: number; hash: string; bytes: number }

@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Decodes the upload with sharp (rejects anything that is not a real raster
   * image — including SVG, which can carry scripts), auto-rotates, strips EXIF/GPS
   * metadata and re-encodes to WebP: a 1600px display image and a 600px thumbnail.
   */
  async processImage(input: Buffer, opts: { allowSvg?: boolean } = {}): Promise<ProcessedImage> {
    if (input.length > MAX_IMAGE_BYTES) throw badRequest('Images must be 10 MB or smaller');
    let meta: sharp.Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw badRequest('File is not a valid image');
    }
    const fmt = meta.format ?? '';
    if (!ALLOWED_IMAGE_FORMATS.has(fmt) && !(opts.allowSvg && fmt === 'svg')) throw badRequest('Upload JPEG, PNG, WebP or AVIF images');
    if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 200) throw badRequest('Images must be at least 200×200 pixels');
    const base = sharp(input, { density: fmt === 'svg' ? 144 : undefined }).rotate();
    const buffer = await base.clone().resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const thumb = await base.clone().resize({ width: 600, height: 800, fit: 'cover', position: 'attention' }).webp({ quality: 78 }).toBuffer();
    const out = await sharp(buffer).metadata();
    return { buffer, thumb, width: out.width ?? 0, height: out.height ?? 0, hash: createHash('sha256').update(input).digest('hex'), bytes: buffer.length };
  }

  async storeProductImage(productId: string, input: Buffer, opts: { allowSvg?: boolean } = {}) {
    const img = await this.processImage(input, opts);
    const id = randomUUID();
    const key = `products/${productId}/${id}.webp`;
    const url = await this.storage.put(key, img.buffer, 'image/webp');
    const thumbUrl = await this.storage.put(`products/${productId}/${id}_thumb.webp`, img.thumb, 'image/webp');
    return { key, url, thumbUrl, ...img };
  }

  async storeProductVideo(productId: string, input: Buffer) {
    if (input.length > MAX_VIDEO_BYTES) throw badRequest('Videos must be 50 MB or smaller');
    const mime = sniffVideo(input);
    if (!mime) throw badRequest('Upload an MP4 or WebM video');
    const key = `products/${productId}/videos/${randomUUID()}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`;
    const url = await this.storage.put(key, input, mime);
    return { key, url, mime, bytes: input.length };
  }

  /** Validates a customer's visual-search photo; returns a normalised JPEG (never stored). */
  async normaliseQueryImage(input: Buffer): Promise<Buffer> {
    if (input.length > 8 * 1024 * 1024) throw badRequest('Photos must be 8 MB or smaller');
    try {
      const meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
      if (!ALLOWED_IMAGE_FORMATS.has(meta.format ?? '')) throw new Error();
      return await sharp(input).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch {
      throw badRequest('Please upload a JPEG, PNG or WebP photo');
    }
  }
}
