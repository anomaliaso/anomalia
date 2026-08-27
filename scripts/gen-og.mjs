// Generates static brand/SEO assets (favicon, app icons, OG cards) from inline SVG.
// Run with: bun scripts/gen-og.mjs   (uses @resvg/resvg-js to rasterize)
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'static');
mkdirSync(out, { recursive: true });

const VIOLET = '#c485fe';
const MAGENTA = 'rgb(236, 178, 237)';
const BG = '#0a0a0a';
const INK = '#f5f5f7';
const SOFT = '#a1a1a6';

// --- Favicon / app icon (square, brand mark with gradient) ---
const BRAND_PATH = 'M473.158 226.577C473.158 226.577 390.618 226.577 365.909 226.577C341.199 226.577 314.629 213.958 327.005 169.75C342.293 115.155 415.443 78.2267 473.158 78.2267C530.873 78.2267 604.023 115.155 619.311 169.75C631.697 213.958 605.116 226.577 580.407 226.577C555.698 226.577 473.158 226.577 473.158 226.577ZM49.0507 231.406C32.6058 231.301 16.1084 230.999 0 230.999V231.406V240.896V254.13H946.316V240.906V231.395V230.988C930.207 230.988 913.71 231.291 897.265 231.395H879.401C847.026 231.155 815.472 229.361 788.113 221.999C722.512 204.343 714.878 171.106 681.852 123.759C643.358 68.6113 577.505 0 473.158 0C368.811 0 302.958 68.6009 264.464 123.769C231.437 171.106 223.804 204.343 158.203 222.009C130.844 229.372 99.2896 231.166 66.915 231.406H49.0507ZM617.355 281.693H682.388C682.388 324.848 632.517 464 473.158 464C313.798 464 263.927 324.848 263.927 281.693H328.96C328.96 308.777 363.333 402.418 473.158 402.418C582.983 402.418 617.355 308.777 617.355 281.693Z';

const iconSvg = `<svg width="512" height="512" viewBox="0 0 947 947" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${VIOLET}"/>
      <stop offset="100%" stop-color="${MAGENTA}"/>
    </linearGradient>
  </defs>
  <g transform="translate(0,241.5)">
    <path fill-rule="evenodd" clip-rule="evenodd" d="${BRAND_PATH}" fill="url(#g)"/>
  </g>
</svg>`;

// --- OG card (1200x630). Headline differs per locale. ---
function ogSvg({ title1, title2, sub }) {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${VIOLET}"/>
      <stop offset="1" stop-color="${MAGENTA}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="-5%" r="75%">
      <stop offset="0" stop-color="#9d86ff" stop-opacity="0.28"/>
      <stop offset="62%" stop-color="#9d86ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${BG}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(80,78) scale(0.045)">
    <path fill-rule="evenodd" clip-rule="evenodd" d="${BRAND_PATH}" fill="url(#g)"/>
  </g>
  <text font-family="Arial, Helvetica, sans-serif" font-size="78" font-weight="700" fill="${INK}" letter-spacing="-2">
    <tspan x="80" y="290">${title1}</tspan>
    <tspan x="80" y="380">${title2}</tspan>
  </text>
  <text x="80" y="478" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="${SOFT}">${sub}</text>
  <rect x="80" y="556" width="54" height="6" rx="3" fill="url(#g)"/>
  <text x="148" y="566" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="${INK}">anomalia.so</text>
</svg>`;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPng(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

// favicon.svg (vector, modern browsers)
writeFileSync(join(out, 'favicon.svg'), iconSvg);

// raster icons
const icons = [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['favicon-48.png', 48],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512]
];
for (const [name, size] of icons) {
  writeFileSync(join(out, name), renderPng(iconSvg, size));
  console.log('wrote', name, size);
}

// OG cards (EN + IT + ES + FR)
const ogCards = {
  'og.png': ogSvg({
    title1: esc('An AI that runs'),
    title2: esc('your social media.'),
    sub: esc('It plans, creates and posts your content — you approve, it does the rest.')
  }),
  'og-it.png': ogSvg({
    title1: esc('Un’AI che gestisce'),
    title2: esc('i tuoi social.'),
    sub: esc('Pianifica, crea e pubblica i tuoi contenuti — tu approvi, al resto pensa lei.')
  }),
  'og-es.png': ogSvg({
    title1: esc('Una IA que gestiona'),
    title2: esc('tus redes sociales.'),
    sub: esc('Planifica, crea y publica tu contenido — tú apruebas, el resto lo hace ella.')
  }),
  'og-fr.png': ogSvg({
    title1: esc('Une IA qui gère'),
    title2: esc('vos réseaux sociaux.'),
    sub: esc('Elle planifie, crée et publie votre contenu — vous approuvez, elle s’occupe du reste.')
  })
};
for (const [name, svg] of Object.entries(ogCards)) {
  writeFileSync(join(out, name), renderPng(svg, 1200));
}
console.log('wrote', Object.keys(ogCards).join(', '), '1200x630');

// Web app manifest
const manifest = {
  name: 'Anomalia',
  short_name: 'Anomalia',
  description: 'An AI that runs your social media.',
  start_url: '/',
  display: 'standalone',
  background_color: '#0a0a0a',
  theme_color: '#c485fe',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }
  ]
};
writeFileSync(join(out, 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote site.webmanifest');
