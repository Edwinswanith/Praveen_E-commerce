import { describe, expect, it } from 'vitest';
import { describeInterpretation } from './search';

describe('describeInterpretation', () => {
  it('describes extracted filters and the AI mode', () => {
    expect(
      describeInterpretation({
        semanticText: '',
        filters: { colors: ['black'], maxPrice: 1000 },
        mode: 'semantic',
        model: 'x',
      }),
    ).toBe('Showing black items under ₹1,000 · AI semantic search');
  });
  it('handles keyword fallback with price range, gender and sizes', () => {
    expect(
      describeInterpretation({
        semanticText: 'cotton shirt',
        filters: { gender: 'MEN', minPrice: 500, maxPrice: 2000, sizes: ['M'] },
        mode: 'keyword',
        model: null,
      }),
    ).toBe("Showing men's cotton shirt between ₹500 and ₹2,000 in size M · Keyword search");
  });
});
