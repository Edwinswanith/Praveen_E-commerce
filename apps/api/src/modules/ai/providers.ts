import sharp from 'sharp';
import { createHash } from 'node:crypto';

/**
 * Embedding providers. `textModel` / `imageModel` are the identifiers persisted
 * with every vector. Two vectors are only ever compared when their model ids are
 * identical, so switching providers can never silently mix embedding spaces.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly textModel: string;
  readonly imageModel: string;
  /** True when text and image vectors share one space (text→image search works). */
  readonly multimodal: boolean;
  readonly dimensions: number;
  readonly configured: boolean;
  embedTexts(texts: string[]): Promise<number[][]>;
  embedImage(image: Buffer, mimeType: string): Promise<number[]>;
}

export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export class EmbeddingProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

/** Google Gemini `gemini-embedding-2`: natively multimodal (text + image → same space). */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly multimodal = true;
  readonly textModel: string;
  readonly imageModel: string;
  private readonly base = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(private readonly apiKey: string | undefined, private readonly model: string, readonly dimensions: number) {
    this.textModel = `${model}@${dimensions}`;
    this.imageModel = this.textModel;
  }

  get configured() {
    return !!this.apiKey;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.apiKey) throw new EmbeddingProviderError('GEMINI_API_KEY is not configured', false);
    const res = await fetch(`${this.base}/models/${this.model}:${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new EmbeddingProviderError(`Gemini ${res.status}: ${text}`, res.status === 429 || res.status >= 500);
    }
    return (await res.json()) as T;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      const r = await this.post<{ embeddings: { values: number[] }[] }>('batchEmbedContents', {
        requests: batch.map((text) => ({ model: `models/${this.model}`, content: { parts: [{ text: text.slice(0, 8000) }] }, outputDimensionality: this.dimensions })),
      });
      out.push(...r.embeddings.map((e) => l2normalize(e.values)));
    }
    return out;
  }

  async embedImage(image: Buffer, mimeType: string): Promise<number[]> {
    const r = await this.post<{ embedding: { values: number[] } }>('embedContent', {
      content: { parts: [{ inline_data: { mime_type: mimeType, data: image.toString('base64') } }] },
      outputDimensionality: this.dimensions,
    });
    return l2normalize(r.embedding.values);
  }
}

const SYNONYMS: Record<string, string> = {
  tee: 'tshirt', tees: 'tshirt', 't-shirt': 'tshirt', tshirts: 'tshirt', shirts: 'shirt', jeans: 'jean', denim: 'jean',
  trousers: 'trouser', pants: 'trouser', chinos: 'chino', dresses: 'dress', kurti: 'kurta', kurtas: 'kurta',
  sneakers: 'sneaker', shoes: 'shoe', comfy: 'comfortable', relaxed: 'oversized', baggy: 'oversized', loose: 'oversized',
  hoodies: 'hoodie', sweatshirts: 'sweatshirt', tops: 'top', joggers: 'jogger', trackpants: 'jogger', ethnic: 'traditional',
  formal: 'office', workwear: 'office', party: 'evening', athleisure: 'sport', sportswear: 'sport', gym: 'sport', running: 'sport',
};

/**
 * Offline fallback (no network, deterministic). Text: signed feature hashing of
 * unigrams + bigrams with fashion synonyms — a lexical, not semantic, space.
 * Image: colour histogram in Lab-ish space + coarse spatial layout. The two
 * spaces are DIFFERENT models (multimodal = false). Use for development, CI and
 * as a degraded mode; production should use a real model (Gemini).
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly multimodal = false;
  readonly configured = true;
  readonly textModel: string;
  readonly imageModel: string;

  constructor(readonly dimensions = 768) {
    this.textModel = `local-hash-text-v1@${dimensions}`;
    this.imageModel = `local-color-image-v1@${dimensions}`;
  }

  private tokens(text: string): string[] {
    const words = text.toLowerCase().replace(/t-shirt/g, 'tshirt').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
    const norm = words.map((w) => SYNONYMS[w] ?? (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
    const bigrams = norm.slice(1).map((w, i) => `${norm[i]}_${w}`);
    return [...norm, ...bigrams];
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const tok of this.tokens(t)) {
        const h = createHash('md5').update(tok).digest();
        const idx = h.readUInt32BE(0) % this.dimensions;
        v[idx]! += (h[4]! & 1 ? 1 : -1) * (tok.includes('_') ? 0.5 : 1);
      }
      return l2normalize(v);
    });
  }

  async embedImage(image: Buffer): Promise<number[]> {
    const { data, info } = await sharp(image).resize(32, 32, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const v = new Array<number>(this.dimensions).fill(0);
    // 8x8x8 RGB histogram (512 dims) with centre-weighting (garment usually centred).
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        const r = data[i]! >> 5, g = data[i + 1]! >> 5, b = data[i + 2]! >> 5;
        const dx = x / info.width - 0.5, dy = y / info.height - 0.5;
        const w = 1.5 - Math.sqrt(dx * dx + dy * dy) * 2;
        v[r * 64 + g * 8 + b]! += Math.max(0.1, w);
      }
    }
    // 16x16 grayscale layout (256 dims) captures silhouette.
    const layout = await sharp(image).resize(16, 16, { fit: 'cover' }).greyscale().raw().toBuffer();
    for (let i = 0; i < 256 && 512 + i < this.dimensions; i++) v[512 + i] = ((255 - layout[i]!) / 255) * 0.15;
    return l2normalize(v);
  }
}

export function contentHash(...parts: string[]) {
  return createHash('sha256').update(parts.join('␟')).digest('hex');
}
