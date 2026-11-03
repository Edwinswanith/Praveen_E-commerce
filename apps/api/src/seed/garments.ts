/**
 * Original flat-illustration product art for DEVELOPMENT SEED DATA only.
 * No stock photos are bundled; these SVGs are rasterised through the real
 * media pipeline (sharp → WebP) exactly like an admin upload. Replace with
 * real product photography before launch.
 */
export type GarmentKind = 'tshirt' | 'shirt' | 'jeans' | 'trousers' | 'kurta' | 'hoodie' | 'jacket' | 'dress' | 'top' | 'shorts' | 'cap' | 'bag' | 'joggers';

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `#${[c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const PATHS: Record<GarmentKind, (c: string, d: string) => string> = {
  tshirt: (c, d) => `<path d="M300 210 L400 170 Q450 215 500 170 L600 210 L690 330 L610 375 L585 335 L585 790 L315 790 L315 335 L290 375 L210 330 Z" fill="${c}"/><path d="M400 170 Q450 235 500 170 Q450 205 400 170" fill="${d}"/>`,
  shirt: (c, d) => `<path d="M310 205 L405 170 L450 215 L495 170 L590 205 L700 560 L630 580 L585 370 L585 800 L315 800 L315 370 L270 580 L200 560 Z" fill="${c}"/><path d="M405 170 L450 215 L495 170 L470 250 L450 230 L430 250 Z" fill="${d}"/><line x1="450" y1="230" x2="450" y2="800" stroke="${d}" stroke-width="4"/>${[300, 380, 460, 540, 620, 700].map((y) => `<circle cx="450" cy="${y}" r="7" fill="${d}"/>`).join('')}`,
  jeans: (c, d) => `<path d="M320 170 L580 170 L610 820 L480 820 L452 360 L422 820 L290 820 Z" fill="${c}"/><rect x="320" y="170" width="260" height="40" fill="${d}"/><path d="M340 215 Q380 280 330 290" stroke="${d}" stroke-width="5" fill="none"/><path d="M560 215 Q520 280 570 290" stroke="${d}" stroke-width="5" fill="none"/>`,
  trousers: (c, d) => `<path d="M325 170 L575 170 L595 820 L478 820 L450 330 L422 820 L305 820 Z" fill="${c}"/><rect x="325" y="170" width="250" height="34" fill="${d}"/><line x1="385" y1="230" x2="365" y2="820" stroke="${d}" stroke-width="3"/><line x1="515" y1="230" x2="535" y2="820" stroke="${d}" stroke-width="3"/>`,
  kurta: (c, d) => `<path d="M320 190 L410 160 Q450 200 490 160 L580 190 L670 430 L610 450 L575 330 L610 840 L290 840 L325 330 L290 450 L230 430 Z" fill="${c}"/><path d="M430 175 L450 330 L470 175" stroke="${d}" stroke-width="6" fill="none"/>${[230, 270, 310].map((y) => `<circle cx="450" cy="${y}" r="5" fill="${d}"/>`).join('')}<path d="M290 800 L610 800" stroke="${d}" stroke-width="10"/>`,
  hoodie: (c, d) => `<path d="M300 230 L370 190 Q450 120 530 190 L600 230 L700 620 L630 640 L590 400 L590 800 L310 800 L310 400 L270 640 L200 620 Z" fill="${c}"/><path d="M370 190 Q450 300 530 190 Q450 140 370 190" fill="${d}"/><rect x="360" y="560" width="180" height="110" rx="20" fill="${d}"/><line x1="430" y1="270" x2="425" y2="360" stroke="${d}" stroke-width="5"/><line x1="470" y1="270" x2="475" y2="360" stroke="${d}" stroke-width="5"/>`,
  jacket: (c, d) => `<path d="M300 210 L400 170 L450 260 L500 170 L600 210 L705 620 L635 640 L590 400 L590 800 L310 800 L310 400 L265 640 L195 620 Z" fill="${c}"/><path d="M400 170 L450 260 L500 170 L470 165 L450 210 L430 165 Z" fill="${d}"/><line x1="450" y1="260" x2="450" y2="800" stroke="${d}" stroke-width="6"/><rect x="340" y="520" width="80" height="12" fill="${d}"/><rect x="480" y="520" width="80" height="12" fill="${d}"/>`,
  dress: (c, d) => `<path d="M390 160 L420 160 Q450 200 480 160 L510 160 L540 360 L660 830 L240 830 L360 360 Z" fill="${c}"/><path d="M360 360 L540 360 L535 390 L365 390 Z" fill="${d}"/><path d="M300 830 Q450 790 600 830" stroke="${d}" stroke-width="6" fill="none"/>`,
  top: (c, d) => `<path d="M330 210 L410 180 Q450 220 490 180 L570 210 L650 330 L590 360 L565 320 L575 700 L325 700 L335 320 L310 360 L250 330 Z" fill="${c}"/><path d="M410 180 Q450 240 490 180" stroke="${d}" stroke-width="8" fill="none"/><path d="M325 660 Q450 690 575 660" stroke="${d}" stroke-width="6" fill="none"/>`,
  shorts: (c, d) => `<path d="M320 260 L580 260 L620 640 L480 660 L450 430 L420 660 L280 640 Z" fill="${c}"/><rect x="320" y="260" width="260" height="38" fill="${d}"/><line x1="440" y1="300" x2="430" y2="380" stroke="${d}" stroke-width="4"/>`,
  joggers: (c, d) => `<path d="M330 170 L570 170 L590 780 L485 780 L452 340 L418 780 L310 780 Z" fill="${c}"/><rect x="330" y="170" width="240" height="40" rx="10" fill="${d}"/><rect x="305" y="770" width="115" height="40" rx="12" fill="${d}"/><rect x="480" y="770" width="115" height="40" rx="12" fill="${d}"/><line x1="575" y1="230" x2="590" y2="760" stroke="${d}" stroke-width="10"/>`,
  cap: (c, d) => `<path d="M270 520 Q280 300 450 290 Q620 300 630 520 Z" fill="${c}"/><path d="M270 520 Q450 470 720 560 Q560 600 270 545 Z" fill="${d}"/><circle cx="450" cy="292" r="14" fill="${d}"/><path d="M450 300 L450 515" stroke="${d}" stroke-width="4"/>`,
  bag: (c, d) => `<path d="M340 330 Q340 200 450 200 Q560 200 560 330" stroke="${d}" stroke-width="22" fill="none"/><rect x="250" y="320" width="400" height="430" rx="34" fill="${c}"/><rect x="250" y="440" width="400" height="16" fill="${d}"/><rect x="420" y="425" width="60" height="46" rx="8" fill="${d}"/>`,
};

export function garmentSvg(kind: GarmentKind, hex: string, variant: 0 | 1, label: string): string {
  const light = parseInt(hex.slice(1), 16) > 0xcccccc;
  const body = light ? shade(hex, -0.06) : hex;
  const detail = shade(hex, light ? -0.22 : -0.16);
  const backgrounds = [['#F4F1EC', '#E9E4DC'], ['#EEF0F6', '#E1E5EF']] as const;
  const [bg1, bg2] = backgrounds[variant];
  const garment = PATHS[kind](body, detail);
  const transform = variant === 1 ? 'translate(900,0) scale(-1,1)' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1125" viewBox="0 0 900 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <radialGradient id="light" cx="0.35" cy="0.25" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#000000" stop-opacity="0.10"/></radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.16"/></filter>
  </defs>
  <rect width="900" height="1000" fill="url(#bg)"/>
  <ellipse cx="450" cy="900" rx="260" ry="26" fill="#000" opacity="0.06"/>
  <g filter="url(#sh)" transform="${transform}">${garment}</g>
  <g transform="${transform}" style="mix-blend-mode:soft-light">${garment.replace(/fill="#[0-9a-fA-F]{6}"/g, 'fill="url(#light)"')}</g>
  <text x="40" y="965" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#171717" opacity="0.55" letter-spacing="4">VYRA</text>
  <text x="860" y="965" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#171717" opacity="0.45">${label.replace(/[<&>]/g, '')}</text>
</svg>`;
}
