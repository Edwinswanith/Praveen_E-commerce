import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CampaignPublicDto, ProductCardDto } from '@vyra/shared';
import { Alert } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { SaleView } from '@/components/campaign/sale-view';
import { claimText, ENDED_PHASES } from '@/lib/campaigns';
import { serverFetch } from '@/lib/server-api';

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

function getCampaign(slug: string) {
  return serverFetch<CampaignPublicDto>(`/campaigns/${encodeURIComponent(slug)}`, { revalidate: 60 });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await getCampaign(slug);
  if (!res.ok) return { title: res.status === 404 ? 'Sale not found' : 'Sale' };
  const c = res.data;
  const name = c.banner.title ?? c.name;
  const ended = ENDED_PHASES.includes(c.phase);
  const title = ended ? `${name} (${c.phase === 'PAUSED' ? 'paused' : 'ended'})` : name;
  const claim = ended ? null : claimText(c);
  const description = [c.banner.subtitle ?? c.description, claim ? `${claim} on MRP.` : null]
    .filter(Boolean)
    .join(' ')
    .slice(0, 160);
  return {
    title,
    description: description || undefined,
    alternates: { canonical: `/sale/${c.slug}` },
    robots: ended ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'website',
      title,
      description: description || undefined,
      url: `/sale/${c.slug}`,
      images: c.banner.imageUrl ? [{ url: c.banner.imageUrl, alt: name }] : undefined,
    },
  };
}

export default async function SalePage({ params }: Props) {
  const { slug } = await params;
  const res = await getCampaign(slug);
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <Container className="py-8">
        <Alert tone="warning" title="This sale couldn’t be loaded">
          Please reload the page in a moment.
        </Alert>
      </Container>
    );
  }
  const c = res.data;
  const products =
    c.phase === 'LIVE'
      ? await serverFetch<ProductCardDto[]>(`/campaigns/${encodeURIComponent(slug)}/products`, {
          revalidate: 60,
          query: { limit: 48 },
        })
      : null;
  return (
    <Container className="pt-4">
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: c.name }]} />
      <SaleView initial={c} initialProducts={products?.ok ? products.data : null} />
    </Container>
  );
}
