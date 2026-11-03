'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { CampaignAdminDto } from '@vyra/shared';
import { Alert, Skeleton } from '@vyra/ui';
import { useApi } from '@/lib/swr';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { ErrorState, Forbidden, PageHeader } from '@/components/ui/feedback';
import { CampaignForm } from './campaign-form';
import { campaignActions } from './campaign-rules';

export function NewCampaign() {
  const { can } = useAuth();
  if (!can(PERM.promotionsWrite)) return <><PageHeader title="New campaign" /><Forbidden /></>;
  return <CampaignForm />;
}

export function EditCampaign({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useAuth();
  const { data, error, isLoading, mutate } = useApi<CampaignAdminDto>(`/campaigns/${id}`, undefined, { revalidateOnMount: true });
  if (!can(PERM.promotionsWrite)) return <><PageHeader title="Edit campaign" /><Forbidden /></>;
  if (error && !data) return <ErrorState error={error} onRetry={() => void mutate()} />;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-96" /></div>;
  if (!campaignActions(data, true).edit.visible) {
    return <><PageHeader title={`Edit ${data.name}`} /><Alert tone="warning">An ended or cancelled campaign cannot be edited, so its report stays truthful.</Alert></>;
  }
  return <CampaignForm key={data.id} campaign={data} onSaved={(c) => { void mutate({ data: c, extra: {} }, { revalidate: false }); router.push(`/campaigns/${c.id}`); }} />;
}
