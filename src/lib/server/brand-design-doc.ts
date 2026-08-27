/**
 * DESIGN.md — the brand, rendered as ONE document.
 *
 * WHY THIS EXISTS. Everything an agent knows about a brand lives in the Studio tables, but until
 * now every surface re-assembled that material its own way: the chat prompt, the editorial planner,
 * the image generator and the ads remixer each picked a different subset and formatted it
 * differently. Same brand, four descriptions of it — which is how the planner ends up believing
 * something the chat never said. This module is the single rendering: one function, one document,
 * every surface reads it.
 *
 * NO LLM AT READ TIME. The rendering is a pure function of the Studio fields. The two blocks that
 * ARE written by a model — `brand_kit.ai_context` (the context brief) and `brand_kit.visual_style`
 * (the art-direction brief) — are produced when the Studio changes, stored, editable by the user,
 * and reproduced here VERBATIM. Nothing is synthesised, summarised or re-inferred while an agent
 * is waiting. Both are written as self-contained markdown (see `brand-context.ts`), so they nest
 * into this document as ordinary sections.
 *
 * ASSETS: PUBLIC URLS IN, SIGNED URLS OUT. Logos, favicons, product images and site imagery are
 * public URLs — they go in verbatim, so an agent can link a product or hand a photo to the image
 * generator without a round-trip through `read_products`. Anything in the private `brand-knowledge`
 * bucket goes in as its STORAGE PATH, never as a signed URL: a signed URL carries a fresh token on
 * every call, and this document sits in the cacheable half of the prompt (see the PROMPT-CACHE
 * LAYOUT note in `chat/system-prompt.ts`) — one expiring token in here re-bills the whole prompt on
 * every turn. Paths are stable forever; whoever actually fetches the bytes signs them at that point
 * (`signPaths`), which is what `content-preview.ts` already does.
 *
 * BOUNDED BY CONSTRUCTION. The synthesiser used to double as a compressor; a deterministic dump has
 * to cap itself instead. Every list here has a limit and says what it left out, so the long tail is
 * discovered through the read_* tools rather than silently dropped.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Caps. Each list says how much it hid, so "not listed" never reads as "does not exist". */
const PRODUCT_MAX = 40;
const PRODUCT_IMAGES_MAX = 3;
const PEOPLE_MAX = 20;
const PERSON_IMAGES_MAX = 2;
const COMPETITOR_MAX = 15;
const DOC_INDEX_MAX = 25;
const BRAND_IMAGES_MAX = 6;
const DESC_MAX = 140;

export type DesignDocProduct = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  kind?: string | null;
  pricing?: unknown;
  featured?: boolean | null;
  url?: string | null;
  images?: unknown;
};

export type DesignDocPerson = {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  kind?: string | null;
  description?: string | null;
  /** `{ path }[]` in the private bucket — rendered as paths, never signed here. */
  images?: unknown;
};

export type DesignDocDocument = {
  id?: string | null;
  kind?: string | null;
  collection?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  chunk_count?: number | null;
};

export type DesignDocCompetitor = {
  name?: string | null;
  website?: string | null;
  kind?: string | null;
  rationale?: string | null;
};

export type DesignDocInput = {
  brandName: string;
  /** `brand_kit` row (any subset — missing fields are simply not rendered). */
  kit: AnyRec | null;
  /** `editorial_plans.voice` — the structured voice the planner locked in. */
  voice?: AnyRec | null;
  language?: string | null;
  targetPlatforms?: string[] | null;
  products?: DesignDocProduct[] | null;
  people?: DesignDocPerson[] | null;
  documents?: DesignDocDocument[] | null;
  competitors?: DesignDocCompetitor[] | null;
};

/**
 * Which sections a reader gets. Every one defaults to ON: the document is the brand, and a surface
 * opts OUT of a part it demonstrably cannot use, rather than opting in to the parts someone
 * remembered. Two real cases drive this — the editorial planner cannot read a knowledge document,
 * so the index is noise to it; and the media generator has a user-facing "use brand style" toggle,
 * so when the user turns the brand look off, `look` / `visualStyle` / `graphic` must go with it.
 */
export type DesignDocSections = {
  identity?: boolean;
  voice?: boolean;
  /** Palette, fonts, logo, favicon, brand imagery. */
  look?: boolean;
  /** Typography + art direction for composed graphics. */
  graphic?: boolean;
  pillars?: boolean;
  products?: boolean;
  people?: boolean;
  competitors?: boolean;
  documents?: boolean;
  /** The art-direction brief written by the model. */
  visualStyle?: boolean;
  /** The context brief + history digests + GUARDRAIL block. */
  context?: boolean;
  character?: boolean;
};

export type DesignDocOptions = {
  /**
   * Emit the operative one-liners that tell an agent what to DO with a section ("call read_products
   * for full details"). True for the chat prompt, where those lines earn their tokens; false for a
   * generator that gets the brand as reference material and has no tools to call.
   */
  toolHints?: boolean;
  /** Per-section switches; anything unset is included. */
  include?: DesignDocSections;
  /**
   * How much of the art-direction brief to carry when `include.visualStyle` is on. 'summary' is for
   * a reader that has to know what the brand can render well without being handed the whole brief —
   * the editorial planner decides the content mix, the image pipeline executes the look.
   */
  visualStyleDetail?: 'full' | 'summary';
};

/** Characters of visual brief a 'summary' reader gets, flattened to one line. */
const VISUAL_STYLE_SUMMARY = 220;

// ── Normalisers — the Studio has been written to by scrapers, agents and humans, so every one of
// these fields exists in two or three shapes in the wild. Read them all, render one. ──────────────

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const truncate = (v: unknown, max = DESC_MAX): string => {
  const s = clean(v).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** `["#fff"]` or `[{ hex }]` or `[{ color }]`. */
export function normalizeColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return [];
  return colors
    .map((c) => (typeof c === 'string' ? c : clean((c as AnyRec)?.hex) || clean((c as AnyRec)?.color)))
    .filter(Boolean);
}

/** `"Inter, Georgia"` or `[{ name, source }]` or `["Inter"]`. */
export function normalizeFonts(fonts: unknown): string[] {
  if (typeof fonts === 'string') return fonts.split(',').map((f) => f.trim()).filter(Boolean);
  if (!Array.isArray(fonts)) return [];
  return fonts
    .map((f) =>
      typeof f === 'string' ? f : [clean((f as AnyRec)?.name) || clean((f as AnyRec)?.family), clean((f as AnyRec)?.source)].filter(Boolean).join(' · ')
    )
    .filter(Boolean);
}

/** `["https://…"]` or `[{ url, type }]`. `og-image` is the site's share card, not a logo. */
export function normalizeLogos(logos: unknown): string[] {
  if (!Array.isArray(logos)) return [];
  return logos
    .map((l) => {
      if (typeof l === 'string') return l;
      const rec = l as AnyRec;
      if (clean(rec?.type) === 'og-image') return '';
      return clean(rec?.url);
    })
    .filter(Boolean);
}

/** `["https://…"]` or `[{ src }]` or `[{ url }]`. Public URLs only — see the header note. */
export function normalizeImageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((i) => (typeof i === 'string' ? i : clean((i as AnyRec)?.src) || clean((i as AnyRec)?.url)))
    .filter(Boolean);
}

/** People/knowledge images: `[{ path }]` in the private bucket. Returns PATHS, deliberately. */
export function normalizeStoragePaths(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((i) => (typeof i === 'string' ? i : clean((i as AnyRec)?.path)))
    .filter(Boolean);
}

/** `"18,50 €"` (scraped) or `{ amount, currency }` (Studio form). */
export function formatPricing(pricing: unknown): string {
  if (typeof pricing === 'string') return pricing.trim();
  if (!pricing || typeof pricing !== 'object') return '';
  const p = pricing as AnyRec;
  const amount = typeof p.amount === 'number' ? p.amount : Number(p.amount);
  if (!Number.isFinite(amount)) return '';
  const currency = clean(p.currency) || 'EUR';
  return `${amount} ${currency}`;
}

/**
 * Nest a stored brief under `## TITLE` without ever doubling the heading.
 *
 * Three kinds of text land in these fields and all three have to come out as one well-formed
 * section: a brief written today (self-titled `## VISUAL STYLE`, normalised in place), one written
 * before the fields became markdown (bare labelled prose, wrapped), and one a user typed into the
 * Studio by hand (which may or may not carry a heading, and may have typed a different level).
 */
export function embedBrief(title: string, text: unknown): string {
  const body = clean(text);
  if (!body) return '';
  const lines = body.split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const heading = lines[first]?.match(/^\s{0,3}#{1,6}\s+(.*?)\s*$/);
  const same = (a: string, b: string) => a.replace(/[^a-z0-9]/gi, '').toLowerCase() === b.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (heading && same(heading[1], title)) {
    lines[first] = `## ${title}`;
    return lines.slice(first).join('\n').trim();
  }
  return `## ${title}\n${body}`;
}

/**
 * One-line digest of a stored brief. Heading markers are stripped rather than carried: at this
 * length "## VISUAL STYLE ### PALETTE" would spend a fifth of the budget re-announcing the section
 * the reader is already inside, so the labels survive and the markdown does not.
 */
function summarizeBrief(title: string, text: unknown, max: number): string {
  const lines = clean(text).split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const heading = lines[first]?.match(/^\s{0,3}#{1,6}\s+(.*?)\s*$/);
  const same = (a: string, b: string) => a.replace(/[^a-z0-9]/gi, '').toLowerCase() === b.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const body = heading && same(heading[1], title) ? lines.slice(first + 1) : lines;
  return truncate(body.map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, '')).join(' '), max);
}

// ── Reusable sections ────────────────────────────────────────────────────────────────────────────
//
// Products and competitors are the two blocks other surfaces need on their own — the chat's publish
// and web hubs, the ads remixer. Each of those used to hand-roll its own version, and they drifted:
// one carried image URLs, one did not, one dropped the product id, and the ads remixer selected a
// column that does not exist so it silently told the model the catalogue was empty. Exported here
// so a surface picks a PROJECTION (what to include, what to call it) and never a second rendering.

export type ProductsSectionOptions = {
  /** Heading, purpose included when the surface has one ("PRODUCTS & SERVICES (for featuring)"). */
  title?: string;
  max?: number;
  /** Public image URLs — worth their tokens where the reader can pass one to an image tool. */
  images?: boolean;
  /** Product ids — only useful to a reader that has tools taking them. */
  ids?: boolean;
  descriptions?: boolean;
  /** Trailing operative line. `null` for a reader with no tools to call. */
  hint?: string | null;
};

const PRODUCTS_HINT =
  '- Link products with the exact URL above, never a guessed one. The image URLs are usable as-is as visual references. read_products for full detail; sync_products when an ecommerce brand is missing URLs.';

/** One product list, one format. '' when the catalogue is empty. */
export function renderProductsSection(
  products: DesignDocProduct[] | null | undefined,
  opts: ProductsSectionOptions = {}
): string {
  const all = (products ?? []).filter(Boolean);
  if (!all.length) return '';
  const { title = 'PRODUCTS & SERVICES', max = PRODUCT_MAX, images = true, ids = true, descriptions = true } = opts;
  const hint = opts.hint === undefined ? PRODUCTS_HINT : opts.hint;
  const listed = all.slice(0, max);
  const lines = listed.map((p) => {
    const price = formatPricing(p.pricing);
    const meta = [clean(p.kind) || 'product', price].filter(Boolean).join(', ');
    const head = `- **${clean(p.title) || 'Untitled'}**${p.featured ? ' ★' : ''} (${meta})`;
    const sub: string[] = [];
    if (clean(p.url)) sub.push(`  - page: ${clean(p.url)}`);
    if (images) {
      const imgs = normalizeImageUrls(p.images).slice(0, PRODUCT_IMAGES_MAX);
      if (imgs.length) sub.push(`  - images: ${imgs.join(' · ')}`);
    }
    if (descriptions && clean(p.description)) sub.push(`  - ${truncate(p.description)}`);
    if (ids && clean(p.id)) sub.push(`  - id: ${clean(p.id)}`);
    return [head, ...sub].join('\n');
  });
  const hidden = all.length - listed.length;
  if (hidden > 0) lines.push(`- …and ${hidden} more products not listed — call read_products.`);
  if (hint) lines.push(hint);
  return `## ${title} (${all.length})\n${lines.join('\n')}`;
}

export type CompetitorsSectionOptions = { title?: string; max?: number };

/** One competitor list, one format. '' when there are none. */
export function renderCompetitorsSection(
  competitors: DesignDocCompetitor[] | null | undefined,
  opts: CompetitorsSectionOptions = {}
): string {
  const all = (competitors ?? []).filter(Boolean);
  if (!all.length) return '';
  const { title = 'COMPETITORS', max = COMPETITOR_MAX } = opts;
  const listed = all.slice(0, max);
  const lines = listed.map((c) => {
    const bits = [clean(c.rationale) ? truncate(c.rationale, 120) : '', clean(c.website)].filter(Boolean);
    return `- **${clean(c.name) || 'Unnamed'}**${clean(c.kind) ? ` (${clean(c.kind)})` : ''}${bits.length ? `: ${bits.join(' — ')}` : ''}`;
  });
  const hidden = all.length - listed.length;
  if (hidden > 0) lines.push(`- …and ${hidden} more competitors not listed.`);
  return `## ${title} (${all.length})\n${lines.join('\n')}`;
}

// ── Renderer ────────────────────────────────────────────────────────────────────────────────────

/**
 * Render the brand as a markdown document. Pure: same Studio in, same bytes out — which is what
 * makes it snapshot-testable and safe to sit in the prompt-cache prefix.
 */
export function renderDesignDoc(input: DesignDocInput, opts: DesignDocOptions = {}): string {
  const hints = opts.toolHints !== false;
  const on = (k: keyof DesignDocSections) => opts.include?.[k] !== false;
  const kit = input.kit ?? {};
  const out: string[] = [];
  const section = (title: string, body: string[]) => {
    const lines = body.filter((l) => l !== '');
    if (lines.length) out.push(`## ${title}\n${lines.join('\n')}`);
  };

  out.push(`# DESIGN.md — ${input.brandName}
Every line below is a field of this brand's Studio, rendered as-is: nothing here was invented at
request time. When something is wrong, the fix is the Studio field, not a correction in chat.`);

  // ── Identity ──
  if (on('identity')) section('IDENTITY', [
    kit.category ? `- **Category**: ${truncate(kit.category, 120)}` : '',
    kit.site_type ? `- **Business type**: ${clean(kit.site_type)}` : '',
    kit.about ? `- **About**: ${truncate(kit.about, 600)}` : '',
    kit.target_audience ? `- **Audience**: ${truncate(kit.target_audience, 400)}` : '',
    input.language ? `- **Content language**: ${clean(input.language)}` : '',
    input.targetPlatforms?.length ? `- **Target platforms**: ${input.targetPlatforms.join(', ')}` : ''
  ]);

  // ── Voice ──
  const voice = on('voice') ? (input.voice ?? null) : null;
  const voiceBits = voice
    ? (['mood', 'tone', 'goal', 'personality', 'register', 'emotion', 'character', 'syntax'] as const)
        .map((k) => (clean(voice[k]) ? `${k}=${clean(voice[k])}` : ''))
        .filter(Boolean)
    : [];
  if (on('voice')) section('VOICE', [
    kit.brand_style ? `- **Style**: ${truncate(kit.brand_style, 800)}` : '',
    voiceBits.length ? `- **Locked voice**: ${voiceBits.join(', ')}` : ''
  ]);

  // ── Look: colours, fonts, logos, brand imagery. Public URLs, usable directly. ──
  const colors = normalizeColors(kit.brand_colors);
  const fonts = normalizeFonts(kit.fonts);
  const logos = normalizeLogos(kit.logos);
  const brandImages = normalizeImageUrls(kit.images).slice(0, BRAND_IMAGES_MAX);
  if (on('look')) section('COLOURS, TYPE & MARKS', [
    colors.length ? `- **Palette**: ${colors.join(' · ')}` : '',
    clean(kit.theme_color) ? `- **Theme colour**: ${clean(kit.theme_color)}` : '',
    fonts.length ? `- **Fonts**: ${fonts.join(' · ')}` : '',
    logos.length ? `- **Logo**: ${logos.join(' · ')}` : '',
    clean(kit.favicon_url) ? `- **Favicon**: ${clean(kit.favicon_url)}` : '',
    brandImages.length ? `- **Brand imagery**: ${brandImages.join(' · ')}` : '',
    logos.length || brandImages.length
      ? '- These are public URLs: link them, or pass one as a visual reference. Match the palette exactly — never approximate a brand colour.'
      : ''
  ]);

  // ── Graphic direction — the typography a graphic is actually set in, plus its art direction
  // (`design-typography.ts`). A JSON field, not a brief: rendered, not embedded. ──
  const graphic = on('graphic') && kit.graphic_style && typeof kit.graphic_style === 'object' ? (kit.graphic_style as AnyRec) : null;
  if (graphic) {
    section('GRAPHIC DIRECTION', [
      clean(graphic.display_font) ? `- **Display font**: ${clean(graphic.display_font)}` : '',
      clean(graphic.body_font) ? `- **Body font**: ${clean(graphic.body_font)}` : '',
      clean(graphic.instructions) ? `- **Art direction**: ${truncate(graphic.instructions, 600)}` : '',
      clean(graphic.why) ? `- **Why this pairing**: ${truncate(graphic.why, 200)}` : ''
    ]);
  }

  // ── Content pillars ──
  const pillars = Array.isArray(kit.content_pillars)
    ? (kit.content_pillars as unknown[]).map((p) => (typeof p === 'string' ? p : clean((p as AnyRec)?.name))).filter(Boolean)
    : [];
  if (on('pillars')) section('CONTENT PILLARS', pillars.map((p) => `- ${p}`));

  // ── Products ──
  const products = on('products') ? (input.products ?? []).filter(Boolean) : [];
  if (products.length) out.push(renderProductsSection(products, { hint: hints ? undefined : null }));

  // ── People ──
  const people = on('people') ? (input.people ?? []).filter(Boolean) : [];
  if (people.length) {
    const listed = people.slice(0, PEOPLE_MAX);
    const lines = listed.map((p) => {
      const meta = [clean(p.kind), clean(p.role)].filter(Boolean).join(', ');
      const head = `- **${clean(p.name) || 'Unnamed'}**${meta ? ` (${meta})` : ''}${clean(p.description) ? `: ${truncate(p.description, 100)}` : ''}`;
      const paths = normalizeStoragePaths(p.images).slice(0, PERSON_IMAGES_MAX);
      // Storage PATHS, not URLs — see the header note on why a signed URL must not land here.
      const sub = paths.length ? [`  - photos (private storage paths, not fetchable URLs): ${paths.join(' · ')}`] : [];
      if (clean(p.id)) sub.push(`  - id: ${clean(p.id)}`);
      return [head, ...sub].join('\n');
    });
    const hidden = people.length - listed.length;
    if (hidden > 0) lines.push(`- …and ${hidden} more people not listed — call read_people.`);
    if (hints)
      lines.push(
        '- Pass people ids into create_post / generate_image so the same face stays consistent across posts. The photo paths are private: a tool signs them, you cannot fetch them.'
      );
    section(`TEAM & PEOPLE (${people.length})`, lines);
  }

  // ── Competitors ──
  const competitors = on('competitors') ? (input.competitors ?? []).filter(Boolean) : [];
  if (competitors.length) out.push(renderCompetitorsSection(competitors));

  // ── Knowledge index ──
  const documents = on('documents') ? (input.documents ?? []).filter(Boolean) : [];
  if (documents.length) {
    // The index itself has to stay bounded: ~45 tokens per line × an uncapped corpus puts the whole
    // library in EVERY turn. Past the cap the agent finds documents through search_knowledge.
    const listed = [...documents].sort((a, b) => (b.chunk_count ?? 0) - (a.chunk_count ?? 0)).slice(0, DOC_INDEX_MAX);
    const lines = listed.map((d) => {
      const bits = [`[${clean(d.collection) || clean(d.kind) || 'doc'}]`, clean(d.title) || 'Untitled', `{${clean(d.id)}}`];
      if (clean(d.summary)) bits.push(`— ${truncate(d.summary, 120)}`);
      if (d.chunk_count) bits.push(`(${d.chunk_count} chunks)`);
      if (clean(d.status) && d.status !== 'ready') bits.push(`[${clean(d.status)}]`);
      return `- ${bits.join(' ')}`;
    });
    const hidden = documents.length - listed.length;
    if (hidden > 0) {
      const byCollection = new Map<string, number>();
      for (const d of documents) {
        const key = clean(d.collection) || 'other';
        byCollection.set(key, (byCollection.get(key) ?? 0) + 1);
      }
      const breakdown = [...byCollection.entries()].map(([c, n]) => `${c}: ${n}`).join(', ');
      lines.push(
        `- …and ${hidden} more documents not listed (all collections — ${breakdown}). Find them with search_knowledge(query, collection).`
      );
    }
    if (hints) lines.push('- Titles only. Use search_knowledge / read_document for content; {id} goes in document_ids.');
    section(`BRAND DOCUMENTS (${documents.length})`, lines);
  }

  // ── The model-written briefs, verbatim. Written as self-contained markdown at write time (see
  // `brand-context.ts`), so they slot in here as ordinary sections. ──
  if (clean(kit.visual_style) && on('visualStyle')) {
    out.push(
      opts.visualStyleDetail === 'summary'
        ? `## VISUAL STYLE (summary — the full brief lives with the image pipeline)\n${summarizeBrief('VISUAL STYLE', kit.visual_style, VISUAL_STYLE_SUMMARY)}`
        : embedBrief('VISUAL STYLE', kit.visual_style)
    );
  }
  if (clean(kit.ai_context) && on('context')) {
    // Carries the GUARDRAIL block (brand-guardrails.ts) as its closing section — the negative half
    // of the brand, and the reason this one is never truncated.
    out.push(embedBrief('BRAND CONTEXT & HISTORY', kit.ai_context));
  }

  // ── AI character ──
  if (on('character') && kit.ai_character && typeof kit.ai_character === 'object') {
    const ch = kit.ai_character as AnyRec;
    const lines = Object.entries(ch)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => (clean(String(v)) ? `- **${k.replace(/_/g, ' ')}**: ${truncate(String(v), 200)}` : ''))
      .filter(Boolean);
    section('AI CHARACTER', lines);
  }

  // An empty Studio produces NO document, not a title with nothing under it: a header alone reads
  // to a model as "this brand has been described", which is the opposite of what it means.
  return out.length > 1 ? out.join('\n\n') : '';
}


// ── Loader ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Read the whole Studio for a brand and render it.
 *
 * Every creative surface used to assemble its own slice of the brand — the motion-video agent read
 * six kit columns, the media generator another five plus a products query of its own, the UGC
 * batch a third set. None of them saw the brand's people, its competitors or its content pillars,
 * and only one of them saw the palette. This is the one read: pass `include` to leave out what a
 * surface genuinely cannot use, not to remember what it needs.
 *
 * Failure is soft on purpose — a creative turn must not die because one table was slow. A missing
 * table costs its section, not the run.
 */
export async function loadDesignDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  brandId: string,
  opts: DesignDocOptions & { brandName?: string } = {}
): Promise<string> {
  const want = (k: keyof DesignDocSections) => opts.include?.[k] !== false;
  const none = { data: null };
  // try/catch around the whole thing, not just the await: a client that throws while BUILDING the
  // query (rather than while running it) would otherwise escape a promise-level .catch and take the
  // creative turn down with it.
  let brandRow: AnyRec | null = null;
  let kit: AnyRec | null = null;
  let products: AnyRec[] | null = null;
  let people: AnyRec[] | null = null;
  let competitors: AnyRec[] | null = null;
  let documents: AnyRec[] | null = null;
  try {
    [{ data: brandRow }, { data: kit }, { data: products }, { data: people }, { data: competitors }, { data: documents }] =
        await Promise.all([
        opts.brandName
          ? Promise.resolve({ data: { name: opts.brandName, content_prefs: null, target_platforms: null } })
          : supabase.from('brands').select('name, content_prefs, target_platforms').eq('id', brandId).maybeSingle(),
        supabase
          .from('brand_kit')
          .select(
            'category, about, target_audience, brand_style, ai_context, visual_style, graphic_style, site_type, content_pillars, brand_colors, fonts, logos, theme_color, favicon_url, images, ai_character'
          )
          .eq('brand_id', brandId)
          .maybeSingle(),
        want('products')
          ? supabase
              .from('products')
              .select('id, title, description, kind, pricing, url, images, featured')
              .eq('brand_id', brandId)
              .order('featured', { ascending: false })
              .limit(PRODUCT_MAX)
          : Promise.resolve(none),
        want('people')
          ? supabase.from('people').select('id, name, role, kind, description, images').eq('brand_id', brandId)
          : Promise.resolve(none),
        want('competitors')
          ? supabase.from('competitors').select('name, website, kind, rationale').eq('brand_id', brandId)
          : Promise.resolve(none),
        want('documents')
          ? supabase
              .from('brand_documents')
              .select('id, kind, collection, title, summary, status, chunk_count')
              .eq('brand_id', brandId)
              .neq('kind', 'image')
          : Promise.resolve(none)
      ]);
  } catch (e) {
    console.error('[design-doc] load failed', e);
    return '';
  }

  const prefs = (brandRow?.content_prefs ?? {}) as Record<string, unknown>;
  const { brandName: _ignored, ...renderOpts } = opts;
  return renderDesignDoc(
    {
      brandName: String(brandRow?.name ?? opts.brandName ?? ''),
      kit,
      language: typeof prefs.language === 'string' ? prefs.language : null,
      targetPlatforms: Array.isArray(brandRow?.target_platforms) ? (brandRow.target_platforms as string[]) : null,
      products,
      people,
      competitors,
      documents
    },
    renderOpts
  );
}
