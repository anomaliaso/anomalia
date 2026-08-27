/**
 * Optimize talent JPGs → WebP, upload to `talent` bucket, upsert DB rows.
 * Usage: node scripts/talent/save.mjs <slug>
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = 'talent';
const MAX_EDGE = 1600;
const WEBP_QUALITY = 82;

const VIEWS = [
  { file: '01-face-front.jpg', view_key: 'face-front', label: 'Viso · Frontale', aspect_ratio: '3:4', sort_order: 10 },
  { file: '02-body-front.jpg', view_key: 'body-front', label: 'Corpo · Frontale', aspect_ratio: '3:4', sort_order: 20 },
  { file: '03-face-three-quarter.jpg', view_key: 'face-three-quarter', label: 'Viso · ¾', aspect_ratio: '3:4', sort_order: 30 },
  { file: '04-face-profile.jpg', view_key: 'face-profile', label: 'Viso · Profilo', aspect_ratio: '3:4', sort_order: 40 },
  { file: '05-hands-detail.jpg', view_key: 'hands-detail', label: 'Mani', aspect_ratio: '1:1', sort_order: 50 },
  { file: '06-body-three-quarter.jpg', view_key: 'body-three-quarter', label: 'Corpo · ¾', aspect_ratio: '3:4', sort_order: 60 },
  { file: '07-body-back.jpg', view_key: 'body-back', label: 'Corpo · Schiena', aspect_ratio: '3:4', sort_order: 70 }
];

async function optimizeToWebp(srcPath, destPath) {
  const img = sharp(srcPath).rotate();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const long = Math.max(w, h);
  const pipeline =
    long > MAX_EDGE
      ? img.resize({
          width: w >= h ? MAX_EDGE : undefined,
          height: h > w ? MAX_EDGE : undefined,
          fit: 'inside',
          withoutEnlargement: true
        })
      : img;

  const { data, info } = await pipeline
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer({ resolveWithObject: true });

  writeFileSync(destPath, data);
  return {
    buffer: data,
    width: info.width,
    height: info.height,
    bytes: data.length,
    mimeType: 'image/webp'
  };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/talent/save.mjs <slug>');
    process.exit(1);
  }

  const url = process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const charPath = join(__dirname, 'characters', `${slug}.mjs`);
  const { default: character } = await import(pathToFileURL(charPath).href);
  const inDir = process.env.TALENT_IN || join(__dirname, '../../artifacts/talent', slug);
  const optDir = join(inDir, 'optimized');

  if (!existsSync(inDir)) {
    console.error(`Input dir missing: ${inDir}`);
    process.exit(1);
  }
  mkdirSync(optDir, { recursive: true });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log(`Optimizing from ${inDir}…`);
  const prepared = [];
  let rawBytes = 0;
  let optBytes = 0;

  for (const view of VIEWS) {
    const src = join(inDir, view.file);
    if (!existsSync(src)) {
      console.error(`Missing ${src}`);
      process.exit(1);
    }
    const srcBytes = readFileSync(src).length;
    rawBytes += srcBytes;
    const dest = join(optDir, `${view.view_key}.webp`);
    const opt = await optimizeToWebp(src, dest);
    const path = `${slug}/${view.view_key}.webp`;
    optBytes += opt.bytes;
    console.log(
      `  ✓ ${view.view_key}: ${opt.width}×${opt.height}, ${(opt.bytes / 1024).toFixed(0)} KB (−${((1 - opt.bytes / srcBytes) * 100).toFixed(0)}%)`
    );
    prepared.push({ view, opt, path });
  }

  console.log(
    `\nSize: ${(rawBytes / 1024 / 1024).toFixed(2)} MB → ${(optBytes / 1024 / 1024).toFixed(2)} MB (−${((1 - optBytes / rawBytes) * 100).toFixed(0)}%)`
  );

  console.log(`\nUploading to storage bucket "${BUCKET}"…`);
  for (const row of prepared) {
    const { error } = await supabase.storage.from(BUCKET).upload(row.path, row.opt.buffer, {
      contentType: row.opt.mimeType,
      upsert: true,
      cacheControl: '31536000'
    });
    if (error) {
      console.error(`  ✗ upload ${row.path}: ${error.message}`);
      process.exit(1);
    }
    console.log(`  ✓ ${row.path}`);
  }

  console.log('\nUpserting talents…');
  const { data: talent, error: talentErr } = await supabase
    .from('talents')
    .upsert(
      {
        slug: character.slug,
        name: character.name,
        gender: character.gender,
        age: character.age,
        body_type: character.body_type ?? character.body ?? null,
        height_band: character.height_band ?? null,
        ethnicity: character.ethnicity,
        summary: character.summary,
        traits: character.traits,
        status: 'active',
        updated_at: new Date().toISOString()
      },
      { onConflict: 'slug' }
    )
    .select('id, slug, name')
    .single();

  if (talentErr || !talent) {
    console.error('Talent upsert failed:', talentErr?.message);
    process.exit(1);
  }
  console.log(`  ✓ talent ${talent.slug} (${talent.id})`);

  const viewRows = prepared.map(({ view, opt, path }) => ({
    talent_id: talent.id,
    view_key: view.view_key,
    label: view.label,
    aspect_ratio: view.aspect_ratio,
    path,
    mime_type: opt.mimeType,
    width: opt.width,
    height: opt.height,
    bytes: opt.bytes,
    sort_order: view.sort_order
  }));

  const { error: viewsErr } = await supabase.from('talent_views').upsert(viewRows, {
    onConflict: 'talent_id,view_key'
  });
  if (viewsErr) {
    console.error('Views upsert failed:', viewsErr.message);
    process.exit(1);
  }
  console.log(`  ✓ ${viewRows.length} views`);

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      prepared.map((p) => p.path),
      3600
    );

  writeFileSync(
    join(inDir, 'save-report.json'),
    JSON.stringify(
      {
        talent,
        views: viewRows,
        signedUrls: (signed ?? []).map((s) => ({ path: s.path, signedUrl: s.signedUrl })),
        savings: { rawBytes, optBytes }
      },
      null,
      2
    )
  );
  console.log(`\nDone.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
