'use client';
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { InventoryMovementDto, InventoryMovementType } from '@vyra/shared';
import { Badge, cn } from '@vyra/ui';
import { formatDateTime, formatNumber, humanize } from '@/lib/format';
import type { Tone } from '@/lib/status';

export const MOVEMENT_TONE: Record<InventoryMovementType, Tone> = {
  STOCK_IN: 'success', STOCK_OUT: 'danger', ADJUSTMENT: 'warning', RESERVATION: 'info', RELEASE: 'neutral', FULFILLMENT: 'violet', RETURN_RESTOCK: 'teal',
};

export function MovementTypeBadge({ type }: { type: InventoryMovementType }) {
  return <Badge tone={MOVEMENT_TONE[type] ?? 'neutral'}>{humanize(type)}</Badge>;
}

export function QuantityDelta({ value }: { value: number }) {
  return <span className={cn('tabular font-semibold', value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-muted')}>{value > 0 ? '+' : value < 0 ? '−' : ''}{formatNumber(Math.abs(value))}</span>;
}

export const movementColumns = (withProduct: boolean): ColumnDef<InventoryMovementDto, unknown>[] => [
  { header: 'When', accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{formatDateTime(row.original.createdAt)}</span> },
  ...(withProduct ? [{
    id: 'variant', header: 'Variant',
    cell: ({ row }: { row: { original: InventoryMovementDto } }) => (
      <span className="block min-w-44"><span className="block truncate font-medium">{row.original.productName}</span><span className="block font-mono text-xs text-muted">{row.original.sku}</span></span>
    ),
  } satisfies ColumnDef<InventoryMovementDto, unknown>] : []),
  { header: 'Type', accessorKey: 'type', cell: ({ row }) => <MovementTypeBadge type={row.original.type} /> },
  { header: 'Qty', accessorKey: 'quantity', meta: { align: 'right' }, cell: ({ row }) => <QuantityDelta value={row.original.quantity} /> },
  { header: 'On hand', accessorKey: 'onHandAfter', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.onHandAfter) },
  { header: 'Reserved', accessorKey: 'reservedAfter', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.reservedAfter) },
  { header: 'Reason', accessorKey: 'reason', cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.reason ?? undefined}>{row.original.reason ?? '—'}</span> },
  { header: 'Reference', accessorKey: 'reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
  { header: 'By', accessorKey: 'actorName', cell: ({ row }) => <span className="whitespace-nowrap text-muted">{row.original.actorName ?? 'System'}</span> },
];
