import { z } from 'zod';

/**
 * The brand's typography for composed graphics.
 *
 * Two roles, not one. A single family makes every graphic read the same; a display face for the
 * lines people stop on and a body face for everything else is the smallest split that gives a brand
 * a recognisable voice on a canvas.
 *
 * This is deliberately NOT brand_kit.fonts. That column is scraped from the website, so it is
 * whatever the site happens to load — very often a serif display face chosen for a hero at 96px,
 * which at post scale reads as "the AI picked a random serif". Worse, an unresolvable name fell
 * back to Inter with nothing said. What lands here has been validated against Google Fonts, so a
 * brand that picks a font actually gets it.
 */

export const GraphicStyleSchema = z.object({
  display_font: z.string().min(1).max(60),
  body_font: z.string().min(1).max(60),
  /** Free-form art direction the composer must honour on every graphic. */
  instructions: z.string().max(1200).default('')
});

export type GraphicStyle = z.infer<typeof GraphicStyleSchema>;

export const DEFAULT_FONT = 'Inter';

/**
 * Families the AI proposal picks from. Not a hard limit — the Studio accepts any family Google
 * Fonts will serve — but a shortlist the model can choose from beats an open field it hallucinates
 * into. Grouped so a proposal can reason about the brand's register rather than guessing.
 */
export const FONT_SHORTLIST = {
  /** Neutral workhorses. Safe for body text in any brand. */
  sans: ['Inter', 'Manrope', 'Work Sans', 'DM Sans', 'Plus Jakarta Sans', 'Figtree', 'Outfit', 'Karla'],
  /** Editorial, warmth, heritage, food, fashion. */
  serif: ['Fraunces', 'Playfair Display', 'Instrument Serif', 'Lora', 'Libre Baskerville', 'Bitter', 'Newsreader'],
  /** Character-forward display faces — headlines only, never body. */
  display: ['Bricolage Grotesque', 'Archivo', 'Space Grotesk', 'Syne', 'Chivo', 'Anton', 'Bebas Neue'],
  /** Technical, developer, precision. */
  mono: ['JetBrains Mono', 'IBM Plex Mono', 'Space Mono', 'DM Mono']
} as const;

export const ALL_SHORTLIST_FONTS = Object.values(FONT_SHORTLIST).flat();

export type ResolvedTypography = {
  display: string;
  body: string;
  instructions: string;
  /** Where the choice came from — the Studio shows this so "why is it Inter?" has an answer. */
  source: 'brand' | 'detected' | 'default';
};

const firstName = (fonts: unknown): string | null => {
  if (!Array.isArray(fonts)) return null;
  for (const f of fonts) {
    if (typeof f === 'string' && f.trim()) return f.trim();
    const name = (f as { name?: string; family?: string })?.name ?? (f as { family?: string })?.family;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
};

/**
 * Resolve what a graphic should be set in, from the brand kit.
 * Chosen typography wins; then the detected site font (better than nothing, and it is what the
 * behaviour used to be); then Inter.
 */
export function resolveTypography(kit: { graphic_style?: unknown; fonts?: unknown } | null | undefined): ResolvedTypography {
  const parsed = GraphicStyleSchema.safeParse(kit?.graphic_style);
  if (parsed.success) {
    return {
      display: parsed.data.display_font,
      body: parsed.data.body_font,
      instructions: parsed.data.instructions,
      source: 'brand'
    };
  }
  const detected = firstName(kit?.fonts);
  if (detected) return { display: detected, body: detected, instructions: '', source: 'detected' };
  return { display: DEFAULT_FONT, body: DEFAULT_FONT, instructions: '', source: 'default' };
}
