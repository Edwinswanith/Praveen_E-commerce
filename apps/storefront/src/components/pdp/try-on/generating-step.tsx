'use client';

import * as React from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@vyra/ui';

export const TRY_ON_TIPS = [
  'Fitting the garment to your pose…',
  'Matching fabric, colour and drape…',
  'Keeping your face, hair and background as they are…',
  'Your photo is processed in memory and never stored.',
  'Tip: a plain background gives the cleanest result.',
];

/** Honest progress: elapsed seconds against the typical ~10s, a bar that never claims 100% until done. */
export function GeneratingStep({ photoUrl, colorName, onCancel }: { photoUrl: string | null; colorName: string; onCancel: () => void }) {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, []);
  const tip = TRY_ON_TIPS[Math.floor(elapsed / 3) % TRY_ON_TIPS.length]!;
  // Eases toward 90% over ~12s, then waits.
  const progress = Math.round(90 * (1 - Math.exp(-elapsed / 6)));

  return (
    <div className="flex flex-col gap-4 p-5" aria-busy="true">
      <div className="relative mx-auto aspect-[4/5] w-full max-w-xs overflow-hidden rounded-lg bg-surface-2">
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- local preview only
          <img src={photoUrl} alt="" className="absolute inset-0 size-full scale-105 object-cover opacity-60 blur-sm" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-brand-500/10 to-violet-500/20 motion-safe:animate-pulse" />
        <div
          aria-hidden
          className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-white/50 to-transparent motion-reduce:hidden"
          style={{ animation: 'vyra-scan 2.4s ease-in-out infinite' }}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-bg/85 py-2 text-sm font-semibold">
          <Sparkles className="size-4 text-violet-500 motion-safe:animate-pulse" aria-hidden />
          Styling you in {colorName}
        </div>
      </div>

      <div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Creating your try-on"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 flex justify-between text-xs text-muted">
          <span>Usually takes about 10 seconds</span>
          <span aria-hidden>{elapsed}s</span>
        </p>
      </div>

      <p className="min-h-10 text-center text-sm text-fg" aria-live="polite">
        {tip}
      </p>

      <Button type="button" variant="outline" size="lg" block onClick={onCancel}>
        <X aria-hidden /> Cancel
      </Button>
    </div>
  );
}
