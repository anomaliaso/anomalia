// One-off: Nano Banana Pro stills for /insights/gemini-3-7-flash.
// Run: node scripts/gen-insights-gemini-images.mjs
import { GoogleGenAI } from '@google/genai';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'static/insights');
mkdirSync(outDir, { recursive: true });

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const MODEL = 'gemini-3-pro-image-preview';

const SHARED =
  'Editorial commercial photography, 16:9 landscape, magazine-quality. Soft natural light, ' +
  'warm muted palette with a gentle lilac/violet (#c485fe) undertone in props and grading. ' +
  'Shallow depth of field, real lens, true materials, candid not stock-posed. ' +
  'Absolutely NO text, letters, words, numbers, logos, watermarks, UI chrome, or readable screens. ' +
  'No garbled letterforms. No 3D-render sheen, no waxy skin, no HDR glow.';

const JOBS = [
  {
    out: 'gemini-37-glance.webp',
    prompt:
      'A close candid of a person in a sunlit cafe glancing at a smartphone held at chest height. ' +
      'The phone screen is a full-bleed colorful product photograph (a small object on a table), ' +
      'not a wall of type — they are looking at the picture, not reading. Hands and phone sharp, ' +
      'face slightly soft. Warm wood table, ceramic cup out of focus. The mood is a one-second glance in a feed. ' +
      SHARED
  },
  {
    out: 'gemini-37-look.webp',
    prompt:
      'Over-the-shoulder of a founder at a pale oak desk reviewing printed social creatives spread out: ' +
      'a product still, a freeze-frame from a short video, a few square photos. They are looking at the pictures, ' +
      'not at a laptop full of copy. Soft window light from the left, a faint lilac notebook, calm and precise. ' +
      'No readable print, no logos. ' +
      SHARED
  },
  {
    out: 'gemini-37-hold.webp',
    prompt:
      'Late evening kitchen table. An open laptop shows a blurred preview of a social post about to go live ' +
      '(shapes and color only — no letters). A person sits still, one hand near the trackpad, unhurried. ' +
      'Warm lamp, cool screen glow, a mug, quiet last-mile check before publish. Intimate, not dramatic. ' +
      SHARED
  }
];

async function generate(job) {
  process.stdout.write(`generating ${job.out}… `);
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: job.prompt }] }],
    config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } }
  });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) {
    const text = parts.filter((p) => p.text).map((p) => p.text).join(' ');
    throw new Error(`no image: ${text.slice(0, 240) || res.candidates?.[0]?.finishReason || 'empty'}`);
  }
  const raw = Buffer.from(img.inlineData.data, 'base64');
  const webp = await sharp(raw).webp({ quality: 82 }).toBuffer();
  writeFileSync(join(outDir, job.out), webp);
  console.log(`ok (${Math.round(webp.length / 1024)}KB)`);
}

for (const job of JOBS) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generate(job);
      last = null;
      break;
    } catch (e) {
      last = e;
      console.log(`attempt ${attempt} failed: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (last) throw last;
}
