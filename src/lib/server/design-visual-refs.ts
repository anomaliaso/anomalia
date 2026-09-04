/**
 * Resolve people / talent / competitor / social-handle images into signed https URLs
 * the graphic composer and image generator can consume as AVAILABLE IMAGES / references.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';
import { signPersonImages, type PersonImage } from '$lib/server/people';
import { listTalents } from '$lib/server/talent';
import { fetchSocialProfile } from '$lib/server/scrapecreators';
import { archiveImageToBucket, signKnowledgePaths } from '$lib/server/media-archive';
import { isUrlSafe } from '$lib/server/brand-analysis';
import type { AvailableGraphicImage } from '$lib/server/design-compose';

export type VisualRef = AvailableGraphicImage;

const SOCIAL_THUMB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SOCIAL_THUMB_SIGN_TTL_S = 7 * 24 * 60 * 60;
const MAX_SOCIAL_THUMBS = 8;

export type LikenessSubject = { kind?: string | null; consent?: unknown };

/**
 * THE LIKENESS RULE. The single place that decides whether a person's photograph may become a
 * reference an image or video model can act on. A `kind='real'` person without an attested
 * `consent` never qualifies — a UGC clip of a real face speaking a synthetic script is a deepfake
 * under Art. 3(60) AI Act, and image rights and the GDPR apply to it whatever the brand intends.
 * AI personas depict nobody, so they are never gated.
 *
 * Every surface that signs a person's photos calls this. Re-stating the condition anywhere else
 * is how the rule diverges.
 */
export function likenessConsented(subject: LikenessSubject): boolean {
  return subject.kind === 'ai' || subject.consent === true;
}

/** Brand people (real + AI persona) → signed photo URLs, labeled for the composer. */
export async function resolvePeopleVisualRefsDetailed(
  supabase: SupabaseClient,
  brandId: string,
  peopleIds: string[] | null | undefined,
  perPerson = 3
): Promise<{ refs: VisualRef[]; blocked: string[] }> {
  const ids = (peopleIds ?? []).map(String).filter(Boolean).slice(0, 6);
  if (!ids.length) return { refs: [], blocked: [] };
  const { data } = await supabase
    .from('people')
    .select('id, name, kind, images, consent')
    .eq('brand_id', brandId)
    .in('id', ids);
  const refs: VisualRef[] = [];
  const blocked: string[] = [];
  for (const row of data ?? []) {
    if (!likenessConsented(row)) {
      blocked.push(String(row.name ?? row.id));
      continue;
    }
    const imgs = Array.isArray(row.images) ? (row.images as PersonImage[]).slice(0, perPerson) : [];
    if (!imgs.length) continue;
    const urls = await signPersonImages(supabase, imgs);
    const labelBase = row.kind === 'ai' ? `ai person:${row.name}` : `person:${row.name}`;
    for (const url of urls) refs.push({ url, label: labelBase });
  }
  if (blocked.length) {
    console.warn(`[likeness] consent missing, refs withheld for: ${blocked.join(', ')} (brand ${brandId})`);
  }
  return { refs, blocked };
}

/** Refs only, for the callers that have nowhere to surface a blocked name. */
export async function resolvePeopleVisualRefs(
  supabase: SupabaseClient,
  brandId: string,
  peopleIds: string[] | null | undefined,
  perPerson = 3
): Promise<VisualRef[]> {
  return (await resolvePeopleVisualRefsDetailed(supabase, brandId, peopleIds, perPerson)).refs;
}

/** Global AI talent library → signed view URLs (first few views per talent). */
export async function resolveTalentVisualRefs(
  supabase: SupabaseClient,
  talentIds: string[] | null | undefined,
  viewsPerTalent = 2
): Promise<VisualRef[]> {
  const ids = (talentIds ?? []).map(String).filter(Boolean).slice(0, 4);
  if (!ids.length) return [];
  const all = await listTalents(supabase).catch((error) => { swallow('list talents', error); return [] as Awaited<ReturnType<typeof listTalents>>; });
  const want = new Set(ids);
  const out: VisualRef[] = [];
  for (const t of all) {
    if (!want.has(t.id) && !want.has(t.slug)) continue;
    for (const v of t.views.slice(0, viewsPerTalent)) {
      if (v.url) out.push({ url: v.url, label: `talent:${t.name}` });
    }
  }
  return out;
}

/**
 * ScrapeCreators → archive thumbs into our bucket → signed URLs.
 * Same path as Designer › social-thumbs (avoids Instagram CORP blocking).
 */
export async function fetchSocialVisualRefs(
  platform: string,
  handle: string
): Promise<{ thumbs: VisualRef[]; error?: string }> {
  const plat = platform.trim().toLowerCase();
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  if (!plat || !h) return { thumbs: [], error: 'missing platform or handle' };

  const admin = createAdminClient();
  let paths: string[] = [];
  const { data: cached } = await admin
    .from('social_thumb_cache')
    .select('paths, fetched_at')
    .eq('platform', plat)
    .eq('handle', h)
    .maybeSingle();

  const fresh = cached && Date.now() - new Date(cached.fetched_at as string).getTime() < SOCIAL_THUMB_CACHE_TTL_MS;
  if (fresh && Array.isArray(cached!.paths) && cached!.paths.length) {
    paths = cached!.paths as string[];
  } else {
    try {
      const profile = await fetchSocialProfile(plat, h);
      const urls = (profile.thumbs ?? []).slice(0, MAX_SOCIAL_THUMBS);
      const safeHandle = h.replace(/[^a-z0-9_.-]/g, '_');
      const archived = await Promise.all(
        urls.map((u, i) => archiveImageToBucket(admin, `thumb-cache/${plat}/${safeHandle}/${i}.jpg`, u))
      );
      paths = archived.filter((p): p is string => !!p);
      await admin.from('social_thumb_cache').upsert({
        platform: plat,
        handle: h,
        paths,
        fetched_at: new Date().toISOString()
      });
    } catch (e) {
      return { thumbs: [], error: e instanceof Error ? e.message : 'scrape_failed' };
    }
  }

  if (!paths.length) return { thumbs: [] };
  const signed = await signKnowledgePaths(admin, paths, SOCIAL_THUMB_SIGN_TTL_S);
  const thumbs = paths
    .map((p) => signed.get(p))
    .filter((u): u is string => !!u)
    .map((url) => ({ url, label: `social:${plat}/@${h}` }));
  return { thumbs };
}

/** Append refs into an available-images catalog (dedupe by URL). */
export function pushVisualRefs(
  available: AvailableGraphicImage[],
  refs: VisualRef[]
): AvailableGraphicImage[] {
  const seen = new Set(available.map((a) => a.url));
  for (const r of refs) {
    if (!r.url || seen.has(r.url)) continue;
    if (!(r.url.startsWith('data:image/') || (r.url.startsWith('http') && isUrlSafe(r.url)))) continue;
    seen.add(r.url);
    available.push({ url: r.url, label: r.label });
  }
  return available;
}
