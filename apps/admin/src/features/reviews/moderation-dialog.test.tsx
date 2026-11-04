import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReviewAdminDto } from '@vyra/shared';
import { api } from '@/lib/api';
import { ModerationDialog } from './moderation-dialog';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const review: ReviewAdminDto = {
  id: 'rev1', rating: 1, title: 'Bad', body: 'Spam spam', authorName: 'Asha', verifiedPurchase: false, createdAt: '2026-11-01T00:00:00Z',
  fit: null, sizePurchased: null, images: [], productId: 'p1', productName: 'Linen Shirt', productSlug: 'linen-shirt', authorEmail: 'a@x.in',
  isPublished: true, moderatedAt: null, moderatedBy: null, moderationNote: null,
};

const reason = () => screen.getByLabelText('Reason');
const submit = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('<ModerationDialog>', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it.each(['', '  ', 'ab', ' a  '])('refuses to hide with reason %j and never calls the API', async (value) => {
    render(<ModerationDialog review={review} action="hide" onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(reason(), { target: { value } });
    submit(/hide review/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 3 characters/i);
    expect(reason()).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('refuses a reason over 300 characters', async () => {
    render(<ModerationDialog review={review} action="hide" onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(reason(), { target: { value: 'x'.repeat(301) } });
    submit(/hide review/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(/under 300/i);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('explains the reason goes to the audit log', () => {
    render(<ModerationDialog review={review} action="hide" onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/audit log/i)).toBeInTheDocument();
  });

  it('hides with a trimmed reason and hands back the updated row', async () => {
    const updated = { ...review, isPublished: false, moderationNote: 'Spam link', moderatedBy: 'Owner', moderatedAt: '2026-11-03T00:00:00Z' };
    vi.mocked(api.post).mockResolvedValue(updated);
    const onDone = vi.fn();
    render(<ModerationDialog review={review} action="hide" onClose={() => {}} onDone={onDone} />);
    fireEvent.change(reason(), { target: { value: '  Spam link ' } });
    submit(/hide review/i);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reviews/rev1/hide', { reason: 'Spam link' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
  });

  it('restores through /publish, also requiring a reason', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...review, isPublished: true });
    render(<ModerationDialog review={{ ...review, isPublished: false }} action="publish" onClose={() => {}} onDone={() => {}} />);
    submit(/restore review/i);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(reason(), { target: { value: 'Hidden by mistake' } });
    submit(/restore review/i);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reviews/rev1/publish', { reason: 'Hidden by mistake' }));
  });
});
