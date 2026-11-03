'use client';
import * as React from 'react';
import type { CodAnalyticsDto } from '@vyra/shared';
import { Banknote, CheckCircle2, PackageX, TimerOff } from 'lucide-react';
import { formatINR, formatNumber } from '@/lib/format';
import { StatCard } from '@/components/ui/feedback';

const pct = (n: number) => `${n.toFixed(1)}%`;

/** COD / RTO headline numbers (GET /admin/analytics/cod; all rates are percentages). */
export function CodKpis({ data }: { data: CodAnalyticsDto | undefined }) {
  const d = data;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard loading={!d} icon={<Banknote />} label="COD share" value={d ? pct(d.codShare) : ''} hint={d ? `${formatNumber(d.codOrders)} COD · ${formatNumber(d.prepaidOrders)} prepaid` : undefined} />
      <StatCard loading={!d} icon={<CheckCircle2 />} label="COD confirmed" value={d ? pct(d.confirmedRate) : ''} hint="OTP or staff call" />
      <StatCard loading={!d} icon={<TimerOff />} label="Auto-cancelled" value={formatNumber(d?.autoCancelled)} hint="Unconfirmed COD orders" tone={d && d.autoCancelled > 0 ? 'warning' : 'default'} />
      <StatCard loading={!d} icon={<PackageX />} label="RTO rate" value={d ? pct(d.rtoRate) : ''} hint={d ? `${formatNumber(d.rtoOrders)} parcels · ${formatINR(d.rtoValue)}` : undefined} tone={d && d.rtoRate >= 10 ? 'danger' : d && d.rtoRate >= 5 ? 'warning' : 'default'} />
    </div>
  );
}
