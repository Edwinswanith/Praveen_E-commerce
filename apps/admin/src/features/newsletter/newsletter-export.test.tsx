import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/download';
import { ApiError } from '@/lib/api';
import { NewsletterExportButton } from './newsletter-screen';

vi.mock('@/lib/download', () => ({ downloadFile: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('<NewsletterExportButton>', () => {
  beforeEach(() => { vi.mocked(downloadFile).mockReset(); vi.mocked(toast.error).mockReset(); });

  it('downloads the confirmed-subscriber CSV from /newsletter/export', async () => {
    vi.mocked(downloadFile).mockResolvedValue(undefined);
    render(<NewsletterExportButton />);
    fireEvent.click(screen.getByRole('button', { name: /export confirmed \(csv\)/i }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith('/newsletter/export', 'vyra-newsletter-subscribers.csv'));
    // Paths are relative to /api/v1/admin: never double-prefixed.
    expect(vi.mocked(downloadFile).mock.calls[0]![0]).not.toMatch(/^\/admin/);
  });

  it('toasts the error when the download fails', async () => {
    vi.mocked(downloadFile).mockRejectedValue(new ApiError('FORBIDDEN', 'You do not have permission to do this.', 403));
    render(<NewsletterExportButton />);
    fireEvent.click(screen.getByRole('button', { name: /export confirmed/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You do not have permission to do this.'));
  });
});
