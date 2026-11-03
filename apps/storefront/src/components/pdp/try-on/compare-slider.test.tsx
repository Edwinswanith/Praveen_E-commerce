import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CompareSlider } from './compare-slider';

function setup(initial = 50) {
  render(<CompareSlider beforeSrc="blob:a" afterSrc="data:image/webp;base64,AA" beforeAlt="before" afterAlt="after" initial={initial} />);
  return screen.getByRole('slider');
}

describe('CompareSlider', () => {
  it('is a focusable slider with an accessible value', () => {
    const s = setup();
    expect(s).toHaveAttribute('tabindex', '0');
    expect(s).toHaveAttribute('aria-valuemin', '0');
    expect(s).toHaveAttribute('aria-valuemax', '100');
    expect(s).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByAltText('before')).toBeInTheDocument();
    expect(screen.getByAltText('after')).toBeInTheDocument();
  });

  it('moves with arrow keys, PageUp/PageDown, Home/End and clamps to 0..100', () => {
    const s = setup();
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(s).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(s, { key: 'ArrowLeft' });
    fireEvent.keyDown(s, { key: 'ArrowLeft' });
    expect(s).toHaveAttribute('aria-valuenow', '45');
    fireEvent.keyDown(s, { key: 'PageUp' });
    expect(s).toHaveAttribute('aria-valuenow', '70');
    fireEvent.keyDown(s, { key: 'End' });
    expect(s).toHaveAttribute('aria-valuenow', '100');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(s).toHaveAttribute('aria-valuenow', '100');
    fireEvent.keyDown(s, { key: 'Home' });
    expect(s).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(s, { key: 'PageDown' });
    expect(s).toHaveAttribute('aria-valuenow', '0');
  });

  it('reveals the after image according to the position', () => {
    const s = setup(30);
    expect(screen.getByTestId('compare-after').style.clipPath).toBe('inset(0 70% 0 0)');
    fireEvent.keyDown(s, { key: 'End' });
    expect(screen.getByTestId('compare-after').style.clipPath).toBe('inset(0 0% 0 0)');
  });
});
