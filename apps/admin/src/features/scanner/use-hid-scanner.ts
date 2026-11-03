'use client';
import * as React from 'react';
import { HidScanBuffer, isEditableTarget, type HidBufferOptions } from './hid-buffer';

/**
 * Global keydown listener that catches HID scanner bursts while focus is NOT in a
 * text field (e.g. after tapping a button). Text fields handle their own input.
 */
export function useGlobalHidScanner(
  onScan: (code: string) => void,
  { enabled = true, now, ...opts }: HidBufferOptions & { enabled?: boolean; /** Injectable clock (tests). */ now?: () => number } = {},
) {
  const cb = React.useRef(onScan);
  cb.current = onScan;
  const clock = React.useRef(now ?? (() => performance.now()));
  clock.current = now ?? (() => performance.now());
  const optsKey = JSON.stringify(opts);
  React.useEffect(() => {
    if (!enabled) return;
    const buffer = new HidScanBuffer(JSON.parse(optsKey) as HidBufferOptions);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) { buffer.reset(); return; }
      const code = buffer.push(e.key, clock.current());
      if (code) {
        e.preventDefault();
        e.stopPropagation();
        cb.current(code);
      } else if (e.key === 'Enter' || (buffer.pending && e.key.length === 1)) {
        // Don't let a scanner burst activate the focused button or trigger shortcuts.
        if (buffer.pending) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, optsKey]);
}
