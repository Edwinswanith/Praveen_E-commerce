'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { ProductImageDto, ProductVideoDto } from '@vyra/shared';
import { Button, Spinner, cn } from '@vyra/ui';
import { ArrowLeft, ArrowRight, GripVertical, ImagePlus, Trash2, Video } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/controls';

const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 50;

export function MediaManager({ productId, images, videos, colours, onChanged, canWrite }: {
  productId: string; images: ProductImageDto[]; videos: ProductVideoDto[]; colours: string[]; onChanged: () => void; canWrite: boolean;
}) {
  const confirm = useConfirm();
  const [order, setOrder] = React.useState<ProductImageDto[]>([]);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadColour, setUploadColour] = React.useState('');
  const [videoUploading, setVideoUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setOrder([...images].sort((a, b) => a.sortOrder - b.sortOrder)), [images]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const tooBig = list.find((f) => f.size > MAX_IMAGE_MB * 1024 * 1024);
    if (tooBig) { toast.error(`${tooBig.name} is larger than ${MAX_IMAGE_MB} MB`); return; }
    const form = new FormData();
    for (const f of list) form.append('files', f);
    if (uploadColour) form.append('color', uploadColour);
    setUploading(true);
    try {
      await api.upload<ProductImageDto[]>(`/products/${productId}/images`, form);
      toast.success(`${list.length} image(s) uploaded`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const persistOrder = async (next: ProductImageDto[]) => {
    const prev = order;
    setOrder(next);
    const changed = next.map((img, i) => ({ img, i })).filter(({ img, i }) => img.sortOrder !== i);
    try {
      await Promise.all(changed.map(({ img, i }) => api.patch(`/products/${productId}/images/${img.id}`, { sortOrder: i })));
      onChanged();
    } catch (err) {
      setOrder(prev);
      toast.error(`Could not reorder: ${errorMessage(err)}`);
    }
  };

  const move = (id: string, delta: number) => {
    const idx = order.findIndex((i) => i.id === id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(idx, 1);
    if (item) next.splice(to, 0, item);
    void persistOrder(next);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = [...order];
    const from = next.findIndex((i) => i.id === dragId);
    const to = next.findIndex((i) => i.id === targetId);
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    setDragId(null);
    void persistOrder(next);
  };

  const patchImage = async (img: ProductImageDto, patch: { alt?: string; color?: string | null }) => {
    try {
      await api.patch(`/products/${productId}/images/${img.id}`, patch);
      toast.success('Image updated');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removeImage = async (img: ProductImageDto) => {
    if (!(await confirm({ title: 'Delete this image?', description: 'The file is removed from the product gallery.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await api.delete(`/products/${productId}/images/${img.id}`);
      toast.success('Image deleted');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const uploadVideo = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!['video/mp4', 'video/webm'].includes(f.type)) { toast.error('Upload an MP4 or WebM video'); return; }
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) { toast.error(`Video must be ${MAX_VIDEO_MB} MB or smaller`); return; }
    const form = new FormData();
    form.append('file', f);
    setVideoUploading(true);
    try {
      await api.upload(`/products/${productId}/videos`, form);
      toast.success('Video uploaded');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setVideoUploading(false);
      if (videoRef.current) videoRef.current.value = '';
    }
  };

  const removeVideo = async (v: ProductVideoDto) => {
    if (!(await confirm({ title: 'Delete this video?', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await api.delete(`/products/${productId}/videos/${v.id}`);
      toast.success('Video deleted');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      {canWrite && (
        <div
          onDragOver={(e) => { if (!dragId) e.preventDefault(); }}
          onDrop={(e) => { if (dragId) return; e.preventDefault(); void upload(e.dataTransfer.files); }}
          className="flex flex-col gap-3 rounded-md border border-dashed border-border-strong bg-surface p-4 sm:flex-row sm:items-center"
        >
          <ImagePlus className="size-6 text-subtle" aria-hidden />
          <div className="flex-1 text-sm">
            <p className="font-medium">Drop images here or choose files</p>
            <p className="text-xs text-muted">JPEG, PNG or WebP up to {MAX_IMAGE_MB} MB. Optionally tag them with a colour.</p>
          </div>
          <Select aria-label="Colour for uploaded images" value={uploadColour} onChange={(e) => setUploadColour(e.target.value)} className="sm:w-40">
            <option value="">All colours</option>
            {colours.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id="img-upload" onChange={(e) => void upload(e.target.files)} />
          <Button type="button" size="sm" variant="outline" loading={uploading} onClick={() => fileRef.current?.click()}>Choose images</Button>
        </div>
      )}

      {order.length === 0 ? (
        <p className="text-sm text-muted">No images yet. The first image is used as the product thumbnail.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Product images (drag to reorder)">
          {order.map((img, i) => (
            <li
              key={img.id}
              draggable={canWrite}
              onDragStart={() => setDragId(img.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(img.id); }}
              className={cn('overflow-hidden rounded-md border border-border bg-bg', dragId === img.id && 'opacity-50')}
            >
              <div className="relative aspect-[3/4] bg-surface-2">
                <img src={img.thumbUrl || img.url} alt={img.alt} className="size-full object-cover" loading="lazy" />
                {i === 0 && <span className="absolute left-2 top-2 rounded-sm bg-fg/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Cover</span>}
                {canWrite && <GripVertical className="absolute right-2 top-2 size-5 cursor-grab rounded-sm bg-bg/80 p-0.5 text-muted" aria-hidden />}
              </div>
              {canWrite ? (
                <ImageMeta img={img} colours={colours} onSave={(patch) => void patchImage(img, patch)}>
                  <div className="flex items-center justify-between">
                    <div className="flex">
                      <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(img.id, -1)} aria-label="Move earlier"><ArrowLeft /></Button>
                      <Button type="button" variant="ghost" size="sm" disabled={i === order.length - 1} onClick={() => move(img.id, 1)} aria-label="Move later"><ArrowRight /></Button>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void removeImage(img)} aria-label="Delete image"><Trash2 /></Button>
                  </div>
                </ImageMeta>
              ) : (
                <p className="truncate p-2 text-xs text-muted">{img.color ?? 'All colours'} · {img.alt}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Videos</h4>
          {canWrite && (
            <>
              <input ref={videoRef} type="file" accept="video/mp4,video/webm" className="sr-only" onChange={(e) => void uploadVideo(e.target.files)} />
              <Button type="button" size="sm" variant="outline" loading={videoUploading} onClick={() => videoRef.current?.click()}><Video /> Upload video</Button>
            </>
          )}
        </div>
        {videos.length === 0 ? <p className="text-sm text-muted">No videos. MP4 or WebM up to {MAX_VIDEO_MB} MB.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <li key={v.id} className="overflow-hidden rounded-md border border-border">
                <video src={v.url} poster={v.posterUrl ?? undefined} controls preload="metadata" className="aspect-video w-full bg-fg" />
                {canWrite && <div className="flex justify-end p-1"><Button type="button" variant="ghost" size="sm" onClick={() => void removeVideo(v)}><Trash2 /> Delete</Button></div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {(uploading || videoUploading) && <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" /> Uploading…</p>}
    </div>
  );
}

function ImageMeta({ img, colours, onSave, children }: { img: ProductImageDto; colours: string[]; onSave: (p: { alt?: string; color?: string | null }) => void; children: React.ReactNode }) {
  const [alt, setAlt] = React.useState(img.alt);
  React.useEffect(() => setAlt(img.alt), [img.alt]);
  const colourOptions = img.color && !colours.includes(img.color) ? [...colours, img.color] : colours;
  return (
    <div className="space-y-1.5 p-2">
      <select
        aria-label="Image colour"
        value={img.color ?? ''}
        onChange={(e) => onSave({ color: e.target.value || null })}
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs focus:border-fg focus:outline-none"
      >
        <option value="">All colours</option>
        {colourOptions.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        aria-label="Alt text"
        value={alt}
        placeholder="Alt text"
        maxLength={200}
        onChange={(e) => setAlt(e.target.value)}
        onBlur={() => { if (alt.trim() !== img.alt) onSave({ alt: alt.trim() }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs focus:border-fg focus:outline-none"
      />
      {children}
    </div>
  );
}
