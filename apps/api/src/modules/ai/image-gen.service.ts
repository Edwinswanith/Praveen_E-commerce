import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { AppError } from '../../common/http/errors';

export type PhotoStyle = 'MODEL' | 'STUDIO' | 'FLATLAY' | 'LIFESTYLE';

export interface PhotoSubject {
  name: string;
  gender: 'MEN' | 'WOMEN' | 'KIDS' | 'UNISEX';
  category: string;
  color: string;
  description: string;
  attributes: Record<string, string>;
}

const BRAND_RULES = 'No text, no captions, no watermark, no brand logos, no printed or sewn neck labels or tags visible, no extra accessories that hide the garment. Photorealistic, true-to-life colour.';

/**
 * Builds a catalogue-photography prompt from real product data. Rules:
 *  - Kids' products are NEVER generated on a child model (ghost mannequin / flat-lay instead).
 *  - With a reference photo, the garment must be reproduced exactly (no redesign):
 *    AI styling may change background, lighting and presentation, not the product.
 */
export function buildPhotoPrompt(s: PhotoSubject, style: PhotoStyle, opts: { hasReference: boolean; angle?: 'front' | 'back' | 'detail'; notes?: string }): { prompt: string; style: PhotoStyle } {
  const effective: PhotoStyle = s.gender === 'KIDS' && (style === 'MODEL' || style === 'LIFESTYLE') ? 'STUDIO' : style;
  const accessory = /cap|bag|tote|backpack/i.test(`${s.category} ${s.name}`);
  const specs = [s.attributes.fabric, s.attributes.fit ? `${s.attributes.fit} fit` : ''].filter(Boolean).join(', ').toLowerCase();
  const garment = `${s.color.toLowerCase()} ${s.name.toLowerCase()}${specs ? ` (${specs})` : ''}`;
  const details = [s.attributes.pattern, s.attributes.sleeve, s.attributes.neck].filter(Boolean).join(', ');
  const wearer = s.gender === 'WOMEN' ? 'a young Indian woman' : s.gender === 'MEN' ? 'a young Indian man' : 'a young Indian adult model';
  const angle = opts.angle === 'back' ? 'back view showing the back of the garment' : opts.angle === 'detail' ? 'close-up detail shot of the fabric texture, stitching and neckline' : 'front view';

  let scene: string;
  if (accessory) {
    scene = effective === 'LIFESTYLE'
      ? `${wearer} carrying/wearing a ${garment} on a tasteful Indian city street, soft natural daylight, shallow depth of field, the product is the hero.`
      : `A ${garment} as a standalone product shot, ${angle}, centred on a plain warm light-grey seamless studio background, soft diffused lighting, gentle shadow.`;
  } else if (effective === 'MODEL') {
    scene = `${wearer} wearing a ${garment}, styled simply with neutral basics so the garment stands out, ${angle}, natural relaxed pose, three-quarter body framing, plain warm light-grey seamless studio background, soft diffused studio lighting, sharp focus on fabric texture.`;
  } else if (effective === 'LIFESTYLE') {
    scene = `${wearer} wearing a ${garment} in a tasteful modern Indian setting (cafe terrace or leafy city street), golden-hour natural light, editorial fashion photography, the garment clearly visible and in focus.`;
  } else if (effective === 'FLATLAY') {
    scene = `A ${garment} neatly laid flat, top-down flat-lay photograph on a clean off-white textured surface, garment fully visible and symmetrical, soft even lighting.`;
  } else {
    scene = `A ${garment} on an invisible ghost mannequin, ${angle}, showing natural shape and drape, plain pure light-grey studio background, soft even e-commerce lighting.`;
  }
  const reference = opts.hasReference
    ? 'Use the garment in the reference image EXACTLY: identical colour, fabric, print, neckline, sleeve length, hem length, buttons, pockets and every detail. Do not redesign, recolour or add anything to the garment. Only change the presentation.'
    : '';
  const prompt = [
    'Professional e-commerce fashion catalogue photograph for an Indian clothing brand, 4:5 portrait.',
    scene,
    details ? `Garment details: ${details}.` : '',
    s.description ? `Product description: ${s.description.slice(0, 300)}` : '',
    reference,
    opts.notes ? `Additional direction: ${opts.notes}` : '',
    BRAND_RULES,
  ].filter(Boolean).join(' ');
  return { prompt, style: effective };
}

/** Gemini image generation ("Nano Banana" family) for product photography. */
@Injectable()
export class ImageGenService {
  private readonly logger = new Logger('ImageGen');

  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured() {
    return !!this.env.GEMINI_API_KEY;
  }

  get model() {
    return this.env.IMAGE_GEN_MODEL;
  }

  async generate(prompt: string, references: { data: Buffer; mimeType: string }[] = []): Promise<Buffer> {
    if (!this.env.GEMINI_API_KEY) throw new AppError('NOT_CONFIGURED', 'AI photography needs GEMINI_API_KEY', HttpStatus.SERVICE_UNAVAILABLE);
    const parts = [
      ...references.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.data.toString('base64') } })),
      { text: prompt },
    ];
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.env.IMAGE_GEN_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } } }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { data: string } }[] }; finishReason?: string }[]; error?: { message: string } };
      const img = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (res.ok && img) return Buffer.from(img.data, 'base64');
      lastError = json.error?.message ?? `no image returned (${json.candidates?.[0]?.finishReason ?? res.status})`;
      if (res.status !== 429 && res.status < 500 && res.ok) break; // safety block / no image: don't hammer
      if (!res.ok && res.status < 500 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    this.logger.warn(`Image generation failed: ${lastError}`);
    throw new AppError('BAD_REQUEST', `The AI could not generate this photo: ${lastError.slice(0, 200)}`, HttpStatus.BAD_GATEWAY);
  }
}
