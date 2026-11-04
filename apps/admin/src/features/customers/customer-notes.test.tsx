import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { CustomerNotesCard, NOTES_MAX } from './customer-notes';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('<CustomerNotesCard>', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); vi.mocked(toast.success).mockReset(); });

  it('is read-only without customers:write', () => {
    render(<CustomerNotesCard customerId="u1" notes="Prefers WhatsApp" canWrite={false} onSaved={() => {}} />);
    expect(screen.getByText('Prefers WhatsApp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows an empty state when there are no notes', () => {
    render(<CustomerNotesCard customerId="u1" notes={null} canWrite={false} onSaved={() => {}} />);
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('edits and saves with customers:write, then refreshes', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<CustomerNotesCard customerId="u1" notes="Old" canWrite onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const box = screen.getByLabelText('Notes');
    expect(box).toHaveValue('Old');
    fireEvent.change(box, { target: { value: '  Called about late parcel  ' } });
    expect(screen.getByText(`24 / ${NOTES_MAX} characters`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save notes/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customers/u1/notes', { notes: 'Called about late parcel' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Notes saved');
  });

  it('blocks saving over 2000 characters', () => {
    render(<CustomerNotesCard customerId="u1" notes={null} canWrite onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'x'.repeat(NOTES_MAX) } });
    expect(screen.getByRole('button', { name: /save notes/i })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'x'.repeat(NOTES_MAX + 1) } });
    expect(screen.getByText(`${NOTES_MAX + 1} / ${NOTES_MAX} characters`)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/2000 characters or fewer/);
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'true');
    const save = screen.getByRole('button', { name: /save notes/i });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(api.post).not.toHaveBeenCalled();
  });
});
