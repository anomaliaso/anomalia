// Blog article generator (Phase 0). Turns a SEO 'blog' initiative into a FULL long-form article
// (not just the outline seo-advisor produces), grounded in the brand's voice AND its own indexed
// pages (content library) so the article links to REAL internal URLs and never invents facts/URLs.
// Stored as a draft in brand_articles for review + export. Publishing (hosted/CMS) comes later.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROOF_DISCIPLINE_RULE } from '$lib/server/proof-discipline';
import { env as publicEnv } from '$env/dynamic/public';
import { genaiClient, structured, groundedText } from './research';
import { bestVariant } from './geo-artifacts';
import { getBrandPages } from './content-library';
import { formatProductsList, getBrandProductsForAi } from './product-context';
import { scoreArticle } from './article-score';
import { brandContacts } from './scheduler';
import { blogStyleBlock } from './blog-style';
import { wallClockToUtc } from './schedule';
import { blogArticlesPerWeek, blogArticlesPerWeekMax, blogArticlesPerMonth } from './plans';
import { ensureKeywordStrategy, keywordStrategyBlock } from './seo-keyword-strategy';
import { PIN_GEMINI } from './xiaomi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// Long-form blog writing runs on Gemini Flash — never MiMo/Kie, whatever GTM_PROVIDER says. MiMo
// used to own this path and was the single source of every HTTP 401 in the blog cron windows (it
// fell through to Gemini anyway, after paying for the failed call). Poi ci ha provato DeepSeek, con
// lo stesso esito silenzioso: un tentativo condannato prima di ogni articolo. Il prezzo di questo
// lavoro è quello di Gemini Flash, e blog-cost.ts lo calcola da lì.
const BLOG_AI = PIN_GEMINI;

const REVIEWER =
  'You are a senior content editor. Reward articles that are specific, genuinely useful and factually careful. Penalize fluff, hype, invented statistics and any claim not supported by the brand context. NEVER fabricate facts, sources or URLs.';

// Flip every article whose scheduled publish time has arrived to 'published'. Run by the blog
// publish cron. Also pushes the newly-published articles to Shopify per brand (no-op when a brand
// has no integration), mirroring the manual "Publish site". `only` scopes to one brand. Returns how
// many were published.
// SAFETY: only 'approved' articles are eligible — that status is set exclusively by a human (the
// manual "Schedule" action). Auto-generated drafts (status 'draft', however they got a
// scheduled_for) must NEVER auto-publish without review.
export async function publishDueArticles(admin: SupabaseClient, only?: string): Promise<number> {
  const nowIso = new Date().toISOString();
  let q = admin
    .from('brand_articles')
    .select('id, brand_id, slug')
    .eq('status', 'approved')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', nowIso);
  if (only) q = q.eq('brand_id', only);
  const { data: due } = await q;
  if (!due?.length) return 0;

  const ids = due.map((a) => a.id);
  const { error } = await admin.from('brand_articles').update({ status: 'published', published_at: nowIso }).in('id', ids);
  if (error) return 0;

  // Instant indexing (IndexNow + Exa) so fresh articles are picked up by Bing/AI engines in
  // minutes. AWAITED: in serverless the instance is frozen as soon as the tick responds, so a
  // fire-and-forget ping is simply lost. notifyIndexers never throws and every call inside it
  // carries a 10s timeout, so awaiting it is bounded.
  const { notifyIndexers } = await import('./indexing');
  const byBrandSlugs = new Map<string, string[]>();
  for (const a of due) {
    const list = byBrandSlugs.get(a.brand_id) ?? [];
    if (a.slug) list.push(a.slug);
    byBrandSlugs.set(a.brand_id, list);
  }
  await Promise.allSettled(
    [...byBrandSlugs].map(([brandId, slugs]) => notifyIndexers(admin, brandId, slugs))
  );

  // Semi-automatic SFB: per published article, propose a 0-credit external-listing draft
  // (non-fatal — never blocks the publish tick). Submit stays manual: owner attestations + credits.
  const { proposeBacklinkOrder } = await import('./backlink-external');
  for (const a of due) await proposeBacklinkOrder(admin, a.brand_id, a.id).catch(swallow('propose backlink order'));

  // Internal linking: append "See also" links to freshly published articles BEFORE the CMS sync,
  // so an external CMS never receives a body without the links (non-fatal).
  const { applyInternalLinks } = await import('./internal-links');
  for (const a of due) await applyInternalLinks(admin, a.brand_id, a.id).catch(swallow('apply internal links'));

  const { markPlacementsPublished } = await import('./backlink-network');
  for (const id of ids) await markPlacementsPublished(admin, id).catch(swallow('mark placements published'));

  const byBrand = new Map<string, string[]>();
  for (const a of due) byBrand.set(a.brand_id, [...(byBrand.get(a.brand_id) ?? []), a.id]);
  const { syncArticlesToCMS } = await import('./cms-sync');
  for (const [brandId, bIds] of byBrand) await syncArticlesToCMS(admin, brandId, bIds).catch(swallow('sync articles to cms'));
  return ids.length;
}

/**
 * How much of this calendar month's article allowance is left for AUTOMATED generation.
 *
 * Counts both articles already produced and month-plan placeholders still waiting to be written —
 * otherwise planning a month would look free (placeholders have no body yet) and a second plan on
 * the same month would double-book the allowance.
 */
export async function blogMonthlyUsage(
  admin: SupabaseClient,
  brandId: string,
  plan: string | null | undefined
): Promise<{ cap: number; used: number; remaining: number }> {
  const cap = blogArticlesPerMonth(plan);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from('brand_articles')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    // ORIGINALS only. The ceiling is about how much the brand commissions, not how many languages it
    // ships in — a Pro brand shipping 4 languages would otherwise burn its month in 7 articles.
    .is('translation_of', null)
    .gte('created_at', monthStart.toISOString());
  const used = count ?? 0;
  return { cap, used, remaining: Math.max(0, cap - used) };
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'article';

const ARTICLE_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const, description: 'The article H1 / title.' },
    slug: { type: 'string' as const, description: 'URL slug (lowercase, hyphenated).' },
    metaTitle: { type: 'string' as const, description: 'SEO title tag, under 60 characters.' },
    metaDescription: { type: 'string' as const, description: 'SEO meta description, under 155 characters.' },
    bodyMarkdown: {
      type: 'string' as const,
      description:
        "The COMPLETE article in Markdown, 1200-2500 words: a strong intro that answers the query up front, then ## / ### sections with real substance, a short dedicated section highlighting 1-3 relevant products/services when the catalog lists them (with exact product URLs), and a short conclusion. Use inline Markdown links [anchor](url) to the brand's OWN pages AND product pages from the provided lists where genuinely relevant (2-6 page links + relevant product links), with their EXACT urls. Optional product images only via the listed img= URLs. Do NOT include the H1 (the title field is the H1). No invented statistics, quotes, or links."
    }
  },
  required: ['title', 'slug', 'metaTitle', 'metaDescription', 'bodyMarkdown']
};

/**
 * Generate a full article for one SEO 'blog' initiative and store it as a draft. Thin wrapper over
 * the shared core. Returns the new article id, or null on failure.
 */
export async function generateArticle(admin: SupabaseClient, brand: AnyRec, initiativeId: string): Promise<string | null> {
  const { data: plan } = await admin
    .from('brand_seo_plans').select('initiatives').eq('brand_id', brand.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const init = ((plan?.initiatives as AnyRec[]) ?? []).find((i) => i.id === initiativeId);
  if (!init) return null;
  return generateAndStore(admin, brand, { title: init.title, targetQuery: init.targetQuery, rationale: init.rationale, sourceInitiativeId: initiativeId });
}

/** Generate a full article from a free-form topic the user typed (no SEO initiative needed). */
export async function generateArticleFromTopic(admin: SupabaseClient, brand: AnyRec, topic: string): Promise<string | null> {
  const t = topic.trim().slice(0, 200);
  if (!t) return null;
  return generateAndStore(admin, brand, { title: t, targetQuery: t, rationale: '', sourceInitiativeId: null });
}

const TOPICS_SCHEMA = {
  type: 'object' as const,
  properties: {
    topics: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'A specific, compelling blog article title.' },
          angle: { type: 'string' as const, description: 'One line: the take / what makes it useful to the audience.' },
          targetKeyword: { type: 'string' as const, description: 'The exact search keyword this article attacks, from the SEO attack strategy when applicable (empty string if none fits).' }
        },
        required: ['title', 'angle']
      }
    }
  },
  required: ['topics']
};

// Propose `count` strategic blog topics grounded in the brand's editorial plan + voice, distinct
// from what already exists. Shared by the draft batch (generateBlogBatchFromPlan) and the month
// planner (planBlogMonth).
async function proposeBlogTopics(admin: SupabaseClient, brand: AnyRec, count: number): Promise<Array<{ title: string; angle: string; targetKeyword?: string }>> {
  const [{ data: kit }, { data: plan }, { data: existing }, { data: social }] = await Promise.all([
    admin.from('brand_kit').select('about, ai_context, category, target_audience, content_pillars').eq('brand_id', brand.id).maybeSingle(),
    admin.from('editorial_plans').select('strategy, weeks').eq('brand_id', brand.id).eq('status', 'active').maybeSingle(),
    admin.from('brand_articles').select('title').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(30),
    // What the social pipeline is covering right now — so the blog ALIGNS with it but goes deeper.
    admin.from('posts').select('pillar, angle, caption').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(20)
  ]);
  const pages = await getBrandPages(admin, brand.id, 15).catch((error) => { swallow('load brand pages', error); return []; });
  const keywordStrategy = await ensureKeywordStrategy(admin, brand).catch((error) => { swallow('ensure keyword strategy', error); return null; });
  const pillars = Array.isArray(kit?.content_pillars) ? (kit!.content_pillars as string[]).filter(Boolean) : [];
  const weekThemes = Array.isArray(plan?.weeks) ? (plan!.weeks as AnyRec[]).map((w) => w?.theme).filter(Boolean).slice(0, 4) : [];
  const existingTitles = (existing ?? []).map((a) => `- ${a.title}`).join('\n') || '(none)';
  const socialCoverage = (social ?? [])
    .map((p) => (p.angle || (p.caption ? String(p.caption).split('\n')[0] : '')) as string)
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 90))
    .filter(Boolean).slice(0, 12);

  const prompt = `Propose ${count} STRATEGIC blog article topics for this brand — timeless/evergreen pieces that serve its audience and rank over time, ALIGNED with the same editorial strategy the social content follows.

BRAND: ${brand.name} — ${String(kit?.about ?? '').slice(0, 400)}
Category: ${kit?.category ?? ''}. Audience: ${kit?.target_audience ?? ''}
${pillars.length ? `Content pillars: ${pillars.join('; ')}` : ''}
${plan?.strategy ? `Editorial strategy (shared with social): ${String(plan.strategy).slice(0, 500)}` : ''}
${weekThemes.length ? `Editorial themes: ${weekThemes.join(' · ')}` : ''}
${socialCoverage.length ? `WHAT THE SOCIAL CONTENT IS COVERING (align to these themes, but do NOT mirror them 1:1 — the blog goes DEEPER: the definitive, evergreen, linkable long-form version a social post can point to):\n${socialCoverage.map((s) => `- ${s}`).join('\n')}` : ''}
${pages.length ? `Existing site pages (don't duplicate; complement them):\n${pages.slice(0, 10).map((p) => `- ${p.title || p.url}`).join('\n')}` : ''}
${keywordStrategyBlock(keywordStrategy)}

ALREADY WRITTEN (do NOT repeat these):
${existingTitles}

Alignment rule: same strategic direction as social, complementary NOT duplicative — a blog piece is the deep/evergreen anchor, not a rewrite of a social post. Where a strategy keyword fits, each topic should attack one (set targetKeyword to it; empty string otherwise). Return exactly ${count} DISTINCT topics (title + angle + targetKeyword).`;

  const out = await bestVariant<{ topics?: Array<{ title: string; angle: string; targetKeyword?: string }> }>(
    genaiClient(), () => prompt, TOPICS_SCHEMA, REVIEWER, 'blog_plan_topics',
    (v) => (v?.topics ?? []).map((t) => t.title).slice(0, 4).join(' | '),
    BLOG_AI
  ).catch((error) => { swallow('join failed', error); return null; });
  return (out?.topics ?? []).slice(0, count);
}

// STRATEGIC blog pass: propose `count` blog topics grounded in the brand's editorial plan + voice,
// distinct from what already exists, then generate them as drafts. The "second loading" for the blog
// alongside the social content pipeline. Returns how many were generated.
export async function generateBlogBatchFromPlan(
  admin: SupabaseClient,
  brand: AnyRec,
  count = 2,
  opts?: { source?: string; scheduledFor?: (string | null)[] }
): Promise<number> {
  const topics = await proposeBlogTopics(admin, brand, count);
  let n = 0;
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    const id = await generateAndStore(admin, brand, {
      title: t.title,
      targetQuery: t.targetKeyword || t.title,
      rationale: t.angle,
      sourceInitiativeId: null,
      source: opts?.source,
      scheduledFor: opts?.scheduledFor?.[i] ?? null
    });
    if (id) n++;
  }
  return n;
}

// MONTH PLAN: propose ~4 weeks of blog topics in ONE AI pass and store them as 'planned'
// placeholder rows (title, angle riding in meta_description, scheduled_for, empty body). They show
// up in the site list and on the calendar so the user sees the whole month ahead; the autopilot
// drip (or the "Genera ora" action) turns each one into a full draft via generatePlannedArticle.
// 'planned' rows are invisible to the public blog (status filter) and can never publish
// (publishDueArticles only flips 'approved'). Returns how many topics were planned.
export async function planBlogMonth(admin: SupabaseClient, brand: AnyRec): Promise<number> {
  const { data: b } = await admin.from('brands').select('timezone, blog_config, content_prefs, plan').eq('id', brand.id).maybeSingle();
  const tz = (b?.timezone as string) || 'Europe/Rome';
  const apw = (b?.blog_config as AnyRec)?.articlesPerWeek;
  const perWeek =
    apw == null
      ? blogArticlesPerWeek(b?.plan as string | null)
      : Math.max(0, Math.min(blogArticlesPerWeekMax(b?.plan as string | null), Number(apw) || 0));
  if (!perWeek) return 0; // blog cadence paused → nothing to plan
  // Never plan past the monthly ceiling: the cadence says how to SPREAD the month, the plan says how
  // many the brand is entitled to. Planning 28 when 6 are left would queue work that later silently
  // fails the cap check, so the plan is trimmed to what's actually available.
  const { remaining } = await blogMonthlyUsage(admin, brand.id as string, b?.plan as string | null);
  if (remaining <= 0) return 0;
  const topics = await proposeBlogTopics(admin, brand, Math.min(perWeek * 4, remaining));
  if (!topics.length) return 0;

  // Spread at the weekly cadence, 10:00 brand time, starting tomorrow, skipping days that already
  // have a scheduled or planned article (same convention as the site page's scheduleAllDrafts).
  const { data: taken } = await admin.from('brand_articles').select('scheduled_for')
    .eq('brand_id', brand.id).not('scheduled_for', 'is', null).gte('scheduled_for', new Date().toISOString());
  const dayInTz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const takenDays = new Set((taken ?? []).map((a) => dayInTz(new Date(a.scheduled_for as string))));
  const stepDays = Math.max(1, Math.round(7 / perWeek));
  const language = ((b?.content_prefs as AnyRec)?.language as string) || (brand.content_prefs?.language as string) || 'Italian';

  let cursor = new Date();
  const rows = topics.map((t) => {
    do { cursor = new Date(cursor.getTime() + 86400000); } while (takenDays.has(dayInTz(cursor)));
    const day = dayInTz(cursor);
    takenDays.add(day);
    cursor = new Date(cursor.getTime() + (stepDays - 1) * 86400000);
    return {
      brand_id: brand.id,
      slug: slugify(t.title),
      title: String(t.title).slice(0, 200),
      meta_description: String(t.angle ?? '').slice(0, 200) || null, // the angle, until generation overwrites it
      meta_title: String(t.targetKeyword ?? '').slice(0, 70) || null, // riding the targetKeyword until generation overwrites it with the real meta title
      body_md: '',
      language,
      status: 'planned',
      source: 'plan',
      source_initiative_id: null,
      scheduled_for: wallClockToUtc(day, '10:00', tz)
    };
  });
  const { error } = await admin.from('brand_articles').insert(rows);
  return error ? 0 : rows.length;
}

// Turn one month-plan placeholder into a full draft (keeping its slot on the calendar), then drop
// the placeholder. Used by the autopilot drip on the placeholder's day and by the site page's
// "Genera ora". Returns the new article id, or null.
export async function generatePlannedArticle(
  admin: SupabaseClient, brand: AnyRec, plannedId: string, opts?: { skipNotify?: boolean; skipImages?: boolean }
): Promise<string | null> {
  const { data: p } = await admin.from('brand_articles')
    .select('id, title, meta_description, meta_title, scheduled_for')
    .eq('id', plannedId).eq('brand_id', brand.id).eq('status', 'planned').maybeSingle();
  if (!p) return null;
  // Overdue placeholder (autopilot was off) → land it 30 minutes from now instead of in the past.
  const slot = p.scheduled_for && Date.parse(String(p.scheduled_for)) > Date.now()
    ? String(p.scheduled_for)
    : new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const id = await generateAndStore(admin, brand, {
    // meta_title carried the plan's targetKeyword (see planBlogMonth) until now, when it's overwritten
    // with the real meta title.
    title: p.title, targetQuery: p.meta_title || p.title, rationale: p.meta_description ?? '',
    sourceInitiativeId: null, source: 'plan', scheduledFor: slot, skipNotify: opts?.skipNotify, skipImages: opts?.skipImages
  });
  if (id) await admin.from('brand_articles').delete().eq('id', p.id).eq('status', 'planned');
  return id;
}

// REACTIVE blog pass: a full article reacting to / expanding on a news item, from the brand's angle.
// Used by the radar. `opts.skipNotify` suppresses the per-article email (the radar sends its own
// daily recap instead). Returns the new article id, or null.
export async function generateBlogFromNews(
  admin: SupabaseClient,
  brand: AnyRec,
  item: { title: string; url?: string; context?: string },
  opts?: { skipNotify?: boolean }
): Promise<string | null> {
  const rationale = `React to and expand on this current news from the brand's own expertise and stance — a timely, useful blog take (not a mere summary): "${item.title}"${item.context ? ` — ${item.context}` : ''}.${item.url ? ` Source: ${item.url}` : ''}`;
  return generateAndStore(admin, brand, { title: item.title.slice(0, 200), targetQuery: item.title.slice(0, 200), rationale, sourceInitiativeId: null, source: 'radar', skipNotify: opts?.skipNotify });
}

type ArticleSpec = {
  title: string;
  targetQuery: string;
  rationale?: string;
  sourceInitiativeId: string | null;
  source?: string;
  scheduledFor?: string | null;
  skipNotify?: boolean;
  // Batch-mode month jobs render images later, in ONE Gemini Batch job (see blog-month.ts):
  // this suppresses the inline render so the text lands fast and the images arrive at 1/4 the cost.
  skipImages?: boolean;
};

// Shared core: ground the article in the brand's voice + its own indexed pages, generate with
// variants+reviewer, store as a draft. Used by both the initiative and free-topic entry points.
async function generateAndStore(admin: SupabaseClient, brand: AnyRec, spec: ArticleSpec): Promise<string | null> {
  const init = { title: spec.title, targetQuery: spec.targetQuery, rationale: spec.rationale ?? '' };
  const [{ data: kit }, { data: brandRow }] = await Promise.all([
    admin.from('brand_kit').select('about, ai_context, category, target_audience').eq('brand_id', brand.id).maybeSingle(),
    admin.from('brands').select('blog_config').eq('id', brand.id).maybeSingle()
  ]);
  const language = (brand.content_prefs?.language as string) || 'Italian';
  const styleInstructions = String((brandRow?.blog_config as AnyRec)?.styleInstructions ?? '').trim().slice(0, 1500);

  // The brand's own indexed pages → real internal links + factual anchors.
  // Products with PDP URLs → real product links + optional highlight section.
  const [pages, products] = await Promise.all([
    getBrandPages(admin, brand.id, 20).catch((error) => { swallow('load brand pages', error); return []; }),
    getBrandProductsForAi(admin, brand.id, 25).catch((error) => { swallow('load product catalog', error); return []; })
  ]);
  const pagesList = pages.length
    ? pages.map((p) => `- ${p.title || p.url} → ${p.url}${Array.isArray(p.topics) && p.topics.length ? ` [${p.topics.slice(0, 4).join(', ')}]` : ''}`).join('\n')
    : '(no indexed pages yet — do not invent internal links)';
  const productsList = formatProductsList(products);
  const keywordStrategy = await ensureKeywordStrategy(admin, brand).catch((error) => { swallow('ensure keyword strategy', error); return null; });
  const { loadNetworkLinksForPrompt, networkLinksBlock, recordPlacementsFromArticle } = await import(
    './backlink-network'
  );
  const networkCandidates = await loadNetworkLinksForPrompt(admin, brand).catch((error) => { swallow('load network link candidates', error); return []; });
  const networkBlock = networkLinksBlock(networkCandidates);

  // PREFIX ORDER IS LOAD-BEARING. DeepSeek prefix-caches automatically and charges cache hits 50×
  // less on input ($0.0028 vs $0.14 / 1M), but only when the prefix matches byte-for-byte. Everything
  // brand-constant (voice, pages, keywords, rules, style) therefore comes FIRST and identical across
  // every article of the month; the per-article angle goes LAST. Putting targetQuery on line 1 — as
  // this prompt used to — gave a different prefix per article and a 0% hit rate on ~1.5k shared tokens.
  // Network candidates are brand-scoped but change slowly; they sit with the other brand-constant blocks.
  const sharedPrefix = `You write COMPLETE, publish-ready blog articles for this brand.

BRAND: ${brand.name} — ${String(kit?.about ?? '').slice(0, 400)}
Category: ${kit?.category ?? ''}. Audience: ${kit?.target_audience ?? ''}
Voice & context (authoritative — write in THIS voice, never contradict it):
${String(kit?.ai_context ?? '').slice(0, 1000) || '(none)'}

THE BRAND'S OWN PAGES you may link to (use EXACT urls, only where relevant — these are the ONLY site-page links allowed; never invent a URL):
${pagesList}

PRODUCTS & SERVICES you may link to (use EXACT product page urls only when listed — never invent a product URL; skip products marked "(no page URL)" for links):
${productsList}
${keywordStrategyBlock(keywordStrategy)}
${networkBlock ? `\n${networkBlock}\n` : ''}
Rules:
- Answer the query up front, then go deep. 1200-2500 words. Concrete, useful, honest — no hype, no filler, no invented statistics.
- Link 2-6 of the brand's own pages inline with Markdown [anchor](exact-url) where they genuinely help the reader.
- When products are relevant to the topic, link them inline AND include one short dedicated ## section that highlights 1-3 matching products/services (name + one-line value + exact product URL). Prefer ★ featured products. You may embed a product image with ![name](img-url) ONLY when an img= URL is listed for that product.
- Optionally weave in 0–2 Anomalia network links from the list above when they genuinely help the reader — never force them, never invent a network URL.
- Sensitive/factual topics: be accurate and measured; never state a fact you cannot support from the brand context. When unsure, frame it as such rather than asserting.
${PROOF_DISCIPLINE_RULE}
- The article must genuinely target its search query and, where natural, support the SEO attack keywords — without keyword stuffing.
- Write everything in ${language}. Return JSON (title is the H1 — do NOT repeat it inside bodyMarkdown).

${blogStyleBlock(styleInstructions)}`;

  const makePrompt = () => `${sharedPrefix}

── THIS ARTICLE ──────────────────────────────────────────────────────────────
Write the article that will rank for "${init.targetQuery}".
ARTICLE ANGLE: ${init.title}
${init.rationale ? `Why it matters: ${init.rationale}` : ''}`;

  const ai = genaiClient();
  const article = await bestVariant<AnyRec>(
    ai, makePrompt, ARTICLE_SCHEMA, REVIEWER, 'blog_article',
    (v) => `${v?.title ?? ''} (${String(v?.bodyMarkdown ?? '').split(/\s+/).length} words)`,
    BLOG_AI
  ).catch((error) => { swallow('split failed', error); return null; });
  if (!article?.bodyMarkdown || !article?.title) return null;

  const { data, error } = await admin.from('brand_articles').insert({
    brand_id: brand.id,
    slug: slugify(String(article.slug || article.title)),
    title: String(article.title).slice(0, 200),
    meta_title: String(article.metaTitle ?? '').slice(0, 70) || null,
    meta_description: String(article.metaDescription ?? '').slice(0, 200) || null,
    body_md: String(article.bodyMarkdown),
    language,
    // Stays 'draft' even with a scheduled_for — auto-generated articles never auto-publish; only
    // the user approving/scheduling them (site page) flips status to 'approved', which is what
    // publishDueArticles actually watches.
    status: 'draft',
    source_initiative_id: spec.sourceInitiativeId,
    source: spec.source ?? (spec.sourceInitiativeId ? 'seo' : 'ai'),
    scheduled_for: spec.scheduledFor ?? null
  }).select('id').maybeSingle();

  if (error || !data?.id) return null;
  // Humanizer pass: strip AI patterns, add human touches (if enabled).
  const { data: cfgRow } = await admin.from('brands').select('blog_config').eq('id', brand.id).maybeSingle();
  const humanizerEnabled = (cfgRow?.blog_config as AnyRec)?.humanizerEnabled !== false;
  if (humanizerEnabled) {
    try {
      const { humanizeArticle: humanize } = await import('./blog-humanizer');
      const h = await humanize(admin, brand.id, String(article.bodyMarkdown), String(article.title), language);
      if (h) {
        await admin.from('brand_articles').update({ body_md: h.bodyMd, updated_at: new Date().toISOString() }).eq('id', data.id);
      }
    } catch (error) { swallow('humanize article draft', error); }
  }
  // Second AI pass: push the draft toward a >90 all-green quality score.
  // the insert, so a timeout here still leaves a saved (un-optimized) draft rather than losing it.
  await optimizeArticleForScore(admin, brand, data.id, { withImages: !spec.skipImages }).catch(swallow('optimize article score'));
  // Record any Anomalia-network URLs the model actually used (post-optimize body).
  if (networkCandidates.length) {
    try {
      const { data: latest } = await admin
        .from('brand_articles')
        .select('body_md')
        .eq('id', data.id)
        .maybeSingle();
      await recordPlacementsFromArticle(
        admin,
        brand.id,
        data.id,
        String(latest?.body_md ?? article.bodyMarkdown),
        networkCandidates
      );
    } catch (error) { swallow('record network placements', error); }
  }
  // Notify the owner that a new draft is waiting for review — unless the caller opted out (the radar
  // sends its own daily recap instead of one email per article).
  if (!spec.skipNotify) {
    await notifyArticleGenerated(admin, brand.id, data.id, String(article.title)).catch(swallow('String failed'));
  }
  return data.id;
}

// Second AI pass to raise an article's quality score toward >90 with all checks green. Web-grounds
// REAL external sources + statistics (never fabricated), weaves in real internal links from the
// brand's indexed pages, tightens structure and meta, then adds on-brand images (for the alt-text
// check). Best-effort; keeps the better of before/after on the text rewrite. No-op if already >=90.
// ponytail: image render is the costly bit (2 per article on auto-gen); gate behind a plan/setting
// if daily volume makes it expensive.
export async function optimizeArticleForScore(
  admin: SupabaseClient, brand: AnyRec, articleId: string, opts: { withImages?: boolean } = {}
): Promise<void> {
  const [{ data: a }, { data: b }] = await Promise.all([
    admin.from('brand_articles').select('title, body_md, meta_title, meta_description, status, cover_image').eq('id', articleId).eq('brand_id', brand.id).maybeSingle(),
    admin.from('brands').select('website, content_prefs').eq('id', brand.id).maybeSingle()
  ]);
  if (!a?.body_md) return;
  const website = (b?.website as string) ?? brand.website ?? null;
  const language = ((b?.content_prefs as AnyRec)?.language as string) || (brand.content_prefs?.language as string) || 'Italian';

  // `hasJsonLd: true` is an ANSWER, not an assumption: `BlogPost.svelte` emits the Article block on
  // every rendered post. The scorer treats an omitted flag as unknown, so stating what we know here
  // is what keeps this article's coverage at 100% instead of paying for a question we can settle.
  const scoreInput = { metaTitle: a.meta_title, metaDescription: a.meta_description, status: a.status, hasJsonLd: true };
  const before = scoreArticle({ bodyMd: a.body_md, ...scoreInput }, website);
  // Only real failures are worth an expensive pass. An `unknown` is missing evidence and an `na` is
  // a question that does not apply — neither is something a rewrite can fix.
  const fixable = before.checks.filter((c) => c.verdict === 'fail');
  if ((before.score ?? 0) >= 90 && fixable.length === 0 && !opts.withImages) return;

  const [pages, products] = await Promise.all([
    getBrandPages(admin, brand.id, 20).catch((error) => { swallow('load brand pages', error); return []; }),
    getBrandProductsForAi(admin, brand.id, 25).catch((error) => { swallow('load product catalog', error); return []; })
  ]);
  const pagesList = pages.length
    ? pages.map((p) => `- ${p.title || p.url} → ${p.url}`).join('\n')
    : '(no indexed pages — do not invent internal links)';
  const productsList = formatProductsList(products);

  const { loadNetworkLinksForPrompt } = await import('./backlink-network');
  const networkCandidates = await loadNetworkLinksForPrompt(admin, brand).catch((error) => { swallow('load network link candidates', error); return []; });
  const networkList = networkCandidates.length
    ? networkCandidates.map((c) => `- ${c.title} → ${c.url}`).join('\n')
    : '(none)';

  // 1) Web-grounded research through the FULL provider chain (google grounding → deepseek → exa → tavily),
  // not Exa alone. This step is what produces the external citations the score's `sources`/`external`
  // checks want, and calling Exa directly made those links hostage to one provider: Exa 429s in
  // bursts (44 rejections in a single day), and the catch below turns a throttle into silently zero
  // external links. groundedText falls through on an empty answer, so the citations survive a burst.
  let citations: { uri: string; title: string }[] = [];
  let research = '';
  if (fixable.length) {
    const query = `Authoritative sources and concrete statistics for a blog article titled "${a.title}" (language: ${language}). Prefer credible, current sources; list specific data points with attribution. Never invent URLs or numbers.`;
    const g = await groundedText(genaiClient(), query, undefined, { brandId: brand.id }).catch(() => ({
      text: '',
      citations: [] as { uri: string; title: string }[]
    }));
    research = String(g.text ?? '').slice(0, 3000);
    citations = g.citations ?? [];
  }
  const citeList = citations.length ? citations.map((c) => `- ${c.title} → ${c.uri}`).join('\n') : '(none found — do not invent external links)';

  // 2) Rewrite to satisfy the failing checks using ONLY the real internal + external URLs above.
  const prompt = `Improve this blog article into a high-quality, SEO-optimised piece. Keep the topic, the brand voice and the language (${language}). Do NOT pad with filler.

CURRENT TITLE: ${a.title}
CURRENT META TITLE: ${a.meta_title ?? ''}
CURRENT META DESCRIPTION: ${a.meta_description ?? ''}

CURRENT ARTICLE (Markdown):
${String(a.body_md).slice(0, 12000)}

Weaknesses to fix: ${fixable.map((c) => c.label).join('; ') || 'general polish'}.

REAL internal pages you may link (exact URLs only, 2-6 where relevant):
${pagesList}

PRODUCTS & SERVICES you may link (exact product page URLs only — never invent; skip "(no page URL)"):
${productsList}

REAL external sources you may cite (exact URLs only — never invent a URL or a statistic):
${citeList}

ANOMALIA NETWORK LINKS you may optionally include (0–2, exact URLs only, only where useful):
${networkList}

Research notes (facts/statistics you may use, each already tied to a source above):
${research || '(none)'}

Requirements:
- Strong intro that answers the query, then at least 3 "## " sections with real substance, and a short conclusion.
- Weave in 2-6 internal page links and relevant product links from the lists above, only where genuinely relevant. Never fabricate a URL or a number.
- When products fit the topic, include one short ## section highlighting 1-3 products with their exact URLs (prefer ★ featured). Optional ![name](img) only when img= is listed.
- Include concrete data points/statistics from the research.
- 1200-2500 words. metaTitle <= 60 chars; metaDescription 50-155 chars.
- Write in ${language}. Return JSON: title (H1, not repeated in body), slug, metaTitle, metaDescription, bodyMarkdown.`;

  const improved = await structured<AnyRec>(genaiClient(), prompt, ARTICLE_SCHEMA, REVIEWER, {
    label: 'blog_optimize',
    ...BLOG_AI
  }).catch((error) => { swallow('genaiClient failed', error); return null; });
  let title = a.title;
  let metaTitle = a.meta_title as string | null;
  let metaDescription = a.meta_description as string | null;
  let bodyMd = String(a.body_md);
  if (improved?.bodyMarkdown && improved?.title) {
    const after = scoreArticle(
      { bodyMd: String(improved.bodyMarkdown), metaTitle: improved.metaTitle, metaDescription: improved.metaDescription, status: a.status, hasJsonLd: true },
      website
    );
    // An ungraded score (too little evidence) is never proof of an improvement — keep the original.
    if (after.score !== null && before.score !== null && after.score >= before.score) {
      title = String(improved.title).slice(0, 200);
      metaTitle = String(improved.metaTitle ?? '').slice(0, 70) || null;
      metaDescription = String(improved.metaDescription ?? '').slice(0, 200) || null;
      bodyMd = String(improved.bodyMarkdown); // slug kept stable (article may already be linked)
    }
  }

  // 3) Add on-brand images (alt-text check) + a cover thumbnail if the article doesn't have one yet.
  let cover = (a.cover_image as string | null) ?? null;
  if (opts.withImages) {
    try {
      const { generateArticleImages, generateArticleCover } = await import('./content-preview');
      const [newBody, newCover] = await Promise.all([
        generateArticleImages(admin, brand, { title, bodyMd, max: 2 }),
        cover ? Promise.resolve(cover) : generateArticleCover(admin, brand, { title, summary: metaDescription ?? undefined })
      ]);
      bodyMd = newBody;
      cover = newCover ?? cover;
    } catch (error) { swallow('generate article images', error); }
  }

  await admin.from('brand_articles').update({
    title, meta_title: metaTitle, meta_description: metaDescription, body_md: bodyMd, cover_image: cover, updated_at: new Date().toISOString()
  }).eq('id', articleId).eq('brand_id', brand.id);
}

async function notifyArticleGenerated(admin: SupabaseClient, brandId: string, articleId: string, title: string): Promise<void> {
  const { data: b } = await admin.from('brands').select('org_id, slug, name').eq('id', brandId).maybeSingle();
  if (!b?.org_id) return;
  const contacts = await brandContacts(admin, b.org_id, brandId);
  if (!contacts.length) return;
  const appUrl = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const preview = `${appUrl}/blog-preview/${articleId}`;
  const manage = `${appUrl}/app/${b.slug}/site`;
  const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:sans-serif;max-width:520px;">
    <h2 style="margin:0 0 8px;">📝 Nuovo articolo pronto da rivedere</h2>
    <p style="color:#444;">È stato generato un nuovo articolo per <b>${esc(b.name ?? '')}</b>:</p>
    <p style="font-size:17px;font-weight:600;margin:0 0 18px;">${esc(title)}</p>
    <p style="color:#444;">È una <b>bozza</b> — rivedila e pubblicala quando sei pronto.</p>
    <p style="margin:22px 0;">
      <a href="${preview}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Anteprima</a>
      &nbsp;
      <a href="${manage}" style="color:#111;padding:10px 18px;text-decoration:underline;">Gestisci il blog</a>
    </p>
  </div>`;
  const text = `Nuovo articolo generato per ${b.name}: "${title}". È una bozza — rivedila e pubblicala.\nAnteprima: ${preview}\nGestisci: ${manage}`;
  const { notifyBrandContacts } = await import('$lib/server/brand-notify');
  await notifyBrandContacts(admin, contacts, {
    logPrefix: '[blog]',
    buildEmail: (_locale, to) => ({
      to,
      subject: `📝 Nuovo articolo da rivedere — ${b.name ?? ''}`,
      html,
      text
    }),
    push: preview ? { url: preview, tag: `article-${articleId}` } : undefined
  });
}
