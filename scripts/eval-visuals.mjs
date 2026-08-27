// Offline eval of the winning visual GENRES (P2 learning loop): for each genre target it renders
// 2 samples through the SAME production renderer (renderPostImage) and QC-critiques each through
// the SAME checklist used in production (critiqueImage replica — copied verbatim from
// content-preview.ts / image-agent.ts, do not paraphrase), then writes per-sample JSON and a
// comparison report (report.md) under strategy-runs/eval-visuals-<timestamp>/.
//
//   npx vite-node --config scripts/vite-node.config.ts scripts/eval-visuals.mjs [genresCsv] [samplesPerGenre]
//   npx vite-node --config scripts/vite-node.config.ts scripts/eval-visuals.mjs raw_ugc,cinematic 3
//   EVAL_DRY_RUN=1 npx vite-node --config scripts/vite-node.config.ts scripts/eval-visuals.mjs
//
// No auth and no DB writes: renderPostImage only gates credits inside a brand context, which a
// standalone script never sets (ai-log is fire-and-forget even without Supabase env). Requires
// GEMINI_API_KEY (or GOOGLE_API_KEY) in .env. EVAL_IMAGE_MODEL overrides the render model for all
// genres (cheap debugging); UGC genres default to the economy UGC_COVER_MODEL, the rest to the
// no-reference default. A failed sample never blocks the other genres.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { renderPostImage } from '../src/lib/server/content-preview';
import { structured } from '../src/lib/server/research';
import { UGC_COVER_MODEL, UGC_VISUAL_STYLE } from '../src/lib/server/ugc';

const BASE_PROMPT = 'the Capy60 keyboard on a sunlit walnut desk, morning light';

// One entry per genre target: how a genre-shaped brief would render for THIS brand.
const GENRES = {
  brand_studio: {
    label: 'Brand Studio',
    prompt: `${BASE_PROMPT}, clean premium product studio shot, soft diffused daylight, shallow depth of field, on-brand palette`
  },
  graphic_brand: {
    label: 'Graphic Brand',
    prompt: `${BASE_PROMPT}, bold editorial graphic style, confident layout, strong composition, brand-consistent palette`
  },
  cinematic: {
    label: 'Cinematic',
    prompt: `${BASE_PROMPT}, cinematic vertical still, warm rim light, film grain, anamorphic feel`,
    aspectRatio: '9:16'
  },
  raw_ugc: {
    label: 'Raw UGC',
    prompt: `${BASE_PROMPT}, handheld smartphone photo, imperfect framing, natural room light`,
    model: UGC_COVER_MODEL,
    visualStyle: UGC_VISUAL_STYLE
  },
  produced_ugc: {
    label: 'Produced UGC',
    prompt: `${BASE_PROMPT}, polished creator-style photo, balanced natural light, aspirational but believable`,
    model: UGC_COVER_MODEL
  },
  real_asset: {
    label: 'Real Asset',
    prompt: `${BASE_PROMPT}, looks like a real product photo, true-to-life textures, minimal post-processing`
  }
};

// critiqueImage checklist — copied verbatim from content-preview.ts (do not paraphrase).
const CRITIQUE_CHECKLIST = `1. PRODUCT FIDELITY: does the generated product match the REAL product reference (shape, TRUE colours, materials, finish, branding)? It must NOT be desaturated to greyscale, recoloured, redesigned, or swapped for a similar object.
2. PERSON FIDELITY: if a person should appear, they must look like the attached person REFERENCE photo(s) — same face, gender presentation, approximate age, hair. FAIL if the generated person clearly contradicts the references (e.g. wrong gender presentation vs the photos). Place them NATURALLY in the scene (not pasted into a reflection, not floating, not duplicated).
3. COMPOSITION: is it a believable, attractive product photo? Flag unnatural framing — e.g. the product reflected strangely, a person/animal appearing from nowhere, wrong scale (a macro crop of a large item), a repetitive "object on dark textured stone" stock backdrop, or obvious AI artifacts.
4. APPEAL: would this stop the scroll and look premium/on-brand?
5. GENERIC AI/STOCK LOOK: does it read as a generic AI render or interchangeable stock photo — over-saturated HDR glow, waxy skin, 3D-render sheen, sterile posing, garbled text, an image that could belong to any brand's feed? FAIL it if so: "technically correct but generic" is not publish-ready.
6. BRAND VISUAL STYLE: does the image match the brand's visual brief? Check palette, lighting, composition, mood, graphic language. Flag any deviation that makes this image feel off-brand.`;

// Same JSON contract as content-preview's CRITIQUE_SCHEMA.
const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true only if the image is publish-ready: attractive, faithful to the real product (and person, if any), AND free of the generic AI/stock look.' },
    score: { type: 'integer', description: 'Overall quality 1-10. 6 is the publish bar: below it the image is retried.' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Concrete problems: wrong product colour/shape, unnatural composition, wrong scale/crop, artifacts, generic AI/stock look.' },
    fixHint: { type: 'string', description: 'One concrete instruction to append to the image prompt on the retry to fix the biggest issue. Empty string if pass.' },
    brandStyleMatch: { type: 'boolean', description: 'true if the image faithfully matches the brand visual brief (palette, lighting, composition, mood)' }
  },
  required: ['pass', 'score', 'issues', 'fixHint']
};

/** Critique one rendered image against the brief using the production checklist. */
async function critique(ai, dataUrl, imagePrompt) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const promptText = `You are a strict art director doing QC on an AI-generated social post image. The attached image is the GENERATED image under review.

The image was generated from this brief:
"${imagePrompt}"

Judge it on:
${CRITIQUE_CHECKLIST}

Be honest and strict — a misleading product shot is worse than no image. Return JSON.`;
  // Same provider routing as production critiqueImage (MiMo vision tier, Gemini fallback).
  const parsed = await structured(ai, promptText, CRITIQUE_SCHEMA, undefined, {
    label: 'eval-visuals-critique',
    images: [{ inlineData: { mimeType: m[1], data: m[2] } }],
    provider: 'xiaomi'
  });
  const score = Number(parsed.score) || 0;
  return {
    score,
    verdict: parsed.pass === true ? 'pass' : 'fail',
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    fixHint: String(parsed.fixHint ?? '')
  };
}

function renderOptsFor(cfg, modelOverride) {
  const opts = {};
  if (cfg.aspectRatio) opts.aspectRatio = cfg.aspectRatio;
  if (cfg.visualStyle) opts.visualStyle = cfg.visualStyle;
  opts.model = modelOverride ?? cfg.model; // undefined → production default (no-ref → economy tier)
  return opts;
}

// ── Main ────────────────────────────────────────────────────────────────────
const [genreFilterArg, samplesArg] = process.argv.slice(2);
const genreFilter = (genreFilterArg ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const samplesPerGenre = Math.min(Math.max(Number(samplesArg ?? 2) || 2, 1), 5);

const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY (or GOOGLE_API_KEY) missing — set it in .env first.');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
const modelOverride = (env.EVAL_IMAGE_MODEL || '').trim() || undefined;

const genres = Object.keys(GENRES).filter((g) => !genreFilter.length || genreFilter.includes(g));
if (!genres.length) {
  console.error(`No matching genres. Available: ${Object.keys(GENRES).join(', ')}`);
  process.exit(1);
}

if (process.env.EVAL_DRY_RUN === '1') {
  console.log('[dry-run] imports resolved; would render:');
  for (const g of genres) console.log(`  - ${g} × ${samplesPerGenre} (model ${modelOverride ?? GENRES[g].model ?? 'default'})`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(process.cwd(), 'strategy-runs', `eval-visuals-${stamp}`);
mkdirSync(outDir, { recursive: true });
console.log(`Output: ${outDir}`);
console.log(`Genres: ${genres.join(', ')} × ${samplesPerGenre} sample(s)`);
console.log(`Model: ${modelOverride ?? '(production defaults — UGC on ' + UGC_COVER_MODEL + ')'}\n`);

const results = [];
for (const genre of genres) {
  const cfg = GENRES[genre];
  for (let s = 1; s <= samplesPerGenre; s++) {
    const started = Date.now();
    process.stdout.write(`[${genre} #${s}] render + critique… `);
    const sample = { genre, sample: s, prompt: cfg.prompt };
    try {
      const dataUrl = await renderPostImage(ai, cfg.prompt, renderOptsFor(cfg, modelOverride));
      sample.imageDataUrl = String(dataUrl ?? '').slice(0, 200);
      if (!dataUrl) throw new Error('render returned no image');
      const c = await critique(ai, dataUrl, cfg.prompt);
      if (!c) throw new Error('critique returned null');
      sample.score = c.score;
      sample.verdict = c.verdict;
      sample.issues = c.issues;
      sample.fixHint = c.fixHint;
      console.log(`ok — score ${c.score} (${c.verdict}) in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (e) {
      sample.score = null;
      sample.verdict = 'error';
      sample.issues = [e instanceof Error ? e.message : String(e)];
      console.log(`ERROR: ${sample.issues[0]}`);
    }
    results.push(sample);
    writeFileSync(
      join(outDir, `sample-${genre}-${String(s).padStart(2, '0')}.json`),
      JSON.stringify(sample, null, 2)
    );
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const byGenre = new Map();
for (const r of results) {
  if (r.score == null) continue;
  const g = byGenre.get(r.genre) ?? { scores: [], pass: 0 };
  g.scores.push(r.score);
  if (r.verdict === 'pass') g.pass += 1;
  byGenre.set(r.genre, g);
}
const table = [...byGenre.entries()]
  .map(([genre, g]) => ({
    genre,
    label: GENRES[genre]?.label ?? genre,
    mean: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
    pass: `${g.pass}/${g.scores.length}`,
    samples: g.scores.length
  }))
  .sort((a, b) => b.mean - a.mean);

const md = [
  `# Visual genres eval — ${stamp}`,
  '',
  `- Genres: ${genres.join(', ')}`,
  `- Samples per genre: ${samplesPerGenre}`,
  `- Base brief: \`${BASE_PROMPT}\``,
  `- Model: ${modelOverride ?? '(production defaults)'}`,
  `- Generated: ${new Date().toISOString()}`,
  '',
  '## Score by genre (mean of critique scores, 1-10)',
  '',
  '| Rank | Genre | Mean score | Pass | Samples |',
  '| --- | --- | --- | --- | --- |',
  ...table.map(
    (t, i) => `| ${i + 1} | ${t.label} (\`${t.genre}\`) | ${t.mean.toFixed(1)} | ${t.pass} | ${t.samples} |`
  ),
  '',
  '## Per-sample detail',
  ''
];
for (const r of results) {
  md.push(`### ${GENRES[r.genre]?.label ?? r.genre} — sample ${r.sample}`);
  md.push(`- **Score:** ${r.score ?? 'n/a'} · **Verdict:** ${r.verdict}`);
  md.push(`- **Prompt:** ${r.prompt}`);
  if (r.issues?.length) md.push(`- **Issues:** ${r.issues.join(' | ')}`);
  if (r.fixHint) md.push(`- **Fix hint:** ${r.fixHint}`);
  md.push('');
}
writeFileSync(join(outDir, 'report.md'), md.join('\n'));
writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    { genres, samplesPerGenre, basePrompt: BASE_PROMPT, modelOverride, generatedAt: new Date().toISOString(), results },
    null,
    2
  )
);

console.log(`\nDone. Inspect: ${outDir}`);
if (table.length) {
  console.log('\nGenre × mean score:');
  for (const t of table) console.log(`  ${t.mean.toFixed(1).padStart(4)}  ${t.label} (${t.pass} pass)`);
}
const errors = results.filter((r) => r.verdict === 'error');
if (errors.length) console.log(`\n${errors.length}/${results.length} samples failed (see JSON files).`);
