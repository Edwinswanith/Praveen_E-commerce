'use client';
import * as React from 'react';
import { Alert, Button, Card } from '@vyra/ui';
import { CheckCircle2, Scale } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ReconcileResult } from '@/lib/types';

/**
 * Runs GET /admin/inventory/reconcile: compares every stock row with the sum of its ledger movements.
 * It must always be consistent (CLAUDE.md rule 14); any drift means a stock change bypassed the ledger.
 */
export function ReconcileCard({ initial = null }: { initial?: ReconcileResult | null }) {
  const [result, setResult] = React.useState<ReconcileResult | null>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const run = async () => {
    setPending(true);
    setError(null);
    try { setResult(await api.get<ReconcileResult>('/inventory/reconcile')); }
    catch (err) { setError(errorMessage(err)); }
    finally { setPending(false); }
  };

  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Scale className="size-4 text-muted" aria-hidden />Stock ledger check</h2>
          <p className="mt-0.5 text-xs text-muted">Compares on-hand and reserved units with the sum of recorded movements for every variant.</p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 max-sm:h-11" loading={pending} onClick={() => void run()}>{result ? 'Run again' : 'Run check'}</Button>
      </div>
      <div aria-live="polite" className="empty:hidden mt-3">
        {error && <Alert tone="danger" title="Could not run the check">{error}</Alert>}
        {!error && result?.consistent && (
          <p className="flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            <span><span className="font-semibold">Consistent:</span> {formatNumber(result.checkedVariants)} variants checked at {formatDateTime(result.checkedAt)}</span>
          </p>
        )}
        {!error && result && !result.consistent && (
          <Alert tone="danger" title={`Ledger mismatch on ${formatNumber(result.drift.length)} of ${formatNumber(result.checkedVariants)} variants`}>
            <p>A stock change bypassed the ledger and must be investigated before stock is adjusted. Checked at {formatDateTime(result.checkedAt)}.</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left"><th scope="col" className="py-1 pr-3 font-semibold">SKU</th><th scope="col" className="py-1 pr-3 text-right font-semibold">On hand</th><th scope="col" className="py-1 pr-3 text-right font-semibold">Ledger on hand</th><th scope="col" className="py-1 pr-3 text-right font-semibold">Reserved</th><th scope="col" className="py-1 text-right font-semibold">Ledger reserved</th></tr></thead>
                <tbody>
                  {result.drift.map((d) => (
                    <tr key={d.variantId} className="border-t border-current/20">
                      <td className="py-1 pr-3 font-mono">{d.sku}</td>
                      <td className="tabular py-1 pr-3 text-right">{formatNumber(d.onHand)}</td>
                      <td className="tabular py-1 pr-3 text-right">{formatNumber(d.ledgerOnHand)}</td>
                      <td className="tabular py-1 pr-3 text-right">{formatNumber(d.reserved)}</td>
                      <td className="tabular py-1 text-right">{formatNumber(d.ledgerReserved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Alert>
        )}
      </div>
    </Card>
  );
}
