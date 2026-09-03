/**
 * Brand media library — upload metadata + AI catalog so agents know what each asset is
 * and when/how/where to reuse it (posts, blog, references).
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { genaiClient, fetchImagePart } from '$lib/server/brand-context';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { structured } from '$lib/server/research';

const BUCKET = 'brand-knowledge';

export type BrandMediaKind = 'image' | 'video';

export type BrandMediaRow = {
  id: string;
  brand_id: string;
  user_id: string;
  kind: BrandMediaKind;
  storage_path: string;
  url: string;
  source: string;
  source_ref: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  file_name: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  subjects: string[] | null;
  colors: string[] | null;
  mood: string | null;
  media_kind: string | null;
  suggested_use: string | null;
  when_to_use: string | null;
  how_to_use: string | null;
  where_to_use: string | null;
  catalog_status: 'pending' | 'ready' | 'failed';
  catalog_error: string | null;
  cataloged_at: string | null;
  duration_seconds: number | null;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandMediaListItem = BrandMediaRow & { signed_url: string | null };

const CATALOG_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const },
    description: { type: 'string' as const },
    tags: { type: 'array' as const, items: { type: 'string' as const } },
    subjects: { type: 'array' as const, items: { type: 'string' as const } },
    colors: { type: 'array' as const, items: { type: 'string' as const } },
    mood: { type: 'string' as const },
    media_kind: {
      type: 'string' as const,
      description: 'photo | illustration | logo | product | person | graphic | video | other'
    },
    suggested_use: { type: 'string' as const },
    when_to_use: { type: 'string' as const },
    how_to_use: { type: 'string' as const },
    where_to_use: { type: 'string' as const }
  },
  required: [
    'title',
    'description',
    'tags',
    'subjects',
    'media_kind',
    'suggested_use',
    'when_to_use',
    'how_to_use',
    'where_to_use'
  ]
};

type CatalogResult = {
  title: string;
  description: string;
  tags: string[];
  subjects: string[];
  colors?: string[];
  mood?: string;
  media_kind: string;
  suggested_use: string;
  when_to_use: string;
  how_to_use: string;
  where_to_use: string;
};

function asStringArray(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function inferKind(mime: string): BrandMediaKind {
  return mime.startsWith('video/') ? 'video' : 'image';
}

/** Probe width/height for images via sharp; best-effort. */
export async function probeImageDimensions(
  buf: Buffer
): Promise<{ width: number | null; height: number | null }> {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Le righe di libreria che appartengono DAVVERO a questo brand, fra quelle chieste. Chi chiama
 * confronta con la lista che ha mandato: un id che manca è di un altro brand o non esiste, e la
 * differenza fra i due non va detta a chi chiede — sarebbe un modo per sondare gli id altrui.
 */
export async function findBrandMediaByIds(
  supabase: SupabaseClient,
  brandId: string,
  ids: string[]
): Promise<BrandMediaRow[]> {
  if (!ids.length) return [];
  const { data } = await supabase
    .from('brand_media')
    .select('*')
    .eq('brand_id', brandId)
    .in('id', ids);
  return (data ?? []) as BrandMediaRow[];
}

export async function listBrandMedia(
  supabase: SupabaseClient,
  brandId: string,
  opts: { limit?: number; status?: string; query?: string } = {}
): Promise<BrandMediaListItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  let q = supabase
    .from('brand_media')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.status) q = q.eq('catalog_status', opts.status);

  const { data, error } = await q;
  if (error || !data?.length) return [];

  let rows = data as BrandMediaRow[];
  const needle = (opts.query ?? '').trim().toLowerCase();
  if (needle) {
    rows = rows.filter((r) => {
      const hay = [
        r.title,
        r.description,
        r.file_name,
        r.suggested_use,
        r.when_to_use,
        r.how_to_use,
        r.where_to_use,
        r.media_kind,
        r.mood,
        ...(r.tags ?? []),
        ...(r.subjects ?? [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  const signed = await signKnowledgePaths(
    supabase,
    rows.map((r) => r.storage_path)
  ).catch((error) => { swallow('rows.map failed', error); return new Map<string, string>(); });

  return rows.map((r) => ({
    ...r,
    signed_url: signed.get(r.storage_path) ?? null
  }));
}

/**
 * Run AI catalog on one brand_media row. For images: multimodal Gemini.
 * For video: text-only catalog from filename/mime/metadata (no frame extract yet).
 */
export async function catalogBrandMedia(
  supabase: SupabaseClient,
  mediaId: string,
  brandId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: row, error } = await supabase
    .from('brand_media')
    .select('*')
    .eq('id', mediaId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error || !row) return { ok: false, error: error?.message ?? 'Not found' };

  const media = row as BrandMediaRow;
  await supabase
    .from('brand_media')
    .update({ catalog_status: 'pending', catalog_error: null, updated_at: new Date().toISOString() })
    .eq('id', mediaId)
    .eq('brand_id', brandId);

  try {
    const patch = await runCatalog(supabase, media);
    const { error: upErr } = await supabase
      .from('brand_media')
      .update({
        ...patch,
        catalog_status: 'ready',
        catalog_error: null,
        cataloged_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', mediaId)
      .eq('brand_id', brandId);
    if (upErr) return { ok: false, error: upErr.message };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('brand_media')
      .update({
        catalog_status: 'failed',
        catalog_error: msg.slice(0, 500),
        updated_at: new Date().toISOString()
      })
      .eq('id', mediaId)
      .eq('brand_id', brandId);
    return { ok: false, error: msg };
  }
}

async function runCatalog(
  supabase: SupabaseClient,
  media: BrandMediaRow
): Promise<Partial<BrandMediaRow>> {
  const ai = genaiClient();
  const mime = media.mime ?? 'application/octet-stream';
  const fileName = media.file_name || media.storage_path.split('/').pop() || 'asset';
  const dims =
    media.width && media.height ? `${media.width}×${media.height}` : 'unknown resolution';
  const size = media.bytes != null ? `${Math.round(media.bytes / 1024)} KB` : 'unknown size';

  const metaBlock = `File: ${fileName}
MIME: ${mime}
Kind: ${media.kind}
Dimensions: ${dims}
Size: ${size}${media.duration_seconds != null ? `\nDuration: ${media.duration_seconds}s` : ''}`;

  const prompt = `You are a brand media librarian. Catalog this asset so other AI agents know exactly what it is and how to reuse it in social posts, blog articles, ads, or as a style/reference image.

${metaBlock}

Return structured JSON:
- title: short human label (not the filename)
- description: 2-4 sentences of what is VISIBLE / depicted (subjects, setting, style, text on image if any)
- tags: 3-8 short searchable tags
- subjects: concrete subjects (people, products, places, objects)
- colors: dominant colours (hex or plain names)
- mood: one short mood phrase
- media_kind: one of photo | illustration | logo | product | person | graphic | video | other
- suggested_use: one sentence on best reuse
- when_to_use: situations / campaigns / seasons when this fits
- how_to_use: as hero post media, carousel slide, blog cover, mood reference, product shot, etc.
- where_to_use: platforms or surfaces (Instagram feed, Stories, LinkedIn, blog, ads, …)`;

  let images: Array<{ inlineData: { mimeType: string; data: string } }> | undefined;
  let dimPatch: { width?: number | null; height?: number | null; bytes?: number | null } = {};

  if (media.kind === 'image') {
    const signed = await signKnowledgePaths(supabase, [media.storage_path]);
    const url = signed.get(media.storage_path);
    if (url) {
      const part = await fetchImagePart(url);
      if (part) images = [part];
      // Probe dimensions from storage if missing
      if (!media.width || !media.height || media.bytes == null) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (media.bytes == null) dimPatch.bytes = buf.byteLength;
            if (!media.width || !media.height) {
              const probed = await probeImageDimensions(buf);
              if (probed.width) dimPatch.width = probed.width;
              if (probed.height) dimPatch.height = probed.height;
            }
          }
        } catch (error) { swallow('probe image dimensions', error); }
      }
    }
  }

  const raw = await structured<CatalogResult>(ai, prompt, CATALOG_SCHEMA, undefined, {
    label: 'mediaCatalog',
    images,
    brandId: media.brand_id
  });

  if (!raw?.title || !raw?.description) {
    throw new Error('Catalog model returned empty result');
  }

  return {
    title: String(raw.title).slice(0, 200),
    description: String(raw.description).slice(0, 2000),
    tags: asStringArray(raw.tags),
    subjects: asStringArray(raw.subjects),
    colors: asStringArray(raw.colors, 8),
    mood: raw.mood ? String(raw.mood).slice(0, 120) : null,
    media_kind: String(raw.media_kind || (media.kind === 'video' ? 'video' : 'photo')).slice(0, 40),
    suggested_use: String(raw.suggested_use).slice(0, 500),
    when_to_use: String(raw.when_to_use).slice(0, 500),
    how_to_use: String(raw.how_to_use).slice(0, 500),
    where_to_use: String(raw.where_to_use).slice(0, 500),
    ...dimPatch
  };
}

export type InsertBrandMediaInput = {
  brandId: string;
  userId: string;
  storagePath: string;
  fileName: string;
  mime: string;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  source?: string;
  sourceRef?: string | null;
  title?: string | null;
};

/** Il bucket della libreria è privato e vive qui: chi deposita un file passa da questa funzione. */
export async function storeBrandMediaBytes(
  supabase: SupabaseClient,
  storagePath: string,
  bytes: Buffer,
  mime: string
): Promise<{ error?: string }> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  return error ? { error: error.message } : {};
}

export async function insertBrandMedia(
  supabase: SupabaseClient,
  input: InsertBrandMediaInput
): Promise<{ row: BrandMediaRow | null; error?: string }> {
  const kind = inferKind(input.mime);
  const { data, error } = await supabase
    .from('brand_media')
    .insert({
      brand_id: input.brandId,
      user_id: input.userId,
      kind,
      storage_path: input.storagePath,
      // Private bucket: store path as url; UI signs via storage_path.
      url: input.storagePath,
      source: input.source ?? 'upload',
      source_ref: input.sourceRef ?? null,
      mime: input.mime,
      bytes: input.bytes ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_seconds: input.durationSeconds ?? null,
      file_name: input.fileName,
      title: input.title ?? input.fileName,
      catalog_status: 'pending'
    })
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: data as BrandMediaRow };
}

export async function deleteBrandMedia(
  supabase: SupabaseClient,
  brandId: string,
  mediaId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabase
    .from('brand_media')
    .select('storage_path')
    .eq('id', mediaId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (row?.storage_path) {
    await supabase.storage.from(BUCKET).remove([row.storage_path]).catch(swallow('remove failed'));
  }
  const { error } = await supabase.from('brand_media').delete().eq('id', mediaId).eq('brand_id', brandId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Resolve brand image picks (mood docs OR media library) to signed URLs. */
export async function resolveBrandImageIds(
  supabase: SupabaseClient,
  brandId: string,
  ids: string[]
): Promise<string[]> {
  const clean = [...new Set(ids.filter(Boolean))].slice(0, 8);
  if (!clean.length) return [];

  const [{ data: docs }, { data: media }] = await Promise.all([
    supabase
      .from('brand_documents')
      .select('id, file_url')
      .in('id', clean)
      .eq('brand_id', brandId)
      .eq('kind', 'image'),
    supabase
      .from('brand_media')
      .select('id, storage_path')
      .in('id', clean)
      .eq('brand_id', brandId)
      .eq('kind', 'image')
  ]);

  const paths = [
    ...(docs ?? []).map((d) => String(d.file_url ?? '')),
    ...(media ?? []).map((m) => String(m.storage_path ?? ''))
  ].filter(Boolean);

  const signed = await signKnowledgePaths(supabase, paths).catch((error) => { swallow('sign media urls', error); return new Map<string, string>(); });
  const urls: string[] = [];
  for (const p of paths) {
    const u = signed.get(p);
    if (u) urls.push(u);
  }
  return urls;
}

export type AgentMediaItem = {
  id: string;
  kind: BrandMediaKind;
  title: string | null;
  description: string | null;
  tags: string[];
  subjects: string[];
  colors: string[];
  mood: string | null;
  media_kind: string | null;
  suggested_use: string | null;
  when_to_use: string | null;
  how_to_use: string | null;
  where_to_use: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  duration_seconds: number | null;
  catalog_status: BrandMediaRow['catalog_status'];
  file_name: string | null;
  preview_url: string | null;
  times_used: number;
  last_used_at: string | null;
};

export const MEDIA_LIBRARY_READ_HINT =
  'MEDIA FIRST: if an image fits, reuse it — do not generate a new one. Each asset has times_used and last_used_at. ROTATE: when several fit, prefer unused or least-recently-used — do not keep picking the same photo. Feed posts: pass media[].id as media_ids to create_post / design_graphic. Graphics or Remotion stills: call use_library_image then put image_url in <img src> / <Img src>. generate_image only when nothing here fits.';

export const USE_LIBRARY_IMAGE_HINT =
  'This did NOT change the post or composition and did not bill credits. Insert image_url with replace_source / replace_motion_source (<img src> or <Img src>). Call again for more library assets.';

/** Unused first, then least recently used, then older uploads. */
export function compareMediaUsage(
  a: Partial<Pick<BrandMediaRow, 'times_used' | 'last_used_at' | 'created_at'>>,
  b: Partial<Pick<BrandMediaRow, 'times_used' | 'last_used_at' | 'created_at'>>
): number {
  const ua = a.times_used ?? 0;
  const ub = b.times_used ?? 0;
  if (ua !== ub) return ua - ub;
  const la = a.last_used_at ?? '';
  const lb = b.last_used_at ?? '';
  if (la !== lb) return la.localeCompare(lb);
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

export function formatMediaUsageBit(r: Partial<Pick<BrandMediaRow, 'times_used' | 'last_used_at'>>): string {
  const n = r.times_used ?? 0;
  if (n <= 0 && !r.last_used_at) return ' unused';
  const last = r.last_used_at ? String(r.last_used_at).slice(0, 10) : 'unknown';
  return ` used=${n} last=${last}`;
}

/**
 * Atomic bump when a library asset is reused as a post visual, graphic embed, or motion still.
 * Fire-and-forget from callers — a failed bump must never fail the creative.
 */
export async function recordBrandMediaUse(
  supabase: SupabaseClient,
  brandId: string,
  mediaIds: string[] | null | undefined
): Promise<void> {
  const ids = [...new Set((mediaIds ?? []).filter(Boolean))];
  if (!ids.length || !brandId) return;
  const { error } = await supabase.rpc('bump_brand_media_usage', {
    p_brand_id: brandId,
    media_ids: ids
  });
  if (error) console.error('recordBrandMediaUse failed:', error.message);
}

export function mapMediaForAgent(items: BrandMediaListItem[]): AgentMediaItem[] {
  return items.map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    description: m.description,
    tags: m.tags ?? [],
    subjects: m.subjects ?? [],
    colors: m.colors ?? [],
    mood: m.mood,
    media_kind: m.media_kind,
    suggested_use: m.suggested_use,
    when_to_use: m.when_to_use,
    how_to_use: m.how_to_use,
    where_to_use: m.where_to_use,
    width: m.width,
    height: m.height,
    bytes: m.bytes,
    mime: m.mime,
    duration_seconds: m.duration_seconds,
    catalog_status: m.catalog_status,
    file_name: m.file_name,
    preview_url: m.signed_url,
    times_used: m.times_used ?? 0,
    last_used_at: m.last_used_at ?? null
  }));
}

export async function listMediaForAgent(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { query?: string; kind?: 'image' | 'video'; status?: 'pending' | 'ready' | 'failed'; limit?: number }
): Promise<{ media: AgentMediaItem[]; hint: string }> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 50);
  let items = await listBrandMedia(supabase, brandId, {
    limit,
    status: opts?.status,
    query: opts?.query
  });
  if (opts?.kind) items = items.filter((m) => m.kind === opts.kind);
  items.sort(compareMediaUsage);
  return { media: mapMediaForAgent(items), hint: MEDIA_LIBRARY_READ_HINT };
}

/**
 * Copy a library image into the public `media` bucket (original pixels, no crop) so graphic
 * HTML/TSX and Remotion <Img> can persist a durable https URL.
 */
export async function copyLibraryImageToPublicUrl(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; mediaId: string }
): Promise<
  | { image_url: string; media_id: string; width: number | null; height: number | null; title: string | null }
  | { error: string }
> {
  const { data: row, error } = await supabase
    .from('brand_media')
    .select('*')
    .eq('id', opts.mediaId)
    .eq('brand_id', opts.brandId)
    .eq('kind', 'image')
    .maybeSingle();
  if (error || !row) return { error: error?.message ?? 'Media not found' };
  const media = row as BrandMediaRow;

  const signed = await signKnowledgePaths(supabase, [media.storage_path]);
  const url = signed.get(media.storage_path);
  if (!url) return { error: 'Could not sign media URL' };

  const res = await fetch(url);
  if (!res.ok) return { error: 'Failed to download media asset' };
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 12_000_000) return { error: 'Media asset empty or too large' };

  const mime = (media.mime || res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const safeMime = mime.startsWith('image/') ? mime : 'image/jpeg';
  const ext = safeMime.includes('png') ? 'png' : safeMime.includes('webp') ? 'webp' : 'jpg';
  const path = `${opts.userId}/library/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('media').upload(path, buf, {
    contentType: safeMime === 'image/jpg' ? 'image/jpeg' : safeMime,
    upsert: false
  });
  if (upErr) return { error: upErr.message };
  const image_url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  if (!image_url) return { error: 'Upload of library media failed' };
  await recordBrandMediaUse(supabase, opts.brandId, [media.id]);
  return {
    image_url,
    media_id: media.id,
    width: media.width,
    height: media.height,
    title: media.title
  };
}

/** Compact digest for system prompts / agent tools. Unused / least-used first. */
export function formatMediaDigest(rows: Array<Partial<BrandMediaRow>>, max = 40): string {
  if (!rows.length) return '(empty library)';
  return [...rows]
    .sort(compareMediaUsage)
    .slice(0, max)
    .map((r) => {
      const status = r.catalog_status === 'ready' ? '' : ` [${r.catalog_status ?? 'pending'}]`;
      const tags = (r.tags ?? []).slice(0, 5).join(', ');
      const dims = r.width && r.height ? ` ${r.width}×${r.height}` : '';
      const use = r.suggested_use ? ` — ${r.suggested_use}` : '';
      return `- [${r.id?.slice(0, 8)}] ${r.title ?? r.file_name ?? 'Untitled'} (${r.kind}${dims}${r.media_kind ? `, ${r.media_kind}` : ''})${status}${tags ? ` #${tags}` : ''}${formatMediaUsageBit(r)}${use}`;
    })
    .join('\n');
}

/** Injected into chat / post-editor / motion-agent system prompts so the model sees the library by default. */
export function formatMediaLibraryPromptSection(rows: Array<Partial<BrandMediaRow>>, max = 24): string {
  if (!rows.length) {
    return `## MEDIA LIBRARY
(empty) — no uploaded assets yet. Generate photos with generate_image when needed. Do NOT invent media ids. Suggest the user upload photos in Brand → Media if they want to reuse real brand assets.`;
  }
  return `## MEDIA LIBRARY
Uploaded brand assets (AI catalog). MEDIA FIRST: before generating a new photo, look here (call read_media to search). If an asset fits, reuse it — use_library_image then <img src> / <Img src>, or pass media_ids to create_post / design_graphic. generate_image only when nothing fits.
ROTATE: prefer unused or least-recently-used assets when several fit. Do not keep picking the same photo. used=N last=YYYY-MM-DD is how often / when it last appeared in a post, graphic, or motion still.
${formatMediaDigest(rows, max)}`;
}

export async function loadMediaLibraryPromptSection(
  supabase: SupabaseClient,
  brandId: string,
  max = 24
): Promise<string> {
  const rows = await listReadyLibraryImages(supabase, brandId, max).catch((error) => { swallow('list library images', error); return []; });
  return formatMediaLibraryPromptSection(rows, max);
}

export type LibraryMediaMode = 'use_as_is' | 'composite';

/** Ready image assets for planners / create_post (full UUID for media_id). */
export async function listReadyLibraryImages(
  supabase: SupabaseClient,
  brandId: string,
  limit = 30
): Promise<BrandMediaRow[]> {
  const { data } = await supabase
    .from('brand_media')
    .select('*')
    .eq('brand_id', brandId)
    .eq('kind', 'image')
    .eq('catalog_status', 'ready')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as BrandMediaRow[];
}

/** Planner digest with FULL ids so seeds can copy media_id verbatim. */
export function formatMediaDigestForPlanner(rows: BrandMediaRow[], max = 24): string {
  if (!rows.length) return '';
  return [...rows]
    .sort(compareMediaUsage)
    .slice(0, max)
    .map((r) => {
      const tags = (r.tags ?? []).slice(0, 6).join(', ');
      const dims = r.width && r.height ? `${r.width}×${r.height}` : '';
      const bits = [
        `id=${r.id}`,
        r.title || r.file_name || 'Untitled',
        r.media_kind || 'photo',
        dims,
        r.description ? String(r.description).slice(0, 140) : '',
        tags ? `tags: ${tags}` : '',
        r.suggested_use ? `use: ${r.suggested_use}` : '',
        r.when_to_use ? `when: ${r.when_to_use}` : '',
        r.how_to_use ? `how: ${r.how_to_use}` : '',
        formatMediaUsageBit(r).trim()
      ].filter(Boolean);
      return `- ${bits.join(' · ')}`;
    })
    .join('\n');
}

/**
 * Publish a library image into the public `media` bucket (platform aspect crop) so it can be
 * used as the post's media_url — pixel-perfect reuse of the user's asset, no AI generation.
 */
/**
 * Il tetto di dimensione per tipo. Uno solo non basta: 12MB e' generoso per una foto e sotto una
 * singola clip da 15s, quindi riusarlo sui video avrebbe rifiutato quasi tutti con "asset too
 * large" — un errore che parla di dimensione e nasconde che il tetto era di un altro mestiere.
 */
export function mediaSizeCeiling(kind: 'image' | 'video'): number {
  return kind === 'video' ? 200_000_000 : 12_000_000;
}

/**
 * Copia un asset della libreria dove un post puo' puntarlo, e restituisce l'URL pubblico.
 *
 * Il `kind` non e' un parametro di comodo: e' il filtro della query. Una foto pubblicata come reel
 * — o una clip come immagine — e' un post plausibile e sbagliato, e ne' lo Storage ne' il provider
 * direbbero niente. La riga sa di che tipo e', quindi si chiede quella giusta e un risultato vuoto
 * e' un rifiuto, non un'ipotesi.
 */
export async function publishLibraryMediaAsPostMedia(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string;
    mediaId: string;
    kind?: 'image' | 'video';
    platform?: string | null;
  }
): Promise<{ publicUrl: string; media: BrandMediaRow } | { error: string }> {
  const kind = opts.kind ?? 'image';
  const { data: row, error } = await supabase
    .from('brand_media')
    .select('*')
    .eq('id', opts.mediaId)
    .eq('brand_id', opts.brandId)
    .eq('kind', kind)
    .maybeSingle();
  if (error || !row) return { error: error?.message ?? 'Media not found' };
  const media = row as BrandMediaRow;

  const signed = await signKnowledgePaths(supabase, [media.storage_path]);
  const url = signed.get(media.storage_path);
  if (!url) return { error: 'Could not sign media URL' };

  const res = await fetch(url);
  if (!res.ok) return { error: 'Failed to download media asset' };
  const buf = Buffer.from(await res.arrayBuffer());
  const ceiling = mediaSizeCeiling(kind);
  if (!buf.length || buf.length > ceiling) return { error: 'Media asset empty or too large' };

  const fallbackMime = kind === 'video' ? 'video/mp4' : 'image/jpeg';
  const mime = (media.mime || res.headers.get('content-type') || fallbackMime).split(';')[0].trim();
  const { publishImageBufferAsPostMedia } = await import('$lib/server/content-preview');
  const publicUrl = await publishImageBufferAsPostMedia(supabase, opts.userId, buf, mime, opts.platform);
  if (!publicUrl) return { error: 'Upload of library media failed' };
  await recordBrandMediaUse(supabase, opts.brandId, [media.id]);
  return { publicUrl, media };
}

/** Il nome storico, per i sei call site che pubblicano solo immagini. */
export const publishLibraryImageAsPostMedia = (
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; mediaId: string; platform?: string | null }
) => publishLibraryMediaAsPostMedia(supabase, { ...opts, kind: 'image' });

/**
 * Deposita in libreria una clip appena renderizzata, e restituisce l'id.
 *
 * Senza questo passo un video generato e' un file pagato che nessun tool sa raggiungere: e' il
 * vicolo cieco in cui `refine_video` e' nato — restituiva un URL e nessuno poteva farci un post.
 * La libreria e' l'unico posto da cui un asset e' riusabile da tutti (read_media, media_ids,
 * create_post_from_asset), quindi ci passa tutto cio' che generiamo, non solo cio' che si carica.
 *
 * Best-effort: se il deposito fallisce, la clip esiste ancora al suo URL e il chiamante lo dice.
 * Perdere l'id e' un fastidio; far fallire un render gia' pagato per un INSERT no.
 */
export async function saveRenderedVideoToLibrary(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; url: string; title: string; durationSeconds?: number }
): Promise<{ mediaId: string } | { error: string }> {
  const res = await fetch(opts.url);
  if (!res.ok) return { error: `could not read the rendered clip (${res.status})` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return { error: 'the rendered clip was empty' };

  const storagePath = `${opts.userId}/${opts.brandId}/media/generated-${Date.now()}.mp4`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: 'video/mp4', upsert: false });
  if (upErr) return { error: upErr.message };

  const { row, error } = await insertBrandMedia(supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    storagePath,
    mime: 'video/mp4',
    bytes: buf.length,
    durationSeconds: opts.durationSeconds,
    fileName: storagePath.split('/').pop() ?? 'generated.mp4',
    title: opts.title,
    source: 'ai'
  });
  if (error || !row) return { error: error ?? 'could not register the clip in the library' };
  return { mediaId: row.id };
}

/** Load library images as Gemini inline parts (for composite / reference mode). */
export async function loadLibraryMediaParts(
  supabase: SupabaseClient,
  brandId: string,
  mediaIds: string[],
  max = 4
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const urls = await resolveBrandImageIds(supabase, brandId, mediaIds.slice(0, max));
  const parts = await Promise.all(urls.map((u) => fetchImagePart(u)));
  return parts.filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;
}

/** Infer default mode: hero photos → use_as_is; logos/graphics often composite better. */
export function defaultLibraryMediaMode(media: Pick<BrandMediaRow, 'media_kind' | 'how_to_use'>): LibraryMediaMode {
  const kind = String(media.media_kind ?? '').toLowerCase();
  const how = String(media.how_to_use ?? '').toLowerCase();
  if (kind === 'logo' || kind === 'graphic' || kind === 'illustration') return 'composite';
  if (how.includes('reference') || how.includes('mood') || how.includes('style')) return 'composite';
  return 'use_as_is';
}

/**
 * Pick the best unused library image for a brief (simple token overlap on catalog text).
 * Falls back to the newest unused asset when nothing scores.
 */
export function pickLibraryAssetForBrief(
  rows: BrandMediaRow[],
  brief: string,
  usedIds: Set<string> = new Set()
): BrandMediaRow | null {
  const available = rows.filter((r) => r.kind === 'image' && r.catalog_status === 'ready' && !usedIds.has(r.id));
  if (!available.length) return null;
  const tokens = brief
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3)
    .slice(0, 16);
  let best = available[0];
  let bestScore = -1;
  for (const r of available) {
    const hay = [
      r.title,
      r.description,
      r.suggested_use,
      r.when_to_use,
      r.how_to_use,
      r.where_to_use,
      r.mood,
      r.media_kind,
      ...(r.tags ?? []),
      ...(r.subjects ?? [])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const tok of tokens) if (hay.includes(tok)) score += 1;
    // Prefer photo/product/person for feed posts over logos.
    const kind = String(r.media_kind ?? '').toLowerCase();
    if (kind === 'photo' || kind === 'product' || kind === 'person') score += 0.5;
    // Rotate: unused / stale assets beat recently reused ones when the catalog match is similar.
    score -= (r.times_used ?? 0);
    if (r.last_used_at) {
      const days = (Date.now() - Date.parse(r.last_used_at)) / 86_400_000;
      if (Number.isFinite(days) && days < 7) score -= 1.5;
      else if (Number.isFinite(days) && days < 30) score -= 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** Attach ready Media library rows onto a planner/render profile (profile.libraryMedia). */
export async function attachBrandLibraryMedia(
  profile: { libraryMedia?: unknown },
  supabase: SupabaseClient,
  brandId: string
): Promise<void> {
  profile.libraryMedia = await listReadyLibraryImages(supabase, brandId, 30).catch((error) => { swallow('list library images', error); return []; });
}
