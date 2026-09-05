import { z } from 'zod';

/**
 * Typographic graphics the MODEL can author safely.
 *
 * The existing DesignSchema ($lib/design/schema) places every layer at an absolute x/y/w/h. That is
 * right for a human dragging things in the design lab and wrong for an LLM: asked for coordinates a
 * model overlaps text, leaves elements half off-canvas and produces ragged vertical rhythm, and
 * computeAutoFitSize can't save it — shrinking type inside a badly placed box just yields small type
 * in the wrong place.
 *
 * So here a graphic is a STACK: an ordered list of blocks laid out in a flex column. The model picks
 * which blocks, in what order, with what words (and which photos/icons/shapes). It never sees a
 * coordinate, so overlap and overflow are unrepresentable rather than merely discouraged. `space` is
 * the one positioning primitive it gets, and it only says "push the rest apart".
 *
 * Photos sit in the stack as `image` blocks (user upload, Media library, product, talent, or a
 * freshly generated still). Decorative marks are constrained: `shape` uses palette tokens, `icon`
 * picks from a fixed set — no freeform SVG from the model.
 *
 * Every size is a fraction of the canvas width (see `scale`), which is what makes one spec render
 * correctly at 1080 for a feed post and at 1080×1920 for a story without a second set of numbers.
 */

export const GraphicAspectSchema = z.enum(['1:1', '4:5', '9:16', '16:9']);
export type GraphicAspect = z.infer<typeof GraphicAspectSchema>;

export const GRAPHIC_WIDTH = 1080;

export function graphicSize(aspect: GraphicAspect): { width: number; height: number } {
  switch (aspect) {
    case '1:1':
      return { width: GRAPHIC_WIDTH, height: GRAPHIC_WIDTH };
    case '4:5':
      return { width: GRAPHIC_WIDTH, height: Math.round((GRAPHIC_WIDTH * 5) / 4) };
    case '9:16':
      return { width: GRAPHIC_WIDTH, height: Math.round((GRAPHIC_WIDTH * 16) / 9) };
    case '16:9':
      return { width: 1920, height: 1080 };
  }
}

/** Canvas-relative sizing: `scale(w, 8.4)` is "8.4% of the canvas width", the cqw of a CSS design. */
export const scale = (canvasW: number, pct: number) => Math.round((canvasW * pct) / 100);

/**
 * z.union, NOT z.discriminatedUnion: zod emits `oneOf` for a discriminated union and @ai-sdk/google
 * forwards that key verbatim, but Gemini's function-declaration Schema only knows `anyOf` — the tool
 * would be rejected at request time. A plain union emits `anyOf` and narrows identically in
 * TypeScript, since every member pins `type` to a literal.
 */
/** Built-in short aliases — full Lucide + Simple Icons catalogs are resolved at render time by name. */
export const GraphicIconNameSchema = z.string().min(1).max(60);

/** Palette tokens — keep freeform hex out of the model's hands. */
export const GraphicFillSchema = z.enum(['accent', 'ink', 'soft', 'hair', 'bg']);
export type GraphicFill = z.infer<typeof GraphicFillSchema>;

export const ImageSizeSchema = z.enum(['sm', 'md', 'lg', 'hero']);
export type ImageSize = z.infer<typeof ImageSizeSchema>;

/** Height of an image block as a % of canvas width (same scale units as type). */
export const IMAGE_SIZE_PCT: Record<ImageSize, number> = {
  sm: 28,
  md: 40,
  lg: 52,
  hero: 68
};

export const BlockSchema = z.union([
  z.object({
    type: z.literal('kicker'),
    text: z.string().min(1).max(60)
  }),
  z.object({
    type: z.literal('headline'),
    /** Newlines are honoured — the model breaks its own lines when the break carries meaning. */
    text: z.string().min(1).max(140)
  }),
  z.object({
    type: z.literal('body'),
    text: z.string().min(1).max(280)
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string().min(1).max(80)).min(2).max(6),
    marker: z.enum(['dot', 'number']).default('dot')
  }),
  z.object({
    type: z.literal('stat'),
    value: z.string().min(1).max(12),
    label: z.string().min(1).max(80).optional()
  }),
  z.object({
    type: z.literal('quote'),
    text: z.string().min(1).max(240),
    attribution: z.string().max(60).optional()
  }),
  z.object({
    /** 3-across grid of short labels, optionally with one cell filled in the accent colour. */
    type: z.literal('grid'),
    items: z.array(z.string().min(1).max(20)).min(3).max(9),
    highlight: z.number().int().min(0).optional()
  }),
  z.object({
    /** An AI answer card: the question, what it named, and (optionally) who it left out. */
    type: z.literal('answer'),
    question: z.string().min(1).max(120),
    items: z.array(z.string().min(1).max(60)).min(1).max(5),
    missing: z.string().max(60).optional()
  }),
  z.object({
    /**
     * A photo (user upload, Media library, product, talent, or AI-generated) embedded in the stack.
     * `src` is an https/data URL, or `ref:N` resolved against the available-images catalog at compose time.
     */
    type: z.literal('image'),
    src: z.string().min(1).max(2000),
    fit: z.enum(['cover', 'contain']).default('cover'),
    size: ImageSizeSchema.default('md'),
    radius: z.enum(['none', 'sm', 'md', 'full']).default('md'),
    label: z.string().max(80).optional()
  }),
  z.object({
    /** Coloured geometric accent — bar, pill, box, or circle. Fill is a palette token. */
    type: z.literal('shape'),
    kind: z.enum(['bar', 'pill', 'box', 'circle']).default('bar'),
    fill: GraphicFillSchema.default('accent'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
    label: z.string().max(40).optional()
  }),
  z.object({
    /**
     * Icon mark from Lucide (UI) or Simple Icons (brands). `name` is a slug:
     * Lucide `check` / `arrow-right` / `sparkles`, Simple Icons `instagram` / `tiktok` / `openai`.
     * Never freeform SVG — unknown names are dropped at render.
     */
    type: z.literal('icon'),
    name: GraphicIconNameSchema,
    set: z.enum(['auto', 'lucide', 'simple']).default('auto'),
    fill: GraphicFillSchema.default('accent'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
    label: z.string().max(60).optional(),
    /** Prefer the brand's own hex (Simple Icons) over the palette fill. Default true for brand marks. */
    brand_color: z.boolean().optional()
  }),
  z.object({
    type: z.literal('rule')
  }),
  z.object({
    /** Flexible gap. Several of them share the leftover height equally, as flex:1 siblings do. */
    type: z.literal('space')
  }),
  z.object({
    type: z.literal('footer'),
    brand: z.string().min(1).max(40),
    note: z.string().max(60).optional()
  })
]);

export type Block = z.infer<typeof BlockSchema>;

export const GraphicSchema = z.object({
  aspect: GraphicAspectSchema.default('4:5'),
  /** `accent` paints the whole canvas in the brand colour — use it for at most one post in a set. */
  theme: z.enum(['light', 'dark', 'accent']).default('light'),
  /**
   * Optional full-bleed photo behind the stack (AI still, library asset, prior generate_image URL).
   * Text sits on top; `dim` darkens/lights the photo so type stays legible.
   */
  background: z
    .object({
      src: z.string().min(1).max(2000),
      fit: z.enum(['cover', 'contain']).default('cover'),
      /** 0 = photo as-is, 1 = fully veiled by theme ink. Typical 0.35–0.55 for readable type. */
      dim: z.number().min(0).max(1).default(0.45)
    })
    .optional(),
  blocks: z.array(BlockSchema).min(1).max(12)
});

export type Graphic = z.infer<typeof GraphicSchema>;

/**
 * Guarantee the composition breathes.
 *
 * Models reliably stack every block at the top and leave the bottom two thirds empty — verified: a
 * kicker, headline and body crammed into the first quarter of a 4:5 canvas. Prompting for it helps
 * and does not hold. So the two spacers that every good composition has are inserted here instead:
 * one under the opening label, one above the footer. Idempotent — a model that got it right is
 * untouched, since an existing `space` in either position satisfies the rule.
 */
export function breathe(blocks: Block[]): Block[] {
  const out = [...blocks];
  const SPACE = { type: 'space' } as const;

  const last = out[out.length - 1];
  if (last?.type === 'footer' && out[out.length - 2]?.type !== 'space') {
    out.splice(out.length - 1, 0, SPACE);
  }
  if (out[0]?.type === 'kicker' && out[1] && out[1].type !== 'space') {
    out.splice(1, 0, SPACE);
  }
  return out;
}

/** Validate, then apply the composition floor. Single funnel — every render goes through here. */
export function parseGraphic(input: unknown): Graphic {
  const g = GraphicSchema.parse(input);
  return { ...g, blocks: breathe(g.blocks) };
}

/** Map a fill token onto the live palette. */
export function resolveFill(fill: GraphicFill, p: Palette): string {
  switch (fill) {
    case 'accent':
      return p.accent;
    case 'ink':
      return p.ink;
    case 'soft':
      return p.soft;
    case 'hair':
      return p.hair;
    case 'bg':
      return p.bg;
  }
}

/**
 * Turn `ref:N` / bare index srcs into real URLs from the available-images catalog the composer saw.
 * Leaves absolute https/data URLs alone. Drops image blocks / backgrounds whose ref cannot be resolved.
 */
export function resolveImageRefs(
  graphic: Graphic,
  available: Array<{ url: string }> | null | undefined
): Graphic {
  const resolveSrc = (src: string): string | null => {
    const m = /^(?:ref:)?(\d+)$/i.exec(src.trim());
    if (m) {
      if (!available?.length) return null;
      return available[Number(m[1])]?.url ?? null;
    }
    if (/^(https?:|data:image\/)/i.test(src)) return src;
    return null;
  };

  let background = graphic.background;
  if (background) {
    const src = resolveSrc(background.src);
    background = src ? { ...background, src } : undefined;
  }

  const blocks = graphic.blocks
    .map((b) => {
      if (b.type !== 'image') return b;
      const src = resolveSrc(b.src);
      if (!src) return null;
      return { ...b, src };
    })
    .filter((b): b is Block => !!b);

  return { ...graphic, background, blocks };
}

export type Palette = {
  bg: string;
  ink: string;
  soft: string;
  faint: string;
  hair: string;
  accent: string;
  /** Ink that stays legible ON the accent colour. */
  onAccent: string;
};

/** Relative luminance (WCAG). Used to keep text legible on a brand colour we've never seen. */
function luminance(hex: string): number {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#?[a-f\d]{6}$/i.test(v.trim());
const norm = (v: string) => (v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`);

const NEUTRAL_ACCENT = '#c485fe';

/**
 * Build the palette from the brand's own colours, falling back to the Anomalia neutrals.
 * The accent is the brand's FIRST colour: it's the one a brand kit puts forward, and it's the only
 * hue in the design — everything else is a neutral, so an ugly brand colour can only ever ruin one
 * element instead of the whole canvas.
 */
export function paletteFor(theme: Graphic['theme'], brandColors?: string[] | null): Palette {
  const accent = (brandColors ?? []).filter(isHex).map(norm)[0] ?? NEUTRAL_ACCENT;
  const onAccent = luminance(accent) > 0.45 ? '#1d1d1f' : '#ffffff';

  if (theme === 'dark') {
    return {
      bg: '#1d1d1f',
      ink: '#ffffff',
      soft: 'rgba(255,255,255,0.62)',
      faint: 'rgba(255,255,255,0.42)',
      hair: 'rgba(255,255,255,0.16)',
      accent,
      onAccent
    };
  }
  if (theme === 'accent') {
    return {
      bg: accent,
      ink: onAccent,
      soft: onAccent === '#ffffff' ? 'rgba(255,255,255,0.72)' : 'rgba(29,29,31,0.68)',
      faint: onAccent === '#ffffff' ? 'rgba(255,255,255,0.5)' : 'rgba(29,29,31,0.45)',
      hair: onAccent === '#ffffff' ? 'rgba(255,255,255,0.24)' : 'rgba(29,29,31,0.18)',
      accent: onAccent,
      onAccent: accent
    };
  }
  return {
    bg: '#f9f9f9',
    ink: '#1d1d1f',
    soft: '#6e6e73',
    faint: '#86868b',
    hair: '#ededef',
    accent,
    onAccent
  };
}
