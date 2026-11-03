import type { MetadataRoute } from 'next';
import type { CategoryNode, ProductListResponse } from '@vyra/shared';
import { serverFetch } from '@/lib/server-api';
import { SITE_URL } from '@/lib/site';
import { flattenCategories } from '@/lib/categories';

export const revalidate = 3600;

const MAX_PRODUCT_PAGES = 20;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/products`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
  ];

  const cats = await serverFetch<CategoryNode[]>('/categories', { revalidate: 3600 });
  if (cats.ok) {
    for (const c of flattenCategories(cats.data)) {
      entries.push({
        url: `${SITE_URL}${c.href}`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
  }

  // Page through the catalogue (60 per page, capped) — tolerate the API being down.
  for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
    const res = await serverFetch<ProductListResponse>('/products', {
      revalidate: 3600,
      query: { page, pageSize: 60, sort: 'newest' },
    });
    if (!res.ok) break;
    for (const p of res.data.items) {
      entries.push({
        url: `${SITE_URL}/p/${p.slug}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
    if (page >= res.data.meta.totalPages) break;
  }
  return entries;
}
