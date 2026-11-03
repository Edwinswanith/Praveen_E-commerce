import type { Metadata } from 'next';
import Link from 'next/link';
import { Camera, Search } from 'lucide-react';
import type { SearchResponse } from '@vyra/shared';
import { Button, EmptyState } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';
import { ListingView } from '@/components/listing/listing-view';
import { Interpretation } from '@/components/listing/interpretation';
import { serverFetch } from '@/lib/server-api';
import { first, pickListParams, type SearchParams } from '@/lib/listing-params';

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = first((await searchParams).q);
  return { title: q ? `Search: ${q}` : 'Search', robots: { index: false, follow: true } };
}

const SEARCH_KEYS = [
  'q',
  'page',
  'pageSize',
  'category',
  'gender',
  'sizes',
  'colors',
  'minPrice',
  'maxPrice',
  'sort',
] as const;

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = pickListParams(sp, SEARCH_KEYS);
  const q = query.q?.trim();
  if (!q) {
    return (
      <Container>
        <EmptyState
          icon={<Search />}
          title="What are you looking for?"
          description="Try natural language like “oversized black tee under ₹1000” or search with a photo."
          action={
            <Button asChild variant="outline">
              <Link href="/search/visual">
                <Camera aria-hidden /> Search with a photo
              </Link>
            </Button>
          }
        />
      </Container>
    );
  }
  const res = await serverFetch<SearchResponse>('/search', { query, revalidate: 60 });
  const data = res.ok ? res.data : null;
  return (
    <Container>
      <ListingView
        header={
          <h1 className="font-display text-xl font-extrabold sm:text-2xl">Results for “{q}”</h1>
        }
        note={<Interpretation interpretation={data?.interpretation ?? null} />}
        products={data?.items ?? []}
        meta={data?.meta ?? null}
        facets={null}
        error={
          res.ok
            ? null
            : res.status === 429
              ? 'You’re searching a little fast. Please wait a moment and try again.'
              : 'Search is temporarily unavailable. Please try again shortly.'
        }
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/products">Browse all products</Link>
          </Button>
        }
      />
    </Container>
  );
}
