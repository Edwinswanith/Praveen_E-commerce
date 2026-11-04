'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { BarcodeSymbology, InventoryRowDto } from '@vyra/shared';
import { barcodeLabelsSchema } from '@vyra/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field } from '@vyra/ui';
import { Barcode, Printer, Trash2, WandSparkles } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { useConfirm } from '@/components/ui/confirm';
import type { GenerateMissingBarcodesResult } from '@/lib/types';
import { openFile } from '@/lib/download';
import { formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/ui/feedback';
import { Segmented, Select } from '@/components/ui/controls';
import { VariantPicker } from '@/features/inventory/variant-picker';
import { BarcodeImage } from './barcode-image';

interface Line { row: InventoryRowDto; copies: string }

export function generatedMessage(n: number): string {
  return n === 0 ? 'All variants already have barcodes' : `${formatNumber(n)} barcode${n === 1 ? '' : 's'} created`;
}

/** POST /admin/barcodes/generate-missing (catalog:write): issues an EAN-13 for every variant that has none. */
export function GenerateMissingButton() {
  const confirm = useConfirm();
  const [pending, setPending] = React.useState(false);
  const run = async () => {
    const ok = await confirm({
      title: 'Create missing barcodes?',
      description: 'Every variant without an EAN-13 barcode gets a new one issued by the server. Existing barcodes are never changed, so printed labels stay valid.',
      confirmLabel: 'Create barcodes',
    });
    if (!ok) return;
    setPending(true);
    try {
      const r = await api.post<GenerateMissingBarcodesResult>('/barcodes/generate-missing');
      toast.success(generatedMessage(r.generated));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return <Button variant="outline" size="sm" className="max-sm:h-11" loading={pending} onClick={() => void run()}><WandSparkles /> Generate missing barcodes</Button>;
}
type Format = 'A4_3x8' | 'THERMAL_50x25';

export function BarcodesScreen() {
  const { can } = useAuth();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [format, setFormat] = React.useState<Format>('A4_3x8');
  const [symbology, setSymbology] = React.useState<BarcodeSymbology>('EAN13');
  const [printing, setPrinting] = React.useState(false);
  const [previewId, setPreviewId] = React.useState<string | null>(null);

  const add = (row: InventoryRowDto) => {
    setLines((ls) => [...ls, { row, copies: String(Math.max(1, row.onHand)) }]);
    setPreviewId(row.variantId);
  };
  const total = lines.reduce((s, l) => s + (Number(l.copies) || 0), 0);
  const preview = lines.find((l) => l.row.variantId === previewId)?.row ?? lines[0]?.row;

  const print = async () => {
    const parsed = barcodeLabelsSchema.safeParse({ items: lines.map((l) => ({ variantId: l.row.variantId, copies: l.copies })), format, symbology });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Check copies (1–500 per variant)'); return; }
    setPrinting(true);
    try {
      await openFile('/barcodes/labels', `vyra-labels-${format}.pdf`, { method: 'POST', body: parsed.data });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <PageHeader title="Barcode labels" description="Print price/barcode labels for received stock. Codes are issued by the server per variant." actions={<>
        {can(PERM.catalogWrite) && <GenerateMissingButton />}
        <Button size="sm" className="max-sm:h-11" disabled={!lines.length} loading={printing} onClick={() => void print()}><Printer /> Print {formatNumber(total)} label{total === 1 ? '' : 's'}</Button>
      </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Variants</CardTitle><span className="text-xs text-muted">{lines.length} selected</span></CardHeader>
          <CardContent className="space-y-4">
            <VariantPicker onPick={add} excludeIds={new Set(lines.map((l) => l.row.variantId))} />
            {lines.length === 0 ? (
              <EmptyState icon={<Barcode />} title="No variants selected" description="Search by SKU, barcode or product name. Copies default to the on-hand quantity." className="py-10" />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">Variant</th><th className="px-3 py-2 text-left font-medium">Barcode</th><th className="px-3 py-2 text-right font-medium">On hand</th><th className="px-3 py-2 text-right font-medium">Copies</th><th className="w-10" /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.row.variantId} className={`cursor-pointer border-t border-border ${preview?.variantId === l.row.variantId ? 'bg-surface' : ''}`} onClick={() => setPreviewId(l.row.variantId)}>
                        <td className="px-3 py-2"><span className="block font-medium">{l.row.productName}</span><span className="font-mono text-xs text-muted">{l.row.sku} · {l.row.color}/{l.row.size}</span></td>
                        <td className="px-3 py-2 font-mono text-xs">{l.row.barcode ?? '—'}</td>
                        <td className="tabular px-3 py-2 text-right text-muted">{formatNumber(l.row.onHand)}</td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <input aria-label={`Copies for ${l.row.sku}`} type="number" min={1} max={500} step={1} value={l.copies}
                            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, copies: e.target.value } : x)))}
                            className="tabular h-8 w-20 rounded-sm border border-border px-2 text-right focus:border-fg focus:outline-none" />
                        </td>
                        <td className="px-1" onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded-sm p-1.5 text-muted hover:text-danger" aria-label={`Remove ${l.row.sku}`}><Trash2 className="size-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Label settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Sheet format" htmlFor="lb-format">
                <Select id="lb-format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="A4_3x8">A4 sheet · 3 × 8 (24 labels)</option>
                  <option value="THERMAL_50x25">Thermal roll · 50 × 25 mm</option>
                </Select>
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Symbology</p>
                <Segmented label="Symbology" value={symbology} onChange={setSymbology} options={[{ value: 'EAN13', label: 'EAN-13' }, { value: 'CODE128', label: 'Code 128' }, { value: 'QR', label: 'QR' }]} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
            <CardContent>
              {preview ? (
                <div className="space-y-2 text-center">
                  <div className="rounded-md border border-border bg-white p-3"><BarcodeImage variantId={preview.variantId} symbology={symbology} alt={`${symbology} barcode for ${preview.sku}`} className="mx-auto h-28 w-full" /></div>
                  <p className="text-sm font-medium">{preview.productName}</p>
                  <p className="font-mono text-xs text-muted">{preview.sku}</p>
                </div>
              ) : <p className="text-sm text-muted">Select a variant to preview its barcode.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
