import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { shouldShowStickyBar, StickyAddBar, useStickyBarVisible } from './sticky-add-bar';

describe('shouldShowStickyBar', () => {
  it('shows only after the CTA scrolled above the viewport', () => {
    expect(shouldShowStickyBar(null, false)).toBe(false);
    expect(shouldShowStickyBar({ isIntersecting: true, top: 300 }, false)).toBe(false);
    // Below the fold on first paint: not yet.
    expect(shouldShowStickyBar({ isIntersecting: false, top: 900 }, false)).toBe(false);
    expect(shouldShowStickyBar({ isIntersecting: false, top: -40 }, false)).toBe(true);
  });
  it('hides while the footer is on screen', () => {
    expect(shouldShowStickyBar({ isIntersecting: false, top: -400 }, true)).toBe(false);
  });
});

type Cb = (entries: Partial<IntersectionObserverEntry>[]) => void;

describe('useStickyBarVisible', () => {
  let cb: Cb | null = null;
  beforeEach(() => {
    cb = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(fn: Cb) {
          cb = fn;
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function Probe() {
    const ref = React.useRef<HTMLDivElement>(null);
    const visible = useStickyBarVisible(ref);
    return (
      <>
        <div ref={ref} data-testid="cta" />
        <footer data-testid="footer" />
        <span>{visible ? 'visible' : 'hidden'}</span>
      </>
    );
  }

  it('reacts to the CTA and footer intersections', () => {
    render(<Probe />);
    const cta = screen.getByTestId('cta');
    const footer = screen.getByTestId('footer');
    expect(screen.getByText('hidden')).toBeInTheDocument();
    act(() => cb!([{ target: cta, isIntersecting: false, boundingClientRect: { top: -120 } as DOMRect }]));
    expect(screen.getByText('visible')).toBeInTheDocument();
    act(() => cb!([{ target: footer, isIntersecting: true }]));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    act(() => cb!([{ target: footer, isIntersecting: false }]));
    expect(screen.getByText('visible')).toBeInTheDocument();
    act(() => cb!([{ target: cta, isIntersecting: true, boundingClientRect: { top: 200 } as DOMRect }]));
    expect(screen.getByText('hidden')).toBeInTheDocument();
  });
});

describe('StickyAddBar', () => {
  const props = {
    imageUrl: null, name: 'Tee', price: 799, mrp: 1299, color: 'Black', size: null,
    busy: false, disabled: false,
  };
  it('is inert and hidden from AT when not visible', () => {
    render(<StickyAddBar {...props} visible={false} onAdd={vi.fn()} onPickSize={vi.fn()} />);
    const bar = screen.getByTestId('sticky-add-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toHaveAttribute('data-visible', 'false');
  });
  it('shows selection and wires both actions when visible', () => {
    const onAdd = vi.fn();
    const onPickSize = vi.fn();
    render(<StickyAddBar {...props} visible onAdd={onAdd} onPickSize={onPickSize} />);
    expect(screen.getByText('Select size')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /change selection/i }));
    expect(onPickSize).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /add to bag/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});
