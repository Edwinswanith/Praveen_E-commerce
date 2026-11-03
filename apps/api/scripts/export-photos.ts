/**
 * Exports AI-generated product photos from storage + DB into versioned seed
 * assets (apps/api/seed-assets/photos) so fresh environments get them without
 * regenerating (and paying for) them. Run: tsx --env-file=.env scripts/export-photos.ts
 */
import { PrismaClient } from '@prisma/client';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const prisma = new PrismaClient();
  const storage = resolve(process.env.STORAGE_LOCAL_DIR ?? './storage');
  const out = resolve(__dirname, '../seed-assets/photos');
  rmSync(out, { recursive: true, force: true });
  const images = await prisma.productImage.findMany({ where: { aiGenerated: true }, include: { product: { select: { slug: true } } }, orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }] });
  const manifest: Record<string, { file: string; color: string | null; alt: string; sortOrder: number; aiPrompt: string | null }[]> = {};
  for (const img of images) {
    const dir = join(out, img.product.slug);
    mkdirSync(dir, { recursive: true });
    const file = `${String(img.sortOrder).padStart(2, '0')}-${slug(img.color ?? 'all')}.webp`;
    copyFileSync(join(storage, img.storageKey), join(dir, file));
    (manifest[img.product.slug] ??= []).push({ file: `${img.product.slug}/${file}`, color: img.color, alt: img.alt, sortOrder: img.sortOrder, aiPrompt: img.aiPrompt });
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`exported ${images.length} images for ${Object.keys(manifest).length} products → ${out}`);
  await prisma.$disconnect();
}
main();
