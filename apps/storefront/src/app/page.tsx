import Link from 'next/link';
import type { CampaignPublicDto, HomeDto } from '@vyra/shared';
import { Alert } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';
import { Hero } from '@/components/home/hero';
import { HomeSaleBanner } from '@/components/campaign/sale-banner';
import { CategoryTiles } from '@/components/home/category-tiles';
import { SeasonalStrip } from '@/components/home/seasonal-strip';
import { RecentlyViewed } from '@/components/home/recently-viewed';
import { ProductRail } from '@/components/product/product-rail';
import { NewsletterForm } from '@/components/layout/newsletter-form';
import { serverFetch } from '@/lib/server-api';

export const revalidate = 60;

export default async function HomePage() {
  const [res, sales] = await Promise.all([
    serverFetch<HomeDto>('/home', { revalidate: 60 }),
    serverFetch<CampaignPublicDto[]>('/campaigns/current', { revalidate: 60, timeoutMs: 4000 }),
  ]);
  const home = res.ok ? res.data : null;
  return (
    <Container>
      <HomeSaleBanner initial={sales.ok ? sales.data : null} />
      <Hero deals={home?.deals ?? null} />
      {!home && (
        <Alert tone="warning" className="mt-6" title="We’re refreshing the shelves">
          Products couldn’t be loaded right now. Please{' '}
          <Link href="/" className="font-semibold underline">
            reload
          </Link>{' '}
          in a moment.
        </Alert>
      )}
      {home && (
        <>
          <CategoryTiles categories={home.categories} />
          <ProductRail
            eyebrow="Hot right now"
            title="Trending"
            products={home.trending}
            viewAllHref="/products?sort=popularity"
          />
          <ProductRail
            eyebrow="Just landed"
            title="New arrivals"
            products={home.newArrivals}
            viewAllHref="/products?sort=newest"
          />
          <SeasonalStrip />
          <ProductRail
            eyebrow="Customer favourites"
            title="Best sellers"
            products={home.bestSellers}
            viewAllHref="/products?sort=popularity"
          />
          <ProductRail
            eyebrow="Editor’s picks"
            title="Featured"
            products={home.featured}
            viewAllHref="/products"
          />
        </>
      )}
      <RecentlyViewed />
      <section
        aria-labelledby="newsletter-heading"
        className="mt-8 overflow-hidden rounded-xl border border-border bg-surface px-6 py-10 sm:px-10"
      >
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-600">
            The VYRA list
          </p>
          <h2 id="newsletter-heading" className="mt-2 font-display text-2xl font-extrabold">
            First dibs on every drop
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            Early access to new collections, members-only offers and style notes. No spam,
            unsubscribe anytime.
          </p>
          <NewsletterForm className="mt-6 max-w-md" />
        </div>
      </section>
    </Container>
  );
}
