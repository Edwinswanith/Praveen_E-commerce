'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { ReviewAdminDto } from '@vyra/shared';
import { reviewModerationSchema } from '@vyra/shared';
import { Alert, Button, Field, Textarea } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';

export type ModerationAction = 'hide' | 'publish';
const MAX = 300;

/**
 * Hide or restore one review (POST /admin/reviews/:id/hide | /publish).
 * A reason is always required: it is stored on the review and written to the audit log.
 */
export function ModerationDialog({ review, action, onClose, onDone }: {
  review: ReviewAdminDto; action: ModerationAction; onClose: () => void; onDone: (r: ReviewAdminDto) => void;
}) {
  const [reason, setReason] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const hide = action === 'hide';
  const id = `review-reason-${review.id}`;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const parsed = reviewModerationSchema.safeParse({ reason });
    if (!parsed.success) {
      const t = reason.trim().length;
      setFieldError(t > MAX ? `Keep the reason under ${MAX} characters` : 'Give a reason of at least 3 characters');
      return;
    }
    setFieldError(null);
    setError(null);
    setPending(true);
    try {
      const r = await api.post<ReviewAdminDto>(`/reviews/${encodeURIComponent(review.id)}/${action}`, parsed.data);
      toast.success(hide ? 'Review hidden from the storefront' : 'Review restored on the storefront');
      onDone(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const label = hide ? 'Hide review' : 'Restore review';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" title={hide ? 'Hide this review?' : 'Restore this review?'}
      description={hide
        ? `It disappears from ${review.productName} and the product rating is recalculated without it.`
        : `It shows on ${review.productName} again and counts towards the product rating.`}
      footer={<>
        <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose}>Cancel</Button>
        <Button type="submit" form={`${id}-form`} variant={hide ? 'danger' : 'secondary'} size="sm" className="max-sm:h-11" loading={pending}>{label}</Button>
      </>}>
      <form id={`${id}-form`} noValidate onSubmit={(e) => void submit(e)} className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <blockquote className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span className="font-medium">{review.rating} of 5</span>
          {review.title && <span className="font-medium">{`: ${review.title}`}</span>}
          {review.body && <span className="mt-1 line-clamp-3 block text-muted">{review.body}</span>}
        </blockquote>
        <Field label="Reason" htmlFor={id} error={fieldError ?? undefined}
          hint={`Required. Saved with your name in the audit log. ${reason.trim().length}/${MAX}`}>
          <Textarea id={id} rows={3} value={reason} invalid={!!fieldError} aria-describedby={fieldError ? `${id}-error` : undefined}
            placeholder={hide ? 'For example: abusive language, not about this product' : 'For example: hidden by mistake'}
            onChange={(e) => { setReason(e.target.value); if (fieldError) setFieldError(null); }} />
        </Field>
      </form>
    </Dialog>
  );
}
