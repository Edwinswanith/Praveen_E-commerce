'use client';

import { Modal } from '../ui/dialog';
import { compareSizes } from '@/lib/variants';

/** Renders `sizeChart` (outer key = size, inner = measurement -> value), tolerating the transposed shape too. */
export function SizeGuide({
  open,
  onOpenChange,
  chart,
  sizes,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  chart: Record<string, Record<string, string>>;
  sizes: string[];
}) {
  const outer = Object.keys(chart);
  const sizeSet = new Set(sizes.map((s) => s.toUpperCase()));
  const outerAreSizes =
    outer.some((k) => sizeSet.has(k.toUpperCase())) ||
    !outer.some((k) => Object.keys(chart[k] ?? {}).some((ik) => sizeSet.has(ik.toUpperCase())));
  const rows = outerAreSizes
    ? [...outer].sort(compareSizes)
    : [...new Set(outer.flatMap((k) => Object.keys(chart[k] ?? {})))].sort(compareSizes);
  const cols = outerAreSizes
    ? [...new Set(outer.flatMap((k) => Object.keys(chart[k] ?? {})))]
    : outer;
  const cell = (row: string, col: string) =>
    (outerAreSizes ? chart[row]?.[col] : chart[col]?.[row]) ?? '—';
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Size guide"
      description="Body measurements in inches unless stated otherwise."
      size="lg"
    >
      <div className="overflow-x-auto p-5">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">Size chart</caption>
          <thead>
            <tr className="bg-surface-2">
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide"
              >
                Size
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} className="border-b border-border">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  {r}
                </th>
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 tabular-nums">
                    {cell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-muted">
          Between sizes? Size up for a relaxed fit, or check the product’s fit in the
          specifications.
        </p>
      </div>
    </Modal>
  );
}
