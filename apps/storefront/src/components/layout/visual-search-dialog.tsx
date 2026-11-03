'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera, ImageUp, Sparkles } from 'lucide-react';
import { Modal } from '../ui/dialog';
import { setPendingVisualFile } from '@/lib/visual-search-store';

export const VISUAL_ACCEPT = 'image/jpeg,image/png,image/webp';
export const VISUAL_MAX_BYTES = 8 * 1024 * 1024;

export function validateVisualFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'Please choose a JPEG, PNG or WebP image.';
  if (file.size > VISUAL_MAX_BYTES) return 'That image is larger than 8 MB. Try a smaller photo.';
  return null;
}

/** Header camera dialog: pick or capture a photo, then hand it to /search/visual. */
export function VisualSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const err = validateVisualFile(file);
    if (err) {
      setError(err);
      return;
    }
    setPendingVisualFile(file);
    onOpenChange(false);
    router.push('/search/visual');
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
      title="Search with a photo"
      description="Find visually similar styles from our catalogue."
    >
      <div className="space-y-4 p-5">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors focus-within:border-brand-500 ${dragging ? 'border-brand-500 bg-brand-50' : 'border-border-strong hover:border-fg'}`}
        >
          <ImageUp className="size-8 text-brand-500" aria-hidden />
          <span className="text-sm font-semibold">Upload an image</span>
          <span className="text-xs text-muted">
            Drag & drop or browse · JPEG, PNG, WebP up to 8 MB
          </span>
          <input
            type="file"
            accept={VISUAL_ACCEPT}
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
        <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-fg text-sm font-semibold text-white hover:bg-neutral-800 focus-within:ring-2 focus-within:ring-brand-500 sm:hidden">
          <Camera className="size-4" aria-hidden /> Take a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Sparkles className="size-3.5 text-violet-500" aria-hidden /> Powered by VYRA AI visual
          search. Your photo is used only for this search.
        </p>
      </div>
    </Modal>
  );
}
