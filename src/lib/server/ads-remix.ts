// Ads remix agent — decides WHICH competitor ads to recompose and HOW, for this brand.
// Input: Meta Ad Library snapshots (competitors.top_ads + keyword trending, or a concrete pool
// from the Ads Library UI). Output: structured remix briefs in ads_remix_briefs.
import { swallow } from '$lib/server/swallow';
import { renderProductsSection, type DesignDocProduct } from '$lib/server/brand-design-doc';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient, fetchImagePart } from '$lib/server/brand-context';
import { aiStructured, type ImagePart } from '$lib/server/xiaomi';
import { refreshCompetitorAds, type NormalizedAd } from '$lib/server/competitor-ads';
import { metaAdLibraryUrl, type MetaAdDigestItem } from '$lib/server/meta-ad-library';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export const REMIX_MAX_BRIEFS = 5;
export const REMIX_MAX_AD_THUMBS = 8;
/** Hard cap on ads the agent sees in one run. */
export const REMIX_MAX_POOL = 12;

export type RemixBrief = {
  id?: string;
  sourceAdId: string;
  sourcePageName: string | null;
  sourceBody: string | null;
  sourceThumbnail: string | null;
  sourceLibraryUrl: string | null;
  rank: number;
  strategy: string;
  keep: string;
  change: string;
  hook: string;
  headline: string;
  body: string | null;
  cta: string | null;
  productName: string | null;
  visualPrompt: string;
  status: 'proposed' | 'approved' | 'converted' | 'discarded';
};

/** Pure: RemixBrief (camelCase, what the consumers read) → the ads_remix_briefs row (snake_case,
 * migration 0151). Every key here MUST match a column or PostgREST rejects the whole insert. */
export function remixBriefRow(brandId: string, b: RemixBrief): Record<string, unknown> {
  return {
    brand_id: brandId,
    source_ad_id: b.sourceAdId,
    source_page_name: b.sourcePageName,
    source_body: b.sourceBody,
    source_thumbnail: b.sourceThumbnail,
    source_library_url: b.sourceLibraryUrl,
    rank: b.rank,
    strategy: b.strategy,
    keep: b.keep,
    change: b.change,
    hook: b.hook,
    headline: b.headline,
    body: b.body,
    cta: b.cta,
    product_name: b.productName,
    visual_prompt: b.visualPrompt,
    status: b.status
  };
}

type RemixInput = {
  brandName: string;
  kit: {
    about?: string | null;
    category?: string | null;
    brandStyle?: string | null;
    targetAudience?: string | null;
    contentPillars?: string[] | null;
    aiContext?: string | null;
  };
  products: DesignDocProduct[];
  ads: NormalizedAd[];
  /** adArchiveId → brief secondo-per-secondo ricavato dall'mp4 (solo testo). */
  breakdowns?: Map<string, string>;
};

/** Map a Meta Ad Library digest row (UI / search) into the remix NormalizedAd shape. */
export function digestToNormalizedAd(ad: MetaAdDigestItem): NormalizedAd {
  return {
    adArchiveId: ad.id,
    pageName: ad.pageName || 'Unknown',
    pageId: null,
    body: ad.body || null,
    cta: ad.ctaText || null,
    linkUrl: ad.linkUrl || null,
    platforms: ad.platforms ?? [],
    displayFormat: ad.mediaType,
    thumbnailUrl: ad.imageUrl,
    startDate: ad.startDate,
    isActive: ad.isActive !== false,
    libraryUrl: metaAdLibraryUrl(ad.id),
    // Solo per lo smontaggio testuale (vedi NormalizedAd.videoUrl): non finisce su nessuna riga.
    videoUrl: ad.videoUrl ?? null
  };
}

// ------------------------------------------------------------------------------------------------
// DAL VIDEO DI UN TERZO ESCE SOLO TESTO
//
// L'mp4 di un competitor si può ISPEZIONARE (scaricare in RAM, estrarre fotogrammi, farlo
// descrivere a Gemini) e nient'altro. Non viene ri-hostato nel nostro storage, non viene salvato
// su `ads_remix_briefs`, non entra MAI in `reference_video_urls` di una generazione. Entra un mp4,
// esce un brief: è il confine tra "studiare un annuncio" e "rifarlo con la roba di un altro".
// `isThirdPartyAdMediaUrl` è il lato strutturale del vincolo — ogni URL che finisce nelle
// reference di una produzione ci passa attraverso (vedi `buildRemixProduceParams`).
// ------------------------------------------------------------------------------------------------

/** Al massimo tre smontaggi per giro: ffmpeg + Gemini per clip, e il resto del pool è testo. */
export const REMIX_MAX_BREAKDOWNS = 3;

const THIRD_PARTY_MEDIA_HOST =
  /(?:^|\.)(?:fbcdn\.net|facebook\.com|fb\.watch|cdninstagram\.com|instagram\.com|tiktokcdn\.com|tiktokcdn-us\.com|ttwstatic\.com|licdn\.com|akamaized\.net|pinimg\.com|twimg\.com)$/i;

/** true quando l'URL sta su un CDN altrui: ispezionabile, mai generabile. */
export function isThirdPartyAdMediaUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    return THIRD_PARTY_MEDIA_HOST.test(new URL(raw.trim()).hostname);
  } catch {
    return false;
  }
}

/** Tiene solo gli URL nostri. Usata su OGNI lista di reference che va a un modello generativo. */
export function onlyOwnMediaUrls(urls: Array<string | null | undefined>, max = 10): string[] {
  return urls
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\//i.test(u) && !isThirdPartyAdMediaUrl(u))
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, max);
}

/**
 * Il visual prompt finale del brief. Con lo smontaggio disponibile la STRUTTURA arriva dal brief
 * secondo-per-secondo (ritmo, camera, beat) e non da una frase inventata; il "cosa cambia" resta
 * quello che ha scritto l'agente. La riga finale è ciò che impedisce che una struttura rubata
 * diventi una creatività clonata: soggetto, prodotto e brand sono i NOSTRI.
 */
export function composeRemixVisualPrompt(shotBrief: string | null, modelPrompt: string): string {
  const mine = modelPrompt.replace(/\s+/g, ' ').trim();
  const shot = (shotBrief ?? '').trim();
  if (!shot) return mine.slice(0, 600);
  return [
    'STRUCTURE (reverse-engineered from the source ad — pacing, framing, beats only):',
    shot,
    '',
    `BRAND ADAPTATION (this is what actually gets shot): ${mine.slice(0, 600)}`,
    '',
    'CAST & PRODUCT ARE OURS: our own person/talent and our own product, our setting, our brand. Never the source ad’s face, product, logo, brand name or on-screen text.'
  ]
    .join('\n')
    .slice(0, 4000);
}

/**
 * Smonta i video del pool in TESTO. Best-effort: un fallimento (fetch/ffmpeg/modello) fa
 * semplicemente tornare il brief alla frase dell'agente.
 */
async function breakdownPoolVideos(pool: NormalizedAd[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = pool
    .filter((a) => typeof a.videoUrl === 'string' && /^https?:\/\//i.test(a.videoUrl))
    .slice(0, REMIX_MAX_BREAKDOWNS);
  if (!targets.length) return out;
  const { breakdownReferenceVideo } = await import('$lib/server/video-breakdown');
  for (const a of targets) {
    // In serie: ogni smontaggio è un download + ffmpeg + una chiamata Gemini.
    const b = await breakdownReferenceVideo(a.videoUrl!).catch((error) => { swallow('breakdown reference video', error); return null; });
    if (b?.prompt) out.set(a.adArchiveId, b.prompt);
  }
  return out;
}

/** Pure: pick and order the pool the agent sees. Competitor ads first (ranked by position in the
 * per-competitor top list), then keyword trending; deduped by adArchiveId; hard cap. */
export function buildRemixPool(
  perCompetitor: Map<string, NormalizedAd[]>,
  trending: NormalizedAd[],
  max = REMIX_MAX_POOL
): NormalizedAd[] {
  const seen = new Set<string>();
  const out: NormalizedAd[] = [];
  for (const [, ads] of perCompetitor) {
    for (const ad of ads) {
      if (seen.has(ad.adArchiveId)) continue;
      seen.add(ad.adArchiveId);
      out.push(ad);
      if (out.length >= max) return out;
    }
  }
  for (const ad of trending) {
    if (seen.has(ad.adArchiveId)) continue;
    seen.add(ad.adArchiveId);
    out.push(ad);
    if (out.length >= max) return out;
  }
  return out;
}

/** Pure: assemble the agent prompt from brand material + competitor ads. */
export function buildRemixPrompt(input: RemixInput): string {
  const kit = input.kit;
  // Shared rendering (brand-design-doc). No images — the ad creative is generated, not reused —
  // and no ids, since the brief names a product in prose rather than calling a tool.
  const products = renderProductsSection(input.products, {
    title: 'OUR PRODUCTS & SERVICES',
    images: false,
    ids: false,
    hint: null
  });
  const ads = input.ads
    .map((a, i) => {
      const lines = [
        `[Ad ${i}] id=${a.adArchiveId} · ${a.pageName}${a.isActive ? '' : ' (ended)'}`,
        a.displayFormat ? `  format: ${a.displayFormat}` : '',
        a.platforms.length ? `  platforms: ${a.platforms.join(', ')}` : '',
        a.body ? `  body: ${a.body.slice(0, 300)}` : '',
        a.cta ? `  cta: ${a.cta}` : '',
        a.linkUrl ? `  link: ${a.linkUrl}` : '',
        a.libraryUrl ? `  library: ${a.libraryUrl}` : '',
        // Lo smontaggio del video: NON è un allegato, è testo. Il modello legge cosa succede
        // secondo per secondo e ne ricava keep/change; l'mp4 non esiste, da qui in poi.
        input.breakdowns?.get(a.adArchiveId)
          ? `  shot breakdown (second-by-second, from the ad's own video):\n${input.breakdowns
              .get(a.adArchiveId)!
              .split('\n')
              .map((l) => `    ${l}`)
              .join('\n')}`
          : ''
      ].filter(Boolean);
      return lines.join('\n');
    })
    .join('\n\n');

  return `You are a senior paid-social strategist. Analyze the competitor ads below and decide WHICH of them are worth remixing for OUR brand, and exactly HOW to recompose each one.

Your job is NOT to copy the ad. It is to extract the winning structure (hook, angle, offer framing, CTA, format) and re-express it in OUR brand's voice, for OUR product and audience. Skip ads that are a poor fit (wrong product category, weak hook, unreadable) — quality over quantity.

BRAND: ${input.brandName}
ABOUT: ${kit.about ?? ''}
CATEGORY: ${kit.category ?? ''}
BRAND STYLE: ${kit.brandStyle ?? ''}
TARGET AUDIENCE: ${kit.targetAudience ?? ''}
CONTENT PILLARS: ${kit.contentPillars?.join(', ') ?? ''}
BRAND CONTEXT (voice / do's & don'ts):
${kit.aiContext ? kit.aiContext.slice(0, 1500) : '(not set)'}

${products || 'OUR PRODUCTS & SERVICES: (no products in catalog)'}

COMPETITOR ADS (thumbnails attached where available):
${ads || '(no ads harvested)'}

When an ad carries a "shot breakdown", that is the real timeline of its video: use it for keep/change (pacing, framing, beat order) and write visual_prompt as the direction OUR shoot needs. Never describe the source's face, product, logo or on-screen text — those are theirs.

For each selected ad produce one brief: what to keep, what to change, the remixed hook + headline + body + CTA written in OUR voice, which product to feature, and a visual_prompt describing the creative direction for our image generator (never reference the competitor's brand name or logo in the output). Set sourceAdId to the exact id= value from the ad list. Rank by expected impact (1 = best). Max ${REMIX_MAX_BRIEFS} briefs.`;
}

function poolThumbs(ads: NormalizedAd[]): string[] {
  return ads
    .map((a) => a.archivedPath ?? a.thumbnailUrl ?? '')
    .filter(Boolean)
    .slice(0, REMIX_MAX_AD_THUMBS);
}

async function signedThumbUrls(supabase: SupabaseClient, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  // Absolute https URLs (live Meta CDN) can be fetched directly; archive paths need signing.
  const archivePaths = paths.filter((p) => !/^https?:\/\//i.test(p));
  const direct = paths.filter((p) => /^https?:\/\//i.test(p));
  if (!archivePaths.length) return direct.slice(0, REMIX_MAX_AD_THUMBS);
  const { data } = await supabase.storage
    .from('brand-knowledge')
    .createSignedUrls(archivePaths, 60 * 60);
  const signed = (data ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
  return [...direct, ...signed].slice(0, REMIX_MAX_AD_THUMBS);
}

/**
 * Analyze a concrete ad pool and replace the brand's remix briefs.
 * Used by the harvest path and by Ads Library (selected / current search results).
 */
export async function remixAdsPool(
  supabase: SupabaseClient,
  brand: { id: string; name: string },
  poolIn: NormalizedAd[]
): Promise<{ ok: true; briefs: RemixBrief[] } | { ok: false; error: string }> {
  const pool = poolIn
    .filter((a) => a?.adArchiveId)
    .filter((a, i, arr) => arr.findIndex((x) => x.adArchiveId === a.adArchiveId) === i)
    .slice(0, REMIX_MAX_POOL);
  if (!pool.length) return { ok: false, error: 'no_competitor_ads' };

  const [{ data: kit }, { data: products }] = await Promise.all([
    supabase
      .from('brand_kit')
      .select('about, category, brand_style, target_audience, content_pillars, ai_context')
      .eq('brand_id', brand.id)
      .maybeSingle(),
    // `title`, not `name`: products has no `name` column, so this select used to fail outright and
    // hand the model an empty catalogue while it was being asked which product to feature.
    supabase
      .from('products')
      .select('id, title, description, kind, pricing, url, featured')
      .eq('brand_id', brand.id)
      .order('featured', { ascending: false })
      .limit(20)
  ]);

  // Smontaggio dei video PRIMA dell'analisi: l'agente deve poter leggere il ritmo reale
  // dell'annuncio, non dedurlo dalla copy. Solo testo esce da qui (vedi il blocco del vincolo).
  const breakdowns = await breakdownPoolVideos(pool).catch((error) => { swallow('breakdown ad videos', error); return new Map<string, string>(); });

  const thumbPaths = poolThumbs(pool);
  const signed = await signedThumbUrls(supabase, thumbPaths).catch((error) => { swallow('sign thumb urls', error); return []; });
  const images: ImagePart[] = [];
  for (const url of signed) {
    const part = await fetchImagePart(url).catch((error) => { swallow('fetch image part', error); return null; });
    if (part) images.push(part);
    if (images.length >= REMIX_MAX_AD_THUMBS) break;
  }

  const schema = {
    type: 'object',
    properties: {
      briefs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sourceAdId: { type: 'string' },
            strategy: { type: 'string' },
            keep: { type: 'string' },
            change: { type: 'string' },
            hook: { type: 'string' },
            headline: { type: 'string' },
            body: { type: 'string' },
            cta: { type: 'string' },
            productName: { type: 'string' },
            visualPrompt: { type: 'string' }
          },
          required: ['sourceAdId', 'strategy', 'hook', 'headline', 'visualPrompt']
        }
      }
    },
    required: ['briefs']
  };

  let analyzed: { briefs: Array<AnyRec> };
  try {
    analyzed = await aiStructured<{ briefs: Array<AnyRec> }>(
      genaiClient(),
      buildRemixPrompt({
        brandName: brand.name,
        kit: {
          about: kit?.about,
          category: kit?.category,
          brandStyle: kit?.brand_style,
          targetAudience: kit?.target_audience,
          contentPillars: kit?.content_pillars,
          aiContext: kit?.ai_context
        },
        products: (products ?? []) as DesignDocProduct[],
        ads: pool,
        breakdowns
      }),
      schema,
      'You are a senior paid-social strategist. Never invent facts about the competitor ads; work only from what is provided.',
      'return_result',
      { images, brandId: brand.id }
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const byId = new Map(pool.map((a) => [a.adArchiveId, a]));
  // Also accept "[Ad i]" style mistakes by resolving numeric index → pool[i].
  const briefs: RemixBrief[] = (analyzed?.briefs ?? [])
    .map((b) => {
      let id = String(b?.sourceAdId ?? '').trim();
      if (!byId.has(id) && /^\d+$/.test(id)) {
        const idx = Number(id);
        if (pool[idx]) id = pool[idx]!.adArchiveId;
      }
      if (!byId.has(id)) return null;
      const src = byId.get(id)!;
      return {
        sourceAdId: src.adArchiveId,
        sourcePageName: src.pageName,
        sourceBody: src.body,
        sourceThumbnail: src.archivedPath ?? src.thumbnailUrl,
        sourceLibraryUrl: src.libraryUrl,
        rank: 0,
        strategy: String(b.strategy ?? '').slice(0, 800),
        keep: String(b.keep ?? '').slice(0, 400),
        change: String(b.change ?? '').slice(0, 400),
        hook: String(b.hook ?? '').slice(0, 200),
        headline: String(b.headline ?? '').slice(0, 200),
        body: String(b.body ?? '').slice(0, 500) || null,
        cta: String(b.cta ?? '').slice(0, 60) || null,
        productName: String(b.productName ?? '').slice(0, 120) || null,
        // Con lo smontaggio, la struttura vince sulla frase: il brief secondo-per-secondo
        // sostituisce il visual_prompt inventato (e ci si aggiunge il "cosa cambia" dell'agente).
        visualPrompt: composeRemixVisualPrompt(
          breakdowns.get(src.adArchiveId) ?? null,
          String(b.visualPrompt ?? '')
        ),
        status: 'proposed' as const
      };
    })
    .filter((b): b is RemixBrief => !!b)
    .slice(0, REMIX_MAX_BRIEFS)
    .map((b, i) => ({ ...b, rank: i + 1 }));

  if (!briefs.length) return { ok: false, error: 'no_remix_briefs' };

  // 3. Replace the brand's previous briefs (the snapshot is regenerated wholesale each run).
  // INSERT FIRST, delete after: deleting first meant a rejected insert left the brand with no
  // briefs at all — the previous snapshot destroyed and the AI call already paid for.
  const { data: previous } = await supabase
    .from('ads_remix_briefs')
    .select('id')
    .eq('brand_id', brand.id);
  const { error } = await supabase
    .from('ads_remix_briefs')
    .insert(briefs.map((b) => remixBriefRow(brand.id, b)));
  if (error) return { ok: false, error: error.message };
  const staleIds = (previous ?? []).map((r) => r.id as string);
  if (staleIds.length) await supabase.from('ads_remix_briefs').delete().in('id', staleIds);
  return { ok: true, briefs };
}

/**
 * Run the remix: (re)harvest competitor ads (cache-7d, cheap), analyze them with the agent, and
 * replace the brand's previous briefs. Best-effort on harvest — a stale snapshot still feeds the
 * agent, so a scraping failure never blocks the analysis.
 *
 * Pass `opts.ads` to remix a concrete pool (e.g. Ads Library selection) and skip harvest.
 */
export async function runAdsRemix(
  supabase: SupabaseClient,
  brand: { id: string; name: string },
  opts?: { ads?: NormalizedAd[] }
): Promise<{ ok: true; briefs: RemixBrief[] } | { ok: false; error: string }> {
  if (opts?.ads?.length) {
    return remixAdsPool(supabase, brand, opts.ads);
  }

  const [{ data: competitors }, { data: kit }] = await Promise.all([
    supabase.from('competitors').select('id, name').eq('brand_id', brand.id).limit(10),
    supabase.from('brand_kit').select('category').eq('brand_id', brand.id).maybeSingle()
  ]);

  const harvest = await refreshCompetitorAds(supabase, brand.id, {
    competitors: (competitors ?? []).map((c) => ({ id: c.id, name: c.name })),
    keyword: kit?.category ?? undefined,
    ownerId: brand.id
  }).catch((error) => { swallow('map failed', error); return ({ perCompetitor: 0, trending: [] as NormalizedAd[] }); });

  const { data: refreshed } = await supabase
    .from('competitors')
    .select('name, top_ads')
    .eq('brand_id', brand.id)
    .limit(10);
  const perCompetitor = new Map<string, NormalizedAd[]>();
  for (const c of refreshed ?? []) {
    const ads = (c as AnyRec).top_ads;
    if (Array.isArray(ads) && ads.length) perCompetitor.set(String(c.name), ads as NormalizedAd[]);
  }
  const pool = buildRemixPool(perCompetitor, harvest.trending);
  return remixAdsPool(supabase, brand, pool);
}

/** Read the brand's current remix briefs, ranked. */
export async function listAdsRemixBriefs(
  supabase: SupabaseClient,
  brandId: string
): Promise<RemixBrief[]> {
  const { data } = await supabase
    .from('ads_remix_briefs')
    .select('*')
    .eq('brand_id', brandId)
    .order('rank', { ascending: true });
  return ((data ?? []) as Array<AnyRec>).map((b) => ({
    id: String(b.id),
    sourceAdId: String(b.source_ad_id),
    sourcePageName: b.source_page_name ?? null,
    sourceBody: b.source_body ?? null,
    sourceThumbnail: b.source_thumbnail ?? null,
    sourceLibraryUrl: b.source_library_url ?? null,
    rank: Number(b.rank) || 1,
    strategy: String(b.strategy ?? ''),
    keep: String(b.keep ?? ''),
    change: String(b.change ?? ''),
    hook: String(b.hook ?? ''),
    headline: String(b.headline ?? ''),
    body: b.body ?? null,
    cta: b.cta ?? null,
    productName: b.product_name ?? null,
    visualPrompt: String(b.visual_prompt ?? ''),
    status: b.status as RemixBrief['status']
  }));
}

// ------------------------------------------------------------------------------------------------
// PRODUCI: il brief diventa una clip. Qui si chiude lo status 'converted', dichiarato dalla 0156 e
// fino a oggi mai scritto da nessuno — i brief restavano testo e basta.
//
// Le reference sono SOLO roba del cliente: i suoi prodotti, le sue persone, i suoi video. Del
// video del competitor è sopravvissuto solo il testo dentro `visual_prompt`, e `onlyOwnMediaUrls`
// è il cancello che lo tiene così anche se domani qualcuno riattaccasse un URL altrui al brief.
// ------------------------------------------------------------------------------------------------

export type RemixEntityRef = { id: string; name: string; urls: string[] };

export type RemixClientAssets = {
  products: RemixEntityRef[];
  people: RemixEntityRef[];
  /** Video del CLIENTE (media library). Unica sorgente ammessa per reference_video_urls. */
  videoUrls: string[];
};

/** Pure (testata): brief + materiale del cliente → input params di un job UGC. */
export function buildRemixProduceParams(
  brief: RemixBrief,
  assets: RemixClientAssets,
  opts: { aspectRatio?: '9:16' | '16:9'; videoCount?: number } = {}
): Record<string, unknown> {
  const prompt = [
    `PAID UGC AD — remix brief #${brief.rank}${brief.productName ? ` · ${brief.productName}` : ''}`,
    brief.hook ? `HOOK (spoken first line): ${brief.hook}` : '',
    brief.headline ? `HEADLINE: ${brief.headline}` : '',
    brief.body ? `BODY: ${brief.body}` : '',
    brief.cta ? `CTA: ${brief.cta}` : '',
    brief.keep ? `KEEP FROM THE WINNING STRUCTURE: ${brief.keep}` : '',
    brief.change ? `CHANGE: ${brief.change}` : '',
    brief.visualPrompt ? `\n${brief.visualPrompt}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const clean = (refs: RemixEntityRef[], max: number): RemixEntityRef[] =>
    refs
      .map((r) => ({ ...r, urls: onlyOwnMediaUrls(r.urls, 4) }))
      .filter((r) => r.urls.length)
      .slice(0, max);

  return {
    prompt,
    videoCount: Math.min(4, Math.max(1, Math.round(opts.videoCount ?? 1))),
    products: clean(assets.products, 3),
    models: clean(assets.people, 2),
    referenceUrls: [],
    // Il cancello: qualunque URL di un CDN altrui sparisce qui, non a valle.
    referenceVideoUrls: onlyOwnMediaUrls(assets.videoUrls, 4),
    referenceAudioUrls: [],
    firstFrameUrl: null,
    lastFrameUrl: null,
    aspectRatio: opts.aspectRatio ?? '9:16',
    format: null,
    platform: null,
    useBrandStyle: true,
    promptId: null,
    videoModel: null
  };
}

/** Prodotti / persone / video del brand, con le immagini firmate. Il prodotto nominato dal brief
 * passa davanti: è quello che il brief chiede di mostrare. */
export async function loadRemixClientAssets(
  supabase: SupabaseClient,
  brandId: string,
  brief: RemixBrief
): Promise<RemixClientAssets> {
  const { normalizeImageUrls } = await import('$lib/server/brand-design-doc');
  const [{ data: productRows }, { data: peopleRows }] = await Promise.all([
    supabase
      .from('products')
      .select('id, title, images, featured')
      .eq('brand_id', brandId)
      .order('featured', { ascending: false })
      .limit(20),
    supabase.from('people').select('id, name, images').eq('brand_id', brandId).limit(10)
  ]);

  const wanted = (brief.productName ?? '').trim().toLowerCase();
  const products: RemixEntityRef[] = (productRows ?? [])
    .map((p) => ({
      id: String((p as AnyRec).id),
      name: String((p as AnyRec).title ?? 'product'),
      urls: normalizeImageUrls((p as AnyRec).images)
    }))
    .filter((p) => p.urls.length)
    .sort((a, b) => {
      const am = wanted && a.name.toLowerCase().includes(wanted) ? 0 : 1;
      const bm = wanted && b.name.toLowerCase().includes(wanted) ? 0 : 1;
      return am - bm;
    });

  const { signPersonImages } = await import('$lib/server/people');
  const people: RemixEntityRef[] = (
    await Promise.all(
      (peopleRows ?? []).map(async (p) => ({
        id: String((p as AnyRec).id),
        name: String((p as AnyRec).name ?? 'person'),
        urls: Array.isArray((p as AnyRec).images)
          ? await signPersonImages(supabase, (p as AnyRec).images.slice(0, 3)).catch((error) => { swallow('images.slice failed', error); return []; })
          : []
      }))
    )
  ).filter((p) => p.urls.length);

  const { listBrandMedia } = await import('$lib/server/brand-media');
  const media = await listBrandMedia(supabase, brandId, { limit: 40 }).catch((error) => { swallow('list brand media', error); return []; });
  const videoUrls = media
    .filter((m) => m.media_kind === 'video' || m.kind === 'video')
    .map((m) => m.signed_url)
    .filter((u): u is string => !!u);

  return { products, people, videoUrls };
}

/**
 * Manda in produzione un brief: coda designer (`ugc_batch`, lo stesso percorso dell'UGC Creator,
 * quindi stessa review automatica dopo il render e stessa coda di approvazione a valle) e status
 * 'converted'. Non pubblica niente: le clip restano da approvare come qualsiasi altro media.
 */
export async function produceRemixBrief(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; briefId: string; origin: string }
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const { data: row } = await supabase
    .from('ads_remix_briefs')
    .select('*')
    .eq('id', opts.briefId)
    .eq('brand_id', opts.brandId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'brief_not_found' };

  const r = row as AnyRec;
  const brief: RemixBrief = {
    id: String(r.id),
    sourceAdId: String(r.source_ad_id),
    sourcePageName: r.source_page_name ?? null,
    sourceBody: r.source_body ?? null,
    sourceThumbnail: r.source_thumbnail ?? null,
    sourceLibraryUrl: r.source_library_url ?? null,
    rank: Number(r.rank) || 1,
    strategy: String(r.strategy ?? ''),
    keep: String(r.keep ?? ''),
    change: String(r.change ?? ''),
    hook: String(r.hook ?? ''),
    headline: String(r.headline ?? ''),
    body: r.body ?? null,
    cta: r.cta ?? null,
    productName: r.product_name ?? null,
    visualPrompt: String(r.visual_prompt ?? ''),
    status: r.status as RemixBrief['status']
  };

  const assets = await loadRemixClientAssets(supabase, opts.brandId, brief);
  const params = buildRemixProduceParams(brief, assets);

  const { DESIGNER_TOOL_UGC, kickDesignerWork } = await import('$lib/server/designer-jobs');
  // 'pending', non 'running': questa richiesta non renderizza nulla, la coda designer la prende
  // in un'altra invocazione — è la sola che ha il budget di tempo per una clip Seedance.
  const { data: job, error } = await supabase
    .from('chat_jobs')
    .insert({
      brand_id: opts.brandId,
      user_id: opts.userId,
      tool_name: DESIGNER_TOOL_UGC,
      status: 'pending',
      input_params: {
        ...params,
        queued: true,
        origin: opts.origin,
        continuation_depth: 0,
        ads_remix_brief_id: brief.id
      }
    })
    .select('id')
    .maybeSingle();
  if (error || !job?.id) return { ok: false, error: error?.message ?? 'job_insert_failed' };

  await supabase
    .from('ads_remix_briefs')
    .update({ status: 'converted', updated_at: new Date().toISOString() })
    .eq('id', brief.id)
    .eq('brand_id', opts.brandId);

  void kickDesignerWork(opts.origin);
  return { ok: true, jobId: String(job.id) };
}
