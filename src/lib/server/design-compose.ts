import { parseGraphic, resolveImageRefs, type Graphic, type GraphicAspect } from '$lib/design/blocks';
import { compileGraphicTsx } from '$lib/design/compile-graphic-tsx';
import { graphicToHtml } from '$lib/design/html-from-blocks';
import { htmlToSatori } from '$lib/design/html-to-satori';
import {
  detectGraphicSourceKind,
  parseGraphicCanvasSize,
  unwrapGraphicSource,
  type GraphicSourceKind
} from '$lib/design/graphic-source';
import { GRAPHIC_CRAFT_SPECS } from '$lib/design/graphic-craft';
import { logoIssue, type GraphicIssue } from '$lib/design/graphic-check';
import { structuredKie, KIE_MODEL } from '$lib/server/kie';
import { firstLogoUrl } from '$lib/server/blog-site';
import { isUrlSafe } from '$lib/server/brand-analysis';

/**
 * Compose the graphic — pick the blocks and write the words — on Grok 4.5 via kie.
 *
 * Deliberately NOT the chat turn's own model: the brand chat runs on a fast tier (DeepSeek / Gemini
 * flash) chosen for conversational latency, and composition is the one step where the model quality
 * shows up directly in the artwork. So the chat tool passes a brief and this makes a second call.
 * Rendering stays deterministic either way — the model only chooses blocks and copy, never pixels.
 *
 * The schema below is hand-written rather than derived from GraphicSchema because kie's structured
 * output runs OpenAI-style `strict` json_schema: every property must be listed in `required`, and a
 * zod union would emit `anyOf` branches that strictObjectSchema doesn't recurse into. So blocks are
 * FLAT here — one object with a `type` and every field nullable — and the zod union in blocks.ts
 * does the real validation once the JSON is back. One shape for the wire, one for the app.
 */

const BLOCK_TYPES = [
  'kicker',
  'headline',
  'body',
  'list',
  'stat',
  'quote',
  'grid',
  'answer',
  'image',
  'shape',
  'icon',
  'rule',
  'space',
  'footer'
] as const;

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });

const BLOCK_JSON = {
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'text',
    'items',
    'marker',
    'value',
    'label',
    'attribution',
    'highlight',
    'question',
    'missing',
    'brand',
    'note',
    'src',
    'fit',
    'size',
    'radius',
    'kind',
    'fill',
    'name',
    'set',
    'brand_color'
  ],
  properties: {
    type: {
      type: 'string',
      enum: [...BLOCK_TYPES],
      description:
        'kicker = small label. headline = the big line. body = supporting sentence. list = 2-6 short items. stat = one big number. quote = a quotation. grid = 3-across labels. answer = an AI chat mockup. image = a photo from AVAILABLE IMAGES (src = "ref:N" or the exact URL). shape = coloured bar/pill/box/circle. icon = Lucide UI mark or Simple Icons brand slug. rule = accent bar. space = flexible gap. footer = brand lockup.'
    },
    text: nullable('string', 'kicker, headline, body, quote: the words. In a headline, a real newline breaks the line.'),
    items: {
      type: ['array', 'null'],
      items: { type: 'string' },
      description: 'list: 2-6 short lines. grid: 3-9 one-or-two-word labels. answer: what the AI named, 1-5 entries.'
    },
    marker: nullable('string', 'list only: "dot" or "number".'),
    value: nullable('string', 'stat only: the number itself, at most 12 characters.'),
    label: nullable(
      'string',
      'stat caption; image caption; shape/pill/box label; icon label beside the mark.'
    ),
    attribution: nullable('string', 'quote only: who said it.'),
    highlight: { type: ['integer', 'null'], description: 'grid only: index of the one cell to fill with the brand colour.' },
    question: nullable('string', 'answer only: the question put to the AI.'),
    missing: nullable('string', 'answer only: who the AI left out of its list.'),
    brand: nullable('string', 'footer only: the brand name.'),
    note: nullable('string', 'footer only: a short right-hand note (handle, price, site).'),
    src: nullable(
      'string',
      'image only: use "ref:0", "ref:1", … matching AVAILABLE IMAGES, or the exact https URL from that list. Never invent a URL.'
    ),
    fit: nullable('string', 'image only: "cover" (default) or "contain".'),
    size: nullable(
      'string',
      'image: sm|md|lg|hero. shape/icon: sm|md|lg. Defaults to md.'
    ),
    radius: nullable('string', 'image only: none|sm|md|full.'),
    kind: nullable('string', 'shape only: bar|pill|box|circle.'),
    fill: nullable('string', 'shape/icon: accent|ink|soft|hair|bg (palette tokens).'),
    name: nullable(
      'string',
      'icon only: Lucide slug (check, arrow-right, sparkles, heart, zap, star, plus) OR Simple Icons brand slug (instagram, tiktok, facebook, linkedin, youtube, openai, …).'
    ),
    set: nullable('string', 'icon only: auto (default), lucide, or simple — force the catalog when ambiguous.'),
    brand_color: { type: ['boolean', 'null'], description: 'icon only: use the Simple Icons brand hex (default true for brand marks).' }
  }
};

const GRAPHIC_JSON = {
  type: 'object',
  additionalProperties: false,
  required: ['aspect', 'theme', 'background', 'blocks'],
  properties: {
    aspect: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9'], description: '4:5 for feed, 9:16 for stories/reels, 1:1 for square, 16:9 for wide.' },
    theme: {
      type: 'string',
      enum: ['light', 'dark', 'accent'],
      description: 'light = off-white canvas. dark = near-black. accent = the brand colour edge to edge, striking but use it sparingly. With a photo background, prefer dark so type stays legible over the scrim.'
    },
    background: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['src', 'fit', 'dim'],
      description:
        'Optional full-bleed photo BEHIND the type (reuse a prior generate_image URL or AVAILABLE IMAGES via ref:N). Null when the canvas is a flat colour. Not the same as an image block (which sits in the stack).',
      properties: {
        src: { type: 'string', description: '"ref:N" or exact https URL from AVAILABLE IMAGES / a prior generate_image result.' },
        fit: { type: 'string', description: '"cover" (default) or "contain".' },
        dim: {
          type: 'number',
          description: '0–1 veil over the photo so type stays readable. Typical 0.4–0.55. Higher = more veiled.'
        }
      }
    },
    blocks: { type: 'array', items: BLOCK_JSON, description: 'Ordered top to bottom. Four to eight blocks makes a good post.' }
  }
};

const SYSTEM = `You are the art director for a brand's social graphics. You compose posts as an ordered STACK of blocks on a coloured canvas — typography first, with optional photos (in-stack or as a full-bleed BACKGROUND), shapes and icons.

You choose blocks and write the words. You never choose positions — the layout engine stacks your blocks in order and distributes the space, so your only spatial control is where you put "space" blocks.

How to compose well:
- Fewer words than feel natural. This is read mid-scroll, not studied. A headline is one thought, ideally under ten words.
- One idea per graphic. If the brief carries two, pick the sharper one.
- Open with a kicker only when it frames something the headline can then land on. Otherwise skip it.
- Spread the blocks over the WHOLE canvas, never bunched at the top. Put a "space" between every group you want separated — after the opening label, between the substance and the headline, before the footer. Three spaces in a seven-block graphic is normal.
- Break a headline with a newline only where the break carries meaning ("Nove posti.\\nTu ne presidi uno."), never to even out line lengths.
- Every field that does not belong to your block type must be null. A headline block has text and the rest null.
- Always end with a footer carrying the brand name (text). When AVAILABLE IMAGES includes a "brand logo", ALSO place that logo as an image block near the top or above the footer — size sm or md, fit "contain". That file IS the official mark from the brand kit. Never fake the brand logo with a Lucide/Simple Icons icon, a coloured shape, or a typed kicker of the brand name when the real logo is listed.
- Write in the brand's language.

Photos — two different uses:
1. background — full-bleed UNDER the type. Use when the brief says "use this photo as background / backdrop / behind the text", OR when AVAILABLE IMAGES includes a "reference photo" / "media library" shot and the brief asks to add a logo or branding onto that photo — then the photo MUST be background.src (never discard it for a blank canvas). Set dim ~0.45 and prefer theme "dark". background null when not needed.
2. image block — a photo IN the stack (product shot in a rounded box, portrait above the headline, OR the brand logo lockup). size md/lg for photos; size sm/md + fit contain for logos. One product photo is usually enough.

Only use photos when AVAILABLE IMAGES is non-empty (or an explicit https URL from a prior generate_image was handed to you). Never invent URLs. Entries labeled "brand logo" / "brand favicon" are always safe to use.

Shapes & icons:
- shape: bar / pill / box / circle with palette fill tokens (accent, ink, soft, hair, bg). Use sparingly as accents — a box shape can frame a short label; it does not wrap a photo (use image radius for that).
- icon: Lucide for UI verbs (check, star, sparkles, arrow-right, heart, zap, plus). Simple Icons for THIRD-PARTY brand marks (instagram, tiktok, linkedin, youtube, openai, …) — NOT for this brand's own logo (use the brand-logo image ref instead). Prefer set "auto".`;

/**
 * The brand's standing art direction outranks the general rules above: it is the one place a brand
 * says "never dark", "always end on the handle", "no more than six words". Appended last so it wins
 * where the two disagree.
 */
function systemFor(opts: { instructions?: string | null }): string {
  const extra = opts.instructions?.trim();
  const base = `${SYSTEM}\n\n${GRAPHIC_CRAFT_SPECS}`;
  return extra ? `${base}\n\nBRAND ART DIRECTION — these override the rules above where they conflict:\n${extra}` : base;
}

export type AvailableGraphicImage = { url: string; label?: string | null };

/**
 * Prepend official brand kit marks so they are always ref:0 (logo) / ref:1 (favicon).
 * Call after assembling media-library / attachment / AI photos — brand marks win the stable slots.
 */
export function withBrandKitLogos(
  images: AvailableGraphicImage[],
  kit: { logos?: unknown; favicon_url?: string | null } | null | undefined
): AvailableGraphicImage[] {
  const brand: AvailableGraphicImage[] = [];
  const primary = firstLogoUrl(kit?.logos);
  if (primary && (primary.startsWith('data:image/') || isUrlSafe(primary))) {
    brand.push({ url: primary, label: 'brand logo' });
  }
  const fav = typeof kit?.favicon_url === 'string' ? kit.favicon_url.trim() : '';
  if (fav && fav !== primary && (fav.startsWith('data:image/') || isUrlSafe(fav))) {
    brand.push({ url: fav, label: 'brand favicon' });
  }
  if (!brand.length) return images;
  const brandUrls = new Set(brand.map((b) => b.url));
  return [...brand, ...images.filter((i) => !brandUrls.has(i.url))];
}

export type ComposeGraphicOpts = {
  brandName?: string | null;
  language?: string | null;
  /** The brand's own art direction for graphics (brand_kit.graphic_style.instructions). */
  instructions?: string | null;
  /** Anything already on the post — caption, platform — so the graphic doesn't repeat the caption verbatim. */
  context?: string | null;
  /** Photos the composer may embed via image blocks (ref:N). */
  availableImages?: AvailableGraphicImage[] | null;
  brandId?: string;
  userId?: string;
};

type FlatBlock = Record<string, unknown>;

/** Drop the nulls the strict schema forced, so the zod union sees a clean discriminated object. */
function tidy(raw: unknown): unknown {
  const g = (raw ?? {}) as { aspect?: unknown; theme?: unknown; background?: unknown; blocks?: unknown };
  const blocks = Array.isArray(g.blocks) ? (g.blocks as FlatBlock[]) : [];
  let background: unknown = g.background ?? null;
  if (background && typeof background === 'object') {
    background = Object.fromEntries(
      Object.entries(background as Record<string, unknown>).filter(([, v]) => v != null && v !== '')
    );
    if (!(background as { src?: string }).src) background = undefined;
  } else {
    background = undefined;
  }
  return {
    aspect: g.aspect ?? '4:5',
    theme: g.theme ?? 'light',
    ...(background ? { background } : {}),
    blocks: blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v != null && v !== '')))
  };
}

function availableImagesPrompt(images: AvailableGraphicImage[] | null | undefined): string {
  if (!images?.length) return 'AVAILABLE IMAGES: none — do not use <img> / image blocks.';
  const lines = images.map((img, i) => {
    const label = img.label?.trim() ? ` (${img.label.trim()})` : '';
    return `[${i}] ref:${i}${label} → ${img.url}`;
  });
  const hasLogo = images.some((img) => /brand logo/i.test(img.label ?? ''));
  const logoHint = hasLogo
    ? '\nBRAND LOGO: an entry labeled "brand logo" is the official mark from Studio › Brand kit. Prefer it as an <img src="ref:N"> (or image block) whenever the brief wants a logo / lockup / brand mark. Do not substitute a typed brand name or a generic icon for it.'
    : '';
  return `AVAILABLE IMAGES (use src="ref:N" or the exact https URL):\n${lines.join('\n')}${logoHint}`;
}

function finish(raw: unknown, opts: ComposeGraphicOpts): Graphic {
  const parsed = parseGraphic(tidy(raw));
  return resolveImageRefs(parsed, opts.availableImages);
}

export async function composeGraphic(brief: string, opts: ComposeGraphicOpts = {}): Promise<Graphic> {
  const prompt = [
    `BRIEF: ${brief}`,
    opts.brandName ? `BRAND: ${opts.brandName}` : '',
    opts.language ? `LANGUAGE: write everything in ${opts.language}` : '',
    opts.context ? `POST CONTEXT (do not repeat it word for word on the canvas):\n${opts.context}` : '',
    availableImagesPrompt(opts.availableImages)
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await structuredKie<unknown>(
    prompt,
    GRAPHIC_JSON,
    systemFor(opts),
    'compose_graphic',
    { brandId: opts.brandId, userId: opts.userId, context: 'design/compose' },
    undefined,
    undefined,
    KIE_MODEL
  );
  return finish(raw, opts);
}

const SOURCE_JSON = {
  type: 'object',
  additionalProperties: false,
  required: ['aspect', 'source'],
  properties: {
    aspect: {
      type: 'string',
      enum: ['1:1', '4:5', '9:16', '16:9'],
      description: '4:5 for feed, 9:16 for stories/reels, 1:1 for square, 16:9 for wide.'
    },
    source: {
      type: 'string',
      description:
        'Complete graphic source: an HTML document with a .canvas root and a <style> block, OR a React TSX file (import React; export default function Graphic; export const width/height). No markdown fences.'
    }
  }
};

const HTML_SYSTEM = `You are the art director for a brand's social graphics. You write the SOURCE CODE of the image — real HTML+CSS (preferred) or React TSX — that a server renderer turns into a PNG.

The renderer is satori (flexbox → SVG). CSS is a SUBSET:
- display:flex (REQUIRED on every wrapper), flex-direction, flex-wrap, align-items, justify-content, gap, flex-grow, flex-shrink
- position: relative | absolute; top/left/right/bottom
- width, height, min/max, margin, padding, overflow:hidden
- font-size, font-weight, font-family, line-height, letter-spacing, text-align, text-transform, color
- background-color, background-image: linear-gradient(...), border, border-radius, object-fit
- NO css grid, NO calc(), NO custom properties (var(--x)), NO hover, NO media queries, NO <script>

HTML contract:
- One root with class="canvas" (or data-graphic) AND data-aspect, data-width, data-height matching the canvas in pixels (1080×1350 for 4:5, 1080×1920 for 9:16, 1080×1080 for 1:1, 1920×1080 for 16:9).
- Put CSS in a <style> tag inside the root. Use classes. Inline styles are also fine.
- Images: <img src="ref:N"> or the exact https URL from AVAILABLE IMAGES. Never invent URLs.
- Use <div>, <span>, <img>, <p>, <h1>–<h3>. Every text wrapper must be display:flex.

TSX contract (only if you choose TSX over HTML):
- import React from 'react'
- export const width, height
- export default function Graphic()
- only the 'react' import is allowed
- inline style objects; same flexbox rules

Composition:
- Spread content over the WHOLE canvas — use flex-grow spacers, not everything bunched at the top.
- Photos: full-bleed background (position:absolute img + a dimming overlay) OR in-stack rounded <img>. If the brief is "put the logo on this photo", the photo MUST be the background — never a blank canvas with only the logo.`;

function sourceSystemFor(opts: { instructions?: string | null }): string {
  const extra = opts.instructions?.trim();
  const base = `${HTML_SYSTEM}\n\n${GRAPHIC_CRAFT_SPECS}`;
  return extra
    ? `${base}\n\nBRAND ART DIRECTION — these override the rules above where they conflict:\n${extra}`
    : base;
}

export type ComposedGraphicSource = {
  source: string;
  aspect: GraphicAspect;
  kind: GraphicSourceKind;
};

function assertRenderableSource(source: string): GraphicSourceKind {
  const kind = detectGraphicSourceKind(source);
  if (kind === 'tsx') compileGraphicTsx(source);
  else htmlToSatori(source);
  return kind;
}

function readSourcePayload(raw: unknown): { aspect: GraphicAspect; source: string } {
  const o = (raw ?? {}) as { aspect?: unknown; source?: unknown };
  const source = unwrapGraphicSource(typeof o.source === 'string' ? o.source : '');
  if (!source) throw new Error('Empty graphic source');
  const parsed = parseGraphicCanvasSize(source);
  const aspect: GraphicAspect =
    o.aspect === '1:1' || o.aspect === '4:5' || o.aspect === '9:16' || o.aspect === '16:9'
      ? o.aspect
      : parsed.aspect;
  return { aspect, source };
}

/**
 * Compose a graphic as editable HTML (or TSX). Falls back to the block JSON composer and
 * projects it to HTML if the freeform source does not parse.
 */
export async function composeGraphicSource(
  brief: string,
  opts: ComposeGraphicOpts = {}
): Promise<ComposedGraphicSource> {
  const prompt = [
    `BRIEF: ${brief}`,
    opts.brandName ? `BRAND: ${opts.brandName}` : '',
    opts.language ? `LANGUAGE: write everything in ${opts.language}` : '',
    opts.context ? `POST CONTEXT (do not repeat it word for word on the canvas):\n${opts.context}` : '',
    availableImagesPrompt(opts.availableImages),
    'Return aspect + source (full HTML with <style>, no markdown fences).'
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const raw = await structuredKie<unknown>(
      prompt,
      SOURCE_JSON,
      sourceSystemFor(opts),
      'compose_graphic_source',
      { brandId: opts.brandId, userId: opts.userId, context: 'design/compose-source' },
      undefined,
      undefined,
      KIE_MODEL
    );
    const { aspect, source } = readSourcePayload(raw);
    const kind = assertRenderableSource(source);
    return { source, aspect, kind };
  } catch (e) {
    // Il ripiego a blocchi è l'unico modo per cui `composeGraphic` viene ancora chiamato: nessun
    // altro chiamante esiste. Finché taceva, i suoi 27 giri in 60 giorni sembravano il percorso
    // normale invece del sintomo che sono — quindi ORA URLA, con la ragione vera.
    console.error(
      `[design] compose source failed (${e instanceof Error ? e.message : String(e)}) — falling back to the block composer, which cannot draw a custom layout.`
    );
    const graphic = await composeGraphic(brief, opts);
    return {
      source: graphicToHtml(graphic),
      aspect: graphic.aspect,
      kind: 'html'
    };
  }
}

/** Revise stored HTML/TSX. Falls back to re-compose if the patch does not parse. */
export async function reviseGraphicSource(
  current: string,
  instruction: string,
  opts: ComposeGraphicOpts = {}
): Promise<ComposedGraphicSource> {
  const prompt = [
    'CURRENT GRAPHIC SOURCE:',
    current,
    '',
    availableImagesPrompt(opts.availableImages),
    '',
    `REQUESTED CHANGE: ${instruction}`,
    opts.language ? `LANGUAGE: ${opts.language}` : '',
    '',
    'Return the COMPLETE revised source (same language as the current file: HTML or TSX). Change only what the request asks for. Keep existing image URLs unless replacing the photo.'
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await structuredKie<unknown>(
      prompt,
      SOURCE_JSON,
      sourceSystemFor(opts),
      'revise_graphic_source',
      { brandId: opts.brandId, userId: opts.userId, context: 'design/revise-source' },
      undefined,
      undefined,
      KIE_MODEL
    );
    const { aspect, source } = readSourcePayload(raw);
    const kind = assertRenderableSource(source);
    return { source, aspect, kind };
  } catch (e) {
    // Questo ripiego RICOMPONE: l'utente ha chiesto "accorcia il titolo" e si ritrova una grafica
    // diversa. È comunque meglio di un errore secco, ma è una perdita e va detta.
    console.error(
      `[design] revise source failed (${e instanceof Error ? e.message : String(e)}) — recomposing from the instruction, so parts the user did not mention may change.`
    );
    return composeGraphicSource(instruction, {
      ...opts,
      context: [opts.context, 'CURRENT SOURCE:\n' + current.slice(0, 6000)].filter(Boolean).join('\n\n')
    });
  }
}

// ── La porta sola: componi → renderizza → un giro di riparazione ─────────────────────────────

/**
 * IL POSTO IN CUI IL GATE HA I DENTI ANCHE ALLA PRIMA COMPOSIZIONE.
 *
 * `inspectGraphicTree` era agganciato solo a `write_source` / `replace_source` — le due tool con
 * cui un modello PATCHA una grafica. Le tre porte che ne COMPONGONO una da zero (create_post con
 * un graphic_brief, design_graphic, il media generator) non lo chiamavano mai: la prima
 * composizione, cioè quella che poi si pubblica, non era mai stata controllata.
 *
 * Il controllo vero vive in `renderGraphicSource` (un innesto solo, ogni chiamante coperto). Qui
 * sopra c'è la decisione: su un difetto BLOCCANTE si fa UN giro di riparazione — non un rifiuto
 * secco, perché a differenza di una tool call non c'è nessun agente in ascolto che possa
 * ritentare, e non un ciclo, perché due giri costano più della grafica che salvano.
 *
 * Il render è deterministico e locale (satori + resvg): rifarlo costa millisecondi, non una
 * chiamata al modello. La chiamata in più è solo la revisione.
 */
export type ComposeAndRenderResult = {
  rendered: import('$lib/server/design-render').RenderedGraphic;
  /** I difetti rimasti DOPO l'eventuale riparazione. Da restituire al chiamante come avvisi. */
  issues: GraphicIssue[];
  /** true se è servito un giro di riparazione. */
  repaired: boolean;
  /** true se la grafica esce ancora con un difetto bloccante (riparazione non riuscita). */
  stillBlocking: boolean;
};

export async function composeAndRenderGraphic(
  brief: string,
  opts: ComposeGraphicOpts & {
    /** Sorgente esistente: se c'è si REVISIONA, così quello che l'utente non ha nominato resta. */
    previousSource?: string | null;
    render: {
      brandColors?: string[] | null;
      brandFont?: string | null;
      typography?: { display: string; body: string };
      availableImages?: Array<{ url: string }> | null;
      format?: 'png' | 'jpeg';
    };
  }
): Promise<ComposeAndRenderResult> {
  const { previousSource, render, ...composeOpts } = opts;
  const { renderGraphicSource } = await import('$lib/server/design-render');

  const composed = previousSource?.trim()
    ? await reviseGraphicSource(previousSource, brief, composeOpts)
    : await composeGraphicSource(brief, composeOpts);

  // Il brand porta la sandbox: e' per brand, e il tempo macchina si addebita a lui.
  const renderWithBrand = { ...render, brandId: composeOpts.brandId, userId: composeOpts.userId };
  let rendered = await renderGraphicSource(composed.source, renderWithBrand);
  let issues = withLogoIssue(rendered.issues, rendered.source, composeOpts.availableImages);
  let repaired = false;

  if (issues.some((i) => i.blocking)) {
    const fix = issues
      .filter((i) => i.blocking)
      .map((i) => `- ${i.detail}`)
      .join('\n');
    console.warn(`[design] first composition failed the gate, one repair round:\n${fix}`);
    try {
      const patched = await reviseGraphicSource(
        rendered.source,
        `The rendered graphic has defects that make it unusable in a feed. Fix ONLY these, changing nothing else:\n${fix}`,
        composeOpts
      );
      const retry = await renderGraphicSource(patched.source, renderWithBrand);
      const after = withLogoIssue(retry.issues, retry.source, composeOpts.availableImages);
      // Si tiene la riparazione solo se ha davvero tolto qualcosa. Un modello a cui si chiede di
      // alzare un corpo di testo può riscrivere mezza tela e introdurne due nuovi: in quel caso
      // la prima versione, con i suoi difetti noti, è la meno peggio.
      const before = issues.filter((i) => i.blocking).length;
      if (after.filter((i) => i.blocking).length < before) {
        repaired = true;
        rendered = retry;
        issues = after;
      } else {
        console.warn('[design] repair round did not reduce the blocking defects — keeping the first render');
      }
    } catch (e) {
      console.error(`[design] repair round failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { rendered, issues, repaired, stillBlocking: issues.some((i) => i.blocking) };
}

/** Il logo si controlla sul sorgente, non sull'albero — vedi `logoIssue`. */
function withLogoIssue(
  issues: GraphicIssue[],
  source: string,
  available: AvailableGraphicImage[] | null | undefined
): GraphicIssue[] {
  const logo = available?.find((i) => /brand logo/i.test(i.label ?? ''))?.url;
  const issue = logoIssue(source, logo);
  return issue ? [...issues, issue] : issues;
}
