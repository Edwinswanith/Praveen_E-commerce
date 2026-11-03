import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProductImageDto } from '@vyra/shared';
import { AiPhotoDialog } from './ai-photo-dialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const real: ProductImageDto = { id: 'img_real', url: '/media/a.webp', thumbUrl: '/media/a-t.webp', alt: 'Front', color: 'Black', sortOrder: 0, width: 800, height: 1000, aiGenerated: false };

describe('AiPhotoDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests /api/v1/admin/products/:id/images/generate exactly once (no doubled /admin prefix)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ ...real, id: 'img_ai', aiGenerated: true }] }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    render(<AiPhotoDialog productId="prod_1" images={[real]} colours={['Black']} open onOpenChange={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /generate photo/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/products/prod_1/images/generate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ style: 'MODEL', count: 1, sourceImageId: 'img_real' });
  });
});
