'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Expand, Play } from 'lucide-react';
import type { ProductImageDto, ProductVideoDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { ProductImage } from '../product/product-image';
import { Modal } from '../ui/dialog';
import { usePrefersReducedMotion } from '@/hooks/use-media-query';

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
  const trackRef = React.useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  /** Scroll the snap track to slide i (the scroll handler then updates `index`). */
  const scrollToIndex = React.useCallback(
    (i: number, smooth = true) => {
      const el = trackRef.current;
      if (!el) return;
      el.scrollTo({ left: i * el.clientWidth, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
      setIndex(i);
    },
    [reducedMotion],
  );

  React.useEffect(() => scrollToIndex(0, false), [color, scrollToIndex]);

  const go = React.useCallback(
    (d: number) => {
      if (!media.length) return;
      scrollToIndex((index + d + media.length) % media.length);
    },
    [index, media.length, scrollToIndex],
  );

  const frame = React.useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      setIndex((prev) => (prev === i ? prev : Math.min(Math.max(i, 0), media.length - 1)));
    });
  };
  React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

  if (media.length === 0) {
    return (
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg">
        <ProductImage src={null} alt={name} fill />
      </div>
    );
  }

  const thumb = (m: Media, i: number) => (
    <button
      key={m.kind === 'image' ? m.image.id : m.video.id}
      type="button"
      onClick={() => scrollToIndex(i)}
      aria-label={m.kind === 'image' ? `Show image ${i + 1}` : 'Play video'}
      aria-current={i === index}
      className={cn(
        'relative aspect-[3/4] w-full shrink-0 overflow-hidden rounded-md border-2 bg-surface-2',
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
    <div className="lg:grid lg:grid-cols-[72px_1fr] lg:gap-3">
      <div
        className="hidden lg:flex lg:max-h-[640px] lg:flex-col lg:gap-2 lg:overflow-y-auto scrollbar-none"
        aria-label="Product media"
      >
        {media.map(thumb)}
      </div>
      <div className="relative min-w-0">
        <div
          ref={trackRef}
          onScroll={onScroll}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              go(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              go(-1);
            }
          }}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${name} images. Swipe or use the arrow keys to browse.`}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg scrollbar-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          data-testid="gallery-track"
        >
          {media.map((m, i) => (
            <div
              key={m.kind === 'image' ? m.image.id : m.video.id}
              className="relative w-full shrink-0 snap-center snap-always"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${media.length}`}
            >
              {m.kind === 'image' ? (
                <>
                  <ZoomImage
                    image={m.image}
                    name={name}
                    priority={i === 0}
                    onOpen={() => {
                      setIndex(i);
                      setViewer(true);
                    }}
                  />
                  {m.image.aiGenerated && (
                    <p className="pointer-events-none absolute left-3 top-3 rounded-sm bg-bg/90 px-2 py-1 text-[11px] font-medium text-muted shadow-sm">
                      AI-styled photo · actual product may vary slightly
                    </p>
                  )}
                </>
              ) : (
                <video
                  src={m.video.url}
                  poster={m.video.posterUrl ?? undefined}
                  controls
                  playsInline
                  preload="none"
                  className="aspect-[3/4] w-full rounded-lg bg-black object-contain"
                >
                  <track kind="captions" />
                </video>
              )}
            </div>
          ))}
        </div>
        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className="absolute left-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg/90 shadow-sm max-lg:hidden"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg/90 shadow-sm max-lg:hidden"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5 lg:hidden"
              aria-hidden
              data-testid="gallery-dots"
            >
              {media.map((m, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,.15)] transition-all duration-200 motion-reduce:transition-none',
                    i === index ? 'w-4 bg-brand-500' : 'w-1.5 opacity-80',
                  )}
                />
              ))}
            </div>
            <p className="sr-only" aria-live="polite">
              Image {index + 1} of {media.length}
            </p>
          </>
        )}
      </div>
      <FullscreenViewer
        open={viewer}
        onOpenChange={setViewer}
        media={media}
        index={Math.min(index, media.length - 1)}
        onIndex={(i) => scrollToIndex(i, false)}
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
