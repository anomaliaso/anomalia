import type { SupabaseClient } from '@supabase/supabase-js';
import { structured, benchmarkDigest, type Benchmark } from '$lib/server/research';
import { CONTENT_FORMATS, normalizeContentFormat, mediaForFormat, type ContentFormat } from '$lib/content-formats';
import { disruptiveBriefSection } from '$lib/disruptive';
import { winningPatternsBlock, type HygieneWinner } from '$lib/server/platform-hygiene';

// The RUBRIC engine — recurring, recognisable content SERIES as a first-class domain object.
// A rubric is NOT a pillar: the pillar is the strategic theme, the rubric is the named,
// format-bound, repeatable series that delivers it ("Dietro le quinte del lab — carousel,
// 1/week"). The AI proposes 5-8 candidates; the CLIENT edits and approves a subset (the /rubrics
// page); the approved set then becomes an authoritative constraint for the editorial plan's
// content mix and the batch planner's seeds. The whole layer is OPT-IN: a brand with no approved
// rubrics gets rubricsBrief() === '' and every planner behaves exactly as before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrandProfile = any;

export type Rubric = {
  id?: string;
  batch_id?: string;
  status?: string;
  name: string;
  promise: string;
  strategic_role: string;
  format: ContentFormat;
  cadence: string;
  differentiation: string;
  rationale: string;
  // Come si VEDE la serie: medium, grammatica della pagina, palette, lettering. È la sola cosa che
  // permette a due rubriche dello stesso brand di avere due registri visivi diversi — un reportage
  // fotografico e un fumetto illustrato. Vuota → la serie eredita il visual_style del brand.
  art_direction?: string;
};

// ── Normalisation (never trust LLM output shape) ─────────────────────────────

export function normalizeRubric(raw: AnyRec): Rubric {
  return {
    ...(typeof raw?.id === 'string' && raw.id ? { id: raw.id } : {}),
    ...(typeof raw?.batch_id === 'string' && raw.batch_id ? { batch_id: raw.batch_id } : {}),
    ...(typeof raw?.status === 'string' && raw.status ? { status: raw.status } : {}),
    name: String(raw?.name ?? '').trim(),
    promise: String(raw?.promise ?? '').trim(),
    strategic_role: String(raw?.strategic_role ?? '').trim(),
    format: normalizeContentFormat(raw?.format),
    cadence: String(raw?.cadence ?? '').trim(),
    differentiation: String(raw?.differentiation ?? '').trim(),
    rationale: String(raw?.rationale ?? '').trim(),
    art_direction: String(raw?.art_direction ?? '').trim() || undefined
  };
}

// ── The ONE injection point for every planner prompt ─────────────────────────
// Returns '' when the brand has no approved rubrics — which is what keeps the whole layer
// backward-compatible: every consumer appends this string, and an empty string means the prompt
// is byte-identical to the pre-rubric behaviour.

export function rubricsBrief(rubrics: Rubric[]): string {
  const valid = (rubrics ?? []).filter((r) => r?.name);
  if (!valid.length) return '';
  const lines = valid.map(
    (r) =>
      `- "${r.name}" [format: ${r.format}${r.cadence ? `, cadence: ${r.cadence}` : ''}]${r.promise ? ` — ${r.promise}` : ''}${r.strategic_role ? ` (role: ${r.strategic_role})` : ''}${r.art_direction ? `\n    art direction: ${r.art_direction}` : ''}`
  );
  return `APPROVED RUBRICS (the brand's recurring content series, approved by the client — an AUTHORITATIVE constraint): plan and produce content as EPISODES of these series. Express any weekly content mix as counts of these rubric NAMES (e.g. '2× ${valid[0].name}'), never as generic categories. A seed belonging to a rubric inherits its format. Respect each rubric's cadence; content outside every rubric is allowed only when something timely genuinely doesn't fit any series. When a series declares an ART DIRECTION, every episode of it is rendered in THAT medium — it OVERRIDES the brand's default visual style, and a series drawn as a comic never comes back as a photograph.\n${lines.join('\n')}`;
}

// ── Proposal generation ──────────────────────────────────────────────────────

const RUBRICS_SCHEMA = {
  type: 'object' as const,
  properties: {
    rubrics: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string' as const,
            description:
              "The series' recognisable NAME, short and memorable, in the brand's language — what the audience learns to look for (e.g. 'Dietro le quinte del lab'). Never a generic category label like 'educational content'."
          },
          promise: { type: 'string' as const, description: 'The recurring idea/promise every episode delivers, one sentence. The same promise, kept again and again — that is what makes it a series.' },
          strategic_role: { type: 'string' as const, description: "Which strategic goal / funnel stage this series serves (e.g. 'consideration: prova concreta del metodo', 'traffic: click verso il blog'). Tie it to the brand's GTM phase when one is given." },
          format: {
            type: 'string' as const,
            enum: [...CONTENT_FORMATS] as const,
            description: "The production format EVERY episode uses — one of the engine's real formats. Pick the format that genuinely fits the series (a step-by-step series → carousel; a sharp-opinion series on X → text_post; a link-driving series → link_post)."
          },
          cadence: { type: 'string' as const, description: "Expected rhythm, e.g. '1/week', '2/month'. The sum across rubrics must be sustainable at the brand's posting cadence." },
          differentiation: { type: 'string' as const, description: 'The competitor gap that justifies this series — what nobody else in the field is doing, grounded in the benchmark/strategy brief when given.' },
          rationale: { type: 'string' as const, description: 'Why THIS series for THIS brand, 1-2 sentences the client reads to decide. Concrete, never generic agency filler.' },
          art_direction: {
            type: 'string' as const,
            description:
              "How every episode LOOKS, concretely enough for an image generator: the MEDIUM first (documentary photography / ink-and-wash comic panels / flat vector editorial illustration / risograph collage / typographic poster…), then the page grammar (panels, gutters, framing), the palette, the lettering, and what is never shown. A narrative series ALSO names its recurring protagonist here — silhouette, hair, habitual clothes, one constant object — so every episode redraws the same person. This OVERRIDES the brand's default visual style for this series, so two series of the same brand can look deliberately different. Two or three sentences, no aspect ratio."
          }
        },
        required: ['name', 'promise', 'strategic_role', 'format', 'cadence', 'differentiation', 'rationale', 'art_direction']
      }
    }
  },
  required: ['rubrics']
};

export type ProposeRubricsOpts = {
  platforms: string[];
  outputLanguage?: string;
  strategyBrief?: string; // market strategy brief + GTM phase brief, when available
  benchmark?: Benchmark | null;
  /**
   * I post che hanno funzionato davvero per QUESTO brand.
   *
   * Chi progetta le serie partiva cieco ogni volta: il benchmark gli diceva cosa fanno i
   * concorrenti, niente gli diceva cosa ha funzionato qui. Il planner settimanale queste cose le
   * legge già; il progettista di rubriche — che decide il formato di tutto ciò che verrà dopo — no.
   * Chi le carica ce le ha già in mano (planEvidence), non costa una query in più.
   */
  topPosts?: HygieneWinner[];
};

// Propose 5-8 candidate rubrics for the client to edit/approve. Pure generation — persistence is
// the caller's job (saveProposedRubrics).
export async function proposeRubrics(profile: BrandProfile, opts: ProposeRubricsOpts): Promise<Rubric[]> {
  const pillars = Array.isArray(profile?.content_pillars) ? profile.content_pillars.filter(Boolean) : [];
  // Cosa ha funzionato QUI, e le leve di contrasto che il repo conosce già: senza, una serie nasce
  // dalla sola idea che il modello si è fatto della categoria — cioè dal luogo comune.
  const winners = winningPatternsBlock(opts.topPosts ?? [], { limit: 6 });
  const prompt = `Design this brand's RUBRICHE — 5-8 recurring, recognisable content SERIES the brand will publish as repeated episodes. A rubric is a named series with one recurring promise and ONE production format, not a generic content category. The client will read these, edit them, and approve the ones to adopt; approved rubrics then drive all content planning.

Brand: ${profile?.name ?? ''}
About: ${profile?.about ?? ''}
Category: ${profile?.category ?? ''}
Brand archetype: ${String(profile?.site_type ?? 'generic')}
Target audience: ${profile?.target_audience ?? ''}
${pillars.length ? `Content pillars (the strategic THEMES the series must serve — a rubric is the repeatable vehicle, the pillar is the theme): ${pillars.join('; ')}` : ''}
${profile?.ai_context ? `\nBRAND CONTEXT & HISTORY (authoritative on voice and what performs):\n${String(profile.ai_context).slice(0, 6000)}` : ''}
${opts.benchmark ? `\nMARKET BENCHMARK (real competitor numbers — ground each rubric's differentiation in these):\n${benchmarkDigest(opts.benchmark)}` : ''}
${opts.strategyBrief?.trim() ? `\nSTRATEGY DIRECTIVES (the approved plans this set of series must execute):\n${opts.strategyBrief.trim()}` : ''}
${winners ? `\nWHAT HAS ALREADY WORKED HERE (this brand's own posts, best first — a series that repeats a pattern this audience already rewarded starts ahead; one that ignores all of them needs a reason):\n${winners}` : ''}
${disruptiveBriefSection()}

Platforms the brand publishes on: ${opts.platforms.join(', ') || 'instagram'}.

Rules:
- 5-8 rubrics, each DISTINCT in promise, format and role — never two series that are the same idea with different names.
- Formats: only the engine's real formats (single_image, carousel, text_post, link_post, video). carousel only makes sense on Instagram/Facebook/LinkedIn; text_post only on X/Threads/Reddit; link_post only where links work.
- Cadences must ADD UP to something sustainable for this brand — not every rubric is weekly.
- Every rubric must cite a real differentiation vs the field, not a platitude.
- Names in the brand's language, memorable, specific to THIS brand.
- REGISTER SPREAD — a set where every series informs is a failed set. Cover at least three different registers among: educational/explanatory, narrative (stories of real people, told in episodes), artistic/expressive (the piece is worth looking at even with the copy removed), documentary, positional/opinion. At least ONE series must earn its place emotionally or aesthetically rather than informationally.
- ART DIRECTION — each series declares its own medium and page grammar, and the set must not be uniform: if one series is photographic, another must be drawn, printed, typographic or collaged. A brand whose subject is people's lived experience deserves a series where those experiences are DRAWN — comic panels, illustrated vignettes, short visual stories — because a stock-looking photo cannot carry a first-person account.
- A NARRATIVE series carries a real arc per episode (a situation, a turn, a landing), not a list with a story-shaped title.
- CAST — a narrative series names its RECURRING protagonist inside art_direction, drawn concretely enough to be redrawn identically every episode: silhouette, hair, habitual clothes, one object that is always with them. Describe a character, never a demographic: no ethnicity, no body type, no age bracket. A series whose protagonist changes face between one episode and the next is not a series, and it is the single most common way a drawn series stops reading as one. Fix only what never changes: if an episode is ABOUT a change to the character (a haircut, a scar, a new coat), the story wins over the description, so do not pin the very trait the stories are likely to turn on. Describe the FACE — brow, eyes, mouth, how it rests — because a cast with no face comes back with no face: the word "silhouette" was taken literally and the protagonist was drawn as a solid black shape in every panel. Never a word the renderer can draw instead of interpret.
Write ALL prose in ${opts.outputLanguage || 'English'}; keep format values unchanged.
Return JSON.`;

  const parsed: AnyRec = await structured(prompt, RUBRICS_SCHEMA,
    'You are a senior editorial strategist at an agency, designing the recurring series (rubriche) a brand becomes known for. Be specific and grounded; a series must be repeatable 20 times without wearing out.',
    { label: 'proposeRubrics' });
  const raw: AnyRec[] = Array.isArray(parsed?.rubrics) ? parsed.rubrics : [];
  return raw.map(normalizeRubric).filter((r) => r.name).slice(0, 8);
}

// ── DB lifecycle (mirrors editorial_plans' pattern) ──────────────────────────

const RUBRIC_COLS = 'id, batch_id, status, name, promise, strategic_role, format, cadence, differentiation, rationale, art_direction, created_at, approved_at';

// The brand's currently APPROVED rubric set ('' brief when empty — the opt-in switch).
export async function loadApprovedRubrics(supabase: SupabaseClient, brandId: string): Promise<Rubric[]> {
  const { data } = await supabase
    .from('rubrics')
    .select(RUBRIC_COLS)
    .eq('brand_id', brandId)
    .eq('status', 'approved')
    .order('created_at', { ascending: true });
  return (data ?? []).map(normalizeRubric);
}

// The latest PROPOSED batch awaiting the client's review (empty when none pending).
export async function loadProposedRubrics(supabase: SupabaseClient, brandId: string): Promise<Rubric[]> {
  const { data } = await supabase
    .from('rubrics')
    .select(RUBRIC_COLS)
    .eq('brand_id', brandId)
    .eq('status', 'proposed')
    .order('created_at', { ascending: true });
  const rows = (data ?? []).map(normalizeRubric);
  if (!rows.length) return [];
  // Only the newest batch is reviewable — older pending batches were superseded by re-proposing.
  const latestBatch = rows[rows.length - 1].batch_id;
  return rows.filter((r) => r.batch_id === latestBatch);
}

// Persist a freshly proposed batch: reject any previous still-pending proposals (a re-propose
// replaces them), insert the new candidates under one batch_id. Returns the stored rows.
export async function saveProposedRubrics(supabase: SupabaseClient, brandId: string, rubrics: Rubric[]): Promise<Rubric[]> {
  await supabase.from('rubrics').update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('brand_id', brandId).eq('status', 'proposed');
  const batchId = crypto.randomUUID();
  const { data, error } = await supabase
    .from('rubrics')
    .insert(rubrics.map((r) => ({
      brand_id: brandId,
      batch_id: batchId,
      status: 'proposed',
      name: r.name,
      promise: r.promise || null,
      strategic_role: r.strategic_role || null,
      format: r.format,
      cadence: r.cadence || null,
      differentiation: r.differentiation || null,
      rationale: r.rationale || null,
      art_direction: r.art_direction || null
    })))
    .select(RUBRIC_COLS);
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeRubric);
}

// Client approval: the selected proposals (with the client's edits applied) become the brand's
// NEW approved set; the previously approved set is superseded as a whole; unselected proposals
// of the batch are rejected. Every approval path goes through here (page action + API).
export async function approveRubrics(
  supabase: SupabaseClient,
  brandId: string,
  // The client's picks: each id must be a 'proposed' rubric of this brand; edits override fields.
  picks: Array<{ id: string; edits?: Partial<Pick<Rubric, 'name' | 'promise' | 'strategic_role' | 'format' | 'cadence' | 'differentiation' | 'art_direction'>> }>
): Promise<{ approved: number }> {
  if (!picks.length) return { approved: 0 };
  const now = new Date().toISOString();
  // Supersede the currently approved set first (one approved set at a time, like editorial_plans).
  await supabase.from('rubrics').update({ status: 'superseded', updated_at: now })
    .eq('brand_id', brandId).eq('status', 'approved');
  let approved = 0;
  for (const pick of picks) {
    const e = pick.edits ?? {};
    const patch: AnyRec = { status: 'approved', approved_at: now, updated_at: now };
    if (typeof e.name === 'string' && e.name.trim()) patch.name = e.name.trim();
    if (typeof e.promise === 'string') patch.promise = e.promise.trim() || null;
    if (typeof e.strategic_role === 'string') patch.strategic_role = e.strategic_role.trim() || null;
    if (typeof e.format === 'string') patch.format = normalizeContentFormat(e.format);
    if (typeof e.cadence === 'string') patch.cadence = e.cadence.trim() || null;
    if (typeof e.differentiation === 'string') patch.differentiation = e.differentiation.trim() || null;
    if (typeof e.art_direction === 'string') patch.art_direction = e.art_direction.trim() || null;
    const { data } = await supabase.from('rubrics').update(patch)
      .eq('id', pick.id).eq('brand_id', brandId).eq('status', 'proposed')
      .select('id');
    if (data?.length) approved += 1;
  }
  // The rest of the pending batch was reviewed and not chosen.
  await supabase.from('rubrics').update({ status: 'rejected', updated_at: now })
    .eq('brand_id', brandId).eq('status', 'proposed');
  return { approved };
}

// Resolve a seed's rubric NAME (the LLM picks by name) to the approved rubric, stamping the
// authoritative format. Pure — exported for tests. No rubrics / no match → seed untouched.
export function applyRubricToSeed<T extends { rubric?: string; rubric_id?: string; format: ContentFormat; media?: 'image' | 'text' | 'link' | 'video'; art_direction?: string }>(
  seed: T,
  rubrics: Rubric[]
): T {
  const name = String(seed.rubric ?? '').trim().toLowerCase();
  if (!name || !rubrics.length) return seed;
  const hit = rubrics.find((r) => r.name.trim().toLowerCase() === name);
  if (!hit) {
    seed.rubric = '';
    return seed;
  }
  seed.rubric = hit.name;
  if (hit.id) seed.rubric_id = hit.id;
  // The rubric's format is authoritative for its episodes — and it must drive the delivery
  // channel (media) too: the downstream format↔media sync treats MEDIA as authoritative for
  // text/link, so a link_post/text_post rubric paired with Pass 1's media:'image' would be
  // silently overwritten back to single_image if we only stamped the format. The platform
  // capability clamps still run after this and may degrade (e.g. a link_post episode landing
  // on Instagram) — that degradation is platform physics, never Pass 1's preference winning.
  seed.format = hit.format;
  if (seed.media !== undefined) seed.media = mediaForFormat(hit.format);
  // La direzione artistica viaggia col seed: il produttore e il renderer non leggono le rubriche.
  if (hit.art_direction) seed.art_direction = hit.art_direction;
  return seed;
}
