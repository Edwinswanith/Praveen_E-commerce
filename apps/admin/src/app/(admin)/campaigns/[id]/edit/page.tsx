import { EditCampaign } from '@/features/campaigns/campaign-edit';

export const metadata = { title: 'Edit campaign' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditCampaign id={id} />;
}
