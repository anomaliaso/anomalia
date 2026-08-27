// Creatives for the "this ad made itself" campaign → static/ads/*.png
// Same recipe as gen-og.mjs: inline SVG + @resvg/resvg-js, system fonts, no new deps.
// Run with: node scripts/gen-ads.mjs
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'static/ads');
mkdirSync(out, { recursive: true });

const VIOLET = '#c485fe';
const PINK = 'rgb(236, 178, 237)';
const DARK = '#0a0a0a';
const INK = '#1d1d1f';
const PAPER = '#ffffff';
const PAPER2 = '#f5f5f7';
const SOFT = '#6e6e73';
const ON_DARK = '#f5f5f7';
const ON_DARK_SOFT = '#a1a1a6';

const F = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BRAND_PATH =
  'M473.158 226.577C473.158 226.577 390.618 226.577 365.909 226.577C341.199 226.577 314.629 213.958 327.005 169.75C342.293 115.155 415.443 78.2267 473.158 78.2267C530.873 78.2267 604.023 115.155 619.311 169.75C631.697 213.958 605.116 226.577 580.407 226.577C555.698 226.577 473.158 226.577 473.158 226.577ZM49.0507 231.406C32.6058 231.301 16.1084 230.999 0 230.999V231.406V240.896V254.13H946.316V240.906V231.395V230.988C930.207 230.988 913.71 231.291 897.265 231.395H879.401C847.026 231.155 815.472 229.361 788.113 221.999C722.512 204.343 714.878 171.106 681.852 123.759C643.358 68.6113 577.505 0 473.158 0C368.811 0 302.958 68.6009 264.464 123.769C231.437 171.106 223.804 204.343 158.203 222.009C130.844 229.372 99.2896 231.166 66.915 231.406H49.0507ZM617.355 281.693H682.388C682.388 324.848 632.517 464 473.158 464C313.798 464 263.927 324.848 263.927 281.693H328.96C328.96 308.777 363.333 402.418 473.158 402.418C582.983 402.418 617.355 308.777 617.355 281.693Z';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Brand mark, `w` px wide, top-left at (x,y). Mark is 947×464 in its own units. */
const mark = (x, y, w, fill) =>
  `<g transform="translate(${x},${y}) scale(${w / 947})"><path fill-rule="evenodd" clip-rule="evenodd" d="${BRAND_PATH}" fill="${fill}"/></g>`;

/** Stacked lines of text. `accent` is the 0-based index painted with the gradient. */
function stack(lines, x, baseline, fs, lh, fill, accent = -1) {
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${baseline + i * lh}" font-family='${F}' font-size="${fs}" font-weight="300" letter-spacing="${-fs * 0.03}" fill="${i === accent ? 'url(#g)' : fill}">${esc(l)}</text>`
    )
    .join('');
}

const defs = (W, H) => `<defs>
  <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}">
    <stop offset="0" stop-color="${VIOLET}"/><stop offset="1" stop-color="${PINK}"/>
  </linearGradient>
  <radialGradient id="glow" cx="50%" cy="0%" r="80%">
    <stop offset="0" stop-color="${VIOLET}" stop-opacity="0.30"/>
    <stop offset="70%" stop-color="${VIOLET}" stop-opacity="0"/>
  </radialGradient>
</defs>`;

/** Rounded CTA pill with centred label; returns svg + its measured width. */
function pill(x, y, label, fs, { bg = 'url(#g)', fg = DARK } = {}) {
  const padX = fs * 0.95;
  const w = label.length * fs * 0.56 + padX * 2;
  const h = fs * 2.5;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + fs * 0.36}" text-anchor="middle" font-family='${F}' font-size="${fs}" font-weight="600" letter-spacing="${-fs * 0.02}" fill="${fg}">${esc(label)}</text>`;
}

// ── Concept A — the claim, black canvas ─────────────────────────────────────────────────────────
function conceptA(W, H, c) {
  const pad = Math.round(W * 0.095);
  const fs = Math.round(W * 0.112);
  const lh = fs * 1.07;
  // Stacked from the bottom up so the claim sits low and the ratio only changes the empty top.
  const foot = H - pad;
  const sub = foot - W * 0.13;
  const top = sub - fs * 1.15 - (c.claim.length - 1) * lh;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${defs(W, H)}
  <rect width="${W}" height="${H}" fill="${DARK}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${mark(pad, pad, W * 0.13, 'url(#g)')}
  <text x="${pad}" y="${pad + W * 0.115}" font-family='${F}' font-size="${W * 0.026}" font-weight="600" letter-spacing="${W * 0.006}" fill="${ON_DARK_SOFT}">${esc(c.eyebrow.toUpperCase())}</text>
  ${stack(c.claim, pad, top, fs, lh, ON_DARK, c.claim.length - 1)}
  <text x="${pad}" y="${sub}" font-family='${F}' font-size="${W * 0.038}" font-weight="400" fill="${ON_DARK_SOFT}">${esc(c.sub)}</text>
  <rect x="${pad}" y="${foot - W * 0.021}" width="${W * 0.07}" height="${W * 0.008}" rx="${W * 0.004}" fill="url(#g)"/>
  <text x="${pad + W * 0.095}" y="${foot - W * 0.006}" font-family='${F}' font-size="${W * 0.032}" font-weight="600" fill="${ON_DARK}">anomalia.so</text>
  </svg>`;
}

// ── Concept B — the machine's own log ───────────────────────────────────────────────────────────
function conceptB(W, H, c) {
  const pad = Math.round(W * 0.095);
  const fs = Math.round(W * 0.085);
  const lh = fs * 1.08;
  const rowFs = Math.round(W * 0.036);
  const rowH = rowFs * 2.5;
  const rows = c.steps.length * rowH;
  const panelH = rows + rowFs * 1.6;
  // Bottom-up: CTA row, then the log panel, then the claim above it.
  const pillH = rowFs * 2.5;
  const pillY = H - pad - pillH;
  const panelTop = pillY - W * 0.055 - panelH;
  const claimTop = panelTop - W * 0.075 - (c.claim.length - 1) * lh;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${defs(W, H)}
  <rect width="${W}" height="${H}" fill="${PAPER2}"/>
  ${mark(pad, pad, W * 0.13, INK)}
  <text x="${pad}" y="${pad + W * 0.115}" font-family='${F}' font-size="${W * 0.026}" font-weight="600" letter-spacing="${W * 0.006}" fill="${SOFT}">${esc(c.eyebrow.toUpperCase())}</text>
  ${stack(c.claim, pad, claimTop, fs, lh, INK, c.claim.length - 1)}
  <rect x="${pad}" y="${panelTop}" width="${W - pad * 2}" height="${panelH}" rx="${W * 0.035}" fill="${PAPER}"/>
  ${c.steps
    .map((s, i) => {
      const y = panelTop + rowFs * 0.8 + rowH * i + rowH / 2;
      return `<circle cx="${pad + rowFs * 1.5}" cy="${y}" r="${rowFs * 0.62}" fill="url(#g)"/>
        <path d="M${pad + rowFs * 1.5 - rowFs * 0.26} ${y} l${rowFs * 0.2} ${rowFs * 0.22} l${rowFs * 0.34} -${rowFs * 0.42}" stroke="${PAPER}" stroke-width="${rowFs * 0.14}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="${pad + rowFs * 2.7}" y="${y + rowFs * 0.36}" font-family='${F}' font-size="${rowFs}" font-weight="500" fill="${INK}">${esc(s)}</text>`;
    })
    .join('')}
  ${pill(pad, pillY, c.cta, rowFs, { bg: INK, fg: PAPER })}
  <text x="${W - pad}" y="${pillY + pillH / 2 + rowFs * 0.36}" text-anchor="end" font-family='${F}' font-size="${rowFs}" font-weight="600" fill="${SOFT}">anomalia.so</text>
  </svg>`;
}

// ── Concept C — the ad, inside the ad ───────────────────────────────────────────────────────────
function conceptC(W, H, c) {
  const pad = Math.round(W * 0.085);
  const cardW = W - pad * 2;
  const cardX = pad;
  const cardY = pad;
  const headH = W * 0.15;
  const metaFs = Math.round(W * 0.03);
  const footH = W * 0.17;
  const fs = Math.round(W * 0.068);
  const lh = fs * 1.08;
  // Bottom-up again: the claim + sub own the bottom, the mock card takes whatever is left.
  const subY = H - pad - fs * 0.1;
  const claimTop = subY - W * 0.075 - (c.claim.length - 1) * lh;
  const cardH = claimTop - fs - W * 0.075 - cardY;
  const imgH = cardH - headH - footH;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${defs(W, H)}
  <rect width="${W}" height="${H}" fill="${PAPER2}"/>
  <!-- the mock ad preview: a smaller copy of the very ad you are looking at -->
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${W * 0.035}" fill="${PAPER}"/>
  <circle cx="${cardX + metaFs * 2}" cy="${cardY + headH / 2}" r="${metaFs * 1.25}" fill="${DARK}"/>
  ${mark(cardX + metaFs * 1.15, cardY + headH / 2 - metaFs * 0.42, metaFs * 1.7, 'url(#g)')}
  <text x="${cardX + metaFs * 4}" y="${cardY + headH / 2 - metaFs * 0.15}" font-family='${F}' font-size="${metaFs}" font-weight="700" fill="${INK}">Anomalia</text>
  <text x="${cardX + metaFs * 4}" y="${cardY + headH / 2 + metaFs * 1.15}" font-family='${F}' font-size="${metaFs * 0.88}" font-weight="400" fill="${SOFT}">${esc(c.sponsored)}</text>
  <g>
    <rect x="${cardX}" y="${cardY + headH}" width="${cardW}" height="${imgH}" fill="${DARK}"/>
    <rect x="${cardX}" y="${cardY + headH}" width="${cardW}" height="${imgH}" fill="url(#glow)"/>
    ${(() => {
      const ifs = fs * 0.86;
      const ilh = ifs * 1.06;
      const first = cardY + headH + imgH / 2 - ((c.inner.length - 1) * ilh) / 2 + ifs * 0.34;
      return c.inner
        .map(
          (l, i) =>
            `<text x="${cardX + metaFs * 1.6}" y="${first + i * ilh}" font-family='${F}' font-size="${ifs}" font-weight="300" letter-spacing="${-ifs * 0.03}" fill="${i === c.inner.length - 1 ? 'url(#g)' : ON_DARK}">${esc(l)}</text>`
        )
        .join('');
    })()}
  </g>
  <text x="${cardX + metaFs * 1.4}" y="${cardY + headH + imgH + metaFs * 2.1}" font-family='${F}' font-size="${metaFs * 1.15}" font-weight="700" fill="${INK}">${esc(c.cta)}</text>
  <text x="${cardX + metaFs * 1.4}" y="${cardY + headH + imgH + metaFs * 3.6}" font-family='${F}' font-size="${metaFs * 0.95}" font-weight="400" fill="${SOFT}">anomalia.so</text>
  ${stack(c.claim, pad, claimTop, fs, lh, INK, c.claim.length - 1)}
  <text x="${pad}" y="${subY}" font-family='${F}' font-size="${W * 0.034}" font-weight="400" fill="${SOFT}">${esc(c.sub)}</text>
  </svg>`;
}

// ── Copy ────────────────────────────────────────────────────────────────────────────────────────
const COPY = {
  it: {
    eyebrow: 'Generata in autonomia',
    sponsored: 'Sponsorizzato',
    a: {
      claim: ['Questa ads', 'è stata fatta', 'da un’AI.'],
      sub: 'Automatizza anche le tue.'
    },
    b: {
      claim: ['Nessuno', 'ha aperto', 'Photoshop.'],
      steps: [
        'Ha letto il brand',
        'Ha scritto la copy',
        'Ha generato la grafica',
        'Ha lanciato la campagna'
      ],
      cta: 'Automatizza anche le tue'
    },
    c: {
      claim: ['Questa ads', 'l’ha fatta Anomalia.'],
      sub: 'Da sola. Automatizza anche le tue.',
      inner: ['Questa ads', 'l’ha fatta', 'un’AI.'],
      cta: 'Automatizza anche le tue'
    }
  },
  en: {
    eyebrow: 'Made autonomously',
    sponsored: 'Sponsored',
    a: {
      claim: ['This ad', 'was made', 'by an AI.'],
      sub: 'Put yours on autopilot too.'
    },
    b: {
      claim: ['Nobody', 'opened', 'Photoshop.'],
      steps: ['Read the brand', 'Wrote the copy', 'Made the artwork', 'Launched the campaign'],
      cta: 'Automate yours too'
    },
    c: {
      claim: ['This ad', 'made itself.'],
      sub: 'Anomalia did. Automate yours too.',
      inner: ['This ad', 'was made', 'by an AI.'],
      cta: 'Automate yours too'
    }
  }
};

const SIZES = [
  ['1x1', 1080, 1080],
  ['4x5', 1080, 1350],
  ['9x16', 1080, 1920]
];

const CONCEPTS = [
  ['a-claim', conceptA, (c) => ({ ...c.a, eyebrow: c.eyebrow })],
  ['b-log', conceptB, (c) => ({ ...c.b, eyebrow: c.eyebrow })],
  ['c-inception', conceptC, (c) => ({ ...c.c, sponsored: c.sponsored })]
];

let n = 0;
for (const [lang, copy] of Object.entries(COPY)) {
  for (const [id, fn, pick] of CONCEPTS) {
    for (const [tag, W, H] of SIZES) {
      const svg = fn(W, H, pick(copy));
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
      writeFileSync(join(out, `${id}-${lang}-${tag}.png`), png);
      n++;
    }
  }
}
console.log(`ads: ${n} creatives → static/ads/`);
