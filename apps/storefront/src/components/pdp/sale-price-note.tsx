'use client';

import * as React from 'react';
import useSWR from 'swr';
import { formatINR, type CampaignBadgeDto, type ProductCardDto } from '@vyra/shared';
import { Price } from '@vyra/ui';
import { campaignProductsKey } from '@/lib/campaigns';
import { useCurrentCampaigns } from '@/hooks/use-campaigns';
import { CampaignTag } from '../campaign/campaign-badge';

/**
 * Sale context under the PDP price. The price itself is the PUBLIC price
 * (variant.price, cached page). Strike-through stays MRP-only (in <Price>);
 * the regular price is plain text, never struck.
 */
export function SalePriceNote({
  price,
  basePrice,
  campaign,
}: {
  price: number;
  basePrice: number | undefined;
  campaign: CampaignBadgeDto | null;
}) {
  return (
    <>
      {campaign && (
        <div className="mt-2 flex flex-col gap-1">
          <CampaignTag campaign={campaign} suffix=" price" />
        </div>
      )}
      {basePrice !== undefined && basePrice > price && (
        <p className="mt-1 text-sm text-muted" data-testid="regular-price">
          Regular price {formatINR(basePrice)}
        </p>
      )}
    </>
  );
}

/** PDP price block: price, MRP struck (only MRP), % off MRP, then sale context. */
export function PdpPrice({
  price,
  mrp,
  basePrice,
  campaign,
}: {
  price: number;
  mrp: number;
  basePrice: number | undefined;
  campaign: CampaignBadgeDto | null;
}) {
  return (
    <>
      <Price price={price} mrp={mrp} size="lg" />
      <SalePriceNote price={price} basePrice={basePrice} campaign={campaign} />
    </>
  );
}

/**
 * During early access the cached page shows public prices; opted-in viewers
 * are told their sale price applies in the bag, only for products that are
 * actually in that campaign.
 */
export function EarlyAccessNote({ productId }: { productId: string }) {
  const { campaigns } = useCurrentCampaigns();
  const open = campaigns.find((c) => c.phase === 'EARLY_ACCESS' && c.hasEarlyAccess);
  const { data } = useSWR<ProductCardDto[]>(open ? campaignProductsKey(open.slug, 100) : null);
  if (!open || !data?.some((p) => p.id === productId)) return null;
  return (
    <p
      className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700"
      data-testid="early-access-note"
    >
      Early access is open: your {open.name} price shows in your bag.
    </p>
  );
}
