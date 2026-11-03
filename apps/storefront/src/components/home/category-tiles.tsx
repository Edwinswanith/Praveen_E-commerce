import Link from 'next/link';
import type { CategoryNode } from '@vyra/shared';
import { toNav, type NavCategory } from '@/lib/categories';
import { ProductImage } from '../product/product-image';

const BLOCKS = [
  'bg-brand-50 text-brand-700',
  'bg-violet-500/10 text-violet-600',
  'bg-sun-300/40 text-amber-800',
  'bg-teal-500/10 text-teal-600',
];

/** Tiles for each top-level category's first children, falling back to the roots. */
export function CategoryTiles({ categories }: { categories: CategoryNode[] }) {
  const roots = toNav(categories);
  const tiles: (NavCategory & { parent?: string })[] = [];
  const maxDepth = Math.max(...roots.map((r) => r.children.length), 0);
  for (let i = 0; i < maxDepth && tiles.length < 12; i++) {
    for (const r of roots) {
      const c = r.children[i];
      if (c && tiles.length < 12) tiles.push({ ...c, parent: r.name });
    }
  }
  const list: (NavCategory & { parent?: string })[] = tiles.length >= 4 ? tiles : roots;
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="shop-by-category" className="py-8">
      <h2
        id="shop-by-category"
        className="mb-4 font-display text-lg font-extrabold uppercase tracking-wide sm:text-xl"
      >
        Shop by category
      </h2>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {list.map((c, i) => (
          <li key={c.id}>
            <Link href={c.href} className="group block">
              <div
                className={`relative flex aspect-square items-end overflow-hidden rounded-lg p-3 ${c.imageUrl ? 'bg-surface-2' : BLOCKS[i % BLOCKS.length]}`}
              >
                {c.imageUrl ? (
                  <ProductImage
                    src={c.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width:1024px) 16vw, 33vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="absolute -bottom-3 right-2 font-display text-6xl font-extrabold leading-none opacity-30 transition-transform duration-300 group-hover:-translate-y-1 sm:text-7xl"
                  >
                    {c.name.charAt(0)}
                  </span>
                )}
              </div>
              <p className="mt-2 truncate text-center text-sm font-semibold">{c.name}</p>
              {c.parent && (
                <p className="truncate text-center text-[11px] uppercase tracking-wider text-muted">
                  {c.parent}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
