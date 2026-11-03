import type { CategoryNode } from '@vyra/shared';

/** Map of category id -> URL path segments (root..leaf slugs). */
export function categoryHref(path: { slug: string }[]): string {
  return `/c/${path.map((p) => p.slug).join('/')}`;
}

/** Walks the tree attaching full hrefs, so nav links are /c/men/topwear/t-shirts. */
export interface NavCategory {
  id: string;
  name: string;
  slug: string;
  href: string;
  imageUrl: string | null;
  productCount?: number;
  children: NavCategory[];
}

export function toNav(nodes: CategoryNode[], parents: string[] = []): NavCategory[] {
  return [...nodes]
    .filter((n) => n.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((n) => {
      const segs = [...parents, n.slug];
      return {
        id: n.id,
        name: n.name,
        slug: n.slug,
        href: `/c/${segs.join('/')}`,
        imageUrl: n.imageUrl,
        productCount: n.productCount,
        children: toNav(n.children ?? [], segs),
      };
    });
}

export function findBySlug(nodes: CategoryNode[], slug: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    const hit = findBySlug(n.children ?? [], slug);
    if (hit) return hit;
  }
  return null;
}

/** Flattens a tree to [{ slug, path }] for the sitemap. */
export function flattenCategories(
  nodes: CategoryNode[],
  parents: string[] = [],
): { slug: string; href: string }[] {
  return nodes.flatMap((n) => {
    const segs = [...parents, n.slug];
    return [
      { slug: n.slug, href: `/c/${segs.join('/')}` },
      ...flattenCategories(n.children ?? [], segs),
    ];
  });
}
