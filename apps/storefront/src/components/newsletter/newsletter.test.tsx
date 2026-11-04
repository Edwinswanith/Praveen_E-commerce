import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
let search = new URLSearchParams();
vi.mock('@/lib/api', async (orig) => {
  const mod = await orig<typeof import('@/lib/api')>();
  return { ...mod, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('next/navigation', () => ({ useSearchParams: () => search }));
const { NewsletterForm } = await import('../layout/newsletter-form');
const { NewsletterConfirm, NewsletterUnsubscribe } = await import('./newsletter-links');

const TOKEN = `abcdefghij0123456789.${'a'.repeat(64)}`;

beforeEach(() => {
  apiMock.mockReset();
  search = new URLSearchParams();
});

describe('<NewsletterForm />', () => {
  it('sends the source and asks the person to confirm by email', async () => {
    apiMock.mockResolvedValueOnce({ ok: true });
    render(<NewsletterForm source="footer" />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' Priya@Example.com ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /subscribe/i }));
    });
    expect(apiMock).toHaveBeenCalledWith('/newsletter', {
      method: 'POST',
      body: { email: 'priya@example.com', source: 'footer' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Check your inbox to confirm your subscription');
    expect(screen.queryByText(/you’re subscribed|you're subscribed|on the list/i)).toBeNull();
  });
});

describe('/newsletter/confirm', () => {
  it('confirms on load', async () => {
    search = new URLSearchParams({ token: TOKEN });
    apiMock.mockResolvedValueOnce({ status: 'SUBSCRIBED' });
    await act(async () => {
      render(<NewsletterConfirm />);
    });
    expect(apiMock).toHaveBeenCalledWith('/newsletter/confirm', { method: 'POST', body: { token: TOKEN } });
    expect(screen.getByText(/you’re subscribed/i)).toBeInTheDocument();
  });

  it('shows the error for a bad link', async () => {
    search = new URLSearchParams({ token: 'nope' });
    apiMock.mockRejectedValueOnce(new ApiError('BAD_REQUEST', 'This link is invalid or has expired', 400));
    await act(async () => {
      render(<NewsletterConfirm />);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('This link is invalid or has expired');
  });
});

describe('/newsletter/unsubscribe', () => {
  it('does not unsubscribe on render; only after the click', async () => {
    search = new URLSearchParams({ token: TOKEN });
    apiMock.mockResolvedValueOnce({ status: 'UNSUBSCRIBED' });
    await act(async () => {
      render(<NewsletterUnsubscribe />);
    });
    expect(apiMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    });
    expect(apiMock).toHaveBeenCalledWith('/newsletter/unsubscribe', { method: 'POST', body: { token: TOKEN } });
    expect(screen.getByRole('status')).toHaveTextContent('You’re unsubscribed');
  });

  it('shows the 400 message and keeps the button', async () => {
    search = new URLSearchParams({ token: 'bad-token' });
    apiMock.mockRejectedValueOnce(
      new ApiError('VALIDATION_FAILED', 'token: This link is invalid or has expired', 400, {
        fieldErrors: { token: ['This link is invalid or has expired'] },
      }),
    );
    render(<NewsletterUnsubscribe />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('This link is invalid or has expired');
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeInTheDocument();
  });
});
