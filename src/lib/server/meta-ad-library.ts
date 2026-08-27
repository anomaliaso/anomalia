/**
 * Meta Ad Library via ScrapeCreators (NOT Zernio).
 *
 * Zernio owns connect / publish / boost of OUR ads.
 * ScrapeCreators exposes Meta's public Ad Library (competitor creatives + copy) —
 * the research step before writing UGC scripts that convert.
 */
import { scrapeCreatorsGet, scrapeCreatorsPost } from '$lib/server/scrapecreators';

export type MetaAdDigestItem = {
  id: string;
  pageName: string;
  /** Primary ad body / spoken-ish copy when present. */
  body: string;
  title: string;
  ctaText: string;
  linkUrl: string;
  isActive: boolean | null;
  startDate: string | null;
  platforms: string[];
  mediaType: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
};

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, max = 600): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Le creatività dell'annuncio, in ordine di specificità: carosello → immagini → VIDEO → snapshot.
 *
 * `snapshot.videos[]` mancava. Per un annuncio video Meta lascia `cards` e `images` vuoti, quindi
 * si finiva sul ramo `[snapshot]`, dove `video_hd_url` non esiste: 6 probe su 6 avevano l'mp4 solo
 * in `snapshot.videos[0]`. Conseguenza a valle: `videoUrl` sempre null → nella Ads Library il
 * player e il bottone di review non comparivano su NESSUN risultato.
 */
function pickCards(snapshot: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const key of ['cards', 'images', 'videos'] as const) {
    const arr = snapshot[key];
    if (Array.isArray(arr) && arr.length) out.push(...arr.map(asRec));
  }
  return out.length ? out : [snapshot];
}

/** Primo valore non vuoto per una di quelle chiavi, cercato su TUTTE le creatività.
 * Il video di un carosello misto sta su `videos[0]` mentre `first` è `images[0]`: guardare solo
 * la prima card è esattamente il bug che ha spento il player. */
function firstField(cards: Record<string, unknown>[], keys: string[]): string {
  for (const c of cards) {
    for (const k of keys) {
      const v = str(c[k], 500);
      if (v) return v;
    }
  }
  return '';
}

/** Normalize one ScrapeCreators / Meta Ad Library row into a compact digest item. */
export function normalizeMetaAd(raw: unknown): MetaAdDigestItem | null {
  const row = asRec(raw);
  const snapshot = asRec(row.snapshot ?? row.ad_snapshot ?? row);
  const cards = pickCards(snapshot);
  const first = cards[0] ?? {};
  const id = str(
    row.ad_archive_id ?? row.adArchiveId ?? row.id ?? snapshot.ad_archive_id ?? first.ad_archive_id,
    64
  );
  if (!id) return null;

  const rawBody =
    first.body ??
    first.body_text ??
    snapshot.body ??
    snapshot.body_text ??
    row.body ??
    first.link_description ??
    '';
  // ScrapeCreators often nests copy as `{ text: "..." }` on snapshot/card body.
  const body = str(
    rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? (asRec(rawBody).text ?? asRec(rawBody).body ?? '')
      : rawBody,
    500
  );
  const title = str(first.title ?? snapshot.title ?? row.title ?? '', 160);
  const pageName = str(
    row.page_name ?? snapshot.page_name ?? row.pageName ?? snapshot.pageName ?? first.page_name ?? '',
    120
  );
  const platformsRaw = row.publisher_platform ?? row.publisherPlatform ?? snapshot.publisher_platform;
  const platforms = Array.isArray(platformsRaw)
    ? platformsRaw.map((p) => str(p, 40)).filter(Boolean)
    : [];

  const startUnix = row.start_date ?? row.startDate ?? snapshot.start_date;
  let startDate: string | null = null;
  if (typeof startUnix === 'number' && Number.isFinite(startUnix)) {
    const ms = startUnix > 1e12 ? startUnix : startUnix * 1000;
    startDate = new Date(ms).toISOString().slice(0, 10);
  } else if (typeof startUnix === 'string' && startUnix.trim()) {
    startDate = startUnix.slice(0, 10);
  }

  const isActive =
    typeof row.is_active === 'boolean'
      ? row.is_active
      : typeof row.isActive === 'boolean'
        ? row.isActive
        : null;

  const imageUrl =
    firstField(cards, [
      'original_image_url',
      'resized_image_url',
      'image_url',
      // Poster del video: senza, una ad solo-video restava senza miniatura in griglia.
      'video_preview_image_url'
    ]) ||
    str(snapshot.original_image_url, 500) ||
    null;
  const videoUrl =
    firstField(cards, ['video_hd_url', 'video_sd_url', 'video_url']) ||
    str(snapshot.video_hd_url ?? snapshot.video_sd_url, 500) ||
    null;

  return {
    id,
    pageName,
    body,
    title,
    ctaText: str(first.cta_text ?? first.cta_type ?? snapshot.cta_text ?? '', 80),
    linkUrl: str(first.link_url ?? snapshot.link_url ?? '', 300),
    isActive,
    startDate,
    platforms,
    mediaType: str(row.media_type ?? snapshot.display_format ?? (videoUrl ? 'video' : imageUrl ? 'image' : ''), 40) || null,
    imageUrl,
    videoUrl
  };
}

/** Pull ad rows out of a ScrapeCreators Ad Library payload (search or company). */
export function collectAds(payload: unknown): MetaAdDigestItem[] {
  const root = asRec(payload);
  // ScrapeCreators returns different array keys by endpoint:
  // - search/ads → searchResults: Ad[]
  // - company/ads → results: Ad[]
  // Never treat those arrays as objects ({}.ads) — that silently dropped every hit.
  const candidates = [
    root.searchResults,
    root.search_results,
    root.results,
    root.ads,
    root.data,
    asRec(root.searchResults).ads,
    asRec(root.search_results).ads,
    asRec(root.data).ads,
    asRec(root.data).results
  ];
  let rows: unknown[] = [];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      rows = c;
      break;
    }
  }
  if (!rows.length && Array.isArray(payload)) rows = payload;

  const out: MetaAdDigestItem[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const item = normalizeMetaAd(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** ScrapeCreators Meta Ad Library sort_by — only these two values are accepted. */
export type MetaAdSortBy = 'total_impressions' | 'relevancy_monthly_grouped';

/** Map caller aliases (e.g. legacy `impressions`) onto a valid ScrapeCreators sort_by. */
export function resolveMetaAdSortBy(sortBy?: string | null): MetaAdSortBy {
  if (sortBy === 'relevancy_monthly_grouped') return 'relevancy_monthly_grouped';
  // `impressions` was our old alias — ScrapeCreators requires `total_impressions`.
  return 'total_impressions';
}

/**
 * Search Meta Ad Library by keyword (long-running ads ≈ winners).
 * Uses ScrapeCreators GET; falls back to POST if the query string would be huge.
 */
export async function searchMetaAdLibrary(
  query: string,
  opts: {
    country?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
    mediaType?: 'ALL' | 'VIDEO' | 'IMAGE' | 'MEME';
    sortBy?: MetaAdSortBy | 'impressions';
    trim?: boolean;
    limit?: number;
  } = {}
): Promise<MetaAdDigestItem[]> {
  const q = query.trim();
  if (!q) return [];
  const path =
    `/v1/facebook/adLibrary/search/ads` +
    qs({
      query: q,
      country: opts.country ?? 'ALL',
      status: opts.status ?? 'ACTIVE',
      // ALL matches competitor-ads harvest — VIDEO-only often looks "empty" for image-heavy brands.
      media_type: opts.mediaType ?? 'ALL',
      sort_by: resolveMetaAdSortBy(opts.sortBy),
      search_type: 'keyword_unordered',
      ad_type: 'all',
      trim: opts.trim !== false
    });
  const data = await scrapeCreatorsGet(path);
  return collectAds(data).slice(0, Math.max(1, Math.min(40, opts.limit ?? 20)));
}

/** All active ads for a company name or Meta page id. */
export async function companyMetaAdLibrary(
  opts: {
    companyName?: string;
    pageId?: string;
    country?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
    mediaType?: 'ALL' | 'VIDEO' | 'IMAGE' | 'MEME';
    sortBy?: MetaAdSortBy | 'impressions';
    trim?: boolean;
    limit?: number;
  }
): Promise<MetaAdDigestItem[]> {
  const companyName = opts.companyName?.trim();
  const pageId = opts.pageId?.trim();
  if (!companyName && !pageId) return [];
  const sort_by = resolveMetaAdSortBy(opts.sortBy);
  const media_type = opts.mediaType ?? 'ALL';
  const path =
    `/v1/facebook/adLibrary/company/ads` +
    qs({
      companyName,
      pageId,
      country: opts.country ?? 'ALL',
      status: opts.status ?? 'ACTIVE',
      media_type,
      sort_by,
      trim: opts.trim !== false
    });
  let data: unknown;
  try {
    data = await scrapeCreatorsGet(path);
  } catch {
    // Large cursors / long names: POST body path.
    data = await scrapeCreatorsPost('/v1/facebook/adLibrary/company/ads', {
      companyName,
      pageId,
      country: opts.country ?? 'ALL',
      status: opts.status ?? 'ACTIVE',
      media_type,
      sort_by,
      trim: opts.trim !== false
    });
  }
  return collectAds(data).slice(0, Math.max(1, Math.min(40, opts.limit ?? 20)));
}

/**
 * Planner / chat digest: first lines, pain angles, long-running signal.
 * Instructs the model to steal STRUCTURE not copy.
 */
export function metaAdLibraryUrl(id: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

export function formatMetaAdsDigestForPlanner(ads: MetaAdDigestItem[], max = 12): string {
  if (!ads.length) return '';
  const lines = ads.slice(0, max).map((a, i) => {
    const open = (a.body || a.title || '(no copy)').slice(0, 180);
    const bits = [
      `#${i + 1}`,
      a.pageName || 'unknown page',
      a.startDate ? `since ${a.startDate}` : '',
      a.isActive === true ? 'ACTIVE' : a.isActive === false ? 'inactive' : '',
      a.mediaType || '',
      a.platforms.length ? a.platforms.join('+') : ''
    ].filter(Boolean);
    return `- ${bits.join(' · ')}\n  opener/body: "${open}"${a.ctaText ? `\n  cta: ${a.ctaText}` : ''}`;
  });
  return [
    'META ADS LIBRARY (competitor paid creatives via ScrapeCreators — long-running ≈ validated):',
    'Steal STRUCTURE (call-out → pain → demo → proof → CTA), never clone copy or faces.',
    'No product in the first ~8s. Prefer hooks that name the viewer’s situation, not the brand.',
    ...lines
  ].join('\n');
}
