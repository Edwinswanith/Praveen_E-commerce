import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AiPhotoPreviewDto, ProductImageDto } from '@vyra/shared';
import { AiPhotoDialog } from './ai-photo-dialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const real: ProductImageDto = { id: 'img_real', url: '/media/a.webp', thumbUrl: '/media/a-t.webp', alt: 'Front', color: 'Black', sortOrder: 0, width: 800, height: 1000, aiGenerated: false };
const preview = (id: string, edgeWhiteRatio = 1): AiPhotoPreviewDto => ({
  previewId: id, dataUrl: 'data:image/webp;base64,AAAA', width: 896, height: 1120, bytes: 81920, style: 'MARKETPLACE', color: 'Black',
  source: { id: real.id, url: real.url, thumbUrl: real.thumbUrl, width: 800, height: 1000 }, edgeWhiteRatio, expiresAt: new Date(Date.now() + 1800_000).toISOString(),
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : data), { status, headers: { 'Content-Type': 'application/json' } });
type Call = [string, RequestInit];

function setup(responses: ((url: string, init: RequestInit) => Response | undefined)[], props: Partial<React.ComponentProps<typeof AiPhotoDialog>> = {}) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    for (const r of responses) { const out = r(url, init); if (out) return out; }
    return json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  render(<AiPhotoDialog productId="prod_1" images={[real]} colours={['Black']} open onOpenChange={onOpenChange} onDone={onDone} {...props} />);
  const calls = () => fetchMock.mock.calls as unknown as Call[];
  return { fetchMock, onDone, onOpenChange, calls };
}

describe('AiPhotoDialog (preview → accept / regenerate / keep original)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('generates a preview from the real photo, shows it next to the original, and saves only on accept', async () => {
    const { calls, onDone } = setup([
      (u) => (u.endsWith('/ai-previews') ? json(preview('pv1'), 201) : undefined),
      (u) => (u.endsWith('/accept') ? json({ ...real, id: 'img_ai', aiGenerated: true, sourceImageId: real.id }, 201) : undefined),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));
    expect(await screen.findByAltText('AI-generated preview')).toBeTruthy();
    expect(screen.getByAltText('Original photo').getAttribute('src')).toBe(real.url);
    expect(screen.getByText(/White background: suitable/)).toBeTruthy();
    const [url, init] = calls()[0]!;
    expect(url).toBe('/api/v1/admin/products/prod_1/images/ai-previews'); // no doubled /admin prefix
    expect(JSON.parse(String(init.body))).toMatchObject({ style: 'MARKETPLACE', angle: 'front', sourceImageId: 'img_real' });
    expect(onDone).not.toHaveBeenCalled(); // nothing saved yet

    fireEvent.click(screen.getByRole('button', { name: /use this photo/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [aurl, ainit] = calls()[1]!;
    expect(aurl).toBe('/api/v1/admin/products/prod_1/images/ai-previews/pv1/accept');
    expect(JSON.parse(String(ainit.body))).toEqual({ placement: 'PRIMARY' });
  });

  it('regenerate replaces the preview (discarding the old one); keep original discards and saves nothing', async () => {
    let n = 0;
    const { calls, onDone, onOpenChange } = setup([(u, i) => (u.endsWith('/ai-previews') && i.method === 'POST' ? json(preview(`pv${++n}`, 0.4), 201) : undefined)]);
    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));
    expect(await screen.findByText(/not pure white \(40%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await waitFor(() => expect(calls().some(([u, i]) => i.method === 'DELETE' && u.endsWith('/ai-previews/pv1'))).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: /keep original/i }));
    await waitFor(() => expect(calls().some(([u, i]) => i.method === 'DELETE' && u.endsWith('/ai-previews/pv2'))).toBe(true));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDone).not.toHaveBeenCalled();
    expect(calls().some(([u]) => u.endsWith('/accept'))).toBe(false);
  });

  it('shows the API error and stays usable', async () => {
    setup([(u) => (u.endsWith('/ai-previews') ? json({ error: { code: 'BAD_GATEWAY', message: 'The AI could not generate this photo: safety' } }, 502) : undefined)]);
    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));
    expect(await screen.findByText(/could not generate this photo/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /generate preview/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('live products: no "from product details" option, and an uploaded original becomes the source', async () => {
    const uploadedImg = { ...real, id: 'img_new', url: '/media/new.webp', thumbUrl: '/media/new-t.webp', alt: 'New' };
    const { calls, onDone } = setup([
      (u) => (u.endsWith('/images') ? json([uploadedImg], 201) : undefined),
      (u) => (u.endsWith('/ai-previews') ? json(preview('pv9'), 201) : undefined),
    ], { images: [], live: true });
    expect(screen.queryByRole('radio', { name: /from product details/i })).toBeNull();
    expect((screen.getByRole('button', { name: /generate preview/i }) as HTMLButtonElement).disabled).toBe(true);
    const file = new File([new Uint8Array([1, 2, 3])], 'shirt.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Upload original product photo'), { target: { files: [file] } });
    await waitFor(() => expect(onDone).toHaveBeenCalled()); // original saved as a normal photo
    expect(await screen.findByRole('radio', { name: /use photo: new/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));
    await screen.findByAltText('AI-generated preview');
    const gen = calls().find(([u]) => u.endsWith('/ai-previews'))!;
    expect(JSON.parse(String(gen[1].body)).sourceImageId).toBe('img_new');
  });
});
