'use client';

import useSWR from 'swr';
import type { CampaignPublicDto } from '@vyra/shared';
import { CURRENT_CAMPAIGNS_KEY, campaignKey } from '@/lib/campaigns';

/**
 * Visible sales. Server HTML is cached and anonymous, so the client always
 * refetches (with cookies) on mount for viewer-specific fields
 * (hasEarlyAccess, subscribed) and a fresh phase.
 */
export function useCurrentCampaigns(initial?: CampaignPublicDto[] | null) {
  const { data, mutate } = useSWR<CampaignPublicDto[]>(CURRENT_CAMPAIGNS_KEY, {
    fallbackData: initial ?? undefined,
    revalidateOnMount: true,
    revalidateOnFocus: true,
  });
  return { campaigns: data ?? [], refresh: () => void mutate() };
}

export function useCampaign(slug: string, initial: CampaignPublicDto) {
  const { data, mutate } = useSWR<CampaignPublicDto>(campaignKey(slug), {
    fallbackData: initial,
    revalidateOnMount: true,
    revalidateOnFocus: true,
  });
  return { campaign: data ?? initial, refresh: () => mutate(), mutate };
}
