import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ALL_SHORTLIST_FONTS,
  DEFAULT_FONT,
  FONT_SHORTLIST,
  GraphicStyleSchema,
  resolveTypography,
  type GraphicStyle,
  type ResolvedTypography
} from '$lib/design/typography';
import { loadGraphicFont } from '$lib/server/design-render';
import { structuredKie, KIE_MODEL } from '$lib/server/kie';

/**
 * Choosing and validating the typography a brand's graphics are set in.
 *
 * The bug this exists to kill: brand_kit.fonts is scraped from the website, so the graphic renderer
 * was setting posts in whatever face the site happened to load — usually a serif display chosen for
 * a 96px hero, which at post scale reads as "the AI picked a random serif". And when the name did
 * not resolve on Google Fonts it fell back to Inter silently, so the brand could not tell whether
 * its font was being used at all.
 */

/**
 * Is this family actually renderable? The check is a real fetch through the renderer's own loader,
 * not a lookup in a list we would have to keep in sync — if it comes back as something else, Google
 * Fonts does not serve it and a graphic set in it would silently be Inter.
 */
export async function fontIsAvailable(family: string): Promise<boolean> {
  const name = family.trim();
  if (!name) return false;
  try {
    const { family: got } = await loadGraphicFont(name);
    return got.toLowerCase() === name.toLowerCase();
  } catch {
    return false;
  }
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['display_font', 'body_font', 'instructions', 'why'],
  properties: {
    display_font: {
      type: 'string',
      description: 'Family for headlines, big numbers and quotes — the lines people stop on.'
    },
    body_font: {
      type: 'string',
      description: 'Family for labels, body copy, lists and the footer. May be the same as the display font.'
    },
    instructions: {
      type: 'string',
      description:
        'Art direction for every graphic this brand makes, in the brand\'s own language. Two to four short rules about tone, theme preference, how much text, what to avoid. Not a description of the brand — instructions a designer could follow.'
    },
    why: { type: 'string', description: 'One sentence on why this pairing suits the brand.' }
  }
};

function proposalSystem(): string {
  const list = Object.entries(FONT_SHORTLIST)
    .map(([group, fonts]) => `${group}: ${fonts.join(', ')}`)
    .join('\n');
  return `You choose the typography a brand's social graphics are set in.

Pick from these families (all are available to the renderer):
${list}

How to choose:
- The DISPLAY face carries the brand's character. Match the register: a serif for heritage, food, editorial and fashion; a grotesque or display face for tech, sport and anything loud; a neutral sans when the brand's voice is plain and the words should do the work.
- The BODY face must disappear. When in doubt make it a neutral sans — Inter, Work Sans, DM Sans. Never set body copy in a display face.
- Pairing the display face with itself is a legitimate choice for a brand with a quiet, systematic identity.
- If the brand's own detected font is in the list above and suits its register, prefer it — it is already their font.

The instructions field is art direction the composer will follow on EVERY graphic. Write rules, not description: which theme to favour, how terse the copy should be, what never to put on a canvas.`;
}

/**
 * Propose typography from what the brand kit knows. Falls back to a safe neutral pairing rather
 * than failing — a brand with no proposal keeps rendering, it just renders in Inter.
 */
export async function proposeGraphicStyle(
  supabase: SupabaseClient,
  brandId: string
): Promise<GraphicStyle> {
  const [{ data: brand }, { data: kit }] = await Promise.all([
    supabase.from('brands').select('name').eq('id', brandId).maybeSingle(),
    supabase
      .from('brand_kit')
      .select('category, about, target_audience, brand_style, fonts, visual_style')
      .eq('brand_id', brandId)
      .maybeSingle()
  ]);

  const detected = Array.isArray(kit?.fonts)
    ? (kit.fonts as Array<{ name?: string } | string>)
        .map((f) => (typeof f === 'string' ? f : f?.name))
        .filter((n): n is string => !!n)
    : [];

  const prompt = [
    `BRAND: ${brand?.name ?? ''}`,
    kit?.category ? `CATEGORY: ${kit.category}` : '',
    kit?.about ? `ABOUT: ${String(kit.about).slice(0, 800)}` : '',
    kit?.target_audience ? `AUDIENCE: ${String(kit.target_audience).slice(0, 400)}` : '',
    kit?.brand_style ? `BRAND STYLE: ${String(kit.brand_style).slice(0, 400)}` : '',
    kit?.visual_style ? `VISUAL BRIEF: ${String(kit.visual_style).slice(0, 1000)}` : '',
    detected.length ? `FONTS DETECTED ON THEIR SITE: ${detected.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  let proposed: { display_font?: string; body_font?: string; instructions?: string } = {};
  try {
    proposed = await structuredKie(
      prompt,
      PROPOSAL_SCHEMA,
      proposalSystem(),
      'propose_graphic_style',
      { brandId, context: 'design/typography' },
      undefined,
      undefined,
      KIE_MODEL
    );
  } catch (e) {
    console.error('[design-typography] proposal failed:', e);
  }

  // Everything the model names is verified against the renderer before it can be saved: a proposal
  // the renderer cannot honour is worse than no proposal, because it looks like a choice.
  const pick = async (name: string | undefined, fallback: string) => {
    const candidate = name?.trim();
    if (candidate && (ALL_SHORTLIST_FONTS as readonly string[]).includes(candidate)) return candidate;
    if (candidate && (await fontIsAvailable(candidate))) return candidate;
    return fallback;
  };

  const display = await pick(proposed.display_font, DEFAULT_FONT);
  const body = await pick(proposed.body_font, DEFAULT_FONT);

  return GraphicStyleSchema.parse({
    display_font: display,
    body_font: body,
    instructions: (proposed.instructions ?? '').slice(0, 1200)
  });
}

/** Propose and persist, unless the brand already chose its own. Returns what is now in force. */
export async function ensureGraphicStyle(
  supabase: SupabaseClient,
  brandId: string,
  opts: { force?: boolean } = {}
): Promise<GraphicStyle | null> {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('graphic_style')
    .eq('brand_id', brandId)
    .maybeSingle();

  const existing = GraphicStyleSchema.safeParse(kit?.graphic_style);
  if (existing.success && !opts.force) return existing.data;

  const style = await proposeGraphicStyle(supabase, brandId);
  const { error } = await supabase.from('brand_kit').update({ graphic_style: style }).eq('brand_id', brandId);
  if (error) {
    console.error('[design-typography] save failed:', error.message);
    return null;
  }
  return style;
}

/** The typography in force for a brand — one query, for the render call sites. */
export async function loadTypography(
  supabase: SupabaseClient,
  brandId: string
): Promise<ResolvedTypography> {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('graphic_style, fonts')
    .eq('brand_id', brandId)
    .maybeSingle();
  return resolveTypography(kit);
}
