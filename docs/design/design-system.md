# VYRA design system

Source: `packages/ui` (tokens in `src/styles/tokens.css` as a Tailwind v4 `@theme`, components in `src/components`).

## Brand
- **Wordmark** (`VyraLogo`): an original geometric "V" drawn as two strokes, violet `#7C3AED` under pink `#FF3F6C`, reading as a tick or "vibe" mark, followed by `YRA` in Manrope 800. Optional tagline lockup "WEAR YOUR VIBE." with wide tracking.
- **Voice**: energetic, inclusive, never shouty. Sentence case in UI; uppercase only for tiny labels and primary CTAs (`size="lg"`).

## Tokens
| Token | Value | Use |
| --- | --- | --- |
| `brand-500` | #FF3F6C | primary actions, sale %, active states |
| `violet-500` | #7C3AED | secondary accent (AI features, badges) |
| `sun-400` | #FFD166 | highlights, "Trending" |
| `teal-500` | #16A085 | success, "in stock" |
| `bg` / `surface` / `surface-2` | #FFF / #F8F8FA / #F1F1F4 | page / cards / hover |
| `fg` / `muted` / `subtle` | #171717 / #737373 / #A3A3A3 | text hierarchy |
| `border` / `border-strong` | #EAEAEA / #D4D4D4 | dividers / inputs |
| radius | 6 / 10 / 14 / 20 px | sm (chips) · md (inputs, buttons) · lg (cards) · xl (sheets) |
| shadow | `card`, `pop` | resting cards, popovers |
| motion | `ease-out-soft` 150–250ms; `prefers-reduced-motion` respected globally |

Type: **Manrope** (display, `font-display`) and **Inter** (body). Scale 12/14/16/20/24/32; avoid anything over 40px outside heroes.
Spacing: 4px grid; page gutters 16px mobile and 24–32px desktop.

## Components (packages/ui)
`Button` (primary · secondary · outline · ghost · subtle · danger · link; sizes sm/md/lg/icon; `loading`), `Input`, `Textarea`, `Label`, `Field` (label + error/hint with aria wiring), `Badge` (brand/violet/sun/teal/neutral/success/warning/danger/info), `Card*`, `Skeleton` (shimmer), `Spinner`, `EmptyState`, `Alert`, `Price` (₹ price + struck MRP + % OFF), `ColorDot`, `VyraLogo`.
App-specific compositions (ProductCard, FilterSheet, DataTable, Scanner…) live in each app's `src/components`.

## Rules
- One primary action per view. Brand pink means "do this"; never use it for decoration.
- Every async surface has a skeleton, an empty state and an error state with a retry.
- Gradients only on marketing heroes, at most one per screen.
- Tabular numerals for money in admin tables. Prices always come from `formatINR`.
- WCAG AA contrast; focus rings are always visible (`:focus-visible` brand outline).
