import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import type { ProductCardDto, ProductDetailDto } from '@vyra/shared';
import { Alert, Skeleton } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { ProductDetail } from '@/components/pdp/product-detail';
import { Specs } from '@/components/pdp/specs';
import { Reviews } from '@/components/pdp/reviews';
import { ProductRail } from '@/components/product/product-rail';
import { RecentlyViewed } from '@/components/home/recently-viewed';
import { serverFetch } from '@/lib/server-api';
import { absoluteUrl } from '@/lib/site';
import { categoryHref } from '@/lib/categories';

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ variant?: string | string[] }> };

function getProduct(slug: string) {
  return serverFetch<ProductDetailDto>(`/products/${encodeURIComponent(slug)}`, { revalidate: 60 });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await getProduct(slug);
  if (!res.ok) return { title: res.status === 404 ? 'Product not found' : 'Product' };
  const p = res.data;
  const title =
    p.seoTitle ??
    (p.name.toLowerCase().includes(p.brand.toLowerCase()) || p.brand.toUpperCase() === 'VYRA'
      ? p.name
      : `${p.brand} ${p.name}`);
  const description = p.seoDescription ?? p.description.slice(0, 160);
  const image = p.images[0]?.url;
  return {
    title,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/p/${p.slug}`,
      images: image ? [{ url: absoluteUrl(image), alt: p.images[0]?.alt || p.name }] : undefined,
    },
  };
}

function productJsonLd(p: ProductDetailDto) {
  const active = p.variants.filter((v) => v.isActive);
  const prices = active.map((v) => v.price);
  const inStock = active.some((v) => v.inStock && v.available > 0);
  const url = absoluteUrl(`/p/${p.slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description,
    sku: active[0]?.sku,
    image: p.images.map((i) => absoluteUrl(i.url)),
    brand: { '@type': 'Brand', name: p.brand },
    category: p.category.path.map((c) => c.name).join(' > ') || p.category.name,
    url,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: prices.length ? Math.min(...prices) : p.minPrice,
      highPrice: prices.length ? Math.max(...prices) : p.minPrice,
      offerCount: active.length,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url,
    },
    ...(p.rating !== null && p.reviewCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: p.rating,
            reviewCount: p.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/** Similar + related rails: streamed in after the product so they never delay (or mask the 404 of) the main content. */
async function Rails({
  slug,
  productId,
  viewAllHref,
}: {
  slug: string;
  productId: string;
  viewAllHref: string;
}) {
  const [similar, related] = await Promise.all([
    serverFetch<ProductCardDto[]>(`/products/${encodeURIComponent(slug)}/similar`, {
      query: { limit: 12 },
      revalidate: 300,
    }),
    serverFetch<ProductCardDto[]>(`/products/${encodeURIComponent(slug)}/related`, {
      query: { limit: 12 },
      revalidate: 300,
    }),
  ]);
  const similarItems = similar.ok ? similar.data.filter((p) => p.id !== productId) : [];
  const similarIds = new Set(similarItems.map((p) => p.id));
  const relatedItems = related.ok
    ? related.data.filter((p) => p.id !== productId && !similarIds.has(p.id))
    : [];
  return (
    <>
      <ProductRail
        title="Similar products"
        eyebrow={
          <span className="inline-flex items-center gap-1 text-violet-600">
            <Sparkles className="size-3" aria-hidden />
            Visually similar · AI
          </span>
        }
        products={similarItems}
      />
      <ProductRail
        title="You may also like"
        eyebrow="Pairs well with"
        products={relatedItems}
        viewAllHref={viewAllHref}
      />
    </>
  );
}

function RailsSkeleton() {
  return (
    <div className="py-8" aria-busy="true" aria-label="Loading recommendations">
      <Skeleton className="h-5 w-48" />
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={i >= 2 ? 'hidden sm:block' : undefined}>
            <Skeleton className="aspect-[3/4] w-full rounded-md" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <Skeleton className="mt-1.5 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const v = (await searchParams)?.variant;
  const initialVariantId = typeof v === 'string' ? v : undefined;
  const res = await getProduct(slug);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <Container className="py-10">
        <Alert tone="danger" title="We couldn’t load this product">
          The store is temporarily unavailable. Please refresh in a moment.
        </Alert>
      </Container>
    );
  }
  const product = res.data;
  const path = product.category.path.length
    ? product.category.path
    : [{ name: product.category.name, slug: product.category.slug }];
  const sizes = [...new Set(product.variants.filter((v) => v.isActive).map((v) => v.size))];

  return (
    <Container className="pt-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productJsonLd(product)).replace(/</g, '\\u003c'),
        }}
      />
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          ...path.map((c, i) => ({ label: c.name, href: categoryHref(path.slice(0, i + 1)) })),
          { label: product.name },
        ]}
      />
      <div className="mt-4">
        <ProductDetail product={product} initialVariantId={initialVariantId} />
      </div>
      <div className="mt-8 border-t border-border">
        <Specs product={product} />
      </div>
      <div className="border-t border-border">
        <Reviews slug={product.slug} sizes={sizes} />
      </div>
      <div className="border-t border-border">
        <Suspense fallback={<RailsSkeleton />}>
          <Rails slug={slug} productId={product.id} viewAllHref={categoryHref(path)} />
        </Suspense>
        <RecentlyViewed excludeId={product.id} />
      </div>
    </Container>
  );
}
