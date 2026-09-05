import { swallow } from '$lib/server/swallow';
import type { GoogleGenAI } from '@google/genai';
import { structured } from '$lib/server/research';
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzePostHistory, historyInsightsDigest } from '$lib/server/post-history-insights';
import { aiText } from '$lib/server/ai-text';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { GUARDRAILS_INSTRUCTION } from '$lib/server/brand-guardrails';

const RECENT_LIMIT = 25;
const TOP_LIMIT = 15;
const STYLE_IMAGES = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// ── Structured Visual Brief ─────────────────────────────────────────────────────────────────────

export type VisualBrief = {
  palette: Array<{ hex: string; role: string; usage_pct: number }>;
  photography: { lighting?: string; lens_feel?: string; grading?: string };
  composition?: string;
  subjects_scenes?: string;
  graphic_language?: string;
  on_image_text?: string;
  mood?: string;
  dos?: string[];
  donts?: string[];
};

const VISUAL_BRIEF_SCHEMA = {
  type: 'object' as const,
  properties: {
    palette: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          hex: { type: 'string' as const },
          role: { type: 'string' as const },
          usage_pct: { type: 'integer' as const }
        },
        required: ['hex', 'role', 'usage_pct']
      }
    },
    photography: {
      type: 'object' as const,
      properties: {
        lighting: { type: 'string' as const },
        lens_feel: { type: 'string' as const },
        grading: { type: 'string' as const }
      }
    },
    composition: { type: 'string' as const },
    subjects_scenes: { type: 'string' as const },
    graphic_language: { type: 'string' as const },
    on_image_text: { type: 'string' as const },
    mood: { type: 'string' as const },
    dos: { type: 'array' as const, items: { type: 'string' as const } },
    donts: { type: 'array' as const, items: { type: 'string' as const } }
  },
  required: ['palette', 'photography', 'mood']
};

function isVisualBrief(x: unknown): x is VisualBrief {
  if (!x || typeof x !== 'object') return false;
  const b = x as Record<string, unknown>;
  if (!Array.isArray(b.palette) || !b.palette.length) return false;
  if (!b.photography || typeof b.photography !== 'object') return false;
  if (typeof b.mood !== 'string') return false;
  return true;
}

/**
 * Serialise the visual brief as a SELF-CONTAINED markdown document — its own `## VISUAL STYLE`
 * title and `###` subsections — so it reads on its own in the Studio and nests unchanged into the
 * brand's DESIGN.md (`renderDesignDoc` embeds it verbatim; see `brand-design-doc.ts`). Subsection
 * labels stay uppercase because prompts elsewhere refer to them by name (e.g. content-preview tells
 * the planner to honour "the visual style's GRAPHIC LANGUAGE").
 */
export function visualBriefToText(b: VisualBrief): string {
  const lines: string[] = ['## VISUAL STYLE'];
  if (b.palette?.length) {
    lines.push('', '### PALETTE');
    for (const p of b.palette) {
      if (p?.hex && p?.role) lines.push(`- ${p.hex} — ${p.role}${typeof p.usage_pct === 'number' ? `, ~${p.usage_pct}% usage` : ''}`);
    }
  }
  if (b.photography && (b.photography.lighting || b.photography.lens_feel || b.photography.grading)) {
    lines.push('', '### PHOTOGRAPHY');
    if (b.photography.lighting) lines.push(`- Lighting: ${b.photography.lighting}`);
    if (b.photography.lens_feel) lines.push(`- Lens/feel: ${b.photography.lens_feel}`);
    if (b.photography.grading) lines.push(`- Colour grading: ${b.photography.grading}`);
  }
  const block = (title: string, body?: string) => {
    if (body) lines.push('', `### ${title}`, body);
  };
  block('COMPOSITION', b.composition);
  block('SUBJECTS & SCENES', b.subjects_scenes);
  block('GRAPHIC LANGUAGE', b.graphic_language);
  block('ON-IMAGE TEXT', b.on_image_text);
  block('MOOD', b.mood);
  if (b.dos?.length) lines.push('', '### DO', ...b.dos.filter(Boolean).map((d) => `- ${d}`));
  if (b.donts?.length) lines.push('', "### DON'T", ...b.donts.filter(Boolean).map((d) => `- ${d}`));
  return lines.join('\n');
}

function normalizeFonts(fonts: unknown): string[] {
  if (!Array.isArray(fonts)) return [];
  return fonts.map((f: AnyRec) => f?.name ?? f?.family ?? '').filter(Boolean);
}

export type ContextInputs = {
  name: string;
  kit: { about?: string | null; category?: string | null; target_audience?: string | null } | null;
  documents: Array<{
    kind: string;
    title: string | null;
    content_text?: string | null;
    summary?: string | null;
    status?: string | null;
  }>;
  posts: Array<{ content: string | null; platform: string | null; metrics: AnyRec | null }>;
};

// Pure: assemble the synthesiser prompt from the brand's material.
export function buildContextPrompt(input: ContextInputs): string {
  const kit = input.kit ?? {};
  // Titles + short summaries only — never dump full document bodies (prompt bomb).
  const notes = input.documents
    .filter((d) => d.kind !== 'image' && (d.summary || d.content_text || d.title))
    .map((d) => {
      const blurb = (d.summary || d.content_text || '').slice(0, 240);
      return `- ${d.title ?? 'Untitled'}${blurb ? `: ${blurb}` : ''}`;
    })
    .join('\n');
  const images = input.documents
    .filter((d) => d.kind === 'image')
    .map((d) => `- ${d.title ?? 'Reference image'}`).join('\n');
  const history = input.posts.map((p) => {
    const er = p.metrics?.engagementRate; const likes = p.metrics?.likes;
    const stat = [likes != null ? `${likes} likes` : '', er != null ? `${er}% eng.` : ''].filter(Boolean).join(', ');
    return `- [${p.platform ?? '?'}${stat ? ` · ${stat}` : ''}] ${p.content ?? ''}`.trim();
  }).join('\n');

  return `You are a brand strategist. Write a concise BRAND CONTEXT BRIEF (max ~500 words) that an AI social-media manager will read before planning posts for this brand. Capture: the brand's voice & tone, recurring themes and topics, formats/angles that perform well (infer from the post history metrics), key facts and constraints from the brand's own notes/documents, and clear do's & don'ts. Do not invent facts.

FORMAT — write it as a self-contained MARKDOWN document that will be embedded as one section of the brand's DESIGN.md: no title line, only level-3 subsections written as "### VOICE", "### THEMES", "### WHAT WORKS", "### FACTS & CONSTRAINTS", with tight prose or bullets under each. Never emit a level-1 or level-2 heading — it would break the document this nests into. The closing GUARDRAIL section is written as "### GUARDRAIL".

${GUARDRAILS_INSTRUCTION}

BRAND: ${input.name}
ABOUT: ${kit.about ?? ''}
CATEGORY: ${kit.category ?? ''}
TARGET AUDIENCE: ${kit.target_audience ?? ''}

BRAND NOTES & DOCUMENTS (summaries — full text is retrieved on demand):
${notes || '(none)'}

REFERENCE IMAGES (titles only):
${images || '(none)'}

PAST POSTS (caption + performance; learn the voice and what works):
${history || '(no history available yet)'}

Return only the brief.`;
}

/**
 * Il parametro `ai` che mezzo prodotto si passa ancora di mano, e che NESSUNO legge piu`: ogni
 * funzione a valle lo riceve come `_ai` e instrada da se`, dal centralino o dallo slot immagini.
 *
 * Costruiva un client Gemini vero — su Google quando la rotta del testo non era `gemini@kie`, che
 * e` il default. Cinquanta call site aprivano cosi` una connessione verso un fornitore che poi non
 * chiamavano: invisibile, perche` non fallisce niente. Torna `null`, che e` esattamente quanto ne
 * usa il codice sotto; togliere il parametro dalle firme e` il lotto dopo, ed e` solo meccanica.
 */
export function genaiClient(): GoogleGenAI {
  return null as never;
}

// Synthesise the text BRAND CONTEXT BRIEF (voice/themes/what-works). Reusable in-memory (onboarding)
// and from the DB (rebuildBrandContext).
export async function synthesizeBrandContext(input: ContextInputs): Promise<string> {
  try {
    return await aiText(buildContextPrompt(input), 'You are an expert brand strategist writing a briefing for another AI. Be concise, factual, specific.');
  } catch (e) {
    console.error('synthesizeBrandContext failed:', e);
    return '';
  }
}

// Download an image URL into a Gemini inlineData part. Best-effort: null on any failure / non-image
// / oversized payload, so a bad thumbnail never breaks style synthesis. Also reused to feed a
// product photo to the image generator as a reference.
export async function fetchImagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0] || 'image/jpeg';
    if (!mimeType.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 6_000_000) return null;
    return { inlineData: { mimeType, data: Buffer.from(buf).toString('base64') } };
  } catch {
    return null;
  }
}

// Synthesise a VISUAL STYLE brief by actually looking at brand imagery (multimodal). Normally fed
// past post thumbnails; for a brand with no post history it can be fed the brand's own SITE images
// (a baseline so generation is on-brand from post #1) — `opts.brandColors`/`opts.archetype` anchor
// the read. Drives the image generator to match the brand's look. Returns '' if nothing usable.
// Uses structured JSON output (VISUAL_BRIEF_SCHEMA) and serializes to labelled text via
// visualBriefToText. Firma invariata (Promise<string>) → zero modifiche nei consumer.
export async function synthesizeVisualStyle(
  imageUrls: string[],
  opts: { brandColors?: string[] | null; archetype?: string | null; fonts?: string[] | null } = {}
): Promise<string> {
  const urls = imageUrls.filter(Boolean).slice(0, STYLE_IMAGES);
  if (!urls.length) return '';
  const parts = (await Promise.all(urls.map(fetchImagePart))).filter(Boolean) as { inlineData: { mimeType: string; data: string } }[];
  if (!parts.length) return '';
  const colorLine = opts.brandColors?.length ? `\nKnown brand colours (anchor the palette to these): ${opts.brandColors.join(', ')}.` : '';
  const archLine = opts.archetype ? `\nBrand type: ${opts.archetype}.` : '';
  const fontLine = opts.fonts?.length ? `\nBrand fonts: ${opts.fonts.join(', ')}.` : '';
  const prompt = `You are an art director. These images are from ONE brand (its social posts and/or its website). Analyse the brand's consistent VISUAL STYLE and return a structured JSON brief so an AI image generator can match it. For the palette, list each colour with its hex code, role (primary/accent/background/etc), and approximate usage percentage. For photography, describe lighting, lens feel, and colour grading. For composition, describe typical framing and layout. Also cover: typical subjects/scenes, graphic language (photo vs illustration), on-image text usage, overall mood, and 2-3 concrete do's and don'ts.${colorLine}${archLine}${fontLine}`;
  try {
    const raw = await structured<unknown>(prompt, VISUAL_BRIEF_SCHEMA, undefined, { label: 'visualBrief', images: parts });
    if (isVisualBrief(raw)) return visualBriefToText(raw);
    // Model returned something that doesn't match the schema — no usable brief.
    return '';
  } catch {
    return '';
  }
}

// Social visual intelligence: look at the brand's BEST-PERFORMING post images (highest engagement
// first) and extract the VISUAL patterns that win — so the planner repeats what works, not just the
// aggregate look. Distinct from synthesizeVisualStyle (which describes the consistent style):
// this is performance-driven, prescriptive direction. Pass top-engagement thumbnails first. '' if
// nothing usable.
export async function synthesizeVisualPlaybook(topThumbnailUrls: string[]): Promise<string> {
  const urls = topThumbnailUrls.filter(Boolean).slice(0, STYLE_IMAGES);
  if (!urls.length) return '';
  const parts = (await Promise.all(urls.map(fetchImagePart))).filter(Boolean) as { inlineData: { mimeType: string; data: string } }[];
  if (!parts.length) return '';
  const prompt = `These are this brand's BEST-PERFORMING social posts (highest engagement first). Identify the VISUAL patterns that win HERE and that the brand should keep doing: recurring subjects, composition & framing, format (single photo / carousel / graphic / UGC), styling & props, lighting, and on-image-text usage. Output 3-5 SHORT, prescriptive directives an AI image generator should follow to match what performs. Be concrete; no preamble, just the directives.`;
  try {
    const txt = (await aiText(prompt, undefined, { label: 'visualWinners', images: parts })).trim();
    return txt ? `### WHAT WORKS VISUALLY\n(from the brand's best-performing posts — repeat these patterns)\n${txt}` : '';
  } catch {
    return '';
  }
}

// Rebuild and persist brand_kit.ai_context + brand_kit.visual_style from brand_kit fields +
// brand_documents + scraped post history (captions, metrics and thumbnails). `extraContext` (e.g.
// the competitive delta from the research pipeline) is appended to the synthesised brief so the
// market framing survives every rebuild.
export async function rebuildBrandContext(
  supabase: SupabaseClient,
  brandId: string,
  extraContext?: string
): Promise<string> {
  const { data: brand } = await supabase.from('brands').select('name').eq('id', brandId).maybeSingle();
  const { data: kit } = await supabase.from('brand_kit').select('about, category, target_audience, brand_colors, fonts, site_type, images, visual_style_locked').eq('brand_id', brandId).maybeSingle();
  const { data: documents } = await supabase
    .from('brand_documents')
    .select('kind, title, content_text, summary, status')
    .eq('brand_id', brandId);
  const { data: recent } = await supabase.from('social_post_history')
    .select('content, platform, metrics, published_at, thumbnail_url, thumbnail_path').eq('brand_id', brandId).eq('source', 'zernio')
    .order('published_at', { ascending: false, nullsFirst: false }).limit(RECENT_LIMIT);
  const { data: pool } = await supabase.from('social_post_history')
    .select('content, platform, metrics, media_type, published_at, thumbnail_url, thumbnail_path').eq('brand_id', brandId).eq('source', 'zernio').limit(200);
  const top = [...(pool ?? [])]
    .sort((a, b) => (b.metrics?.engagementRate ?? 0) - (a.metrics?.engagementRate ?? 0)).slice(0, TOP_LIMIT);

  const seen = new Set<string>();
  const posts = [...(recent ?? []), ...top].filter((p) => {
    const k = p.content ?? ''; if (seen.has(k)) return false; seen.add(k); return true;
  });

  // Prefer top-performing thumbnails for the style read, falling back to recent ones — and prefer
  // OUR archived copy (signed, never expires) over the scraped CDN URL, which dies within days.
  const styleRows = [...top, ...(recent ?? [])];
  const signedThumbs = await signKnowledgePaths(
    supabase,
    styleRows.map((p) => (p as AnyRec).thumbnail_path as string).filter(Boolean)
  ).catch((error) => { swallow('filter failed', error); return new Map<string, string>(); });
  const thumbs = styleRows
    .map((p) => signedThumbs.get((p as AnyRec).thumbnail_path as string) ?? p.thumbnail_url)
    .filter((u): u is string => !!u);

  const styleOpts = { brandColors: kit?.brand_colors, archetype: kit?.site_type, fonts: normalizeFonts(kit?.fonts) };
  const [context, visualPlaybook] = await Promise.all([
    synthesizeBrandContext({ name: brand?.name ?? '', kit: kit ?? null, documents: documents ?? [], posts }),
    synthesizeVisualPlaybook(thumbs) // thumbs are top-engagement first → "what works visually"
  ]);

  // Visual style with a FALLBACK image chain. History thumbnails alone are not enough: they are
  // signed platform-CDN URLs that expire within days (a stale row 403s and the synthesis silently
  // came back empty — the "Rigenera dall'AI does nothing" bug), and brand-new brands have none.
  // Fallbacks, in order of fidelity: the brand's uploaded/archived images (private bucket paths —
  // NON-expiring, includes the auto-archived top posts), the site imagery captured at analysis,
  // the product photos.
  let visualStyle = thumbs.length ? await synthesizeVisualStyle(thumbs, styleOpts) : '';
  if (!visualStyle) {
    const { data: imageDocs } = await supabase
      .from('brand_documents').select('file_url').eq('brand_id', brandId).eq('kind', 'image')
      .order('created_at', { ascending: false }).limit(STYLE_IMAGES);
    const paths = (imageDocs ?? []).map((d) => String(d.file_url ?? '')).filter(Boolean);
    let signedUrls: string[] = [];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('brand-knowledge').createSignedUrls(paths, 60 * 60);
      signedUrls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
    }
    const siteImages: string[] = Array.isArray(kit?.images) ? (kit.images as string[]).filter(Boolean) : [];
    const { data: prods } = await supabase.from('products').select('images').eq('brand_id', brandId).limit(20);
    const productImages = (prods ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .flatMap((p) => (Array.isArray(p.images) ? p.images : []).map((i: any) => (typeof i === 'string' ? i : i?.src ?? i?.url)))
      .filter((u): u is string => typeof u === 'string' && !!u);
    const fallback = [...signedUrls, ...siteImages, ...productImages];
    if (fallback.length) visualStyle = await synthesizeVisualStyle(fallback, styleOpts);
  }

  // History mining: "what works here" (best times / formats / hashtags / cadence) from the brand's
  // own posts, so the planner keeps scheduling and styling to what performs after every rebuild.
  const histDigest = historyInsightsDigest(
    analyzePostHistory(
      (pool ?? []).map((p) => ({ content: p.content, mediaType: (p as AnyRec).media_type, publishedAt: p.published_at, metrics: p.metrics }))
    )
  );

  // Fold in history insights + the visual playbook + the competitive delta (if any) so the planner
  // reads market-aware, performance-aware (text AND visual) context after rebuilds.
  const fullContext = [context, histDigest, visualPlaybook, extraContext?.trim()].filter(Boolean).join('\n\n');

  // If synthesis degraded to empty (model error/timeout/dead media), NEVER clobber an existing
  // brief with null — keep the last good one. Respect visual_style_locked (manual edits win).
  const isLocked = kit?.visual_style_locked === true;
  const update: AnyRec = { ai_context_updated_at: new Date().toISOString() };
  if (!isLocked && visualStyle) update.visual_style = visualStyle;
  if (fullContext) update.ai_context = fullContext;
  await supabase.from('brand_kit').update(update).eq('brand_id', brandId);

  // Typography for composed graphics, proposed once the kit is rich enough to reason about — which
  // is exactly here, after the analysis and after the visual brief. Non-forcing, so a brand that
  // picked its own fonts in Studio is never overwritten, and awaited-but-swallowed so a failing
  // proposal can't take the rebuild (or the onboarding step that calls it) down with it.
  try {
    const { ensureGraphicStyle } = await import('$lib/server/design-typography');
    await ensureGraphicStyle(supabase, brandId);
  } catch (e) {
    console.warn('[brand-context] graphic typography proposal skipped:', e);
  }

  return fullContext;
}
