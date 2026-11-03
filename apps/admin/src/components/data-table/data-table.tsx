'use client';
import * as React from 'react';
import {
  flexRender, getCoreRowModel, useReactTable,
  type ColumnDef, type RowSelectionState, type OnChangeFn,
} from '@tanstack/react-table';
import { Card, Skeleton, EmptyState, cn } from '@vyra/ui';
import { Inbox } from 'lucide-react';
import { Checkbox } from '@/components/ui/controls';
import { ErrorState } from '@/components/ui/feedback';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  empty?: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode };
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  dense?: boolean;
}

/** Server-paginated data table (sorting/filtering happen on the API). */
export function DataTable<T>({
  columns, data, getRowId, isLoading, error, onRetry, onRowClick, rowSelection, onRowSelectionChange, empty, toolbar, footer, className, dense,
}: DataTableProps<T>) {
  const selectable = !!onRowSelectionChange;
  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<T, unknown> = {
      id: '__select',
      size: 36,
      header: ({ table }) => (
        <Checkbox
          label="Select all rows on this page"
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllRowsSelected(v)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox label="Select row" checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(v)} />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable]);

  const table = useReactTable<T>({
    data: data ?? [],
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    enableRowSelection: selectable,
    state: { rowSelection: rowSelection ?? {} },
    onRowSelectionChange,
  });

  const showSkeleton = isLoading && !data;
  const rows = table.getRowModel().rows;

  return (
    <Card className={cn('overflow-hidden', className)}>
      {toolbar && <div className="border-b border-border px-3 py-3 sm:px-4">{toolbar}</div>}
      {error && !data ? (
        <div className="p-4"><ErrorState error={error} onRetry={onRetry} /></div>
      ) : (
        <div className="relative overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border bg-surface">
                  {hg.headers.map((h) => {
                    const meta = h.column.columnDef.meta as { align?: 'right' | 'center'; className?: string } | undefined;
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        style={h.column.columnDef.size && h.column.columnDef.size !== 150 ? { width: h.column.columnDef.size } : undefined}
                        className={cn(
                          'whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-muted first:pl-4 last:pr-4',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                          meta?.className,
                        )}
                      >
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {showSkeleton &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                    {allColumns.map((c, j) => (
                      <td key={`${c.id ?? j}`} className="px-3 py-3 first:pl-4 last:pr-4"><Skeleton className="h-4 w-full max-w-40" /></td>
                    ))}
                  </tr>
                ))}
              {!showSkeleton && rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row.original); } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={cn(
                    'border-b border-border transition-colors last:border-0 data-[state=selected]:bg-brand-50/50',
                    onRowClick && 'cursor-pointer hover:bg-surface focus-visible:bg-surface',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as { align?: 'right' | 'center'; className?: string } | undefined;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 align-middle first:pl-4 last:pr-4',
                          dense ? 'py-2' : 'py-2.5',
                          meta?.align === 'right' && 'tabular text-right',
                          meta?.align === 'center' && 'text-center',
                          meta?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!showSkeleton && rows.length === 0 && (
            <EmptyState
              icon={empty?.icon ?? <Inbox />}
              title={empty?.title ?? 'Nothing here yet'}
              description={empty?.description}
              action={empty?.action}
              className="py-12"
            />
          )}
        </div>
      )}
      {footer && <div className="border-t border-border px-3 py-2.5 sm:px-4">{footer}</div>}
    </Card>
  );
}
