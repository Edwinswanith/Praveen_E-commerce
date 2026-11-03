/**
 * Deterministic natural-language query understanding for product search.
 * Extracts hard constraints (price, colour, gender, size) that become SQL
 * filters; the remaining text is embedded for semantic ranking.
 * Example: "comfortable oversized black cotton t-shirt for summer under 1000 rupees"
 *   -> { maxPrice: 1000, colors: ['black'], semanticText: 'comfortable oversized cotton t-shirt for summer' }
 */
export interface ParsedQuery {
  semanticText: string;
  minPrice?: number;
  maxPrice?: number;
  colors: string[];
  gender?: 'MEN' | 'WOMEN' | 'KIDS';
  sizes: string[];
}

export const KNOWN_COLORS = [
  'black', 'white', 'red', 'blue', 'navy', 'green', 'olive', 'yellow', 'mustard', 'pink', 'purple',
  'grey', 'gray', 'beige', 'brown', 'maroon', 'orange', 'cream', 'teal', 'lavender', 'khaki',
];

// Each number captures its own optional "k" suffix so "1k and 2,500" -> 1000..2500.
const NUM = String.raw`(?:rs\.?|inr|₹)?\s*(\d[\d,]*\s*(?:k\b)?)\s*(?:rs\.?|rupees?|inr|₹|\/-)?`;

function toNumber(raw: string): number {
  const n = Number(raw.replace(/[,\sk]/gi, ''));
  return /k$/i.test(raw.trim()) ? n * 1000 : n;
}

export function parseSearchQuery(input: string): ParsedQuery {
  let q = ` ${input.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const out: ParsedQuery = { semanticText: '', colors: [], sizes: [] };

  const between = new RegExp(String.raw`\b(?:between|from)\s+${NUM}\s*(?:and|to|-)\s*${NUM}`, 'i').exec(q);
  if (between) {
    out.minPrice = toNumber(between[1]!);
    out.maxPrice = toNumber(between[2]!);
    q = q.replace(between[0], ' ');
  }
  const under = new RegExp(String.raw`\b(?:under|below|less than|within|upto|up to|max|<)\s+${NUM}`, 'i').exec(q);
  if (under) {
    out.maxPrice = toNumber(under[1]!);
    q = q.replace(under[0], ' ');
  }
  const over = new RegExp(String.raw`\b(?:over|above|more than|min|>)\s+${NUM}`, 'i').exec(q);
  if (over) {
    out.minPrice = toNumber(over[1]!);
    q = q.replace(over[0], ' ');
  }

  for (const c of KNOWN_COLORS) {
    const re = new RegExp(`\\b${c}\\b`, 'g');
    if (re.test(q)) {
      out.colors.push(c === 'gray' ? 'grey' : c);
      q = q.replace(re, ' ');
    }
  }
  out.colors = [...new Set(out.colors)];

  if (/\b(women|womens|women's|ladies|girls?)\b/.test(q)) out.gender = /\bgirls?\b/.test(q) ? 'KIDS' : 'WOMEN';
  else if (/\b(men|mens|men's|gents)\b/.test(q)) out.gender = 'MEN';
  else if (/\b(kids?|boys?|children|child)\b/.test(q)) out.gender = 'KIDS';

  const size = /\bsize\s+(xxs|xs|s|m|l|xl|xxl|3xl|\d{2})\b/.exec(q);
  if (size) {
    out.sizes.push(size[1]!.toUpperCase());
    q = q.replace(size[0], ' ');
  }

  out.semanticText = q.replace(/\b(for|a|an|the|me|find|show|i want|looking for)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!out.semanticText) out.semanticText = input.trim();
  return out;
}
