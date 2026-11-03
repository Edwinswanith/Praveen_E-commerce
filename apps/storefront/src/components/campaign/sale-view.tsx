'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Clock, Gift, Info } from 'lucide-react';
import { formatIST, type CampaignPublicDto, type ProductCardDto } from '@vyra/shared';
import { Button, EmptyState } from '@vyra/ui';
import { campaignProductsKey, ENDED_PHASES, promotionText } from '@/lib/campaigns';
import { useCampaign } from '@/hooks/use-campaigns';
import { ProductGrid, ProductGridSkeleton } from '../product/product-grid';
import { SaleBannerContent } from './sale-banner';
import { RemindMe } from './remind-me';

function Offers({ campaign: c }: { campaign: CampaignPublicDto }) {
  if (c.promotions.length === 0) return null;
  return (
    <section aria-labelledby="offers-heading" className="rounded-lg border border-border p-4">
      <h2 id="offers-heading" className="flex items-center gap-2 text-sm font-bold">
        <Gift className="size-4 text-brand-600" aria-hidden />
        Bundle offers
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {c.promotions.map((p) => (
          <li key={p.id}>
            <strong>{promotionText(p)}</strong>
            <span className="text-muted">
              {' '}
              Add {p.minQuantity} or more eligible items and it applies automatically in your bag.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Schedule({ campaign: c }: { campaign: CampaignPublicDto }) {
  const rows: [string, string][] = [];
  if (c.earlyAccessStartsAt && c.phase === 'TEASER') rows.push(['Early access opens', formatIST(c.earlyAccessStartsAt)]);
  if (c.phase !== 'LIVE') rows.push(['Sale starts', formatIST(c.startsAt)]);
  rows.push(['Sale ends', formatIST(c.endsAt)]);
  return (
    <section aria-labelledby="schedule-heading" className="rounded-lg border border-border p-4">
      <h2 id="schedule-heading" className="flex items-center gap-2 text-sm font-bold">
        <Clock className="size-4 text-brand-600" aria-hidden />
        When
      </h2>
      <dl className="mt-2 space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SaleProducts({ slug, initial }: { slug: string; initial: ProductCardDto[] | null }) {
  const { data, error, isLoading } = useSWR<ProductCardDto[]>(campaignProductsKey(slug), {
    fallbackData: initial ?? undefined,
  });
  if (!data && isLoading) return <ProductGridSkeleton count={8} />;
  if (error && !data) return <p className="text-sm text-muted">Sale products couldn’t be loaded. Please reload in a moment.</p>;
  if (!data || data.length === 0)
    return <p className="text-sm text-muted">No products in this sale right now.</p>;
  return <ProductGrid products={data} />;
}

function EndedState({ campaign: c }: { campaign: CampaignPublicDto }) {
  const paused = c.phase === 'PAUSED';
  return (
    <EmptyState
      className="py-16"
      icon={<Info />}
      title={paused ? 'This sale is paused' : 'This sale has ended'}
      description={
        paused
          ? `${c.name} is paused for now, so items are at their regular prices. We’ll show it here again if it resumes.`
          : `${c.name} is over and items are back to their regular prices. Thanks for shopping with us.`
      }
      action={
        <Button asChild size="lg">
          <Link href="/products">Shop all products</Link>
        </Button>
      }
    />
  );
}

export function SaleView({
  initial,
  initialProducts,
}: {
  initial: CampaignPublicDto;
  initialProducts: ProductCardDto[] | null;
}) {
  const { campaign: c, refresh, mutate } = useCampaign(initial.slug, initial);

  if (ENDED_PHASES.includes(c.phase)) {
    return (
      <div className="py-6" data-testid="sale-ended">
        <h1 className="sr-only">{c.banner.title ?? c.name}</h1>
        <EndedState campaign={c} />
      </div>
    );
  }

  const shopNow = c.phase === 'LIVE' || (c.phase === 'EARLY_ACCESS' && c.hasEarlyAccess);
  return (
    <div className="space-y-6 py-4 sm:py-6">
      <SaleBannerContent campaign={c} headingLevel="h1" onExpire={() => void refresh()} />

      {c.phase === 'EARLY_ACCESS' && (
        <section aria-labelledby="early-heading" className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h2 id="early-heading" className="font-bold">
            {c.hasEarlyAccess ? 'Early access is open for you' : 'Early access is open'}
          </h2>
          <p className="mt-1 text-muted">
            {c.hasEarlyAccess
              ? `You can shop sale prices before everyone else, until ${formatIST(c.startsAt)}. Product pages show regular prices; your sale price shows in your bag.`
              : `Customers who signed up for reminders can shop sale prices now. Everyone else gets them from ${formatIST(c.startsAt)}.`}
          </p>
        </section>
      )}

      {!shopNow && (
        <div className="grid gap-4 md:grid-cols-2">
          <RemindMe campaign={c} onSubscribed={() => void mutate()} />
          <div className="space-y-4">
            <Schedule campaign={c} />
            <Offers campaign={c} />
          </div>
        </div>
      )}

      {shopNow && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Offers campaign={c} />
            <Schedule campaign={c} />
          </div>
          <section aria-labelledby="sale-products-heading">
            <h2 id="sale-products-heading" className="mb-4 font-display text-lg font-extrabold">
              In the sale
            </h2>
            <SaleProducts slug={c.slug} initial={c.phase === initial.phase ? initialProducts : null} />
          </section>
        </>
      )}
    </div>
  );
}
