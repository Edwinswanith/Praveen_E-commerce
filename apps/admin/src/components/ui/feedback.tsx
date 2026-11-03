'use client';
import * as React from 'react';
import { Alert, Badge, Button, Card, Skeleton, cn } from '@vyra/ui';
import { Lock } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api';
import type { Tone } from '@/lib/status';
import { humanize } from '@/lib/format';

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  if (error instanceof ApiError && error.status === 403) return <Forbidden className={className} />;
  return (
    <Alert tone="danger" title="Could not load data" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{errorMessage(error)}</span>
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
      </div>
    </Alert>
  );
}

export function Forbidden({ className }: { className?: string }) {
  return (
    <Card className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted"><Lock className="size-5" /></div>
      <h3 className="text-sm font-bold">You don&apos;t have access to this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">Your role doesn&apos;t include the permission required. Ask an administrator if you need it.</p>
    </Card>
  );
}

export function StatusBadge({ value, tone, label }: { value: string; tone?: Tone; label?: string }) {
  return <Badge tone={tone ?? 'neutral'}>{label ?? humanize(value)}</Badge>;
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-bold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone, icon, loading }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'warning' | 'danger'; icon?: React.ReactNode; loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && <span className="text-subtle [&_svg]:size-4">{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className={cn('tabular mt-1.5 text-2xl font-semibold tracking-tight', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger')}>{value}</p>
      )}
      {hint && !loading && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function KeyValue({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map((i) => (
        <React.Fragment key={i.label}>
          <dt className="text-muted">{i.label}</dt>
          <dd className="min-w-0 break-words text-fg">{i.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
