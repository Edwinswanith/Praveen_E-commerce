'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatIST, type CampaignPublicDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { bannerColors, claimText, countdownLabel, promotionText } from '@/lib/campaigns';
import { useCurrentCampaigns } from '@/hooks/use-campaigns';
import { Countdown } from './countdown';

const PHASE_EYEBROW: Partial<Record<CampaignPublicDto['phase'], string>> = {
  TEASER: 'Coming soon',
  EARLY_ACCESS: 'Early access',
  LIVE: 'Sale on now',
  ENDED: 'Sale ended',
  PAUSED: 'Sale paused',
  CANCELLED: 'Sale ended',
};

export function extendedText(c: Pick<CampaignPublicDto, 'extended' | 'originalEndsAt'>): string | null {
  return c.extended && c.originalEndsAt ? `Extended. Originally ended ${formatIST(c.originalEndsAt)}` : null;
}

/**
 * The campaign's own words (title, subtitle), the server's % claim (or none),
 * a countdown to countdownTo only, and an always-visible extension notice.
 */
export function SaleBannerContent({
  campaign: c,
  onExpire,
  headingLevel = 'h2',
  cta,
  className,
}: {
  campaign: CampaignPublicDto;
  onExpire?: () => void;
  headingLevel?: 'h1' | 'h2';
  cta?: React.ReactNode;
  className?: string;
}) {
  const colors = bannerColors(c.banner.themeColor);
  const claim = claimText(c);
  const label = countdownLabel(c);
  const extended = extendedText(c);
  const Heading = headingLevel;
  const eyebrow = [c.festival, c.edition].filter(Boolean).join(' ');
  return (
    <div
      className={cn('relative overflow-hidden rounded-xl px-5 py-6 sm:px-8 sm:py-8', className)}
      style={colors}
      data-testid="sale-banner"
    >
      {c.banner.imageUrl && (
        // Decorative art on the right; text sits on the solid colour so contrast holds.
        <img
          src={c.banner.imageUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-2/5 object-cover sm:block"
        />
      )}
      <div className={cn('relative', c.banner.imageUrl && 'sm:max-w-[58%]')}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] opacity-90">
          {PHASE_EYEBROW[c.phase] ?? 'Sale'}
          {eyebrow && <span> · {eyebrow}</span>}
        </p>
        <Heading className="mt-2 font-display text-2xl font-extrabold leading-tight sm:text-4xl">
          {c.banner.title ?? c.name}
        </Heading>
        {(c.banner.subtitle ?? c.description) && (
          <p className="mt-2 max-w-xl text-sm opacity-90 sm:text-base">{c.banner.subtitle ?? c.description}</p>
        )}
        {claim && (
          <p className="mt-3 font-display text-xl font-extrabold sm:text-2xl">
            <span data-testid="sale-claim">{claim}</span>
            <span className="ml-2 align-middle text-xs font-semibold opacity-90">
              on MRP{c.claim.productCount > 0 ? `, ${c.claim.productCount} in-stock style${c.claim.productCount === 1 ? '' : 's'}` : ''}
            </span>
          </p>
        )}
        {c.promotions.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Bundle offers">
            {c.promotions.map((p) => (
              <li key={p.id} className="rounded-full border border-white/50 px-3 py-1 text-xs font-semibold">
                {promotionText(p)}
              </li>
            ))}
          </ul>
        )}
        {c.countdownTo && label && (
          <Countdown target={c.countdownTo} label={label} onExpire={onExpire} className="mt-4" />
        )}
        {extended && (
          <p className="mt-2 text-xs font-semibold" data-testid="sale-extended">
            {extended}
          </p>
        )}
        {cta && <div className="mt-5">{cta}</div>}
      </div>
    </div>
  );
}

function ctaLabel(c: CampaignPublicDto): string {
  if (c.phase === 'LIVE') return 'Shop the sale';
  if (c.phase === 'EARLY_ACCESS') return c.hasEarlyAccess ? 'Shop early access' : 'Get early access';
  return 'See what’s coming';
}

/** Home page sale banner: the highest-priority visible campaign, if any. */
export function HomeSaleBanner({ initial }: { initial: CampaignPublicDto[] | null }) {
  const { campaigns, refresh } = useCurrentCampaigns(initial);
  const c = campaigns[0];
  if (!c) return null;
  return (
    <section aria-label="Sale" className="pt-4 sm:pt-6">
      <SaleBannerContent
        campaign={c}
        onExpire={refresh}
        cta={
          <Link
            href={`/sale/${encodeURIComponent(c.slug)}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-5 text-xs font-bold uppercase tracking-wider text-fg transition-colors hover:bg-sun-400"
          >
            {ctaLabel(c)} <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
    </section>
  );
}
