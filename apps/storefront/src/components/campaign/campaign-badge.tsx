import { formatIST, type CampaignBadgeDto } from '@vyra/shared';
import { cn } from '@vyra/ui';

/** "Festive Edit Sale price" tag. Static text: no ticking timers on cards. */
export function CampaignTag({
  campaign,
  withEnd = true,
  suffix = '',
  className,
}: {
  campaign: CampaignBadgeDto;
  withEnd?: boolean;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={cn('flex flex-col gap-0.5', className)} data-testid="campaign-tag">
      <span className="w-fit rounded-sm bg-brand-50 px-1.5 py-0.5 text-[11px] font-bold text-brand-700">
        {campaign.name}
        {suffix}
      </span>
      {withEnd && <span className="text-[11px] text-muted">Sale ends {formatIST(campaign.endsAt)}</span>}
    </span>
  );
}
