'use client';
import * as React from 'react';
import type { OrderStatus } from '@vyra/shared';
import { ORDER_TRANSITIONS } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { Ban, CheckCircle2, PackageCheck, Truck, MapPin, Home, Undo2, PackageX } from 'lucide-react';

export const ACTION_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Mark pending payment',
  CONFIRMED: 'Confirm order',
  PACKED: 'Mark packed',
  SHIPPED: 'Mark shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Mark delivered',
  CANCELLED: 'Cancel order',
  RETURNED: 'Mark returned',
  RTO: 'Mark returned to origin (RTO)',
};

const ICON: Partial<Record<OrderStatus, React.ComponentType<{ className?: string }>>> = {
  CONFIRMED: CheckCircle2, PACKED: PackageCheck, SHIPPED: Truck, OUT_FOR_DELIVERY: MapPin, DELIVERED: Home, CANCELLED: Ban, RETURNED: Undo2, RTO: PackageX,
};

/** Valid next statuses for an order (from the shared ORDER_TRANSITIONS state machine). */
export function nextStatuses(status: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[status] ?? [];
}

/**
 * Renders one action per valid transition. CANCELLED is routed through `onCancel`
 * (reason + dedicated cancel endpoint) and RTO through `onRto` (note + confirmation).
 * `blocked` disables individual transitions and shows why (e.g. PACKED while COD is unconfirmed).
 */
export function NextStatusActions({ status, onSelect, onCancel, onRto, disabled, canWrite = true, pendingStatus, blocked }: {
  status: OrderStatus;
  onSelect: (next: OrderStatus) => void;
  onCancel?: () => void;
  onRto?: () => void;
  disabled?: boolean;
  canWrite?: boolean;
  pendingStatus?: OrderStatus | null;
  blocked?: Partial<Record<OrderStatus, string>>;
}) {
  if (!canWrite) return null;
  const options = nextStatuses(status);
  if (!options.length) return <p className="text-xs text-muted">No further status changes are possible.</p>;
  return (
    <div className="flex flex-col gap-1.5 sm:items-end">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Order status actions">
        {options.map((next, i) => {
          const Icon = ICON[next];
          const isCancel = next === 'CANCELLED';
          const isRto = next === 'RTO';
          const reason = blocked?.[next];
          const handler = isCancel ? onCancel : isRto ? onRto : () => onSelect(next);
          return (
            <Button
              key={next}
              type="button"
              size="sm"
              variant={isCancel || isRto ? 'outline' : i === 0 ? 'secondary' : 'outline'}
              className={isCancel || isRto ? 'text-danger hover:border-danger' : undefined}
              disabled={disabled || !handler || !!reason}
              title={reason}
              aria-describedby={reason ? `blocked-${next}` : undefined}
              loading={pendingStatus === next}
              onClick={() => handler?.()}
              data-status={next}
            >
              {Icon && <Icon />}
              {ACTION_LABEL[next]}
            </Button>
          );
        })}
      </div>
      {options.filter((s) => blocked?.[s]).map((s) => (
        <p key={s} id={`blocked-${s}`} className="text-xs text-warning">{blocked?.[s]}</p>
      ))}
    </div>
  );
}
