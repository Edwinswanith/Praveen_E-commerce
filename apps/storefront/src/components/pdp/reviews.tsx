'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, MessageSquarePlus, Star } from 'lucide-react';
import { toast } from 'sonner';
import type { PageMeta, ReviewDto } from '@vyra/shared';
import { reviewSchema } from '@vyra/shared';
import { Alert, Button, Field, Input, Skeleton, Textarea, cn } from '@vyra/ui';
import { api, ApiError } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/hooks/use-auth';
import { Stars } from '../ui/stars';

interface ReviewsResponse {
  items: ReviewDto[];
  meta: PageMeta;
  summary: {
    average: number | null;
    count: number;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  };
}

function WriteReview({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [hover, setHover] = React.useState(0);
  const [formError, setFormError] = React.useState<string | null>(null);
  const { register, handleSubmit, setValue, watch, setError, formState } = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: { rating: 0, title: '', body: '' },
  });
  const rating = Number(watch('rating') ?? 0);
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api<ReviewDto>(`/products/${slug}/reviews`, { method: 'POST', body: values });
      toast.success('Thanks! Your review has been posted.');
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT')
        setFormError('You’ve already reviewed this product.');
      else setFormError(applyApiErrors(e, setError, ['rating', 'title', 'body']));
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
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Button type="submit" loading={formState.isSubmitting}>
        Submit review
      </Button>
    </form>
  );
}

export function Reviews({ slug }: { slug: string }) {
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
                    {r.body && (
                      <p className="mt-1.5 whitespace-pre-line text-sm text-fg/90">{r.body}</p>
                    )}
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
