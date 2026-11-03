'use client';

import * as React from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { cn } from '@vyra/ui';

export interface CompareSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  /** 0–100: how much of the "after" image is revealed from the left. */
  initial?: number;
  className?: string;
  afterBadge?: React.ReactNode;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Before/after comparison. The handle is a WAI-ARIA slider: drag with a
 * pointer (mouse, touch, pen) or use ←/→ (5%), PageUp/PageDown (25%), Home/End.
 */
export function CompareSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  initial = 50,
  className,
  afterBadge,
}: CompareSliderProps) {
  const [pos, setPos] = React.useState(clamp(initial));
  const boxRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);

  const fromPointer = (clientX: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setPos(clamp(((clientX - r.left) / r.width) * 100));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowLeft: -5,
      ArrowDown: -5,
      ArrowRight: 5,
      ArrowUp: 5,
      PageDown: -25,
      PageUp: 25,
    };
    if (e.key in step) {
      e.preventDefault();
      setPos((p) => clamp(p + step[e.key]!));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPos(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setPos(100);
    }
  };

  return (
    <div
      ref={boxRef}
      className={cn(
        'relative aspect-[4/5] w-full touch-pan-y select-none overflow-hidden rounded-lg bg-surface-2',
        className,
      )}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        fromPointer(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local object/data URLs, never optimised or uploaded */}
      <img src={beforeSrc} alt={beforeAlt} draggable={false} className="absolute inset-0 size-full object-cover" />
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        data-testid="compare-after"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={afterSrc} alt={afterAlt} draggable={false} className="absolute inset-0 size-full object-cover" />
      </div>
      <span className="pointer-events-none absolute left-2 top-2 rounded-sm bg-black/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
        Try-on
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-sm bg-black/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
        Your photo
      </span>
      {afterBadge}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.15)]" style={{ left: `${pos}%` }} />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare try-on with your photo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% try-on`}
        onKeyDown={onKeyDown}
        className="absolute top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-fg shadow-pop outline-none ring-brand-500 focus-visible:ring-2"
        style={{ left: `${pos}%` }}
      >
        <ChevronsLeftRight className="size-5" aria-hidden />
      </div>
    </div>
  );
}
