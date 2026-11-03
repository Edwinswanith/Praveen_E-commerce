'use client';
import * as React from 'react';
import type { BarcodeSymbology } from '@vyra/shared';
import { Skeleton } from '@vyra/ui';
import { ImageOff } from 'lucide-react';
import { requestBlob } from '@/lib/api';

/** Fetches GET /admin/barcodes/:variantId.png with staff credentials and renders it via a blob URL. */
export function BarcodeImage({ variantId, symbology, alt, className }: { variantId: string; symbology: BarcodeSymbology; alt: string; className?: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    requestBlob(`/barcodes/${encodeURIComponent(variantId)}.png`, { query: { symbology } })
      .then(({ blob }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [variantId, symbology]);
  if (failed) return <div className={`flex items-center justify-center gap-1 text-xs text-muted ${className ?? ''}`}><ImageOff className="size-4" /> Unavailable</div>;
  if (!url) return <Skeleton className={className} />;
  return <img src={url} alt={alt} className={`object-contain ${className ?? ''}`} />;
}
