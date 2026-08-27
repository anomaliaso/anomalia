/**
 * One-shot: generate a single ≤15s UGC talking video for a brand via the Media Generator agent
 * (same renderVideo / buildVideoPrompt / buildUgcShotBrief path as posts).
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/test-ugc-media-generator.ts [brandId]
 *
 * Pins mobile UI screenshots from the brand Media library so the cover shows a real phone
 * screen (Case B — refs as product fidelity, not photos to edit).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { streamMediaGenerator } from '../src/lib/server/media-generator/agent';
import { SEEDANCE_25_MODEL } from '../src/lib/video-models';
import { spokenWordCount } from '../src/lib/server/video';

const brandId = process.argv[2] ?? '22bf9fdc-9fcd-4f8c-a6e0-54cfa7ffec37';
const admin = createAdminClient();

const { data: brand, error } = await admin
  .from('brands')
  .select('id, name, slug, status, plan')
  .eq('id', brandId)
  .maybeSingle();
if (error || !brand) {
  console.error('brand not found', brandId, error?.message);
  process.exit(1);
}

const { data: member } = await admin
  .from('brand_members')
  .select('user_id')
  .eq('brand_id', brand.id)
  .limit(1)
  .maybeSingle();
const userId = member?.user_id;
if (!userId) {
  console.error('no brand member for', brand.slug);
  process.exit(1);
}

// Prefer catalogued mobile UI screenshots from the brand Media library.
const { data: libraryRows, error: libErr } = await admin
  .from('brand_media')
  .select(
    'id, title, description, tags, subjects, media_kind, catalog_status, file_name, width, height'
  )
  .eq('brand_id', brand.id)
  .eq('kind', 'image')
  .eq('catalog_status', 'ready')
  .order('created_at', { ascending: false })
  .limit(40);
if (libErr) {
  console.error('brand_media list failed', libErr.message);
  process.exit(1);
}

const isMobileUi = (r: {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  subjects?: string[] | null;
  media_kind?: string | null;
  file_name?: string | null;
}) => {
  const blob = [
    r.title,
    r.description,
    r.media_kind,
    r.file_name,
    ...(r.tags ?? []),
    ...(r.subjects ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    /\bui\b/.test(blob) ||
    blob.includes('screenshot') ||
    blob.includes('mobile') ||
    blob.includes('app interface') ||
    (r.file_name ?? '').toLowerCase().startsWith('ui-') ||
    (r.file_name ?? '').toLowerCase().startsWith('img_')
  );
};

const uiRows = (libraryRows ?? []).filter(isMobileUi);
if (!uiRows.length) {
  console.error('[ugc-mg] FAIL — no mobile UI assets in brand media library');
  process.exit(1);
}

// Two refs → Case B (product fidelity). Prefer calendar / overview for the posting script.
const prefer = (re: RegExp) => uiRows.find((r) => re.test(`${r.title ?? ''} ${r.file_name ?? ''}`));
const primary =
  prefer(/calendar|content calendar|overview/i) ??
  prefer(/^UI ·/i) ??
  uiRows[0]!;
const secondary =
  uiRows.find((r) => r.id !== primary.id && /overview|radar|media generator|blog/i.test(`${r.title ?? ''}`)) ??
  uiRows.find((r) => r.id !== primary.id) ??
  null;
const mediaIds = [primary.id, ...(secondary ? [secondary.id] : [])].slice(0, 2);

// Concise PAS for ≤15s — personal/emotional, fits showing the calendar UI on phone.
const spoken = [
  'I was still writing captions at midnight and nothing had posted.',
  'It was eating my evenings — then Anomalia drafted the visuals and the copy, I just tap approve.',
  "Anyway try it and tell me I'm wrong."
].join(' ');

const prompt = `Produce ONE vertical 9:16 UGC talking-head video (kind=video only).

This is Case B — NEW scene. The attached Media library images are PRODUCT UI screenshots (phone app screens), NOT photos to edit in place. Do NOT call generate_image with baseRefIndex. Do NOT turn the UI screenshot into the full frame.

Requirements:
- First generate_image: a candid UGC selfie cover of a real person in a real room, chest-up 9:16, holding their phone so the SCREEN clearly shows the Anomalia mobile UI from Ref 0 (match that screenshot's layout/UI — Content Calendar / app UI). Casual grip, not a polished product demo. No on-image text overlays beyond what's on the phone screen.
- Then generate_video with ugc:true, durationSeconds=15, coverImageUrl from that still
- Spoken script (exact, do not rewrite or expand): "${spoken}"
- generate_video prompt = subject/camera/audio/timeline shot brief (not a vibe paragraph)
- PAS performance in 15s: PROBLEM frustration → AGITATE cost → SOLUTION relief (phone/UI visible as the fix) → soft CTA
- Expressive face (brows knit on the problem, shoulders drop / softer eyes on the solution)
- No music, no burned-in captions/subtitles
- Finish with finish() when the video URL is ready

Primary library UI: ${primary.title ?? primary.file_name ?? primary.id}
${secondary ? `Secondary library UI (fidelity only): ${secondary.title ?? secondary.file_name ?? secondary.id}` : ''}`;

console.log(`[ugc-mg] brand=${brand.slug} (${brand.id}) user=${userId}`);
console.log(`[ugc-mg] model=${SEEDANCE_25_MODEL}`);
console.log(`[ugc-mg] script words=${spokenWordCount(spoken)} (must finish in 15s)`);
console.log(
  `[ugc-mg] library UI mediaIds=${mediaIds.join(', ')} primary="${primary.title ?? primary.file_name}"`
);

const result = await streamMediaGenerator({
  supabase: admin,
  userId,
  brandId: brand.id,
  prompt,
  aspectRatio: '9:16',
  kind: 'video',
  variants: 1,
  useBrandStyle: false,
  videoModel: SEEDANCE_25_MODEL,
  mediaIds
});

const events: unknown[] = [];
const videos: Array<{ url: string; prompt?: string; id?: string; duration?: number }> = [];
const images: Array<{
  url: string;
  prompt?: string;
  id?: string;
  used_base_photo?: boolean;
  base_ref_index?: number | null;
}> = [];
let summary = '';

for await (const part of result.fullStream) {
  events.push(part);
  const t = (part as { type?: string }).type;
  if (t === 'tool-result') {
    const tr = part as {
      toolName?: string;
      result?: Record<string, unknown>;
      output?: Record<string, unknown>;
    };
    const out = (tr.result ?? tr.output ?? {}) as Record<string, unknown>;
    const name = tr.toolName ?? '';
    console.log(`[tool] ${name}`, JSON.stringify(out).slice(0, 500));
    if (name === 'generate_video' && out.ok && typeof out.url === 'string') {
      videos.push({
        url: out.url,
        prompt: String(out.prompt ?? ''),
        id: String(out.id ?? ''),
        duration: typeof out.duration === 'number' ? out.duration : undefined
      });
    }
    if (name === 'generate_image' && out.ok && typeof out.url === 'string') {
      images.push({
        url: out.url,
        prompt: String(out.prompt ?? ''),
        id: String(out.id ?? ''),
        used_base_photo: out.used_base_photo === true,
        base_ref_index: typeof out.base_ref_index === 'number' ? out.base_ref_index : null
      });
    }
    if (name === 'finish' && typeof out.summary === 'string') summary = out.summary;
  } else if (t === 'text-delta') {
    const d = (part as { textDelta?: string; text?: string }).textDelta ?? (part as { text?: string }).text;
    if (d) process.stdout.write(d);
  } else if (t === 'error') {
    console.error('\n[stream error]', part);
  }
}

console.log('\n[ugc-mg] done');
console.log('[ugc-mg] images=', images.length, 'videos=', videos.length);
if (summary) console.log('[ugc-mg] summary=', summary);

const outDir = join(process.cwd(), 'artifacts');
mkdirSync(outDir, { recursive: true });
const report = {
  brand,
  userId,
  spoken,
  mediaIds,
  libraryUi: mediaIds.map((id) => (libraryRows ?? []).find((r) => r.id === id) ?? { id }),
  images,
  videos,
  summary,
  eventTypes: events.map((e) => (e as { type?: string }).type)
};
writeFileSync(join(outDir, 'ugc-media-generator-report.json'), JSON.stringify(report, null, 2));
console.log('[ugc-mg] wrote artifacts/ugc-media-generator-report.json');

if (!videos.length) {
  console.error('[ugc-mg] FAIL — no video produced');
  process.exit(2);
}

const v = videos[0]!;
console.log('[ugc-mg] video url=', v.url);
console.log('[ugc-mg] duration=', v.duration);
console.log('[ugc-mg] cover used_base_photo=', images[0]?.used_base_photo, 'base_ref=', images[0]?.base_ref_index);
console.log('[ugc-mg] prompt head=', (v.prompt ?? '').slice(0, 500));
if (v.duration != null && v.duration > 15) {
  console.error('[ugc-mg] FAIL — UGC duration exceeded 15s');
  process.exit(3);
}
process.exit(0);

