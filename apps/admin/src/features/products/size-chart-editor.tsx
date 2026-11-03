'use client';
import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@vyra/ui';

export interface SizeChartState { columns: string[]; rows: { size: string; values: Record<string, string> }[] }

export function sizeChartFromRecord(rec: Record<string, Record<string, string>> | null | undefined): SizeChartState {
  if (!rec || !Object.keys(rec).length) return { columns: [], rows: [] };
  const columns: string[] = [];
  for (const m of Object.values(rec)) for (const k of Object.keys(m)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows: Object.entries(rec).map(([size, values]) => ({ size, values: { ...values } })) };
}

export function sizeChartToRecord(s: SizeChartState): Record<string, Record<string, string>> | null {
  const out: Record<string, Record<string, string>> = {};
  for (const r of s.rows) {
    const size = r.size.trim();
    if (!size) continue;
    const values: Record<string, string> = {};
    for (const c of s.columns) {
      const col = c.trim();
      const v = r.values[c]?.trim();
      if (col && v) values[col] = v;
    }
    out[size] = values;
  }
  return Object.keys(out).length ? out : null;
}

const cell = 'h-8 w-full min-w-20 rounded-sm border border-transparent bg-transparent px-2 text-sm hover:border-border focus:border-fg focus:bg-bg focus:outline-none';

/** Grid editor: rows = sizes, columns = measurements (e.g. Chest, Length in inches). */
export function SizeChartEditor({ value, onChange, suggestedSizes }: { value: SizeChartState; onChange: (v: SizeChartState) => void; suggestedSizes: string[] }) {
  const [newCol, setNewCol] = React.useState('');
  const addColumn = () => {
    const c = newCol.trim();
    if (!c || value.columns.includes(c)) return;
    onChange({ ...value, columns: [...value.columns, c] });
    setNewCol('');
  };
  const fillFromSizes = () => {
    const existing = new Set(value.rows.map((r) => r.size.trim().toUpperCase()));
    const rows = [...value.rows, ...suggestedSizes.filter((s) => !existing.has(s.toUpperCase())).map((size) => ({ size, values: {} }))];
    onChange({ columns: value.columns.length ? value.columns : ['Chest (in)', 'Length (in)'], rows });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={newCol} onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } }}
          placeholder="Measurement, e.g. Chest (in)" aria-label="New measurement column" className="h-8 w-56 rounded-md border border-border-strong px-2.5 text-sm focus:border-fg focus:outline-none" />
        <Button type="button" size="sm" variant="outline" onClick={addColumn}><Plus /> Column</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...value, rows: [...value.rows, { size: '', values: {} }] })}><Plus /> Row</Button>
        {suggestedSizes.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={fillFromSizes}>Add rows for variant sizes</Button>}
      </div>
      {value.rows.length === 0 && value.columns.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">No size chart. Add measurement columns and size rows.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted">Size</th>
                {value.columns.map((c) => (
                  <th key={c} className="px-2 py-2 text-left text-xs font-medium text-muted">
                    <span className="inline-flex items-center gap-1">{c}
                      <button type="button" aria-label={`Remove column ${c}`} className="rounded-sm p-0.5 hover:bg-surface-2" onClick={() => onChange({ columns: value.columns.filter((x) => x !== c), rows: value.rows })}><X className="size-3" /></button>
                    </span>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {value.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-1 py-1"><input aria-label={`Size for row ${i + 1}`} className={`${cell} font-medium`} value={r.size} onChange={(e) => onChange({ ...value, rows: value.rows.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)) })} /></td>
                  {value.columns.map((c) => (
                    <td key={c} className="px-1 py-1">
                      <input aria-label={`${c} for ${r.size || `row ${i + 1}`}`} className={cell} value={r.values[c] ?? ''}
                        onChange={(e) => onChange({ ...value, rows: value.rows.map((x, j) => (j === i ? { ...x, values: { ...x.values, [c]: e.target.value } } : x)) })} />
                    </td>
                  ))}
                  <td className="px-1"><button type="button" aria-label={`Remove row ${r.size}`} className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => onChange({ ...value, rows: value.rows.filter((_, j) => j !== i) })}><X className="size-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
