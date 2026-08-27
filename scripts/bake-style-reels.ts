/**
 * Bake short 3:4 MP4 reels for the /styles grid (no Remotion mount in the page).
 *
 * Builds a StyleReel-like motion plate with sharp (SVG frames) + ffmpeg-static.
 * Does NOT need Google Fonts / satori — works offline.
 *
 *   FORCE=1 npx vite-node --config scripts/vite-node.config.ts scripts/bake-style-reels.ts
 *   FORCE=1 npx vite-node --config scripts/vite-node.config.ts scripts/bake-style-reels.ts editoriale aria
 *
 * Output: static/styles/reels/{slug}-3x4.mp4
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { STYLE_PRESETS } from '../src/lib/design/presets/index.ts';

const require = createRequire(import.meta.url);
const ffmpegPath: string = require('ffmpeg-static');

const OUT_DIR = join(process.cwd(), 'static/styles/reels');
const W = 540;
const H = 720;
const FPS = 30;
const SECONDS = 4;
const FRAMES = FPS * SECONDS;

mkdirSync(OUT_DIR, { recursive: true });

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function frameSvg(
  t: number,
  opts: { bg: string; ink: string; accent: string; muted: string; brand: string; headline: string; sub: string }
) {
  const enter = easeOutCubic(Math.min(1, t / 0.35));
  const accentIn = easeOutCubic(Math.max(0, Math.min(1, (t - 0.15) / 0.4)));
  const titleIn = easeOutCubic(Math.max(0, Math.min(1, (t - 0.28) / 0.4)));
  const hold = Math.max(0, Math.min(1, (t - 2.2) / 0.6));

  const blobR = Math.round(150 * (0.55 + 0.45 * accentIn));
  const titleY = Math.round(240 + (1 - titleIn) * 28);
  const lines = opts.headline.split('\n').filter(Boolean);

  const dots = Array.from({ length: 16 }, (_, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 36 + col * 18;
    const y = 36 + row * 18;
    return `<circle cx="${x}" cy="${y}" r="4" fill="${opts.accent}" opacity="${enter}"/>`;
  }).join('');

  const title = lines
    .map(
      (line, i) =>
        `<text x="36" y="${titleY + i * 52}" font-family="Arial Black, Helvetica, sans-serif" font-size="46" font-weight="700" fill="${opts.ink}" opacity="${titleIn}">${escapeXml(line)}</text>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="${opts.bg}"/>
  <circle cx="${W - 40}" cy="${Math.round(H * 0.28)}" r="${blobR}" fill="${opts.accent}" opacity="${0.92 * accentIn}"/>
  ${dots}
  <text x="36" y="${titleY - 36}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="2" fill="${opts.accent}" opacity="${titleIn}">${escapeXml(opts.brand.toUpperCase())}</text>
  ${title}
  <foreignObject x="36" y="${titleY + lines.length * 52 + 8}" width="${W - 80}" height="80">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.35;color:${opts.muted};opacity:${titleIn}">${escapeXml(opts.sub)}</div>
  </foreignObject>
  <text x="36" y="${H - 40}" font-family="Arial Black, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${opts.ink}" opacity="${hold}">@yourbrand</text>
  <rect x="${W - 78}" y="${H - 62}" width="42" height="36" fill="${opts.accent}" opacity="${hold}"/>
  <text x="${W - 57}" y="${H - 38}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="${opts.bg}" opacity="${hold}">→</text>
</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function bakeOne(slug: string) {
  const preset = STYLE_PRESETS.find((p) => p.slug === slug);
  if (!preset) throw new Error(`unknown ${slug}`);

  const outMp4 = join(OUT_DIR, `${slug}-3x4.mp4`);
  const frameDir = join(OUT_DIR, `_${slug}-frames`);
  mkdirSync(frameDir, { recursive: true });

  const reel = preset.reel;
  const headline = 'Most content\nnever gets\nread';
  const sub = 'And almost always the reason is not the writing.';

  for (let i = 0; i < FRAMES; i++) {
    const t = i / FPS;
    const svg = frameSvg(t, {
      bg: reel.bg,
      ink: reel.ink,
      accent: reel.accent,
      muted: reel.muted,
      brand: preset.name,
      headline,
      sub
    });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    writeFileSync(join(frameDir, `f-${String(i).padStart(4, '0')}.png`), png);
  }

  const args = [
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    join(frameDir, 'f-%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    outMp4
  ];
  const res = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  rmSync(frameDir, { recursive: true, force: true });
  if (res.status !== 0) {
    console.error(res.stderr?.slice(-1200));
    throw new Error(`ffmpeg failed for ${slug}`);
  }
  const kb = Math.round(readFileSync(outMp4).byteLength / 1024);
  console.log('ok', slug, `${kb}KB`);
}

const only = process.argv.slice(2);
const list = only.length ? only : STYLE_PRESETS.map((p) => p.slug);

for (const slug of list) {
  if (!STYLE_PRESETS.some((p) => p.slug === slug)) continue;
  if (existsSync(join(OUT_DIR, `${slug}-3x4.mp4`)) && process.env.FORCE !== '1') {
    console.log('skip', slug);
    continue;
  }
  await bakeOne(slug);
}

console.log('done', list.length);
