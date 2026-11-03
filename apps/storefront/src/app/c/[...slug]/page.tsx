import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CategoryNode, ProductListResponse } from '@vyra/shared';
import { Alert, Button } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { ListingView } from '@/components/listing/listing-view';
import { ProductImage } from '@/components/product/product-image';
import { serverFetch } from '@/lib/server-api';
import { categoryHref } from '@/lib/categories';
import { pickListParams, LIST_KEYS, type SearchParams } from '@/lib/listing-params';
import { FREE_SHIPPING_TEXT } from '@/lib/store-promises';

type CategoryWithPath = CategoryNode & { path: { name: string; slug: string }[] };
type Props = { params: Promise<{ slug: string[] }>; searchParams: Promise<SearchParams> };

function getCategory(slug: string) {
  return serverFetch<CategoryWithPath>(`/categories/${encodeURIComponent(slug)}`, {
    revalidate: 300,
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const leaf = slug.at(-1) ?? '';
  const res = await getCategory(leaf);
  if (!res.ok) return { title: 'Shop' };
  const c = res.data;
  const pathNames = c.path.map((p) => p.name).join(' ');
  const title = c.seoTitle ?? `${pathNames || c.name} — Shop online`;
  const description =
    c.seoDescription ??
    c.description ??
    `Shop ${c.name} at VYRA. Latest styles, best prices, free shipping above ${FREE_SHIPPING_TEXT} and easy returns.`;
  const canonical = categoryHref(c.path.length ? c.path : [{ slug: c.slug }]);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      images: c.bannerUrl ? [c.bannerUrl] : undefined,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const leaf = slug.at(-1);
  if (!leaf) notFound();
  const catRes = await getCategory(leaf);
  if (!catRes.ok && catRes.status === 404) notFound();

  const query = {
    ...pickListParams(
      sp,
      LIST_KEYS.filter((k) => k !== 'category'),
    ),
    category: leaf,
  };
  const listRes = await serverFetch<ProductListResponse>('/products', { query, revalidate: 60 });

  if (!catRes.ok) {
    return (
      <Container className="py-10">
        <Alert tone="danger" title="We couldn’t load this category">
          The catalogue is temporarily unavailable. Please try again shortly.
        </Alert>
      </Container>
    );
  }
  const c = catRes.data;
  const path = c.path.length ? c.path : [{ name: c.name, slug: c.slug }];
  const data = listRes.ok ? listRes.data : null;

  const header = (
    <>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          ...path.map((p, i) => ({ label: p.name, href: categoryHref(path.slice(0, i + 1)) })),
        ]}
      />
      {c.bannerUrl ? (
        <div className="relative mt-3 aspect-[3/1] overflow-hidden rounded-lg bg-surface-2 sm:aspect-[5/1]">
          <ProductImage
            src={c.bannerUrl}
            alt={c.name}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-1">
        <h1 className="font-display text-xl font-extrabold sm:text-2xl">{c.name}</h1>
        {c.description && <p className="max-w-2xl text-sm text-muted">{c.description}</p>}
      </div>
      {c.children.length > 0 && (
        <ul
          className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0"
          aria-label="Subcategories"
        >
          {c.children
            .filter((ch) => ch.isActive !== false)
            .map((ch) => (
              <li key={ch.id} className="shrink-0">
                <Link
                  href={`${categoryHref(path)}/${ch.slug}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong px-4 py-1.5 text-sm font-medium hover:border-fg"
                >
                  {ch.name}
                  {ch.productCount !== undefined && (
                    <span className="text-xs text-subtle">{ch.productCount}</span>
                  )}
                </Link>
              </li>
            ))}
        </ul>
      )}
    </>
  );

  return (
    <Container>
      <ListingView
        header={header}
        products={data?.items ?? []}
        meta={data?.meta ?? null}
        facets={data?.facets ?? null}
        showCategoryFacet={false}
        error={
          listRes.ok ? null : 'Products are temporarily unavailable. Please try again shortly.'
        }
        emptyAction={
          <Button asChild variant="outline">
            <Link href={categoryHref(path)}>Clear filters</Link>
          </Button>
        }
      />
    </Container>
  );
}
