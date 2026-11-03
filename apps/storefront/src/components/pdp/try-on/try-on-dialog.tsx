'use client';

import * as React from 'react';
import type { TryOnResponse, VariantDto } from '@vyra/shared';
import { ApiError } from '@/lib/api';
import { colorOptions, selectColor, type Selection } from '@/lib/variants';
import { downscaleImage, remainingLabel, requestTryOn, tryOnErrorMessage } from '@/lib/try-on';
import { Modal } from '../../ui/dialog';
import { PhotoStep } from './photo-step';
import { GeneratingStep } from './generating-step';
import { ResultStep } from './result-step';

export interface TryOnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productSlug: string;
  productName: string;
  variants: VariantDto[];
  selection: Selection;
  onSelectionChange: (s: Selection) => void;
  /** Resolves true when the item was added. */
  onAddToBag: (variantId: string) => Promise<boolean>;
  /** Free try-ons left today (null = unknown). */
  remaining: number | null;
  onRemainingChange: (n: number) => void;
}

const RAW_MAX_BYTES = 30 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

interface Photo {
  blob: Blob;
  url: string;
}

type Phase = 'photo' | 'generating' | 'result';

/**
 * Virtual try-on: photo → generating → result. The photo and the generated
 * image live only in component state (object URL / data URL) and are dropped
 * when the dialog closes. Nothing is written to storage.
 */
export function TryOnDialog(props: TryOnDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Virtual try-on"
      description={`See ${props.productName} on you`}
      size="md"
      className="max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:rounded-none"
    >
      {open && <TryOnFlow {...props} />}
    </Modal>
  );
}

function TryOnFlow({
  productSlug,
  productName,
  variants,
  selection,
  onSelectionChange,
  onAddToBag,
  remaining,
  onRemainingChange,
}: TryOnDialogProps) {
  const [phase, setPhase] = React.useState<Phase>('photo');
  const [photo, setPhoto] = React.useState<Photo | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  const [result, setResult] = React.useState<TryOnResponse | null>(null);
  const [pendingColor, setPendingColor] = React.useState<string>('');
  const abortRef = React.useRef<AbortController | null>(null);
  const photoRef = React.useRef<Photo | null>(null);
  photoRef.current = photo;

  // Unmount (dialog closed): cancel any request and release the photo.
  React.useEffect(
    () => () => {
      abortRef.current?.abort();
      if (photoRef.current) URL.revokeObjectURL(photoRef.current.url);
    },
    [],
  );

  const colors = colorOptions(variants);
  const currentColor = selection.color ?? colors[0]?.name ?? null;
  const currentHex = colors.find((c) => c.name === currentColor)?.hex ?? null;
  const outOfTries = blocked || remaining === 0;

  const replacePhoto = (next: Photo | null) => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return next;
    });
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo (JPEG, PNG or WebP).');
      return;
    }
    if (file.size > RAW_MAX_BYTES) {
      setError('That photo is too large. Try a smaller one.');
      return;
    }
    setPreparing(true);
    try {
      let blob: Blob;
      try {
        blob = await downscaleImage(file);
      } catch {
        const usable = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= UPLOAD_MAX_BYTES;
        if (!usable) throw new Error('unreadable');
        blob = file;
      }
      replacePhoto({ blob, url: URL.createObjectURL(blob) });
      setResult(null);
      setPhase('photo');
    } catch {
      setError("We couldn't read that photo. Try a JPEG or PNG.");
    } finally {
      setPreparing(false);
    }
  };

  const generate = async (color: string | null) => {
    if (!photo || !consent || outOfTries) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setPendingColor(color ?? '');
    setPhase('generating');
    try {
      const res = await requestTryOn({ photo: photo.blob, productSlug, color, signal: ac.signal });
      if (ac.signal.aborted) return;
      setResult(res);
      onRemainingChange(res.remainingToday);
      const match = colors.find((c) => c.name.toLowerCase() === res.color.toLowerCase());
      if (match && match.name !== selection.color) onSelectionChange(selectColor(variants, selection, match.name));
      setPhase('result');
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError(tryOnErrorMessage(e));
      if (e instanceof ApiError && e.status === 429) {
        setBlocked(true);
        onRemainingChange(0);
      }
      setPhase(result ? 'result' : 'photo');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase(result ? 'result' : 'photo');
  };

  const retake = () => {
    replacePhoto(null);
    setResult(null);
    setError(null);
    setPhase('photo');
  };

  const remainingText = remaining === null ? null : remainingLabel(remaining);

  if (phase === 'generating') {
    return <GeneratingStep photoUrl={photo?.url ?? null} colorName={pendingColor || currentColor || 'this style'} onCancel={cancel} />;
  }
  if (phase === 'result' && result && photo) {
    return (
      <ResultStep
        result={result}
        photoUrl={photo.url}
        productName={productName}
        productSlug={productSlug}
        variants={variants}
        selection={selection}
        onSelectionChange={onSelectionChange}
        onAddToBag={onAddToBag}
        onTryColor={(c) => void generate(c)}
        onRetake={retake}
        remainingText={remainingText}
        canRegenerate={!outOfTries}
        error={error}
      />
    );
  }
  return (
    <PhotoStep
      photoUrl={photo?.url ?? null}
      colorName={currentColor}
      colorHex={currentHex}
      consent={consent}
      onConsent={setConsent}
      onPick={(f) => void pick(f)}
      onGenerate={() => void generate(currentColor)}
      error={error}
      blocked={outOfTries}
      preparing={preparing}
      remainingText={remainingText}
    />
  );
}
