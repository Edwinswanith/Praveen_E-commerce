'use client';
import * as React from 'react';
import { Plus, RotateCcw, X, Trash2 } from 'lucide-react';
import { Badge, Button, cn } from '@vyra/ui';
import { formatNumber } from '@/lib/format';
import {
  applyExclusions, applyToRows, comboKey, deriveAxes, generateVariantMatrix, normColour, normSize,
  type ColourOption, type EditableField, type MatrixDefaults, type MatrixRow, DEFAULT_MATRIX_VALUES,
} from './variant-matrix';

const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: 'XS–XXL', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { label: 'Waist 28–38', sizes: ['28', '30', '32', '34', '36', '38'] },
  { label: 'Kids', sizes: ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-11Y'] },
  { label: 'Free size', sizes: ['FREE'] },
];

const COLOUR_PRESETS: ColourOption[] = [
  { name: 'Black', hex: '#111111' }, { name: 'White', hex: '#FFFFFF' }, { name: 'Navy', hex: '#1F2A44' },
  { name: 'Grey', hex: '#8A8D91' }, { name: 'Beige', hex: '#D9C8A9' }, { name: 'Olive', hex: '#5B5F2E' },
  { name: 'Maroon', hex: '#6D1A2A' }, { name: 'Pink', hex: '#F4A6C0' },
];

const FIELDS: { field: EditableField; label: string; step: string; money?: boolean }[] = [
  { field: 'mrp', label: 'MRP ₹', step: '0.01', money: true },
  { field: 'price', label: 'Price ₹', step: '0.01', money: true },
  { field: 'costPrice', label: 'Cost ₹', step: '0.01', money: true },
  { field: 'weightGrams', label: 'Weight g', step: '1' },
  { field: 'lowStockThreshold', label: 'Low at', step: '1' },
];

export type VariantErrors = Record<number, Partial<Record<string, string>>>;

export function VariantMatrixEditor({ rows, onChange, errors }: { rows: MatrixRow[]; onChange: (rows: MatrixRow[]) => void; errors?: VariantErrors }) {
  const initial = React.useMemo(() => deriveAxes(rows), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [colours, setColours] = React.useState<ColourOption[]>(initial.colours);
  const [sizes, setSizes] = React.useState<string[]>(initial.sizes);
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [defaults, setDefaults] = React.useState<MatrixDefaults>(DEFAULT_MATRIX_VALUES);
  const [colourName, setColourName] = React.useState('');
  const [colourHex, setColourHex] = React.useState('#888888');
  const [sizeInput, setSizeInput] = React.useState('');

  const regenerate = (c: ColourOption[], s: string[], ex: Set<string> = excluded) => {
    onChange(applyExclusions(generateVariantMatrix(c, s, rows, defaults), ex));
  };
  const updateColours = (c: ColourOption[]) => { setColours(c); regenerate(c, sizes); };
  const updateSizes = (s: string[]) => { setSizes(s); regenerate(colours, s); };

  const addColour = (c: ColourOption) => {
    if (!c.name.trim() || colours.some((x) => normColour(x.name) === normColour(c.name))) return;
    updateColours([...colours, { name: c.name.trim(), hex: c.hex?.toUpperCase() ?? null }]);
    setColourName('');
  };
  const addSizes = (list: string[]) => {
    const next = [...sizes];
    for (const s of list) if (s.trim() && !next.some((x) => normSize(x) === normSize(s))) next.push(s.trim().toUpperCase());
    updateSizes(next);
    setSizeInput('');
  };

  const setCell = (key: string, field: EditableField, value: string) => onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const removeCell = (row: MatrixRow) => {
    const ex = new Set(excluded).add(comboKey(row.color, row.size));
    setExcluded(ex);
    onChange(applyExclusions(rows, ex));
  };
  const restoreCell = (row: MatrixRow) => {
    const target = comboKey(row.color, row.size);
    const ex = new Set(excluded);
    ex.delete(target);
    const c = colours.some((x) => normColour(x.name) === normColour(row.color)) ? colours : [...colours, { name: row.color, hex: row.colorHex }];
    const s = sizes.some((x) => normSize(x) === normSize(row.size)) ? sizes : [...sizes, row.size];
    const generated = generateVariantMatrix(c, s, rows, defaults);
    // Re-adding an axis value must not silently create other brand-new combinations.
    for (const r of generated) {
      const k = comboKey(r.color, r.size);
      if (!r.id && k !== target && !rows.some((x) => comboKey(x.color, x.size) === k)) ex.add(k);
    }
    setColours(c);
    setSizes(s);
    setExcluded(ex);
    onChange(applyExclusions(generated, ex));
  };

  const active = rows.filter((r) => r.isActive);
  const inactive = rows.filter((r) => !r.isActive);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Colours</legend>
          <div className="flex flex-wrap gap-1.5">
            {colours.map((c, i) => (
              <span key={c.name} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg py-1 pl-1.5 pr-1 text-sm">
                <input
                  type="color"
                  aria-label={`Colour swatch for ${c.name}`}
                  value={c.hex ?? '#888888'}
                  onChange={(e) => updateColours(colours.map((x, j) => (j === i ? { ...x, hex: e.target.value.toUpperCase() } : x)))}
                  className="size-5 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-black/10 [&::-webkit-color-swatch-wrapper]:p-0"
                />
                {c.name}
                <button type="button" onClick={() => updateColours(colours.filter((_, j) => j !== i))} className="rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Remove colour ${c.name}`}><X className="size-3.5" /></button>
              </span>
            ))}
            {!colours.length && <span className="text-sm text-muted">No colours yet.</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="color" value={colourHex} onChange={(e) => setColourHex(e.target.value)} aria-label="New colour hex" className="h-8 w-10 cursor-pointer rounded-md border border-border-strong bg-bg p-0.5" />
            <input value={colourName} onChange={(e) => setColourName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColour({ name: colourName, hex: colourHex }); } }}
              placeholder="Colour name" aria-label="New colour name" className="h-8 w-40 rounded-md border border-border-strong px-2.5 text-sm focus:border-fg focus:outline-none" />
            <Button type="button" size="sm" variant="outline" onClick={() => addColour({ name: colourName, hex: colourHex })} disabled={!colourName.trim()}><Plus /> Add</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {COLOUR_PRESETS.filter((p) => !colours.some((c) => normColour(c.name) === normColour(p.name))).map((p) => (
              <button key={p.name} type="button" onClick={() => addColour(p)} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-fg">
                <span className="size-2.5 rounded-full ring-1 ring-black/10" style={{ background: p.hex ?? undefined }} />{p.name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Sizes</legend>
          <div className="flex flex-wrap gap-1.5">
            {sizes.map((s, i) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg py-1 pl-3 pr-1 text-sm font-medium">
                {s}
                <button type="button" onClick={() => updateSizes(sizes.filter((_, j) => j !== i))} className="rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Remove size ${s}`}><X className="size-3.5" /></button>
              </span>
            ))}
            {!sizes.length && <span className="text-sm text-muted">No sizes yet.</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={sizeInput} onChange={(e) => setSizeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSizes(sizeInput.split(',')); } }}
              placeholder="e.g. M or 32, 34" aria-label="New size" className="h-8 w-40 rounded-md border border-border-strong px-2.5 text-sm focus:border-fg focus:outline-none" />
            <Button type="button" size="sm" variant="outline" onClick={() => addSizes(sizeInput.split(','))} disabled={!sizeInput.trim()}><Plus /> Add</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {SIZE_PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => addSizes(p.sizes)} className="rounded-full px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-fg">+ {p.label}</button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="rounded-md border border-border bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-muted">Defaults for new variants · apply to all active variants</p>
        <div className="flex flex-wrap items-end gap-2">
          {FIELDS.map((f) => (
            <label key={f.field} className="w-28 text-xs text-muted">
              {f.label}
              <input type="number" inputMode="decimal" step={f.step} min={0} value={defaults[f.field]} onChange={(e) => setDefaults({ ...defaults, [f.field]: e.target.value })}
                className="tabular mt-1 h-8 w-full rounded-md border border-border-strong bg-bg px-2 text-sm text-fg focus:border-fg focus:outline-none" />
            </label>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!active.length}
            onClick={() => {
              let next = rows;
              for (const f of FIELDS) if (defaults[f.field].trim() !== '') next = applyToRows(next, f.field, defaults[f.field]);
              onChange(next);
            }}
          >
            Apply to {active.length} variant{active.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Add at least one colour and one size to generate variants.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Variant</th>
                <th className="px-3 py-2 text-left font-medium">SKU · Barcode</th>
                {FIELDS.map((f) => <th key={f.field} className="px-2 py-2 text-right font-medium">{f.label}</th>)}
                <th className="px-3 py-2 text-right font-medium">On hand</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {[...active, ...inactive].map((r) => {
                const idx = rows.indexOf(r);
                const rowErr = errors?.[idx];
                return (
                  <tr key={r.key} className={cn('border-t border-border', !r.isActive && 'bg-surface text-muted')}>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="size-3 rounded-full ring-1 ring-black/10" style={{ background: r.colorHex ?? '#ccc' }} aria-hidden />
                        <span className="font-medium">{r.color}</span>
                        <span className="text-muted">/</span>
                        <span className="font-medium">{r.size}</span>
                        {!r.isActive && <Badge tone="neutral">Inactive</Badge>}
                        {!r.id && <Badge tone="info">New</Badge>}
                      </span>
                      {rowErr?.root && <p className="mt-0.5 text-xs text-danger">{rowErr.root}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                      {r.sku ? (<><span className="block">{r.sku}</span><span className="block text-muted">{r.barcode ?? '—'}</span></>) : <span className="font-sans text-subtle">Generated on save</span>}
                    </td>
                    {FIELDS.map((f) => (
                      <td key={f.field} className="px-1 py-1.5 align-top">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={f.step}
                          min={0}
                          disabled={!r.isActive}
                          aria-label={`${f.label} for ${r.color} ${r.size}`}
                          aria-invalid={rowErr?.[f.field] ? true : undefined}
                          value={r[f.field]}
                          onChange={(e) => setCell(r.key, f.field, e.target.value)}
                          className={cn(
                            'tabular h-8 w-24 rounded-sm border border-border bg-bg px-2 text-right text-sm focus:border-fg focus:outline-none disabled:bg-transparent',
                            rowErr?.[f.field] && 'border-danger',
                          )}
                        />
                        {rowErr?.[f.field] && <p className="mt-0.5 max-w-24 text-[11px] leading-tight text-danger">{rowErr[f.field]}</p>}
                      </td>
                    ))}
                    <td className="tabular whitespace-nowrap px-3 py-1.5 text-right">
                      {r.onHand !== undefined ? (<>{formatNumber(r.onHand)}<span className="block text-xs text-muted">{formatNumber(r.reserved ?? 0)} reserved</span></>) : <span className="text-subtle">—</span>}
                    </td>
                    <td className="px-1">
                      {r.isActive ? (
                        <button type="button" onClick={() => removeCell(r)} className="rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-danger" aria-label={r.id ? `Deactivate ${r.color} ${r.size}` : `Remove ${r.color} ${r.size}`} title={r.id ? 'Deactivate (variants are never deleted)' : 'Remove'}>
                          <Trash2 className="size-4" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => restoreCell(r)} className="rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Restore ${r.color} ${r.size}`} title="Reactivate"><RotateCcw className="size-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">{active.length} active variant{active.length === 1 ? '' : 's'}{inactive.length ? ` · ${inactive.length} inactive` : ''}. SKUs and EAN-13 barcodes are generated by the server and never change.</p>
    </div>
  );
}
