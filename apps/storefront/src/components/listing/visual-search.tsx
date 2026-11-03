'use client';

import * as React from 'react';
import { Camera, ImageUp, RefreshCw, Sparkles } from 'lucide-react';
import type { SearchResponse } from '@vyra/shared';
import { Alert, Button, EmptyState, Input } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { takePendingVisualFile } from '@/lib/visual-search-store';
import { ProductGrid, ProductGridSkeleton } from '../product/product-grid';
import { VISUAL_ACCEPT, validateVisualFile } from '../layout/visual-search-dialog';
import { Interpretation } from './interpretation';
import { NativeSelect } from '../ui/select';

export function VisualSearch() {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [gender, setGender] = React.useState('');
  const [maxPrice, setMaxPrice] = React.useState('');
  const [result, setResult] = React.useState<SearchResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);

  const run = React.useCallback(
    async (f: File, refine: { q?: string; gender?: string; maxPrice?: string } = {}) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setLoading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append('image', f);
        if (refine.q?.trim()) fd.append('q', refine.q.trim());
        if (refine.gender) fd.append('gender', refine.gender);
        if (refine.maxPrice && Number(refine.maxPrice) > 0) fd.append('maxPrice', refine.maxPrice);
        setResult(
          await api<SearchResponse>('/visual-search', {
            method: 'POST',
            body: fd,
            signal: ac.signal,
          }),
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(errorMessage(e, 'Visual search failed. Please try another photo.'));
      } finally {
        if (controller.current === ac) setLoading(false);
      }
    },
    [],
  );

  const choose = React.useCallback(
    (f: File | null | undefined) => {
      if (!f) return;
      const err = validateVisualFile(f);
      if (err) {
        setError(err);
        return;
      }
      setFile(f);
      setResult(null);
      void run(f);
    },
    [run],
  );

  React.useEffect(() => {
    const pending = takePendingVisualFile();
    if (pending) choose(pending);
  }, [choose]);

  React.useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-violet-500" aria-hidden />
        <h1 className="font-display text-xl font-extrabold sm:text-2xl">Visual search</h1>
      </div>
      <p className="mt-1 text-sm text-muted">
        Upload or snap a photo of something you love. We’ll find visually similar styles.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-border bg-surface">
            {preview ? (
              /* Local blob preview: plain img, nothing to optimise. */
              <img src={preview} alt="Your uploaded photo" className="size-full object-contain" />
            ) : (
              <label className="flex size-full cursor-pointer flex-col items-center justify-center gap-2 p-6 text-center focus-within:ring-2 focus-within:ring-brand-500">
                <ImageUp className="size-10 text-brand-500" aria-hidden />
                <span className="text-sm font-semibold">Choose a photo</span>
                <span className="text-xs text-muted">JPEG, PNG or WebP · up to 8 MB</span>
                <input
                  type="file"
                  accept={VISUAL_ACCEPT}
                  className="sr-only"
                  onChange={(e) => choose(e.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong text-sm font-semibold hover:border-fg focus-within:ring-2 focus-within:ring-brand-500">
              <ImageUp className="size-4" aria-hidden /> {file ? 'Change' : 'Upload'}
              <input
                type="file"
                accept={VISUAL_ACCEPT}
                className="sr-only"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-fg text-sm font-semibold text-white hover:bg-neutral-800 focus-within:ring-2 focus-within:ring-brand-500">
              <Camera className="size-4" aria-hidden /> Camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
          </div>
          <form
            className="space-y-3 rounded-lg border border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (file) void run(file, { q, gender, maxPrice });
            }}
          >
            <p className="text-xs font-bold uppercase tracking-wider">Refine results</p>
            <div>
              <label htmlFor="vs-q" className="sr-only">
                Describe what you want
              </label>
              <Input
                id="vs-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. in blue, cotton, for office"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="vs-gender" className="sr-only">
                  For
                </label>
                <NativeSelect
                  id="vs-gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                >
                  <option value="">Anyone</option>
                  <option value="MEN">Men</option>
                  <option value="WOMEN">Women</option>
                  <option value="KIDS">Kids</option>
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="vs-max" className="sr-only">
                  Maximum price
                </label>
                <Input
                  id="vs-max"
                  inputMode="numeric"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ''))}
                  placeholder="Max ₹"
                />
              </div>
            </div>
            <Button type="submit" block disabled={!file} loading={loading}>
              <RefreshCw aria-hidden /> Update results
            </Button>
          </form>
        </div>

        <div aria-live="polite">
          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}
          {loading && <ProductGridSkeleton count={8} />}
          {!loading && result && (
            <>
              <Interpretation interpretation={result.interpretation} />
              <p className="mb-4 text-sm text-muted">
                <strong className="text-fg">{result.meta.total}</strong> similar styles
              </p>
              {result.items.length > 0 ? (
                <ProductGrid products={result.items} />
              ) : (
                <EmptyState
                  title="No close matches"
                  description="Try a clearer photo with the garment centred, or add a text refinement."
                />
              )}
            </>
          )}
          {!loading && !result && !error && (
            <EmptyState
              icon={<Camera />}
              title="Start with a photo"
              description="Results will appear here. Tip: crop to a single garment for the best matches."
            />
          )}
        </div>
      </div>
    </div>
  );
}
