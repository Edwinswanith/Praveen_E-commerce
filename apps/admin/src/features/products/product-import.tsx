'use client';
import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@vyra/ui';
import { ArrowLeft, Download, FileSpreadsheet, Upload, CheckCircle2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import type { ImportResultDto } from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { Forbidden } from '@/components/ui/feedback';

const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function ProductImport() {
  const { can } = useAuth();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportResultDto | null>(null);
  const [committed, setCommitted] = React.useState<ImportResultDto | null>(null);
  const [pending, setPending] = React.useState<'dry' | 'commit' | 'template' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  if (!can(PERM.catalogWrite)) return <Forbidden />;

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setError(null);
    setPending(dryRun ? 'dry' : 'commit');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.upload<ImportResultDto>('/products/import', form, dryRun ? { dryRun: 'true' } : undefined);
      if (dryRun) { setPreview(res); setCommitted(null); }
      else { setCommitted(res); setPreview(null); toast.success(`Import complete: ${res.created} created, ${res.updated} updated`); }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const template = async () => {
    setPending('template');
    try { await downloadFile('/products/import/template', 'vyra-product-import-template.csv'); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setPending(null); }
  };

  const pick = (f: File | null) => { setFile(f); setPreview(null); setCommitted(null); setError(null); };

  return (
    <>
      <PageHeader
        back={<Link href="/products" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Products</Link>}
        title="Bulk import"
        description="Create or update products and variants from a CSV or XLSX file. Always validate with a dry run first."
        actions={<Button variant="outline" size="sm" loading={pending === 'template'} onClick={() => void template()}><Download /> Download template</Button>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>1. Choose a file</CardTitle></CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0] ?? null); }}
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-strong bg-surface px-6 py-10 text-center"
            >
              <FileSpreadsheet className="size-8 text-subtle" aria-hidden />
              {file ? (
                <p className="text-sm"><span className="font-medium">{file.name}</span> <span className="text-muted">· {(file.size / 1024).toFixed(1)} KB</span></p>
              ) : (
                <p className="text-sm text-muted">Drop a .csv or .xlsx file here</p>
              )}
              <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload /> {file ? 'Choose another file' : 'Choose file'}</Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={!file} loading={pending === 'dry'} onClick={() => void send(true)}>2. Validate (dry run)</Button>
              <Button
                size="sm"
                disabled={!preview || pending !== null || preview.errors.length > 0}
                loading={pending === 'commit'}
                onClick={() => void send(false)}
                title={preview?.errors.length ? 'Fix all row errors and re-validate before importing' : undefined}
              >
                3. Import
              </Button>
            </div>
            {error && <Alert tone="danger" className="mt-4" title="Import failed">{error}</Alert>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>How it works</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>One row per variant. Rows with the same product slug are grouped into one product.</p>
            <p>Existing products (matched by slug) are updated; variants are matched by colour + size.</p>
            <p>SKUs and barcodes are always generated by the server.</p>
            <p>Stock is not imported — use inventory movements or purchase orders.</p>
          </CardContent>
        </Card>
      </div>

      {(preview || committed) && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>{committed ? 'Import result' : 'Dry run preview'}</CardTitle>
            {committed && <span className="flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="size-4" /> Committed</span>}
          </CardHeader>
          <CardContent>
            {(() => {
              const r = (committed ?? preview)!;
              return (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <Stat label={committed ? 'Created' : 'Would create'} value={r.created} />
                    <Stat label={committed ? 'Updated' : 'Would update'} value={r.updated} />
                    <Stat label="Row errors" value={r.errors.length} danger={r.errors.length > 0} />
                  </div>
                  {r.errors.length === 0 ? (
                    <Alert tone="success">{committed ? 'All rows imported.' : 'No errors found. You can import this file.'}</Alert>
                  ) : (
                    <div className="max-h-96 overflow-auto rounded-md border border-border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface text-xs text-muted"><tr><th className="w-20 px-3 py-2 text-left font-medium">Row</th><th className="px-3 py-2 text-left font-medium">Error</th></tr></thead>
                        <tbody>{r.errors.map((er, i) => <tr key={i} className="border-t border-border"><td className="tabular px-3 py-2">{er.row}</td><td className="px-3 py-2 text-danger">{er.message}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${danger ? 'text-danger' : ''}`}>{formatNumber(value)}</p>
    </div>
  );
}
