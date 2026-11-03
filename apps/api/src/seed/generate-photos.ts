/* eslint-disable no-console */
/**
 * Regenerates catalogue photography with Gemini image generation (demo/dev).
 * Per product colour: a hero shot (adult model; ghost mannequin for kids;
 * product shot for accessories) + a detail shot that uses the hero as its
 * reference so both show the SAME garment. Drawings are replaced only after a
 * product's new photos succeed; finished products are skipped (resumable).
 *
 *   node --env-file=.env dist/src/seed/generate-photos.js [--force] [--limit=N] [--slug=x]
 *
 * For REAL products, use the admin "AI studio photo" on a photo of the actual
 * garment instead; generated-from-text images must not represent stock you sell.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

process.env.QUEUES_ENABLED = 'false';

async function main() {
  const { AppModule } = await import('../app.module');
  const { PrismaService } = await import('../common/prisma/prisma.service');
  const { StorageService } = await import('../common/storage/storage.service');
  const { MediaService } = await import('../modules/media/media.service');
  const { EmbeddingService } = await import('../modules/ai/embedding.service');
  const { ImageGenService, buildPhotoPrompt } = await import('../modules/ai/image-gen.service');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
  const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];
  const concurrency = Number(process.env.PHOTO_CONCURRENCY ?? 4);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService), storage = app.get(StorageService), media = app.get(MediaService);
  const embeddings = app.get(EmbeddingService), gen = app.get(ImageGenService);
  if (!gen.configured) throw new Error('GEMINI_API_KEY is not set');

  const products = await prisma.product.findMany({
    where: { deletedAt: null, ...(onlySlug ? { slug: onlySlug } : {}) },
    include: { category: true, attributes: true, images: true, variants: { where: { isActive: true }, select: { color: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  const todo = products.filter((p) => force || !p.images.some((i) => i.aiGenerated)).slice(0, limit);
  console.log(`Generating photos for ${todo.length}/${products.length} products with ${gen.model} (concurrency ${concurrency})`);

  let done = 0, images = 0, failed = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const colors = [...new Set(p.variants.map((v) => v.color))];
      const subjectBase = { name: p.name, gender: p.gender, category: p.category.name, description: p.description, attributes: Object.fromEntries(p.attributes.map((a) => [a.key, a.value])) };
      const accessory = /cap|bag/i.test(p.category.slug);
      const heroStyle = p.gender === 'KIDS' ? 'STUDIO' : accessory ? 'STUDIO' : 'MODEL';
      const created: { id: string }[] = [];
      try {
        let order = 0;
        for (const color of colors) {
          const subject = { ...subjectBase, color };
          const hero = buildPhotoPrompt(subject, heroStyle, { hasReference: false, angle: 'front' });
          const heroImg = await gen.generate(hero.prompt);
          const detail = buildPhotoPrompt(subject, heroStyle === 'MODEL' ? 'STUDIO' : 'FLATLAY', { hasReference: true, angle: 'detail' });
          const detailImg = await gen.generate(detail.prompt, [{ data: heroImg, mimeType: 'image/jpeg' }]);
          for (const [img, prompt, label] of [[heroImg, hero.prompt, hero.style], [detailImg, detail.prompt, detail.style]] as const) {
            const s = await media.storeProductImage(p.id, img);
            created.push(await prisma.productImage.create({
              data: {
                productId: p.id, storageKey: s.key, url: s.url, thumbUrl: s.thumbUrl, width: s.width, height: s.height, mimeType: 'image/webp', bytes: s.bytes, contentHash: s.hash,
                color, alt: `${p.name} in ${color} (AI-generated ${label.toLowerCase()} photo)`, sortOrder: 1000 + order++, aiGenerated: true, aiPrompt: `${gen.model}: ${prompt}`.slice(0, 4000),
              },
            }));
            images++;
          }
        }
        // Success for every colour: retire the previous images and put the new ones first.
        const old = p.images;
        await prisma.productImage.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
        for (const o of old) {
          await storage.delete(o.storageKey);
          await storage.delete(o.storageKey.replace(/\.webp$/, '_thumb.webp'));
        }
        const fresh = await prisma.productImage.findMany({ where: { productId: p.id }, orderBy: { sortOrder: 'asc' } });
        for (const [i, img] of fresh.entries()) await prisma.productImage.update({ where: { id: img.id }, data: { sortOrder: i } });
        await embeddings.processProduct(p.id).catch((e: Error) => console.warn(`  embedding ${p.slug}: ${e.message.slice(0, 120)}`));
        done++;
        console.log(`  ✔ ${done}/${todo.length} ${p.name} (${colors.length} colours)`);
      } catch (e) {
        failed++;
        // Roll back this product's partial images; keep its old ones.
        await prisma.productImage.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
        console.warn(`  ✘ ${p.name}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  console.log(`\nDone: ${done} products, ${images} images, ${failed} failed. Re-run to retry failures (finished products are skipped).`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
