// Cross-brand Anomalia backlink network.
//
// Marketing promise: brands on Anomalia get real contextual links from other brands' articles —
// not directory spam. This module:
//   1) finds published articles from other opted-in network brands
//   2) ranks them by topical relevance (category + token overlap)
//   3) injects a short allow-list into blog generation prompts
//   4) records placements when those URLs appear in a generated draft
//   5) surfaces give/receive opportunities for Studio + CLI
//
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { hasBacklinkNetwork } from '$lib/plans';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type NetworkCandidate = {
  brandId: string;
  brandName: string;
  articleId: string;
  title: string;
  url: string;
  category: string;
  relevance: number;
  suggestedAnchor: string;
  rationale: string;
};

export type BacklinkOpportunity = {
  id: string;
  direction: 'give' | 'receive';
  partnerBrandId: string;
  partnerBrandName: string;
  partnerArticleId: string | null;
  partnerUrl: string;
  partnerTitle: string | null;
  relevance: number;
  suggestedAnchor: string | null;
  rationale: string | null;
  status: string;
  createdAt: string;
};

export type BacklinkPlacement = {
  id: string;
  sourceBrandId: string;
  sourceArticleId: string | null;
  targetBrandId: string;
  targetArticleId: string | null;
  targetUrl: string;
  anchorText: string | null;
  status: string;
  createdAt: string;
  /** Populated for UI when known. */
  partnerName?: string | null;
  sourceTitle?: string | null;
  targetTitle?: string | null;
};

export type BacklinkNetworkSummary = {
  /** Opt-in flag (blog_config) — independent of plan. */
  enabled: boolean;
  /** Starter+ entitlement. */
  planAllowed: boolean;
  /** Plan + opt-in — network is fully usable. */
  unlocked: boolean;
  outgoing: BacklinkPlacement[];
  incoming: BacklinkPlacement[];
  opportunities: BacklinkOpportunity[];
  stats: {
    outgoingCount: number;
    incomingCount: number;
    openGive: number;
    openReceive: number;
  };
};

/** Opt-out flag on blog_config. Default ON so the marketed network works without a setup step.
 *  Plan entitlement is separate — see `canUseBacklinkNetwork`. */
export function isBacklinkNetworkEnabled(blogConfig: unknown): boolean {
  const cfg = (blogConfig ?? {}) as AnyRec;
  if (cfg.backlinkNetwork === false) return false;
  return true;
}

/** Starter+ plan AND blog opt-in. Free / Go never participate (give or receive). */
export function canUseBacklinkNetwork(
  plan: string | null | undefined,
  blogConfig?: unknown
): boolean {
  return hasBacklinkNetwork(plan) && isBacklinkNetworkEnabled(blogConfig);
}

const STOP = new Set(
  'the a an and or of to in for on with your you our we is are how what why when come cosa perche gli una uno del della delle dei nel nei alla dai per con che non più sono der die das und oder mit von zu den dem'.split(
    ' '
  )
);

/** Pure: tokenize a free-text field into significant lowercase terms. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (w.length > 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/** Pure: Jaccard-ish overlap of two token sets, 0–1. */
export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Pure relevance score 0–100 for linking from a source brand into a partner article.
 * Category match is the strongest signal; title/about overlap fills the rest.
 */
export function scoreNetworkRelevance(opts: {
  sourceCategory?: string | null;
  sourceAbout?: string | null;
  sourceAudience?: string | null;
  targetCategory?: string | null;
  targetAbout?: string | null;
  articleTitle?: string | null;
  articleMeta?: string | null;
}): number {
  const srcCat = String(opts.sourceCategory ?? '')
    .trim()
    .toLowerCase();
  const tgtCat = String(opts.targetCategory ?? '')
    .trim()
    .toLowerCase();
  let score = 0;
  if (srcCat && tgtCat) {
    if (srcCat === tgtCat) score += 45;
    else if (srcCat.includes(tgtCat) || tgtCat.includes(srcCat)) score += 28;
    else {
      const catOverlap = tokenOverlap(tokenize(srcCat), tokenize(tgtCat));
      score += Math.round(catOverlap * 22);
    }
  }

  const sourceBag = tokenize(
    `${opts.sourceCategory ?? ''} ${opts.sourceAbout ?? ''} ${opts.sourceAudience ?? ''}`
  );
  const targetBag = tokenize(
    `${opts.targetCategory ?? ''} ${opts.targetAbout ?? ''} ${opts.articleTitle ?? ''} ${opts.articleMeta ?? ''}`
  );
  score += Math.round(tokenOverlap(sourceBag, targetBag) * 55);

  // Soft floor when both sides have a category but little text overlap — still potentially useful.
  if (score < 12 && srcCat && tgtCat && srcCat === tgtCat) score = 18;
  return Math.max(0, Math.min(100, score));
}

/** Pure: pick a short anchor from the article title (first 4–6 significant words). */
export function suggestAnchor(title: string): string {
  const words = String(title ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'this guide';
  return words.slice(0, Math.min(6, Math.max(3, words.length))).join(' ');
}

/** Build the public hosted URL for a published article (custom domain or /blog/{slug}/…). */
export async function publicArticleUrl(
  admin: SupabaseClient,
  brandId: string,
  articleSlug: string
): Promise<string | null> {
  const { data: site } = await admin
    .from('brand_sites')
    .select('host')
    .eq('brand_id', brandId)
    .eq('verified', true)
    .limit(1)
    .maybeSingle();
  if (site?.host) return `https://${site.host}/${articleSlug}`;

  const { data: b } = await admin.from('brands').select('blog_slug, id').eq('id', brandId).maybeSingle();
  const appUrl = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!appUrl) return null;
  return `${appUrl}/blog/${b?.blog_slug || b?.id}/${articleSlug}`;
}

type PartnerRow = {
  brandId: string;
  brandName: string;
  category: string;
  about: string;
  articleId: string;
  title: string;
  meta: string;
  slug: string;
  url: string;
};

/** Load partner brands that opted into the network and have published originals. */
async function loadPartnerArticles(
  admin: SupabaseClient,
  excludeBrandId: string,
  limitBrands = 40
): Promise<PartnerRow[]> {
  // blog_config is jsonb — filter in JS (PostgREST jsonb predicates vary by version).
  const { data: brands } = await admin
    .from('brands')
    .select('id, name, plan, blog_config, blog_slug')
    .neq('id', excludeBrandId)
    .limit(200);
  const eligible = (brands ?? []).filter((b) => {
    const cfg = (b.blog_config ?? {}) as AnyRec;
    if (cfg.enabled !== true) return false;
    // Partner must also be on Starter+ — Free/Go never receive (or give) network links.
    return canUseBacklinkNetwork(b.plan, cfg);
  }).slice(0, limitBrands);
  if (!eligible.length) return [];

  const brandIds = eligible.map((b) => b.id as string);
  const [{ data: kits }, { data: arts }, { data: sites }] = await Promise.all([
    admin.from('brand_kit').select('brand_id, category, about, target_audience').in('brand_id', brandIds),
    admin
      .from('brand_articles')
      .select('id, brand_id, slug, title, meta_description, published_at')
      .in('brand_id', brandIds)
      .eq('status', 'published')
      .is('translation_of', null)
      .order('published_at', { ascending: false })
      .limit(200),
    admin.from('brand_sites').select('brand_id, host').in('brand_id', brandIds).eq('verified', true)
  ]);

  const kitBy = new Map((kits ?? []).map((k) => [k.brand_id as string, k]));
  const brandBy = new Map(eligible.map((b) => [b.id as string, b]));
  const hostBy = new Map((sites ?? []).map((s) => [s.brand_id as string, s.host as string]));
  const appUrl = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');

  // Keep at most 3 newest articles per partner brand.
  const perBrand = new Map<string, number>();
  const out: PartnerRow[] = [];
  for (const a of arts ?? []) {
    const bid = a.brand_id as string;
    const n = perBrand.get(bid) ?? 0;
    if (n >= 3) continue;
    const brand = brandBy.get(bid);
    if (!brand) continue;
    const host = hostBy.get(bid);
    let url: string | null = null;
    if (host) url = `https://${host}/${a.slug}`;
    else if (appUrl) url = `${appUrl}/blog/${brand.blog_slug || brand.id}/${a.slug}`;
    if (!url) continue;
    const kit = kitBy.get(bid);
    perBrand.set(bid, n + 1);
    out.push({
      brandId: bid,
      brandName: String(brand.name ?? ''),
      category: String(kit?.category ?? ''),
      about: String(kit?.about ?? ''),
      articleId: a.id as string,
      title: String(a.title ?? ''),
      meta: String(a.meta_description ?? ''),
      slug: String(a.slug ?? ''),
      url
    });
  }
  return out;
}

/**
 * Rank partner articles the source brand may link to. Soft-penalises partners that already
 * received many links from this brand recently (anti-farm balancing).
 */
export async function findNetworkCandidates(
  admin: SupabaseClient,
  brand: AnyRec,
  opts?: { limit?: number; minRelevance?: number }
): Promise<NetworkCandidate[]> {
  const limit = opts?.limit ?? 5;
  const minRelevance = opts?.minRelevance ?? 18;

  const [{ data: kit }, { data: brandRow }, { data: recentOut }] = await Promise.all([
    admin.from('brand_kit').select('category, about, target_audience').eq('brand_id', brand.id).maybeSingle(),
    admin.from('brands').select('blog_config, plan').eq('id', brand.id).maybeSingle(),
    admin
      .from('brand_backlink_placements')
      .select('target_brand_id')
      .eq('source_brand_id', brand.id)
      .neq('status', 'removed')
      .gte('created_at', new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString())
  ]);

  const plan = brandRow?.plan ?? brand.plan;
  const blogCfg = brandRow?.blog_config ?? brand.blog_config;
  if (!canUseBacklinkNetwork(plan, blogCfg)) return [];

  const recentHits = new Map<string, number>();
  for (const r of recentOut ?? []) {
    const id = r.target_brand_id as string;
    recentHits.set(id, (recentHits.get(id) ?? 0) + 1);
  }

  const partners = await loadPartnerArticles(admin, brand.id);
  const scored: NetworkCandidate[] = [];
  for (const p of partners) {
    let relevance = scoreNetworkRelevance({
      sourceCategory: kit?.category,
      sourceAbout: kit?.about,
      sourceAudience: kit?.target_audience,
      targetCategory: p.category,
      targetAbout: p.about,
      articleTitle: p.title,
      articleMeta: p.meta
    });
    const hits = recentHits.get(p.brandId) ?? 0;
    if (hits >= 3) relevance = Math.max(0, relevance - 25);
    else if (hits === 2) relevance = Math.max(0, relevance - 12);
    else if (hits === 1) relevance = Math.max(0, relevance - 4);

    if (relevance < minRelevance) continue;
    scored.push({
      brandId: p.brandId,
      brandName: p.brandName,
      articleId: p.articleId,
      title: p.title,
      url: p.url,
      category: p.category,
      relevance,
      suggestedAnchor: suggestAnchor(p.title),
      rationale:
        kit?.category && p.category && String(kit.category).toLowerCase() === p.category.toLowerCase()
          ? `Same category (${p.category}) — useful complementary reading.`
          : `Topically related to ${kit?.category || brand.name}'s audience.`
    });
  }

  scored.sort((a, b) => b.relevance - a.relevance);
  // At most one article per partner brand in the allow-list.
  const seen = new Set<string>();
  const unique: NetworkCandidate[] = [];
  for (const c of scored) {
    if (seen.has(c.brandId)) continue;
    seen.add(c.brandId);
    unique.push(c);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Compact prompt block. Empty string when the network has nothing useful. */
export function networkLinksBlock(candidates: NetworkCandidate[]): string {
  if (!candidates.length) return '';
  const lines = candidates
    .slice(0, 5)
    .map(
      (c) =>
        `- [${c.brandName}] ${c.title} → ${c.url} (suggested anchor: "${c.suggestedAnchor}"; relevance ${c.relevance})`
    )
    .join('\n');
  return `ANOMALIA NETWORK LINKS (optional — contextual backlinks to other Anomalia brands; use EXACT urls only; weave in 0–2 where they genuinely help the reader; never force a link; never invent a URL):
${lines}`.slice(0, 1600);
}

/** Scan article markdown for network URLs and persist placements (idempotent per article+url). */
export async function recordPlacementsFromArticle(
  admin: SupabaseClient,
  sourceBrandId: string,
  sourceArticleId: string,
  bodyMd: string,
  candidates: NetworkCandidate[]
): Promise<number> {
  if (!candidates.length || !bodyMd) return 0;
  const byUrl = new Map(candidates.map((c) => [c.url, c]));
  const found: Array<{ candidate: NetworkCandidate; anchor: string }> = [];

  for (const m of bodyMd.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)) {
    const anchor = m[1]?.trim() ?? '';
    const url = m[2]?.trim() ?? '';
    const c = byUrl.get(url);
    if (!c) continue;
    found.push({ candidate: c, anchor: anchor || c.suggestedAnchor });
  }
  if (!found.length) return 0;

  // Cap recorded network placements per article (anti-spam).
  const unique = new Map<string, { candidate: NetworkCandidate; anchor: string }>();
  for (const f of found) {
    if (unique.size >= 2) break;
    if (!unique.has(f.candidate.url)) unique.set(f.candidate.url, f);
  }

  let written = 0;
  for (const { candidate: c, anchor } of unique.values()) {
    const { data: existing } = await admin
      .from('brand_backlink_placements')
      .select('id')
      .eq('source_article_id', sourceArticleId)
      .eq('target_url', c.url)
      .maybeSingle();
    if (existing?.id) {
      await admin
        .from('brand_backlink_placements')
        .update({
          anchor_text: anchor.slice(0, 120),
          status: 'draft',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await admin.from('brand_backlink_placements').insert({
        source_brand_id: sourceBrandId,
        source_article_id: sourceArticleId,
        target_brand_id: c.brandId,
        target_article_id: c.articleId,
        target_url: c.url,
        anchor_text: anchor.slice(0, 120),
        status: 'draft'
      });
    }
    // Mark matching open "give" opportunity as placed (best-effort).
    await admin
      .from('brand_backlink_opportunities')
      .update({ status: 'placed', updated_at: new Date().toISOString() })
      .eq('brand_id', sourceBrandId)
      .eq('direction', 'give')
      .eq('partner_article_id', c.articleId)
      .eq('status', 'open');
    written++;
  }
  return written;
}

/** Flip draft → published when the source article publishes (best-effort). */
export async function markPlacementsPublished(
  admin: SupabaseClient,
  sourceArticleId: string
): Promise<void> {
  await admin
    .from('brand_backlink_placements')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('source_article_id', sourceArticleId)
    .eq('status', 'draft');
}

/**
 * Generate / refresh open opportunities for a brand:
 * - give: articles THIS brand should link to (outgoing)
 * - receive: articles OTHER brands could link to THIS brand's published posts (incoming potential)
 */
export async function generateBacklinkOpportunities(
  admin: SupabaseClient,
  brand: AnyRec
): Promise<{ give: number; receive: number }> {
  const { data: brandRow } = await admin.from('brands').select('blog_config, plan, name').eq('id', brand.id).maybeSingle();
  if (!canUseBacklinkNetwork(brandRow?.plan ?? brand.plan, brandRow?.blog_config ?? brand.blog_config)) {
    return { give: 0, receive: 0 };
  }

  // Clear previous open opportunities so the list stays fresh.
  await admin
    .from('brand_backlink_opportunities')
    .delete()
    .eq('brand_id', brand.id)
    .eq('status', 'open');

  const giveCandidates = await findNetworkCandidates(admin, brand, { limit: 12, minRelevance: 15 });
  const giveRows = giveCandidates.map((c) => ({
    brand_id: brand.id,
    direction: 'give' as const,
    partner_brand_id: c.brandId,
    partner_article_id: c.articleId,
    partner_url: c.url,
    partner_title: c.title,
    partner_brand_name: c.brandName,
    relevance: c.relevance,
    suggested_anchor: c.suggestedAnchor,
    rationale: c.rationale,
    status: 'open' as const
  }));

  // Receive: score OUR published articles against each partner brand's kit — same relevance math,
  // flipped. Partners that would score us highly are the ones most likely to link in.
  const { data: ourArts } = await admin
    .from('brand_articles')
    .select('id, slug, title, meta_description')
    .eq('brand_id', brand.id)
    .eq('status', 'published')
    .is('translation_of', null)
    .order('published_at', { ascending: false })
    .limit(8);
  const { data: ourKit } = await admin
    .from('brand_kit')
    .select('category, about, target_audience')
    .eq('brand_id', brand.id)
    .maybeSingle();

  const receiveRows: AnyRec[] = [];
  if (ourArts?.length) {
    const partners = await loadPartnerArticles(admin, brand.id, 30);
    // Group by partner brand (use first article only as a stand-in for the partner identity).
    const partnerBrands = new Map<string, PartnerRow>();
    for (const p of partners) {
      if (!partnerBrands.has(p.brandId)) partnerBrands.set(p.brandId, p);
    }
    const scored: Array<{
      partner: PartnerRow;
      art: (typeof ourArts)[number];
      url: string;
      relevance: number;
    }> = [];
    for (const art of ourArts) {
      const url = await publicArticleUrl(admin, brand.id, art.slug as string);
      if (!url) continue;
      for (const partner of partnerBrands.values()) {
        const relevance = scoreNetworkRelevance({
          sourceCategory: partner.category,
          sourceAbout: partner.about,
          targetCategory: ourKit?.category,
          targetAbout: ourKit?.about,
          sourceAudience: null,
          articleTitle: art.title,
          articleMeta: art.meta_description
        });
        if (relevance < 18) continue;
        scored.push({ partner, art, url, relevance });
      }
    }
    scored.sort((a, b) => b.relevance - a.relevance);
    const seenPartner = new Set<string>();
    for (const s of scored) {
      if (seenPartner.has(s.partner.brandId)) continue;
      seenPartner.add(s.partner.brandId);
      receiveRows.push({
        brand_id: brand.id,
        direction: 'receive',
        partner_brand_id: s.partner.brandId,
        partner_article_id: s.art.id,
        partner_url: s.url,
        partner_title: s.art.title,
        partner_brand_name: s.partner.brandName,
        relevance: s.relevance,
        suggested_anchor: suggestAnchor(String(s.art.title ?? '')),
        rationale: `Partner "${s.partner.brandName}" is a topical fit to link your article.`,
        status: 'open'
      });
      if (receiveRows.length >= 12) break;
    }
  }

  const all = [...giveRows, ...receiveRows];
  if (all.length) {
    await admin.from('brand_backlink_opportunities').insert(all);
  }
  return { give: giveRows.length, receive: receiveRows.length };
}

export async function loadBacklinkNetworkSummary(
  supabase: SupabaseClient,
  brandId: string
): Promise<BacklinkNetworkSummary> {
  const [{ data: brandRow }, { data: outRows }, { data: inRows }, { data: opps }] = await Promise.all([
    supabase.from('brands').select('blog_config, plan').eq('id', brandId).maybeSingle(),
    supabase
      .from('brand_backlink_placements')
      .select('id, source_brand_id, source_article_id, target_brand_id, target_article_id, target_url, anchor_text, status, created_at')
      .eq('source_brand_id', brandId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('brand_backlink_placements')
      .select('id, source_brand_id, source_article_id, target_brand_id, target_article_id, target_url, anchor_text, status, created_at')
      .eq('target_brand_id', brandId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('brand_backlink_opportunities')
      .select(
        'id, direction, partner_brand_id, partner_article_id, partner_url, partner_title, partner_brand_name, relevance, suggested_anchor, rationale, status, created_at'
      )
      .eq('brand_id', brandId)
      .eq('status', 'open')
      .order('relevance', { ascending: false })
      .limit(40)
  ]);

  const planOk = hasBacklinkNetwork(brandRow?.plan);
  const optIn = isBacklinkNetworkEnabled(brandRow?.blog_config);

  const mapPlacement = (r: AnyRec): BacklinkPlacement => ({
    id: r.id,
    sourceBrandId: r.source_brand_id,
    sourceArticleId: r.source_article_id,
    targetBrandId: r.target_brand_id,
    targetArticleId: r.target_article_id,
    targetUrl: r.target_url,
    anchorText: r.anchor_text,
    status: r.status,
    createdAt: r.created_at
  });

  const outgoing = (outRows ?? []).map(mapPlacement);
  const incoming = (inRows ?? []).map(mapPlacement);
  const opportunities: BacklinkOpportunity[] = (opps ?? []).map((o) => ({
    id: o.id,
    direction: o.direction as 'give' | 'receive',
    partnerBrandId: o.partner_brand_id,
    partnerBrandName: o.partner_brand_name ?? '',
    partnerArticleId: o.partner_article_id,
    partnerUrl: o.partner_url,
    partnerTitle: o.partner_title,
    relevance: Number(o.relevance ?? 0),
    suggestedAnchor: o.suggested_anchor,
    rationale: o.rationale,
    status: o.status,
    createdAt: o.created_at
  }));

  // Enrich partner names for placements (best-effort).
  const partnerIds = [
    ...new Set([
      ...outgoing.map((p) => p.targetBrandId),
      ...incoming.map((p) => p.sourceBrandId)
    ])
  ];
  if (partnerIds.length) {
    const { data: names } = await supabase.from('brands').select('id, name').in('id', partnerIds);
    const nameBy = new Map((names ?? []).map((n) => [n.id as string, n.name as string]));
    for (const p of outgoing) p.partnerName = nameBy.get(p.targetBrandId) ?? null;
    for (const p of incoming) p.partnerName = nameBy.get(p.sourceBrandId) ?? null;
  }

  return {
    enabled: optIn,
    planAllowed: planOk,
    unlocked: planOk && optIn,
    outgoing,
    incoming,
    opportunities,
    stats: {
      outgoingCount: outgoing.length,
      incomingCount: incoming.length,
      openGive: opportunities.filter((o) => o.direction === 'give').length,
      openReceive: opportunities.filter((o) => o.direction === 'receive').length
    }
  };
}

/** Convenience: candidates + prompt block for blog generation. */
export async function loadNetworkLinksForPrompt(
  admin: SupabaseClient,
  brand: AnyRec
): Promise<NetworkCandidate[]> {
  if (!hasBacklinkNetwork(brand.plan)) return [];
  return findNetworkCandidates(admin, brand, { limit: 5, minRelevance: 20 }).catch((error) => { swallow('find network candidates', error); return []; });
}
