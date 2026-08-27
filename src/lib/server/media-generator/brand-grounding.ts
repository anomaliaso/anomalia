/**
 * Brand identity for UGC / media-generator spoken scripts.
 *
 * Visual style (palette, photography) is separate — `useBrandStyle` can be off while scripts
 * still MUST know what the brand sells. Without this block, PAS / Life-Force craft invents
 * universal human pain (medical, family, grocery spend…) that has nothing to do with the brand.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';

export type UgcBrandOffering = {
  title: string;
  description: string;
  kind: string;
};

export type UgcBrandGrounding = {
  name: string;
  about: string;
  category: string;
  audience: string;
  brandStyle: string;
  /** ai_context minus the visual playbook — voice, pillars, and the GUARDRAIL block, in full. */
  aiContext: string;
  offerings: UgcBrandOffering[];
  language: string;
  /**
   * The brand's DESIGN.md (`brand-design-doc.ts`). When present it REPLACES the field-by-field
   * identity block below: same facts, plus the palette, the marks, the people and the art direction
   * a spoken script's framing and wardrobe should respect. Empty for a caller that hand-builds this
   * struct, which then gets the original block — no surface loses its grounding for lack of a doc.
   */
  designDoc?: string;
};

const ABOUT_CAP = 600;
const OFFERING_DESC_CAP = 140;
const MAX_OFFERINGS = 12;

function clip(s: unknown, n: number): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

/**
 * Strip the visual-playbook appendix from ai_context so scripts get voice/identity, not look rules.
 *
 * NOT truncated, and deliberately so. This used to clip at 2200 characters, which sounds harmless
 * until you look at where the cut lands: the synthesiser writes ~500 words of brief and closes with
 * the GUARDRAIL block (`brand-guardrails.ts`) — what the product does NOT do, the claims that need
 * sign-off, the words this brand never uses. Past ~2200 characters that block is exactly what falls
 * off the end. Spoken scripts were getting the positive half of the brand and none of the limits,
 * which is the one place an invented claim is spoken aloud by a face.
 *
 * Line structure is preserved for the same reason: ai_context is markdown now, and flattening it
 * turns "### GUARDRAIL" plus its five rules into one unreadable line.
 */
export function identityFromAiContext(aiContext: unknown): string {
  const raw = String(aiContext ?? '').trim();
  if (!raw) return '';
  // content-preview folds playbook under a marker — drop it for spoken-script grounding.
  // Tolerates the markdown heading the digests now carry (`### WHAT WORKS VISUALLY`).
  const cut = raw.search(/\n[#*\s]*WHAT WORKS VISUALLY\b|\n[#*\s]*VISUAL PLAYBOOK\b/i);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

export async function loadUgcBrandGrounding(
  supabase: SupabaseClient,
  brandId: string
): Promise<UgcBrandGrounding> {
  const [{ data: brand }, { data: kit }, { data: products }] = await Promise.all([
    supabase.from('brands').select('name, content_prefs').eq('id', brandId).maybeSingle(),
    supabase
      .from('brand_kit')
      .select('about, category, target_audience, brand_style, ai_context')
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase
      .from('products')
      .select('title, description, kind, featured')
      .eq('brand_id', brandId)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(MAX_OFFERINGS)
  ]);

  const prefs =
    brand?.content_prefs && typeof brand.content_prefs === 'object'
      ? (brand.content_prefs as Record<string, unknown>)
      : {};
  const language = clip(prefs.language, 40);

  const offerings: UgcBrandOffering[] = (products ?? [])
    .map((p) => ({
      title: clip(p.title, 80),
      description: clip(p.description, OFFERING_DESC_CAP),
      kind: clip(p.kind || 'product', 40)
    }))
    .filter((p) => p.title);

  // The whole Studio, rendered once (`brand-design-doc.ts`). Soft-failed: a slow table costs the
  // script its document, never the run — formatUgcBrandGrounding falls back to the fields above.
  const { loadDesignDoc } = await import('$lib/server/brand-design-doc');
  const designDoc = await loadDesignDoc(supabase, brandId, {
    toolHints: false,
    include: { documents: false }
  }).catch((error) => { swallow('load design doc', error); return ''; });

  return {
    designDoc,
    name: clip(brand?.name, 80) || 'Brand',
    about: clip(kit?.about, ABOUT_CAP),
    category: clip(kit?.category, 120),
    audience: clip(kit?.target_audience, 240),
    brandStyle: clip(kit?.brand_style, 240),
    aiContext: identityFromAiContext(kit?.ai_context),
    offerings,
    language
  };
}

/** Prompt block for script planners / media agents. Empty-ish brands still get a hard topic rule. */
export function formatUgcBrandGrounding(g: UgcBrandGrounding): string {
  const lines: string[] = [
    `BRAND IDENTITY (authoritative — every spoken script is ABOUT this brand, not generic life drama):`
  ];
  if (g.designDoc?.trim()) {
    lines.push(g.designDoc.trim());
    if (g.language) lines.push(`Language: write spoken lines in ${g.language}`);
    lines.push(topicRules(g.name));
    return lines.join('\n');
  }
  lines.push(`Name: ${g.name || '(unknown)'}`);
  if (g.category) lines.push(`Category: ${g.category}`);
  if (g.about) lines.push(`About: ${g.about}`);
  if (g.audience) lines.push(`Audience: ${g.audience}`);
  if (g.brandStyle) lines.push(`Voice/style: ${g.brandStyle}`);
  if (g.language) lines.push(`Language: write spoken lines in ${g.language}`);
  if (g.offerings.length) {
    lines.push('Offerings / features (use real names; demo a concrete mechanic from here or the user brief):');
    for (const o of g.offerings) {
      const bits = [o.title, o.kind ? `(${o.kind})` : '', o.description ? `— ${o.description}` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(`- ${bits}`);
    }
  } else {
    lines.push('Offerings: (none in catalog — stick to the user brief + About; do not invent products.)');
  }
  if (g.aiContext) {
    lines.push('Brand context (voice, themes, what we sell — follow this):');
    lines.push(g.aiContext);
  }
  lines.push(topicRules(g.name));
  return lines.join('\n');
}

/** The rules that keep a script on this brand's topic. Identical on both grounding paths. */
function topicRules(name: string): string {
  return `TOPIC HARD RULES:
- Pain/problem beats MUST be problems THIS brand's audience has in THIS category (workflow, product friction, the job-to-be-done). Never invent unrelated domains.
- FORBIDDEN unless the brand category is literally that domain: medical/health diagnoses, family crises, relationship drama, dating, mortality, random grocery/household spending stress.
- Name "${name || 'the brand'}" (or the assigned product) in the SOLUTION beat. Demo a real feature/mechanic from the brief or offerings — not "I found an app".
- The user brief is the topic bible. If it asks to illustrate features / use screenshots, each clip spotlights a distinct feature or angle from that brief.`;
}
