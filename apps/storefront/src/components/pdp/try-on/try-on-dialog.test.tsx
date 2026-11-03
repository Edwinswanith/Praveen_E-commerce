import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VariantDto } from '@vyra/shared';
import type { Selection } from '@/lib/variants';
import { TryOnDialog } from './try-on-dialog';

vi.mock('@/lib/try-on', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/try-on')>();
  // jsdom has no canvas: pass the file through unchanged.
  return { ...mod, downscaleImage: vi.fn(async (f: Blob) => f) };
});

function v(id: string, color: string, size: string, available = 5): VariantDto {
  return {
    id, sku: `SKU-${id}`, color, colorHex: color === 'Maroon' ? '#800000' : '#0f5132', size,
    mrp: 2999, price: 1999, discountPercent: 33, available, inStock: available > 0, isActive: true, barcode: null,
  };
}
const variants = [v('m-s', 'Maroon', 'S'), v('m-m', 'Maroon', 'M'), v('g-m', 'Green', 'M')];
const DISCLAIMER = 'AI-generated preview. Fit, colour and drape may differ from the real garment.';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function Harness({ onAdd, initial = { color: 'Maroon', size: null } }: { onAdd: (id: string) => Promise<boolean>; initial?: Selection }) {
  const [selection, setSelection] = React.useState<Selection>(initial);
  const [remaining, setRemaining] = React.useState<number | null>(3);
  return (
    <TryOnDialog
      open
      onOpenChange={() => undefined}
      productSlug="festive-silk-blend-kurta"
      productName="Festive Silk Blend Kurta"
      variants={variants}
      selection={selection}
      onSelectionChange={setSelection}
      onAddToBag={onAdd}
      remaining={remaining}
      onRemainingChange={setRemaining}
    />
  );
}

async function choosePhoto() {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'me.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByTestId('try-on-upload'), { target: { files: [file] } });
  await screen.findByAltText('Your photo preview');
}

describe('TryOnDialog', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requires the consent checkbox (unchecked by default) before generating', async () => {
    render(<Harness onAdd={vi.fn()} />);
    expect(screen.getByText(/full upper body/i)).toBeInTheDocument();
    expect(screen.getByText('3 free try-ons left today')).toBeInTheDocument();
    const go = screen.getByRole('button', { name: /see it on me/i });
    expect(go).toBeDisabled();
    await choosePhoto();
    const consent = screen.getByRole('checkbox', { name: /18 or older and this is a photo of me/i });
    expect(consent).not.toBeChecked();
    expect(go).toBeDisabled();
    fireEvent.click(go);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(consent);
    expect(go).toBeEnabled();
  });

  it('sends photo + slug + selected colour + consent, then shows the result with its disclaimer', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
    render(<Harness onAdd={vi.fn()} />);
    await choosePhoto();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /see it on me/i }));
    expect(await screen.findByRole('progressbar', { name: /creating your try-on/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    resolve(json(200, { data: { image: 'data:image/webp;base64,AAAA', color: 'Maroon', disclaimer: DISCLAIMER, remainingToday: 2 } }));
    expect(await screen.findByTestId('try-on-disclaimer')).toHaveTextContent(DISCLAIMER);
    expect(screen.getByText('2 free try-ons left today')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /compare/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', 'data:image/webp;base64,AAAA');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/try-on');
    const form = init!.body as FormData;
    expect(form.get('productSlug')).toBe('festive-silk-blend-kurta');
    expect(form.get('color')).toBe('Maroon');
    expect(form.get('consent')).toBe('true');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    expect((init!.headers as Record<string, string>)['X-Vyra-Session']).toMatch(/^s_/);
  });

  it('shows the server message on 429 and blocks further attempts', async () => {
    const msg = "You've used today's 5 free try-ons. Come back tomorrow!";
    fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'RATE_LIMITED', message: msg } }));
    render(<Harness onAdd={vi.fn()} />);
    await choosePhoto();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /see it on me/i }));
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see it on me/i })).toBeDisabled();
    expect(screen.getByText('No free try-ons left today')).toBeInTheDocument();
  });

  it('explains 503 without exposing internals', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: { code: 'NOT_CONFIGURED', message: 'GEMINI key missing' } }));
    render(<Harness onAdd={vi.fn()} />);
    await choosePhoto();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /see it on me/i }));
    expect(await screen.findByText(/isn't available right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/GEMINI/)).not.toBeInTheDocument();
  });

  it('Add to bag asks for a size when none is selected, then adds that variant', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { image: 'data:image/webp;base64,AAAA', color: 'Maroon', disclaimer: DISCLAIMER, remainingToday: 2 } }),
    );
    const onAdd = vi.fn(async () => true);
    render(<Harness onAdd={onAdd} />);
    await choosePhoto();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /see it on me/i }));
    await screen.findByTestId('try-on-disclaimer');

    fireEvent.click(screen.getByRole('button', { name: /^add to bag$/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText(/pick your size/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'M' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('m-m'));
    expect(await screen.findByRole('button', { name: /added to bag/i })).toBeInTheDocument();
  });

  it('uses the PDP size directly when one is selected and can regenerate in another colour', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { image: 'data:image/webp;base64,AAAA', color: 'Maroon', disclaimer: DISCLAIMER, remainingToday: 2 } }))
      .mockResolvedValueOnce(json(200, { data: { image: 'data:image/webp;base64,BBBB', color: 'Green', disclaimer: DISCLAIMER, remainingToday: 1 } }));
    const onAdd = vi.fn(async () => true);
    render(<Harness onAdd={onAdd} initial={{ color: 'Maroon', size: 'M' }} />);
    await choosePhoto();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /see it on me/i }));
    await screen.findByTestId('try-on-disclaimer');

    fireEvent.click(screen.getByRole('button', { name: /try another colour/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Try on in Green' }));
    await screen.findByText('1 free try-on left today');
    expect((fetchMock.mock.calls[1]![1]!.body as FormData).get('color')).toBe('Green');
    expect(screen.getByTestId('try-on-disclaimer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to bag · m/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('g-m'));
  });

  it('cancel returns to the photo step without a result', async () => {
    fetchMock.mockImplementationOnce((_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    );
    render(<Harness onAdd={vi.fn()} />);
    await choosePhoto();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /see it on me/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(await screen.findByRole('button', { name: /see it on me/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
