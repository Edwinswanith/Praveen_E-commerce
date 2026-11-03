import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HidScanBuffer, createDuplicateFilter, isEditableTarget } from './hid-buffer';
import { useGlobalHidScanner } from './use-hid-scanner';

/** Feeds a string to the buffer with a fixed inter-key gap; returns the result of the final Enter. */
function type(buffer: HidScanBuffer, text: string, gapMs: number, start = 1000, enterGap = gapMs) {
  let t = start;
  for (const ch of text) {
    expect(buffer.push(ch, t)).toBeNull();
    t += gapMs;
  }
  return buffer.push('Enter', t - gapMs + enterGap);
}

describe('HidScanBuffer', () => {
  it('turns a fast burst ending in Enter into exactly one code', () => {
    const b = new HidScanBuffer();
    expect(type(b, '2000000000017', 8)).toBe('2000000000017');
    // buffer is cleared afterwards
    expect(b.push('Enter', 5000)).toBeNull();
  });

  it('ignores slow human typing', () => {
    const b = new HidScanBuffer();
    expect(type(b, '2000000000017', 180)).toBeNull();
  });

  it('ignores Enter that arrives long after the last character', () => {
    const b = new HidScanBuffer();
    expect(type(b, 'VY-TSH-00042-BLK-M', 10, 1000, 900)).toBeNull();
  });

  it('drops slow leading keystrokes but keeps a following fast burst', () => {
    const b = new HidScanBuffer();
    b.push('x', 0);
    b.push('y', 400);
    expect(type(b, 'VY-TSH-00042-BLK-M', 5, 1200)).toBe('VY-TSH-00042-BLK-M');
  });

  it('ignores modifier keys inside a burst and strips AIM symbology prefixes', () => {
    const b = new HidScanBuffer();
    let t = 0;
    for (const k of [']', 'E', '0', 'Shift', '2', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '1', '7']) {
      b.push(k, t);
      t += 6;
    }
    expect(b.push('Enter', t)).toBe('2000000000017');
  });

  it('rejects codes shorter than minLength', () => {
    const b = new HidScanBuffer({ minLength: 4 });
    expect(type(b, '12', 5)).toBeNull();
  });

  it('produces separate codes for back-to-back scans', () => {
    const b = new HidScanBuffer();
    expect(type(b, 'AAAA1111', 5, 0)).toBe('AAAA1111');
    expect(type(b, 'BBBB2222', 5, 300)).toBe('BBBB2222');
  });
});

describe('createDuplicateFilter', () => {
  it('suppresses the same code within the window but accepts it afterwards', () => {
    const accept = createDuplicateFilter(2000);
    expect(accept('A', 0)).toBe(true);
    expect(accept('A', 500)).toBe(false);
    expect(accept('B', 600)).toBe(true);
    expect(accept('A', 2600)).toBe(true);
  });
});

describe('isEditableTarget', () => {
  it('recognises text inputs but not buttons', () => {
    const input = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
  });
});

let fakeNow = 0;
function Harness({ onScan }: { onScan: (c: string) => void }) {
  useGlobalHidScanner(onScan, { now: () => fakeNow });
  return (
    <div>
      <button type="button">Focusable</button>
      <input aria-label="Other field" />
    </div>
  );
}

function burst(target: Element, text: string, gap: number, start: number) {
  fakeNow = start;
  for (const ch of text) {
    fireEvent.keyDown(target, { key: ch });
    fakeNow += gap;
  }
  fireEvent.keyDown(target, { key: 'Enter' });
}

describe('useGlobalHidScanner', () => {
  it('emits one code for a fast burst while focus is on a non-text element', () => {
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    burst(screen.getByRole('button'), '2000000000017', 5, 10_000);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('2000000000017');
  });

  it('ignores slow typing outside inputs', () => {
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    burst(document.body, 'hello world', 200, 20_000);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not capture keystrokes typed into another text field', () => {
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    burst(screen.getByLabelText('Other field'), '2000000000017', 5, 30_000);
    expect(onScan).not.toHaveBeenCalled();
  });
});
