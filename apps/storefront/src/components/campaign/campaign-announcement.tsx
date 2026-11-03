'use client';

import Link from 'next/link';
import type { CampaignPublicDto } from '@vyra/shared';
import { announcementText } from '@/lib/campaigns';
import { useCurrentCampaigns } from '@/hooks/use-campaigns';

/** Announcement-bar link to the top visible sale; falls back to `children` when none. */
export function CampaignAnnouncement({
  initial,
  children,
}: {
  initial: CampaignPublicDto[] | null;
  children: React.ReactNode;
}) {
  const { campaigns } = useCurrentCampaigns(initial);
  const c = campaigns[0];
  if (!c) return <>{children}</>;
  return (
    <Link
      href={`/sale/${encodeURIComponent(c.slug)}`}
      className="-my-2 inline-flex min-h-11 items-center font-semibold text-sun-400 underline-offset-2 hover:underline"
      data-testid="announcement-sale"
    >
      {announcementText(c)}
    </Link>
  );
}
