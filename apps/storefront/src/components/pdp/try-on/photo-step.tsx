'use client';

import * as React from 'react';
import { Camera, ImageUp, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { Alert, Button } from '@vyra/ui';

function Silhouette() {
  return (
    <svg viewBox="0 0 80 100" className="h-24 w-20 shrink-0" aria-hidden>
      <rect x="1" y="1" width="78" height="98" rx="8" className="fill-surface-2 stroke-border-strong" strokeDasharray="4 3" />
      <circle cx="40" cy="32" r="13" className="fill-border-strong" />
      <path d="M12 99c0-20 12-34 28-34s28 14 28 34z" className="fill-border-strong" />
      <path d="M58 12l4 4 8-8" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-teal-500" />
    </svg>
  );
}

export interface PhotoStepProps {
  photoUrl: string | null;
  colorName: string | null;
  colorHex: string | null;
  consent: boolean;
  onConsent: (v: boolean) => void;
  onPick: (file: File | undefined) => void;
  onGenerate: () => void;
  error: string | null;
  blocked: boolean;
  preparing: boolean;
  remainingText: string | null;
}

export function PhotoStep({
  photoUrl,
  colorName,
  colorHex,
  consent,
  onConsent,
  onPick,
  onGenerate,
  error,
  blocked,
  preparing,
  remainingText,
}: PhotoStepProps) {
  const consentId = React.useId();
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPick(e.target.files?.[0]);
    e.target.value = ''; // allow re-picking the same file
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      {photoUrl ? (
        <div className="relative mx-auto w-full max-w-xs overflow-hidden rounded-lg bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview only, never uploaded elsewhere */}
          <img src={photoUrl} alt="Your photo preview" className="aspect-[4/5] w-full object-cover" />
          <Button
            type="button"
            size="sm"
            variant="subtle"
            className="absolute bottom-2 right-2 h-11 bg-bg/90 px-4"
            onClick={() => uploadRef.current?.click()}
          >
            <RefreshCw aria-hidden /> Change photo
          </Button>
        </div>
      ) : (
        <div className="flex gap-4 rounded-lg bg-surface p-4">
          <Silhouette />
          <div className="min-w-0 text-sm">
            <p className="font-bold">For the best result</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted">
              <li>Full upper body, facing the camera</li>
              <li>Good, even light</li>
              <li>A plain background works best</li>
            </ul>
          </div>
        </div>
      )}

      <div className={photoUrl ? 'sr-only' : 'grid gap-2 sm:grid-cols-1'}>
        <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong text-sm font-semibold hover:border-fg focus-within:ring-2 focus-within:ring-brand-500">
          <ImageUp className="size-4" aria-hidden /> Upload a photo
          <input
            ref={uploadRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            onChange={onChange}
            data-testid="try-on-upload"
          />
        </label>
        <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-fg text-sm font-semibold text-white hover:bg-neutral-800 focus-within:ring-2 focus-within:ring-brand-500 md:hidden">
          <Camera className="size-4" aria-hidden /> Take a selfie
          <input type="file" accept="image/*" capture="user" className="sr-only" onChange={onChange} />
        </label>
      </div>

      {colorName && (
        <p className="flex items-center gap-2 text-sm text-muted">
          Trying on
          <span className="size-4 rounded-full ring-1 ring-black/10" style={{ background: colorHex ?? '#d4d4d4' }} aria-hidden />
          <span className="font-semibold text-fg">{colorName}</span>
        </p>
      )}

      <label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input
          id={consentId}
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsent(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-brand-500"
          required
        />
        <span>I&apos;m 18 or older and this is a photo of me. VYRA doesn&apos;t store your photo.</span>
      </label>

      {error && (
        <Alert tone="danger">
          {error}
        </Alert>
      )}

      <div className="mt-auto space-y-2">
        <Button
          type="button"
          size="lg"
          block
          onClick={onGenerate}
          disabled={!photoUrl || !consent || blocked || preparing}
          loading={preparing}
        >
          <Sparkles aria-hidden /> See it on me
        </Button>
        {remainingText && <p className="text-center text-xs font-semibold text-muted">{remainingText}</p>}
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-subtle">
          <Lock className="size-3" aria-hidden /> Processed in memory to create your preview, then discarded.
        </p>
      </div>
    </div>
  );
}
