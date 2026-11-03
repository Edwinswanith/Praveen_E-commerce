import type { Metadata } from 'next';
import Link from 'next/link';
import type { ProductListResponse } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { ListingView } from '@/components/listing/listing-view';
import { serverFetch } from '@/lib/server-api';
import { pickListParams, type SearchParams } from '@/lib/listing-params';

export const metadata: Metadata = {
  title: 'Shop all fashion',
  description:
    'Browse the full VYRA collection: new arrivals, best sellers and everyday essentials for men, women and kids.',
  alternates: { canonical: '/products' },
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const query = pickListParams(sp);
  const res = await serverFetch<ProductListResponse>('/products', { query, revalidate: 60 });
  const data = res.ok ? res.data : null;
  return (
    <Container>
      <ListingView
        header={
          <>
            <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'All products' }]} />
            <h1 className="mt-2 font-display text-xl font-extrabold sm:text-2xl">
              {query.q ? `Results for “${query.q}”` : 'All products'}
            </h1>
          </>
        }
        products={data?.items ?? []}
        meta={data?.meta ?? null}
        facets={data?.facets ?? null}
        error={
          res.ok ? null : 'The catalogue is temporarily unavailable. Please try again shortly.'
        }
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/products">Clear filters</Link>
          </Button>
        }
      />
    </Container>
  );
}
