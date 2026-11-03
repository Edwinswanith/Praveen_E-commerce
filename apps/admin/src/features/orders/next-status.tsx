'use client';
import * as React from 'react';
import type { OrderStatus } from '@vyra/shared';
import { ORDER_TRANSITIONS } from '@vyra/shared';
import { Button } from '@vyra/ui';
import { Ban, CheckCircle2, PackageCheck, Truck, MapPin, Home, Undo2 } from 'lucide-react';

export const ACTION_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Mark pending payment',
  CONFIRMED: 'Confirm order',
  PACKED: 'Mark packed',
  SHIPPED: 'Mark shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Mark delivered',
  CANCELLED: 'Cancel order',
  RETURNED: 'Mark returned',
};

const ICON: Partial<Record<OrderStatus, React.ComponentType<{ className?: string }>>> = {
  CONFIRMED: CheckCircle2, PACKED: PackageCheck, SHIPPED: Truck, OUT_FOR_DELIVERY: MapPin, DELIVERED: Home, CANCELLED: Ban, RETURNED: Undo2,
};

/** Valid next statuses for an order (from the shared ORDER_TRANSITIONS state machine). */
export function nextStatuses(status: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[status] ?? [];
}

/**
 * Renders one action per valid transition. CANCELLED is routed through `onCancel`
 * (which collects a reason and uses the dedicated cancel endpoint).
 */
export function NextStatusActions({ status, onSelect, onCancel, disabled, canWrite = true, pendingStatus }: {
  status: OrderStatus;
  onSelect: (next: OrderStatus) => void;
  onCancel?: () => void;
  disabled?: boolean;
  canWrite?: boolean;
  pendingStatus?: OrderStatus | null;
}) {
  if (!canWrite) return null;
  const options = nextStatuses(status);
  if (!options.length) return <p className="text-xs text-muted">No further status changes are possible.</p>;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Order status actions">
      {options.map((next, i) => {
        const Icon = ICON[next];
        const isCancel = next === 'CANCELLED';
        return (
          <Button
            key={next}
            type="button"
            size="sm"
            variant={isCancel ? 'outline' : i === 0 ? 'secondary' : 'outline'}
            className={isCancel ? 'text-danger hover:border-danger' : undefined}
            disabled={disabled || (isCancel && !onCancel)}
            loading={pendingStatus === next}
            onClick={() => (isCancel ? onCancel?.() : onSelect(next))}
            data-status={next}
          >
            {Icon && <Icon />}
            {ACTION_LABEL[next]}
          </Button>
        );
      })}
    </div>
  );
}
