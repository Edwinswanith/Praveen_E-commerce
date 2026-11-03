'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, Camera, MessageSquarePlus, Ruler, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PageMeta, ReviewDto } from '@vyra/shared';
import { reviewSchema } from '@vyra/shared';
import { Alert, Button, Field, Input, Skeleton, Textarea, cn } from '@vyra/ui';
import { api, ApiError } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { FIT_LABEL, formatDate } from '@/lib/format';
import { useAuth } from '@/hooks/use-auth';
import { Stars } from '../ui/stars';
import { Modal } from '../ui/dialog';
import { NativeSelect } from '../ui/select';

interface ReviewsResponse {
  items: ReviewDto[];
  meta: PageMeta;
  summary: {
    average: number | null;
    count: number;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  };
}

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
type Fit = keyof typeof FIT_LABEL;
const FITS = Object.keys(FIT_LABEL) as Fit[];

interface Photo {
  file: File;
  url: string;
}

/** Up to 3 photos with previews; object URLs are revoked when removed/unmounted. */
function PhotoPicker({
  photos,
  onChange,
  error,
}: {
  photos: Photo[];
  onChange: (p: Photo[]) => void;
  error: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const latest = React.useRef(photos);
  latest.current = photos;
  React.useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const add = (files: FileList | null) => {
    setLocalError(null);
    if (!files) return;
    const next = [...photos];
    for (const f of Array.from(files)) {
      if (next.length >= MAX_PHOTOS) {
        setLocalError(`You can add up to ${MAX_PHOTOS} photos.`);
        break;
      }
      if (!f.type.startsWith('image/')) {
        setLocalError(`${f.name} isn’t an image.`);
        continue;
      }
      if (f.size > MAX_PHOTO_BYTES) {
        setLocalError(`${f.name} is larger than 10 MB.`);
        continue;
      }
      next.push({ file: f, url: URL.createObjectURL(f) });
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };
  const remove = (i: number) => {
    const p = photos[i];
    if (p) URL.revokeObjectURL(p.url);
    onChange(photos.filter((_, j) => j !== i));
  };
  const shown = error ?? localError;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Photos (optional, up to {MAX_PHOTOS})
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div key={p.url} className="relative size-20 overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Photo ${i + 1} preview`} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              aria-label={`Remove photo ${i + 1}`}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-xs text-muted hover:border-fg hover:text-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300">
            <Camera className="size-5" aria-hidden />
            Add photo
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => add(e.target.files)}
            />
          </label>
        )}
      </div>
      {shown ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {shown}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">JPG, PNG or WebP · at least 200×200 px · up to 10 MB</p>
      )}
    </div>
  );
}

function WriteReview({
  slug,
  sizes,
  onDone,
}: {
  slug: string;
  sizes: string[];
  onDone: () => void;
}) {
  const [hover, setHover] = React.useState(0);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const { register, handleSubmit, setValue, watch, setError, formState } = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      rating: 0,
      title: '',
      body: '',
      fit: undefined as Fit | undefined,
      sizePurchased: '',
    },
  });
  const rating = Number(watch('rating') ?? 0);
  const fit = watch('fit');
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setPhotoError(null);
    const fd = new FormData();
    fd.set('rating', String(values.rating));
    if (values.title) fd.set('title', values.title);
    if (values.body) fd.set('body', values.body);
    if (values.fit) fd.set('fit', values.fit);
    if (values.sizePurchased) fd.set('sizePurchased', values.sizePurchased);
    for (const p of photos) fd.append('images', p.file, p.file.name);
    try {
      // FormData: the browser sets the multipart boundary; api() adds X-Requested-With.
      await api<ReviewDto>(`/products/${slug}/reviews`, { method: 'POST', body: fd });
      toast.success('Thanks! Your review has been posted.');
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT')
        setFormError('You’ve already reviewed this product.');
      else if (
        e instanceof ApiError &&
        (e.fieldErrors.images?.[0] || e.status === 413 || /image|photo|file/i.test(e.message))
      )
        setPhotoError(
          e.fieldErrors.images?.[0] ?? (e.status === 413 ? 'Those photos are too large.' : e.message),
        );
      else
        setFormError(
          applyApiErrors(e, setError, ['rating', 'title', 'body', 'fit', 'sizePurchased']),
        );
    }
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border p-4" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Your rating
        </legend>
        <div
          className="flex gap-1"
          onMouseLeave={() => setHover(0)}
          role="radiogroup"
          aria-label="Rating"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              onMouseEnter={() => setHover(n)}
              onClick={() => setValue('rating', n, { shouldValidate: true })}
              className="p-0.5"
            >
              <Star
                className={cn(
                  'size-7',
                  n <= (hover || rating) ? 'fill-sun-400 text-sun-400' : 'text-border-strong',
                )}
                aria-hidden
              />
            </button>
          ))}
        </div>
        {formState.errors.rating && (
          <p role="alert" className="mt-1 text-xs text-danger">
            Please choose a rating
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          How did it fit? (optional)
        </legend>
        <div className="flex flex-wrap gap-2">
          {FITS.map((f) => (
            <label
              key={f}
              className={cn(
                'inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
                fit === f ? 'border-fg bg-fg text-white' : 'border-border-strong hover:border-fg',
              )}
            >
              <input
                type="radio"
                name="review-fit"
                value={f}
                checked={fit === f}
                onChange={() => setValue('fit', f, { shouldDirty: true })}
                className="sr-only"
              />
              {FIT_LABEL[f]}
            </label>
          ))}
        </div>
      </fieldset>
      {sizes.length > 0 && (
        <Field label="Size you bought (optional)" htmlFor="rv-size">
          <NativeSelect id="rv-size" {...register('sizePurchased')} className="max-w-40">
            <option value="">Select</option>
            {sizes.map((sz) => (
              <option key={sz} value={sz}>
                {sz}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field label="Title (optional)" htmlFor="rv-title" error={formState.errors.title?.message}>
        <Input id="rv-title" {...register('title')} maxLength={100} />
      </Field>
      <Field label="Review (optional)" htmlFor="rv-body" error={formState.errors.body?.message}>
        <Textarea
          id="rv-body"
          {...register('body')}
          maxLength={2000}
          placeholder="How was the fit, fabric and colour?"
        />
      </Field>
      <PhotoPicker
        photos={photos}
        onChange={(p) => {
          setPhotos(p);
          setPhotoError(null);
        }}
        error={photoError}
      />
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Button type="submit" loading={formState.isSubmitting}>
        Submit review
      </Button>
    </form>
  );
}

function ReviewPhotos({ review }: { review: ReviewDto }) {
  const [open, setOpen] = React.useState<number | null>(null);
  if (review.images.length === 0) return null;
  const current = open !== null ? review.images[open] : undefined;
  return (
    <>
      <ul className="mt-2 flex gap-2" aria-label="Customer photos">
        {review.images.map((img, i) => (
          <li key={img.id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block size-16 overflow-hidden rounded-md border border-border hover:border-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              aria-label={`Enlarge photo ${i + 1} from ${review.authorName}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbUrl || img.url} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Modal
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={`Photo ${(open ?? 0) + 1} of ${review.images.length} · ${review.authorName}`}
        size="lg"
      >
        {current && (
          <div className="flex flex-col items-center gap-3 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={`Customer photo ${(open ?? 0) + 1} from ${review.authorName}`}
              className="max-h-[70dvh] w-auto rounded-md object-contain"
            />
            {review.images.length > 1 && (
              <div className="flex gap-2">
                {review.images.map((img, i) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setOpen(i)}
                    aria-label={`Show photo ${i + 1}`}
                    aria-current={i === open}
                    className={cn(
                      'size-12 overflow-hidden rounded-sm border-2',
                      i === open ? 'border-fg' : 'border-transparent',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.thumbUrl || img.url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export function Reviews({ slug, sizes = [] }: { slug: string; sizes?: string[] }) {
  const { user } = useAuth();
  const [page, setPage] = React.useState(1);
  const [writing, setWriting] = React.useState(false);
  const key = `/products/${slug}/reviews?page=${page}`;
  const { data, error, isLoading, mutate } = useSWR<ReviewsResponse>(key);
  const [all, setAll] = React.useState<ReviewDto[]>([]);
  React.useEffect(() => {
    if (!data) return;
    setAll((prev) =>
      page === 1
        ? data.items
        : [...prev, ...data.items.filter((r) => !prev.some((p) => p.id === r.id))],
    );
  }, [data, page]);

  const summary = data?.summary;
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="reviews-heading"
          className="font-display text-lg font-extrabold uppercase tracking-wide"
        >
          Ratings & reviews
        </h2>
        {user ? (
          !writing && (
            <Button variant="outline" size="sm" onClick={() => setWriting(true)}>
              <MessageSquarePlus aria-hidden /> Write a review
            </Button>
          )
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={`/login?next=${encodeURIComponent(`/p/${slug}#reviews`)}`}>
              Sign in to review
            </Link>
          </Button>
        )}
      </div>
      {writing && (
        <div className="mt-4">
          <WriteReview
            slug={slug}
            sizes={sizes}
            onDone={() => {
              setWriting(false);
              setPage(1);
              void mutate();
            }}
          />
        </div>
      )}
      {isLoading && !data && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {error && (
        <Alert tone="danger" className="mt-4">
          Reviews couldn’t be loaded.
        </Alert>
      )}
      {summary &&
        (summary.count === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No reviews yet. Be the first to share your thoughts.
          </p>
        ) : (
          <div className="mt-4 grid gap-8 md:grid-cols-[240px_1fr]">
            <div>
              <p className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-extrabold">
                  {summary.average?.toFixed(1) ?? '—'}
                </span>
                <Star className="size-6 fill-teal-500 text-teal-500" aria-hidden />
              </p>
              <p className="text-sm text-muted">{summary.count} verified ratings</p>
              <ul className="mt-4 space-y-1.5">
                {(['5', '4', '3', '2', '1'] as const).map((r) => {
                  const n = summary.distribution[r] ?? 0;
                  const pct = summary.count ? Math.round((n / summary.count) * 100) : 0;
                  return (
                    <li key={r} className="flex items-center gap-2 text-xs">
                      <span className="w-6 tabular-nums">{r}★</span>
                      <span
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
                        role="img"
                        aria-label={`${pct}% rated ${r} stars`}
                      >
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            Number(r) >= 3
                              ? 'bg-teal-500'
                              : Number(r) === 2
                                ? 'bg-sun-400'
                                : 'bg-brand-500',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-8 text-right tabular-nums text-muted">{n}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <ul className="divide-y divide-border">
                {all.map((r) => (
                  <li key={r.id} className="py-4 first:pt-0">
                    <div className="flex items-center gap-2">
                      <Stars value={r.rating} />
                      {r.title && <p className="text-sm font-bold">{r.title}</p>}
                    </div>
                    {(r.fit || r.sizePurchased) && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        {r.fit && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
                              r.fit === 'TRUE_TO_SIZE'
                                ? 'bg-teal-500/10 text-teal-700'
                                : 'bg-amber-50 text-amber-700',
                            )}
                          >
                            <Ruler className="size-3" aria-hidden />
                            {FIT_LABEL[r.fit]}
                          </span>
                        )}
                        {r.sizePurchased && (
                          <span className="text-muted">Size bought: {r.sizePurchased}</span>
                        )}
                      </p>
                    )}
                    {r.body && (
                      <p className="mt-1.5 whitespace-pre-line text-sm text-fg/90">{r.body}</p>
                    )}
                    <ReviewPhotos review={r} />
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{r.authorName}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(r.createdAt)}</span>
                      {r.verifiedPurchase && (
                        <span className="inline-flex items-center gap-1 text-teal-600">
                          <BadgeCheck className="size-3.5" aria-hidden />
                          Verified buyer
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
              {data && data.meta.page < data.meta.totalPages && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  loading={isLoading}
                >
                  Load more reviews
                </Button>
              )}
            </div>
          </div>
        ))}
    </section>
  );
}
