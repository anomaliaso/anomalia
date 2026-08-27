import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { adsAvailable, adsFeatureEnabled } from '$lib/server/ads';
import {
  runAdsRemix,
  listAdsRemixBriefs,
  digestToNormalizedAd,
  type RemixBrief
} from '$lib/server/ads-remix';
import type { MetaAdDigestItem } from '$lib/server/meta-ad-library';
import type { NormalizedAd } from '$lib/server/competitor-ads';
import { withBrandContext } from '$lib/server/ai-log';

function asDigest(raw: unknown): MetaAdDigestItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? r.adArchiveId ?? '').trim();
  if (!id) return null;
  return {
    id,
    pageName: String(r.pageName ?? ''),
    body: String(r.body ?? ''),
    title: String(r.title ?? ''),
    ctaText: String(r.ctaText ?? r.cta ?? ''),
    linkUrl: String(r.linkUrl ?? ''),
    isActive: typeof r.isActive === 'boolean' ? r.isActive : null,
    startDate: r.startDate != null ? String(r.startDate) : null,
    platforms: Array.isArray(r.platforms) ? r.platforms.map((p) => String(p)) : [],
    mediaType: r.mediaType != null ? String(r.mediaType) : null,
    imageUrl: r.imageUrl != null ? String(r.imageUrl) : null,
    videoUrl: r.videoUrl != null ? String(r.videoUrl) : null
  };
}

function asNormalized(raw: unknown): NormalizedAd | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.adArchiveId ?? r.id ?? '').trim();
  if (!id) return null;
  return {
    adArchiveId: id,
    pageName: String(r.pageName ?? 'Unknown'),
    pageId: r.pageId != null ? String(r.pageId) : null,
    body: r.body != null ? String(r.body) : null,
    cta: r.cta != null ? String(r.cta) : r.ctaText != null ? String(r.ctaText) : null,
    linkUrl: r.linkUrl != null ? String(r.linkUrl) : null,
    platforms: Array.isArray(r.platforms) ? r.platforms.map((p) => String(p)) : [],
    displayFormat: r.displayFormat != null ? String(r.displayFormat) : r.mediaType != null ? String(r.mediaType) : null,
    thumbnailUrl: r.thumbnailUrl != null ? String(r.thumbnailUrl) : r.imageUrl != null ? String(r.imageUrl) : null,
    startDate: r.startDate != null ? String(r.startDate) : null,
    isActive: r.isActive !== false,
    libraryUrl:
      r.libraryUrl != null
        ? String(r.libraryUrl)
        : `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`,
    archivedPath: r.archivedPath != null ? String(r.archivedPath) : null
  };
}

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug!, apiKey);
  if (brandError) return brandError;
  if (!adsFeatureEnabled()) return json({ error: 'Not found' }, { status: 404 });
  if (!adsAvailable(brand.plan)) return json({ error: 'ads_not_on_plan' }, { status: 403 });

  const briefs = await listAdsRemixBriefs(supabase, brand.id);
  return json({ briefs });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug!, apiKey);
  if (brandError) return brandError;
  if (!adsFeatureEnabled()) return json({ error: 'Not found' }, { status: 404 });
  if (!adsAvailable(brand.plan)) return json({ error: 'ads_not_on_plan' }, { status: 403 });

  const gated = await gateAiAction(brand, apiKey);
  if (gated) return gated;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // Optional concrete pool from Ads Library / CLI — skip harvest when provided.
  let ads: NormalizedAd[] | undefined;
  if (Array.isArray(body.ads) && body.ads.length) {
    ads = body.ads
      .map((row) => asNormalized(row) ?? (() => {
        const d = asDigest(row);
        return d ? digestToNormalizedAd(d) : null;
      })())
      .filter((a): a is NormalizedAd => !!a);
  }

  const result = await withBrandContext(brand.id, () =>
    runAdsRemix(supabase, { id: brand.id, name: brand.name }, ads?.length ? { ads } : undefined)
  );
  if (!result.ok) return json({ error: result.error }, { status: 400 });
  return json({ ok: true, briefs: result.briefs as RemixBrief[] });
};
