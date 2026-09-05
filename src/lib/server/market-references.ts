// Weekly market references: scrape competitor (and adjacent) social posts → archive thumbs →
// ONE structured AI call that distills a reusable format/hook catalog for the planner + chat.
// Cadence is weekly by design (FRESH_DAYS = 7) so ScrapeCreators + AI cost stay bounded.
import { swallow } from '$lib/server/swallow';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { archiveImageToBucket } from '$lib/server/media-archive';
import type { ScrapeTarget } from '$lib/server/scrapecreators';
import type { NormalizedAd } from '$lib/server/competitor-ads';
import { createAdminClient } from '$lib/server/supabase-admin';
import { aiStructured } from '$lib/server/ai-text';
import { formatFieldPlaybook, type FieldPlaybook } from '$lib/server/market-field';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Weekly refresh — cron runs Mondays; regenerate only when older than this. */
export const FRESH_DAYS = 7;

/** Max competitor accounts scraped per refresh (cost cap). */
const MAX_COMPETITORS = 5;
/** Cap handles per competitor (prefer IG + TikTok for video signal). */
const MAX_HANDLES_PER_COMP = 2;
/** Max posts kept as market references after ranking. */
const MAX_REFERENCES = 12;
/** Prefer video in the shortlist (still include strong image posts to fill). */
const VIDEO_TARGET = 8;
/** Light scrape: enough for ranking, cheaper than onboarding's 30. */
const SCRAPE_LIMITS = { maxPages: 1, maxPosts: 20 };

export type MarketReference = {
  competitor: string;
  platform: string;
  content: string | null;
  mediaType: 'image' | 'video' | 'text' | null;
  url: string | null;
  thumbnailUrl: string | null;
  archivedPath: string | null;
  engagement: number;
  metrics: AnyRec;
  /** Distilled by AI — optional until catalog pass runs. */
  format?: string;
  hook?: string;
  angle?: string;
  copyable_pattern?: string;
};

export type FormatCatalogEntry = {
  name: string;
  description: string;
  whyItWorks: string;
  howToAdapt: string;
  /** Prefer video | image | either */
  media: 'video' | 'image' | 'either';
};

export type FormatCatalog = {
  formats: FormatCatalogEntry[];
  hooks: Array<{ pattern: string; example: string }>;
  angles: string[];
};

export type MarketReferencesRow = {
  references: MarketReference[];
  catalog: FormatCatalog;
  summary: string;
  sources: Array<{ competitor: string; platform: string; handle: string }>;
  /** Meta Ad Library trending / competitor ads snapshot (ScrapeCreators). */
  ads: NormalizedAd[];
  /**
   * Field watch (market-field.ts): cosa gira nel CAMPO del brand, non solo presso i competitor già
   * schedati. Vive su questa riga di proposito — così il brief del planner resta una sola lettura e
   * i due consumatori esistenti lo ricevono senza toccare nulla.
   */
  field_playbook: FieldPlaybook | null;
  updated_at: string;
};

export function isMarketRefsFresh(updatedAt: string | null, days = FRESH_DAYS): boolean {
  if (!updatedAt) return false;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < days * 24 * 3600 * 1000;
}

function engagementOf(p: { metrics?: AnyRec }): number {
  const m = p.metrics ?? {};
  return (Number(m.likes) || 0) + (Number(m.comments) || 0) + (Number(m.shares) || 0) + (Number(m.views) || 0) * 0.01;
}

function preferVideoRank(a: { mediaType?: string | null; engagement: number }, b: typeof a): number {
  const av = a.mediaType === 'video' ? 1 : 0;
  const bv = b.mediaType === 'video' ? 1 : 0;
  if (av !== bv) return bv - av;
  return b.engagement - a.engagement;
}

/** Compact planner/chat block — empty string when nothing useful. */
export function formatMarketBrief(row: Pick<MarketReferencesRow, 'summary' | 'catalog' | 'references'> & Partial<Pick<MarketReferencesRow, 'field_playbook'>> | null): string {
  if (!row) return '';
  const lines: string[] = [];
  if (row.summary?.trim()) lines.push(row.summary.trim());

  const formats = row.catalog?.formats ?? [];
  if (formats.length) {
    lines.push('COPYABLE FORMATS (adapt structure + hook — never copy caption/look verbatim):');
    for (const f of formats.slice(0, 6)) {
      lines.push(
        `- ${f.name} [${f.media}]: ${f.description} → adapt: ${f.howToAdapt}${f.whyItWorks ? ` (why: ${f.whyItWorks})` : ''}`
      );
    }
  }

  const hooks = row.catalog?.hooks ?? [];
  if (hooks.length) {
    lines.push('HOOK PATTERNS SEEN IN MARKET:');
    for (const h of hooks.slice(0, 6)) {
      lines.push(`- ${h.pattern}${h.example ? ` — e.g. "${h.example.slice(0, 120)}"` : ''}`);
    }
  }

  const angles = row.catalog?.angles ?? [];
  if (angles.length) {
    lines.push(`MARKET ANGLES: ${angles.slice(0, 8).join('; ')}`);
  }

  const refs = (row.references ?? []).filter((r) => r.content || r.format || r.hook).slice(0, 8);
  if (refs.length) {
    lines.push('EXAMPLE MARKET POSTS (structure only — differentiate visually and in voice):');
    for (const r of refs) {
      const tag = [r.competitor, r.platform, r.mediaType, r.format].filter(Boolean).join(' · ');
      const hook = r.hook ? ` hook="${r.hook.slice(0, 80)}"` : '';
      const cap = r.content ? String(r.content).replace(/\s+/g, ' ').slice(0, 160) : '';
      lines.push(`- [${tag}]${hook}${cap ? ` ${cap}` : ''}`);
    }
  }

  // Il playbook di campo è una fonte diversa dalle reference dei competitor — chi sta ottenendo
  // attenzione nel campo, anche se non è nella lista dei concorrenti — quindi entra come blocco a
  // sé invece di essere mescolato alle righe sopra.
  const field = formatFieldPlaybook(row.field_playbook ?? null);

  if (!lines.length) return field;
  const competitorBrief =
    `MARKET TRENDING REFERENCES (refreshed ~weekly from competitor socials — use as STRUCTURAL inspiration for hooks/formats/angles; never imitate their visual look or copy their words):\n` +
    lines.join('\n');
  return field ? `${competitorBrief}\n\n${field}` : competitorBrief;
}

async function ownerIdForBrand(supabase: SupabaseClient, brandId: string): Promise<string | null> {
  const { data: brand } = await supabase.from('brands').select('org_id').eq('id', brandId).maybeSingle();
  if (!brand?.org_id) return null;
  const { data: org } = await supabase.from('organizations').select('owner_id').eq('id', brand.org_id).maybeSingle();
  return (org?.owner_id as string) ?? null;
}

function pickHandles(raw: unknown): ScrapeTarget[] {
  if (!Array.isArray(raw)) return [];
  const preferred = ['tiktok', 'instagram', 'youtube', 'linkedin', 'twitter', 'x', 'threads'];
  const scored = raw
    .map((h: AnyRec) => {
      const platform = String(h?.platform ?? '').toLowerCase();
      const username = (h?.username ?? h?.handle ?? null) as string | null;
      const profileUrl = (h?.profileUrl ?? h?.profile_url ?? null) as string | null;
      if (!platform || (!username && !profileUrl)) return null;
      const rank = preferred.indexOf(platform);
      return { platform, username, profileUrl, rank: rank >= 0 ? rank : 99 };
    })
    .filter(Boolean) as Array<ScrapeTarget & { rank: number }>;
  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, MAX_HANDLES_PER_COMP).map(({ platform, username, profileUrl }) => ({
    platform,
    username,
    profileUrl
  }));
}

/**
 * brand_market_references is SELECT-only for members (0132) — writes must use the service role
 * (cron + UI refresh). Ignoring upsert errors made "Aggiorna catalogo" look successful while the
 * page stayed empty forever.
 */
async function persistMarketReferences(
  brandId: string,
  row: {
    references: MarketReference[];
    catalog: FormatCatalog;
    summary: string;
    sources: MarketReferencesRow['sources'];
    ads: MarketReferencesRow['ads'];
    updated_at: string;
  }
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('brand_market_references').upsert(
    {
      brand_id: brandId,
      references: row.references,
      catalog: row.catalog,
      summary: row.summary,
      sources: row.sources,
      ads: row.ads,
      updated_at: row.updated_at
    },
    { onConflict: 'brand_id' }
  );
  if (error) throw new Error(`Failed to save market references: ${error.message}`);
}

/** Backfill social handles for competitors that were saved without them (page research used to skip this). */
async function ensureCompetitorHandles(
  supabase: SupabaseClient,
  comps: Array<{ id: string; name: string; website?: string | null; handles?: unknown }>,
  platforms: string[]
): Promise<void> {
  const missing = comps.filter((c) => !pickHandles(c.handles).length);
  if (!missing.length) return;

  try {
    const { resolveCompetitorHandles } = await import('$lib/server/research');
    const wanted = platforms.length ? platforms : ['instagram', 'tiktok'];
    const handleMap = await resolveCompetitorHandles(
      missing.map((c) => ({
        name: String(c.name),
        website: String(c.website ?? ''),
        kind: 'direct' as const,
        rationale: ''
      })),
      wanted
    );
    await Promise.all(
      missing.map(async (c) => {
        const handles = handleMap.get(String(c.name)) ?? [];
        if (!handles.length) return;
        c.handles = handles;
        await supabase.from('competitors').update({ handles }).eq('id', c.id);
      })
    );
  } catch (e) {
    console.warn('[market-refs] handle resolve failed:', e instanceof Error ? e.message : e);
  }
}

const CATALOG_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: {
      type: 'string' as const,
      description: '2-4 sentences: what is winning in this market right now (formats, hooks, video vs still).'
    },
    formats: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Short format name (e.g. "Cynical talking-head UGC", "3-slide mythbust").' },
          description: { type: 'string' as const },
          whyItWorks: { type: 'string' as const },
          howToAdapt: {
            type: 'string' as const,
            description: 'How THIS brand can reuse the structure without copying look or words.'
          },
          media: { type: 'string' as const, enum: ['video', 'image', 'either'] as const }
        },
        required: ['name', 'description', 'whyItWorks', 'howToAdapt', 'media']
      }
    },
    hooks: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          pattern: { type: 'string' as const, description: 'Reusable hook pattern, not a verbatim quote.' },
          example: { type: 'string' as const, description: 'Paraphrased example from the market posts.' }
        },
        required: ['pattern', 'example']
      }
    },
    angles: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Content angles dominating the field.'
    },
    tagged: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'number' as const, description: '0-based index into the numbered post list.' },
          format: { type: 'string' as const },
          hook: { type: 'string' as const },
          angle: { type: 'string' as const },
          copyable_pattern: {
            type: 'string' as const,
            description: 'One-line recipe: structure the brand can copy (not the words).'
          }
        },
        required: ['index', 'format', 'hook', 'angle', 'copyable_pattern']
      }
    }
  },
  required: ['summary', 'formats', 'hooks', 'angles', 'tagged']
};

type CatalogAi = {
  summary: string;
  formats: FormatCatalogEntry[];
  hooks: Array<{ pattern: string; example: string }>;
  angles: string[];
  tagged: Array<{ index: number; format: string; hook: string; angle: string; copyable_pattern: string }>;
};

async function distillCatalog(
  refs: MarketReference[],
  brand: { name?: string; category?: string; about?: string; language?: string }
): Promise<CatalogAi | null> {
  if (!refs.length) return null;
  const lang = brand.language?.trim() || 'English';
  const list = refs
    .map((r, i) => {
      const cap = (r.content ?? '').replace(/\s+/g, ' ').slice(0, 220);
      return `${i}. [${r.competitor} · ${r.platform} · ${r.mediaType ?? '?'} · eng ${Math.round(r.engagement)}] ${cap || '(no caption)'}`;
    })
    .join('\n');

  const prompt = `You are a social creative strategist. Below are top-performing posts from competitors in ${brand.name ?? 'this brand'}'s market (${brand.category ?? 'unknown category'}).

Brand about: ${String(brand.about ?? '').slice(0, 400)}

Extract a REUSABLE catalog of formats and hooks this brand can adapt. Rules:
- Steal STRUCTURE (format, pacing, hook type, CTA shape) — never suggest copying captions, claims, or visual look.
- Prefer short-form VIDEO patterns when the posts are video.
- Keep names concrete and cynical/specific, not generic ("UGC talking head that opens with a myth", not "engaging content").
- Tag each numbered post with format/hook/angle/copyable_pattern.
- Write summary, format descriptions, hooks, and angles in ${lang}.

POSTS:
${list}`;

  try {
    return await aiStructured<CatalogAi>(prompt, CATALOG_SCHEMA, undefined, 'market_catalog', {
      context: 'marketReferencesCatalog',
      temperature: 0.4
    });
  } catch (e) {
    console.warn('[market-refs] catalog distill failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Refresh market references for a brand. Scrapes competitor handles (cache-aware), ranks
 * preferring video, archives thumbs, distills one AI catalog, upserts the row.
 * Also refreshes competitors.top_posts and competitors.top_ads (Meta Ad Library) for the UI.
 */
export async function refreshMarketReferences(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { force?: boolean }
): Promise<MarketReferencesRow | null> {
  if (!opts?.force) {
    const { data: existing } = await supabase
      .from('brand_market_references')
      .select('updated_at')
      .eq('brand_id', brandId)
      .maybeSingle();
    if (existing && isMarketRefsFresh(existing.updated_at)) {
      return loadMarketReferences(supabase, brandId);
    }
  }

  const [{ data: comps }, { data: kit }, { data: brandRow }] = await Promise.all([
    supabase
      .from('competitors')
      .select('id, name, website, handles, top_posts')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
      .limit(MAX_COMPETITORS),
    supabase.from('brand_kit').select('category, about, ai_context').eq('brand_id', brandId).maybeSingle(),
    supabase.from('brands').select('name, content_prefs, org_id, target_platforms').eq('id', brandId).maybeSingle()
  ]);

  if (!comps?.length) return null;

  const platforms = Array.isArray(brandRow?.target_platforms)
    ? (brandRow.target_platforms as string[]).filter(Boolean)
    : ['instagram', 'tiktok'];
  await ensureCompetitorHandles(supabase, comps, platforms);

  const handleMap = new Map<string, ScrapeTarget[]>();
  const sources: MarketReferencesRow['sources'] = [];
  for (const c of comps) {
    const handles = pickHandles(c.handles);
    if (!handles.length) continue;
    handleMap.set(String(c.name), handles);
    for (const h of handles) {
      sources.push({
        competitor: String(c.name),
        platform: h.platform,
        handle: String(h.username ?? h.profileUrl ?? '')
      });
    }
  }

  const ownerId = await ownerIdForBrand(supabase, brandId);

  // Meta Ad Library (ScrapeCreators): per-competitor active ads + niche keyword trending.
  // Runs even when organic handles are missing — company name is enough.
  const adsKeyword =
    String(kit?.category ?? '').trim() ||
    String(brandRow?.name ?? '').trim() ||
    null;
  let trendingAds: MarketReferencesRow['ads'] = [];
  let adsError: string | null = null;
  try {
    const { refreshCompetitorAds } = await import('$lib/server/competitor-ads');
    const adsResult = await refreshCompetitorAds(supabase, brandId, {
      competitors: comps.map((c) => ({ id: String(c.id), name: String(c.name) })),
      keyword: adsKeyword,
      ownerId,
      country: null
    });
    trendingAds = adsResult.trending;
  } catch (e) {
    adsError = e instanceof Error ? e.message : 'Ad Library refresh failed';
    console.warn('[market-refs] ads refresh failed:', adsError);
    trendingAds = [];
  }

  // Organic scrape is optional — skip cleanly when no handles (ads may still have updated).
  const competitorPosts = new Map<string, Awaited<ReturnType<typeof import('$lib/server/scrapecreators').scrapeForOnboarding>>['posts']>();
  if (handleMap.size) {
    const { scrapeForOnboarding } = await import('$lib/server/scrapecreators');
    await Promise.all(
      [...handleMap.entries()].map(async ([name, handles]) => {
        try {
          const { posts } = await scrapeForOnboarding(handles, SCRAPE_LIMITS);
          competitorPosts.set(name, posts);
        } catch (e) {
          console.warn(`[market-refs] scrape ${name}:`, e instanceof Error ? e.message : e);
          competitorPosts.set(name, []);
        }
      })
    );
  }

  const candidates: MarketReference[] = [];

  for (const [name, posts] of competitorPosts) {
    const ranked = [...posts]
      .map((p) => ({
        competitor: name,
        platform: p.platform,
        content: p.content ?? null,
        mediaType: (p.mediaType as MarketReference['mediaType']) ?? null,
        url: p.url ?? null,
        thumbnailUrl: p.thumbnailUrl ?? null,
        archivedPath: null as string | null,
        engagement: engagementOf(p),
        metrics: (p.metrics ?? {}) as AnyRec
      }))
      .sort(preferVideoRank);

    // Refresh competitor top_posts snapshot (top 3) for the Competitors UI.
    const top3 = ranked.slice(0, 3);
    const topPosts = await Promise.all(
      top3.map(async (tp) => {
        let archivedPath: string | null = null;
        if (tp.thumbnailUrl && ownerId) {
          const key = createHash('sha1').update(tp.thumbnailUrl).digest('hex').slice(0, 16);
          archivedPath = await archiveImageToBucket(
            supabase,
            `${ownerId}/${brandId}/competitors/${key}.jpg`,
            tp.thumbnailUrl
          ).catch((error) => { swallow('archive thumbnail', error); return null; });
        }
        return {
          content: tp.content,
          platform: tp.platform,
          thumbnailUrl: tp.thumbnailUrl,
          engagement: tp.engagement,
          metrics: tp.metrics,
          ...(archivedPath ? { archivedPath } : {})
        };
      })
    );
    const comp = comps.find((c) => c.name === name);
    if (comp) {
      await supabase.from('competitors').update({ top_posts: topPosts }).eq('id', comp.id);
    }

    candidates.push(...ranked.slice(0, 6));
  }

  // Ads-only path: no organic posts to distill — persist ads and keep any existing catalog.
  if (!candidates.length) {
    const existing = await loadMarketReferences(supabase, brandId);
    const updated_at = new Date().toISOString();
    const row: MarketReferencesRow = {
      references: existing?.references ?? [],
      catalog: existing?.catalog ?? { formats: [], hooks: [], angles: [] },
      summary: existing?.summary ?? '',
      sources: sources.length ? sources : (existing?.sources ?? []),
      ads: trendingAds,
      // Il field watch ha una sua cadenza e una sua scrittura: qui si porta avanti quello che c'è.
      field_playbook: existing?.field_playbook ?? null,
      updated_at
    };
    await persistMarketReferences(brandId, row);
    // Surface hard failures only when we produced nothing useful for either panel.
    if (!row.ads.length && !row.catalog.formats.length && adsError) {
      throw new Error(adsError);
    }
    if (!row.ads.length && !row.catalog.formats.length && !handleMap.size) {
      throw new Error(
        'No social handles on competitors — add handles or re-run research, then refresh again.'
      );
    }
    return row;
  }

  // Global shortlist: prefer video up to VIDEO_TARGET, then fill by engagement.
  const videos = candidates.filter((c) => c.mediaType === 'video').sort((a, b) => b.engagement - a.engagement);
  const rest = candidates.filter((c) => c.mediaType !== 'video').sort((a, b) => b.engagement - a.engagement);
  const shortlist = [...videos.slice(0, VIDEO_TARGET), ...rest].slice(0, MAX_REFERENCES);

  // Archive reference thumbs into market/ path.
  const refs: MarketReference[] = await Promise.all(
    shortlist.map(async (r) => {
      let archivedPath = r.archivedPath;
      if (r.thumbnailUrl && ownerId) {
        const key = createHash('sha1').update(r.thumbnailUrl).digest('hex').slice(0, 16);
        archivedPath =
          (await archiveImageToBucket(
            supabase,
            `${ownerId}/${brandId}/market/${key}.jpg`,
            r.thumbnailUrl
          ).catch((error) => { swallow('archive thumbnail', error); return null; })) ?? archivedPath;
      }
      return { ...r, archivedPath };
    })
  );

  const language =
    ((brandRow?.content_prefs as AnyRec)?.language as string | undefined) ?? undefined;
  const distilled = await distillCatalog(refs, {
    name: brandRow?.name,
    category: kit?.category ?? undefined,
    about: kit?.about ?? kit?.ai_context?.slice(0, 400) ?? undefined,
    language
  });

  if (distilled?.tagged?.length) {
    for (const t of distilled.tagged) {
      const i = Math.floor(Number(t.index));
      if (i < 0 || i >= refs.length) continue;
      refs[i] = {
        ...refs[i],
        format: t.format || refs[i].format,
        hook: t.hook || refs[i].hook,
        angle: t.angle || refs[i].angle,
        copyable_pattern: t.copyable_pattern || refs[i].copyable_pattern
      };
    }
  }

  const catalog: FormatCatalog = {
    formats: (distilled?.formats ?? []).slice(0, 8),
    hooks: (distilled?.hooks ?? []).slice(0, 8),
    angles: (distilled?.angles ?? []).slice(0, 10)
  };
  const summary = distilled?.summary?.trim() || '';
  const updated_at = new Date().toISOString();

  // Il playbook di campo sta sulla stessa riga ma ha un'altra cadenza (market-field.ts). In DB
  // sopravvive — `persistMarketReferences` non lo tocca — ma questo oggetto è quello che il planner
  // formatta subito dopo il refresh: senza riportarlo avanti, quel brief lo perderebbe.
  const { data: fieldRow } = await supabase
    .from('brand_market_references')
    .select('field_playbook')
    .eq('brand_id', brandId)
    .maybeSingle();

  const row: MarketReferencesRow = {
    references: refs,
    catalog,
    summary,
    sources,
    ads: trendingAds,
    field_playbook: ((fieldRow as AnyRec)?.field_playbook ?? null) as FieldPlaybook | null,
    updated_at
  };
  await persistMarketReferences(brandId, row);

  return row;
}

export async function loadMarketReferences(
  supabase: SupabaseClient,
  brandId: string
): Promise<MarketReferencesRow | null> {
  const { data, error } = await supabase
    .from('brand_market_references')
    .select('references, catalog, summary, sources, ads, field_playbook, updated_at')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    references: (Array.isArray(data.references) ? data.references : []) as MarketReference[],
    catalog: (data.catalog ?? { formats: [], hooks: [], angles: [] }) as FormatCatalog,
    summary: String(data.summary ?? ''),
    sources: (Array.isArray(data.sources) ? data.sources : []) as MarketReferencesRow['sources'],
    ads: (Array.isArray((data as AnyRec).ads) ? (data as AnyRec).ads : []) as MarketReferencesRow['ads'],
    field_playbook: ((data as AnyRec).field_playbook ?? null) as FieldPlaybook | null,
    updated_at: String(data.updated_at)
  };
}

/** Load + format planner brief. Never throws. */
export async function loadMarketBrief(supabase: SupabaseClient, brandId: string): Promise<string> {
  try {
    const row = await loadMarketReferences(supabase, brandId);
    return formatMarketBrief(row);
  } catch {
    return '';
  }
}

/**
 * Ensure a fresh row exists. If stale/missing and force/stale, refresh.
 * Best-effort for planner callers — returns brief string.
 */
export async function ensureMarketReferences(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { force?: boolean }
): Promise<MarketReferencesRow | null> {
  const existing = await loadMarketReferences(supabase, brandId);
  if (existing && isMarketRefsFresh(existing.updated_at) && !opts?.force) return existing;
  // Il refresh torna null quando il brand non ha competitor — ma la riga può comunque portare il
  // playbook di campo, che nasce apposta per chi non sa ancora chi guardare. Restituirla invece di
  // null è la differenza fra "il campo entra nel brief" e "sparisce proprio dove serve".
  return (await refreshMarketReferences(supabase, brandId, { force: true })) ?? existing;
}
