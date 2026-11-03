/**
 * SKU format: VY-<CAT3>-<PRODUCT SEQ 5>-<COLOR3>-<SIZE>
 * e.g. VY-TSH-00042-BLK-M. Human-readable, sortable, unique per variant.
 */
const COLOR_CODES: Record<string, string> = {
  black: 'BLK', white: 'WHT', red: 'RED', blue: 'BLU', navy: 'NVY', green: 'GRN', olive: 'OLV',
  yellow: 'YLW', mustard: 'MST', pink: 'PNK', purple: 'PRP', grey: 'GRY', gray: 'GRY', beige: 'BGE',
  brown: 'BRN', maroon: 'MRN', orange: 'ORG', cream: 'CRM', teal: 'TEL', lavender: 'LVD', khaki: 'KHK',
};

function code(input: string, len: number): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return 'X'.repeat(len);
  if (clean.length <= len) return clean.padEnd(len, 'X');
  // Consonant-preferring abbreviation keeps codes recognisable (SHIRT -> SHR).
  const first = clean[0]!;
  const consonants = clean.slice(1).replace(/[AEIOU]/g, '');
  return (first + consonants + clean.slice(1)).slice(0, len);
}

export function colorCode(color: string): string {
  return COLOR_CODES[color.trim().toLowerCase()] ?? code(color, 3);
}

export function sizeCode(size: string): string {
  return size.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'OS';
}

export function generateSku(params: { categoryCode: string; productSeq: number; color: string; size: string }): string {
  if (!Number.isInteger(params.productSeq) || params.productSeq <= 0) throw new Error('productSeq must be a positive integer');
  return ['VY', code(params.categoryCode, 3), String(params.productSeq).padStart(5, '0'), colorCode(params.color), sizeCode(params.size)].join('-');
}
