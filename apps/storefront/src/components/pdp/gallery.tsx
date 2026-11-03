'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Expand, Play } from 'lucide-react';
import type { ProductImageDto, ProductVideoDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { ProductImage } from '../product/product-image';
import { Modal } from '../ui/dialog';

type Media = { kind: 'image'; image: ProductImageDto } | { kind: 'video'; video: ProductVideoDto };

/** Images for the chosen colour first (untagged images are shared by all colours). */
export function imagesForColor(images: ProductImageDto[], color: string | null): ProductImageDto[] {
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!color) return sorted;
  const matching = sorted.filter((i) => i.color === color || i.color === null);
  return matching.length > 0 ? matching : sorted;
}

function ZoomImage({
  image,
  name,
  priority,
  onOpen,
}: {
  image: ProductImageDto;
  name: string;
  priority?: boolean;
  onOpen: () => void;
}) {
  const [origin, setOrigin] = React.useState<string | null>(null);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setOrigin(
          `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`,
        );
      }}
      onMouseLeave={() => setOrigin(null)}
      className="group relative block aspect-[3/4] w-full cursor-zoom-in overflow-hidden rounded-lg bg-surface-2"
      aria-label={`Open full-screen view: ${image.alt || name}`}
    >
      <ProductImage
        src={image.url}
        alt={image.alt || name}
        fill
        priority={priority}
        sizes="(min-width: 1024px) 45vw, 100vw"
        className="object-cover transition-transform duration-200 ease-out"
        style={origin ? { transform: 'scale(2)', transformOrigin: origin } : undefined}
      />
      <span
        className="absolute bottom-3 right-3 flex size-9 items-center justify-center rounded-full bg-bg/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      >
        <Expand className="size-4" />
      </span>
    </button>
  );
}

export function Gallery({
  images,
  videos,
  name,
  color,
}: {
  images: ProductImageDto[];
  videos: ProductVideoDto[];
  name: string;
  color: string | null;
}) {
  const media: Media[] = React.useMemo(
    () => [
      ...imagesForColor(images, color).map((image) => ({ kind: 'image' as const, image })),
      ...videos.map((video) => ({ kind: 'video' as const, video })),
    ],
    [images, videos, color],
  );
  const [index, setIndex] = React.useState(0);
  const [viewer, setViewer] = React.useState(false);
  React.useEffect(() => setIndex(0), [color]);
  const current = media[Math.min(index, media.length - 1)];
  const go = React.useCallback(
    (d: number) => setIndex((i) => (media.length ? (i + d + media.length) % media.length : 0)),
    [media.length],
  );

  if (media.length === 0) {
    return (
      <div className="aspect-[3/4] w-full overflow-hidden rounded-lg">
        <ProductImage src={null} alt={name} fill />
      </div>
    );
  }

  const thumb = (m: Media, i: number) => (
    <button
      key={m.kind === 'image' ? m.image.id : m.video.id}
      type="button"
      onClick={() => setIndex(i)}
      aria-label={m.kind === 'image' ? `Show image ${i + 1}` : 'Play video'}
      aria-current={i === index}
      className={cn(
        'relative aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-md border-2 bg-surface-2 lg:w-full',
        i === index ? 'border-brand-500' : 'border-transparent hover:border-border-strong',
      )}
    >
      {m.kind === 'image' ? (
        <ProductImage
          src={m.image.thumbUrl || m.image.url}
          alt=""
          fill
          sizes="80px"
          className="object-cover"
        />
      ) : (
        <>
          {m.video.posterUrl && (
            <ProductImage
              src={m.video.posterUrl}
              alt=""
              fill
              sizes="80px"
              className="object-cover"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Play className="size-5 fill-white text-white" aria-hidden />
          </span>
        </>
      )}
    </button>
  );

  return (
    <div className="flex flex-col-reverse gap-3 lg:grid lg:grid-cols-[72px_1fr]">
      <div
        className="flex gap-2 overflow-x-auto scrollbar-none lg:max-h-[640px] lg:flex-col lg:overflow-y-auto"
        aria-label="Product media"
      >
        {media.map(thumb)}
      </div>
      <div className="relative">
        {current?.kind === 'image' ? (
          <ZoomImage
            image={current.image}
            name={name}
            priority={index === 0}
            onOpen={() => setViewer(true)}
          />
        ) : current?.kind === 'video' ? (
          <video
            key={current.video.id}
            src={current.video.url}
            poster={current.video.posterUrl ?? undefined}
            controls
            playsInline
            className="aspect-[3/4] w-full rounded-lg bg-black object-contain"
          >
            <track kind="captions" />
          </video>
        ) : null}
        {current?.kind === 'image' && current.image.aiGenerated && (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-sm bg-bg/90 px-2 py-1 text-[11px] font-medium text-muted shadow-sm">
            AI-styled photo · actual product may vary slightly
          </p>
        )}
        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-bg/90 shadow-sm lg:hidden"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-bg/90 shadow-sm lg:hidden"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </>
        )}
      </div>
      <FullscreenViewer
        open={viewer}
        onOpenChange={setViewer}
        media={media}
        index={index}
        onIndex={setIndex}
        name={name}
      />
    </div>
  );
}

function FullscreenViewer({
  open,
  onOpenChange,
  media,
  index,
  onIndex,
  name,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  media: Media[];
  index: number;
  onIndex: (i: number) => void;
  name: string;
}) {
  const go = React.useCallback(
    (d: number) => onIndex((index + d + media.length) % media.length),
    [index, media.length, onIndex],
  );
  const current = media[index];
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${name} — ${index + 1} of ${media.length}`}
      size="full"
      className="bg-bg"
    >
      <div
        className="relative flex h-full min-h-[70dvh] items-center justify-center"
        aria-roledescription="carousel"
        aria-label="Use the left and right arrow keys to browse"
      >
        {current?.kind === 'image' && (
          <div className="relative h-[80dvh] w-full max-w-4xl">
            <ProductImage
              src={current.image.url}
              alt={current.image.alt || name}
              fill
              sizes="100vw"
              className="object-contain"
            />
          </div>
        )}
        {current?.kind === 'video' && (
          <video
            src={current.video.url}
            controls
            autoPlay
            playsInline
            className="max-h-[80dvh] max-w-full"
          >
            <track kind="captions" />
          </video>
        )}
        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous"
              className="absolute left-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 hover:bg-border"
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next"
              className="absolute right-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 hover:bg-border"
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </>
        )}
      </div>
      <div className="flex justify-center gap-2 pb-4" aria-label="Choose image">
        {media.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onIndex(i)}
            aria-label={`Go to ${m.kind} ${i + 1}`}
            aria-current={i === index}
            className={cn(
              'size-2.5 rounded-full',
              i === index ? 'bg-brand-500' : 'bg-border-strong',
            )}
          />
        ))}
      </div>
    </Modal>
  );
}
