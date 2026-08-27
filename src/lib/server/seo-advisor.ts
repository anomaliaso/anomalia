import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { genaiClient, groundedText } from './research';
import { bestVariant, type GeoBlock } from './geo-artifacts';

// ── SEO growth advisor ──────────────────────────────────────────────────────────────────────────
//
// Phase 1: a QUALITATIVE evaluation + a prioritized list of growth INITIATIVES (blog, landing pages
// for specific queries, free tools, comparisons, glossary, programmatic). Grounded in the real SERP
// landscape (research.ts) and the brand's own technical/content audit.
// Phase 2: turn ONE chosen initiative into a ready asset (blog outline / landing page / tool spec),
// produced with variants + reviewer (bestVariant) and stored back in brand_geo_artifacts as a draft
// (source_finding = 'seo:<initiativeId>') — same copy-paste-block UX as the GEO fixes.
//
// HONEST BOUNDARY: DataForSEO tools (dfs_*) give real volumes, difficulty, SERPs, and
// domain rating. The SEO agent loops with those tools before proposing initiatives.
// GSC remains useful for owned-property click data the Labs estimates cannot see.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type SeoInitiativeType = 'blog' | 'landing_page' | 'free_tool' | 'comparison' | 'glossary' | 'programmatic';
export type SeoInitiative = {
  id: string;
  type: SeoInitiativeType;
  title: string;
  targetQuery: string;
  rationale: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  examples: string[];
};
export type SeoEvaluation = {
  grade: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  /**
   * What the report could NOT determine, and what would determine it. Optional on the type because
   * plans stored before this field existed do not carry it — a reader of an old row must not be
   * told a section is there when it is not.
   */
  gaps?: string[];
};
export type SeoPlan = { evaluation: SeoEvaluation; initiatives: SeoInitiative[] };

const REVIEWER = 'You are a senior SEO strategist. Recommendations must be concrete, grounded in real search demand and honest about effort. Never invent metrics or fabricate competitors.';

async function loadProfile(admin: SupabaseClient, brand: AnyRec): Promise<{ profile: AnyRec; siteUrl: string; language: string }> {
  const [{ data: kit }, { data: products }] = await Promise.all([
    admin.from('brand_kit').select('source_url, about, category, target_audience, ai_context').eq('brand_id', brand.id).maybeSingle(),
    admin.from('products').select('title').eq('brand_id', brand.id).limit(12)
  ]);
  const profile: AnyRec = {
    name: brand.name,
    about: kit?.about ?? '',
    category: kit?.category ?? '',
    target_audience: kit?.target_audience ?? '',
    ai_context: kit?.ai_context ?? '',
    products: (products ?? []).map((p) => p.title).filter(Boolean)
  };
  const siteUrl = String(kit?.source_url || brand.website || '').trim();
  const language = (brand.content_prefs?.language as string) || 'Italian';
  return { profile, siteUrl, language };
}

// ── Phase 1: the plan ────────────────────────────────────────────────────────────────────────────

const PLAN_SCHEMA = {
  type: 'object' as const,
  properties: {
    evaluation: {
      type: 'object' as const,
      properties: {
        grade: { type: 'string' as const, description: 'A short overall grade, e.g. "B+", "C".' },
        summary: { type: 'string' as const, description: 'A tight paragraph: where the brand stands on SEO and the core bet.' },
        strengths: { type: 'array' as const, items: { type: 'string' as const } },
        weaknesses: { type: 'array' as const, items: { type: 'string' as const } },
        // A stated gap is credible; a silently filled one destroys the whole document. Required so
        // the model has to answer it — an optional field on a report is a field nobody fills.
        gaps: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'Cosa NON sei riuscito a determinare con i dati disponibili, e cosa lo determinerebbe. Concreto: "volume reale delle query brand — non c\'è GSC collegato", "posizionamento dei competitor sulle pagine prezzo — sono dietro login". Se davvero non manca nulla, scrivi una sola voce che lo dica.'
        }
      },
      required: ['grade', 'summary', 'strengths', 'weaknesses', 'gaps']
    },
    initiatives: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          type: { type: 'string' as const, enum: ['blog', 'landing_page', 'free_tool', 'comparison', 'glossary', 'programmatic'] as const },
          title: { type: 'string' as const },
          targetQuery: { type: 'string' as const, description: 'The Google query/question this initiative targets.' },
          rationale: { type: 'string' as const, description: 'Why — grounded in real demand + competitor gap.' },
          effort: { type: 'string' as const, enum: ['low', 'medium', 'high'] as const },
          impact: { type: 'string' as const, enum: ['low', 'medium', 'high'] as const },
          examples: { type: 'array' as const, items: { type: 'string' as const }, description: '2-3 concrete example titles / angles / tool names.' }
        },
        required: ['type', 'title', 'targetQuery', 'rationale', 'effort', 'impact', 'examples']
      },
      description: '5-8 initiatives, prioritized (highest impact/effort first).'
    }
  },
  required: ['evaluation', 'initiatives']
};

// Compact audit context so the plan is grounded in the brand's own site, not generic advice.
function auditContext(audit: AnyRec | null): string {
  if (!audit) return '(no site audit yet)';
  const t = (audit.tech ?? {}) as AnyRec;
  const c = (t.content ?? {}) as AnyRec;
  const issues = Array.isArray(t.issues) ? t.issues.map((i: AnyRec) => i.title).slice(0, 8).join('; ') : '';
  const gaps = Array.isArray(audit.citations) ? audit.citations.filter((x: AnyRec) => !x.brandMentioned).map((x: AnyRec) => x.prompt).slice(0, 5) : [];
  return [
    `Technical score: ${audit.tech_score ?? 'n/a'}/100. Issues: ${issues || 'none'}.`,
    c.wordCount != null ? `Homepage words: ${c.wordCount}, H1s: ${c.h1Count ?? '?'}, text ratio: ${c.textRatio ?? '?'}%.` : '',
    `AI share-of-voice: ${audit.share_of_voice ?? 0}%.`,
    gaps.length ? `Queries where the brand is ABSENT from AI answers: ${gaps.join(' | ')}` : ''
  ].filter(Boolean).join('\n');
}

export async function generateSeoPlan(admin: SupabaseClient, brand: AnyRec): Promise<SeoPlan | null> {
  // Prefer the multi-step SEO agent (DataForSEO tool loop). Falls back to the legacy one-shot
  // grounded + bestVariant path when the agent is disabled or fails.
  try {
    const { seoAgentEnabled, runSeoAgent } = await import('./seo-agent');
    if (seoAgentEnabled()) {
      const agented = await runSeoAgent({ supabase: admin, brand, mode: 'plan' });
      if (agented?.initiatives?.length) {
        return { evaluation: agented.evaluation, initiatives: agented.initiatives };
      }
    }
  } catch (e) {
    console.warn('[seo-advisor] agent plan failed, falling back:', e instanceof Error ? e.message : e);
  }

  const ai = genaiClient();
  const { profile, siteUrl, language } = await loadProfile(admin, brand);
  const { data: audit } = await admin
    .from('brand_geo_audits').select('tech_score, tech, share_of_voice, citations')
    .eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

  let gscBlock = '';
  try {
    const { loadGscSummary, formatGscPromptBlock } = await import('$lib/server/gsc');
    const gsc = await loadGscSummary(admin, String(brand.id));
    gscBlock = formatGscPromptBlock(gsc);
  } catch (error) { swallow('load gsc summary', error); }

  // Ground the real SERP landscape (separate call — grounding can't share JSON mode).
  const grounded = await groundedText(
    ai,
    `Research the SEO landscape for this brand using current web information.
Brand: ${profile.name} — ${String(profile.about).slice(0, 300)}
Category: ${profile.category}. Audience: ${profile.target_audience}. Products: ${(profile.products as string[]).join(', ') || 'n/a'}
Site: ${siteUrl || 'n/a'}
${gscBlock ? `\n${gscBlock}\n` : ''}
Report: what do potential customers search on Google around this category/problem (list concrete real queries with intent)? Which competitors rank or get cited? Which content formats win here (guides, comparisons, free tools, glossaries)? Where is the obvious white space?`,
    'You are an SEO strategist using live web search. Cite real competitors and realistic queries; never fabricate.'
  ).catch((error) => { swallow('here failed', error); return ({ text: '', citations: [] }); });

  const makePrompt = () => `You are a senior SEO strategist. Produce (1) a qualitative SEO evaluation and (2) a prioritized list of 5-8 growth initiatives for this brand.

BRAND: ${profile.name}
About: ${String(profile.about).slice(0, 500)}
Category: ${profile.category}. Audience: ${profile.target_audience}
Brand voice/context: ${String(profile.ai_context).slice(0, 800) || '(none)'}

SITE AUDIT:
${auditContext(audit)}

${gscBlock ? `${gscBlock}\n\n` : ''}SEO LANDSCAPE (grounded on live web):
${grounded.text || '(no landscape data)'}

Initiative types: blog, landing_page (a page targeting one specific query/question), free_tool (a genuinely useful free tool/calculator tied to what this brand does, built to attract organic traffic), comparison, glossary, programmatic.
For each initiative give: type, title, the target Google query, why (grounded in real demand + competitor gap), effort (low/medium/high), impact (low/medium/high), and 2-3 concrete examples. Prioritize by impact/effort.
When GSC data is present, at least 3 initiatives MUST target real GSC queries.

CHIUDI SEMPRE con evaluation.gaps: cosa non sei riuscito a determinare e cosa lo determinerebbe. Un report che non dichiara i propri buchi si legge come completo quando non lo è, e chi poi scopre il buco scarta tutto il resto insieme a quello. Non riempire un buco con una stima: dichiaralo.
Write ALL prose in ${language}. Return JSON.`;

  const plan = await bestVariant<SeoPlan>(
    ai, makePrompt, PLAN_SCHEMA, REVIEWER, 'seo_plan',
    (v) => `Grade ${v?.evaluation?.grade}. Initiatives: ${(v?.initiatives ?? []).map((i) => `${i.type}:${i.title}`).slice(0, 6).join(' | ')}`
  ).catch((error) => { swallow('join failed', error); return null; });

  if (!plan?.initiatives?.length) return null;

  // Stable ids so Phase 2 can target one initiative.
  const initiatives = plan.initiatives.map((i) => ({ ...i, id: randomUUID(), examples: Array.isArray(i.examples) ? i.examples.slice(0, 3) : [] }));
  const evaluation = plan.evaluation ?? { grade: '', summary: '', strengths: [], weaknesses: [] };

  await admin.from('brand_seo_plans').insert({ brand_id: brand.id, grade: evaluation.grade ?? null, evaluation, initiatives });
  return { evaluation, initiatives };
}

// Generate MORE initiatives, distinct from the ones already proposed, optionally steered by a user
// hint from chat ("I want to focus on X"). Appends to the latest plan (keeps existing ids/assets
// intact); if no plan exists yet, starts one. Returns just the fresh initiatives.
const INITIATIVES_SCHEMA = {
  type: 'object' as const,
  properties: { initiatives: PLAN_SCHEMA.properties.initiatives },
  required: ['initiatives']
};

export async function addSeoInitiatives(admin: SupabaseClient, brand: AnyRec, opts: { guidance?: string; count?: number } = {}): Promise<SeoInitiative[] | null> {
  try {
    const { seoAgentEnabled, runSeoAgent } = await import('./seo-agent');
    if (seoAgentEnabled()) {
      const agented = await runSeoAgent({
        supabase: admin,
        brand,
        mode: 'more',
        guidance: opts.guidance,
        count: opts.count
      });
      if (agented?.initiatives?.length) return agented.initiatives;
    }
  } catch (e) {
    console.warn('[seo-advisor] agent more-initiatives failed, falling back:', e instanceof Error ? e.message : e);
  }

  const ai = genaiClient();
  const { profile, siteUrl, language } = await loadProfile(admin, brand);
  const { data: plan } = await admin
    .from('brand_seo_plans').select('id, initiatives').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const existing: SeoInitiative[] = (plan?.initiatives as SeoInitiative[]) ?? [];
  const existingList = existing.map((i) => `- [${i.type}] ${i.title} (query: ${i.targetQuery})`).join('\n') || '(none)';

  const grounded = await groundedText(
    ai,
    `Research the SEO landscape for ${profile.name} (${profile.category}). Site: ${siteUrl || 'n/a'}. What do buyers search on Google around this? Which competitors rank? Where is white space?`,
    'You are an SEO strategist using live web search. Cite real competitors and realistic queries; never fabricate.'
  ).catch((error) => { swallow('groundedText failed', error); return ({ text: '', citations: [] }); });

  const makePrompt = () => `Propose ${opts.count ?? 4} NEW SEO growth initiatives for this brand — DIFFERENT from the ones already proposed.

BRAND: ${profile.name} — ${String(profile.about).slice(0, 400)}
Category: ${profile.category}. Audience: ${profile.target_audience}
${opts.guidance ? `USER DIRECTION (what the owner wants to focus on — prioritize this): ${opts.guidance}\n` : ''}
ALREADY PROPOSED (do NOT repeat these; propose genuinely different angles):
${existingList}

SEO LANDSCAPE (grounded):
${grounded.text || '(no data)'}

Types: blog, landing_page, free_tool, comparison, glossary, programmatic. For each: type, title, target Google query, why (grounded), effort (low/medium/high), impact (low/medium/high), 2-3 examples. Write in ${language}. Return JSON.`;

  const out = await bestVariant<{ initiatives: SeoInitiative[] }>(
    ai, makePrompt, INITIATIVES_SCHEMA, REVIEWER, 'seo_initiatives',
    (v) => (v?.initiatives ?? []).map((i) => `${i.type}:${i.title}`).slice(0, 6).join(' | ')
  ).catch((error) => { swallow('join failed', error); return null; });
  if (!out?.initiatives?.length) return null;

  const fresh = out.initiatives.map((i) => ({ ...i, id: randomUUID(), examples: Array.isArray(i.examples) ? i.examples.slice(0, 3) : [] }));
  if (plan?.id) {
    await admin.from('brand_seo_plans').update({ initiatives: [...existing, ...fresh] }).eq('id', plan.id);
  } else {
    await admin.from('brand_seo_plans').insert({ brand_id: brand.id, grade: null, evaluation: null, initiatives: fresh });
  }
  return fresh;
}

// ── Phase 2: one initiative → a ready asset (variants + reviewer) ─────────────────────────────────

type Asset = { kind: string; title: string; blocks: GeoBlock[]; targetPath: string };

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
const metaBlock = (title: string, desc: string): GeoBlock => ({ labelKey: 'metaTags', content: `Title: ${title}\nMeta description: ${desc}` });

const BLOG_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const }, metaTitle: { type: 'string' as const }, metaDescription: { type: 'string' as const },
    outline: { type: 'array' as const, items: { type: 'object' as const, properties: { heading: { type: 'string' as const }, points: { type: 'array' as const, items: { type: 'string' as const } } }, required: ['heading', 'points'] } }
  },
  required: ['title', 'metaTitle', 'metaDescription', 'outline']
};

const LANDING_SCHEMA = {
  type: 'object' as const,
  properties: {
    h1: { type: 'string' as const }, intro: { type: 'string' as const }, metaTitle: { type: 'string' as const }, metaDescription: { type: 'string' as const },
    sections: { type: 'array' as const, items: { type: 'object' as const, properties: { heading: { type: 'string' as const }, body: { type: 'string' as const } }, required: ['heading', 'body'] } },
    faq: { type: 'array' as const, items: { type: 'object' as const, properties: { q: { type: 'string' as const }, a: { type: 'string' as const } }, required: ['q', 'a'] } },
    cta: { type: 'string' as const }
  },
  required: ['h1', 'intro', 'metaTitle', 'metaDescription', 'sections', 'faq', 'cta']
};

const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const }, whatItDoes: { type: 'string' as const },
    inputs: { type: 'array' as const, items: { type: 'string' as const } }, outputs: { type: 'array' as const, items: { type: 'string' as const } },
    seoAngle: { type: 'string' as const }, mvpScope: { type: 'string' as const }, landingCopy: { type: 'string' as const }
  },
  required: ['name', 'whatItDoes', 'inputs', 'outputs', 'seoAngle', 'mvpScope', 'landingCopy']
};

async function genBlog(ai: GoogleGenAI, profile: AnyRec, init: SeoInitiative, language: string): Promise<Asset | null> {
  const p = await bestVariant<AnyRec>(ai, () => `Write a blog article OUTLINE (not the full text) for this brand that will rank for "${init.targetQuery}".
Brand: ${profile.name} — ${String(profile.about).slice(0, 300)}. Voice: ${String(profile.ai_context).slice(0, 500)}
Angle: ${init.title}. Give a title, an SEO meta title (<60 chars) and meta description (<155 chars), and 5-8 sections each with 2-4 key points. Write in ${language}.`,
    BLOG_SCHEMA, REVIEWER, 'seo_blog', (v) => `${v.title}: ${(v.outline ?? []).map((s: AnyRec) => s.heading).slice(0, 5).join(', ')}`).catch((error) => { swallow('join failed', error); return null; });
  if (!p?.outline?.length) return null;
  const md = `# ${p.title}\n\n${(p.outline as AnyRec[]).map((s) => `## ${s.heading}\n${(s.points ?? []).map((pt: string) => `- ${pt}`).join('\n')}`).join('\n\n')}`;
  return { kind: 'blog', title: p.title || init.title, targetPath: `/blog/${slug(p.title || init.title)}`, blocks: [{ labelKey: 'blogOutline', content: md }, metaBlock(p.metaTitle, p.metaDescription)] };
}

async function genLanding(ai: GoogleGenAI, profile: AnyRec, init: SeoInitiative, language: string): Promise<Asset | null> {
  const p = await bestVariant<AnyRec>(ai, () => `Write a landing page targeting the Google query "${init.targetQuery}" for this brand.
Brand: ${profile.name} — ${String(profile.about).slice(0, 300)}. Voice: ${String(profile.ai_context).slice(0, 500)}
Angle: ${init.title}. Give an H1, an intro, an SEO meta title + meta description, 3-5 sections (heading + body), 3-5 FAQ (q+a), and a CTA. Concrete and on-brand, answer-first. Write in ${language}.`,
    LANDING_SCHEMA, REVIEWER, 'seo_landing', (v) => `${v.h1}: ${(v.sections ?? []).map((s: AnyRec) => s.heading).slice(0, 4).join(', ')}`).catch((error) => { swallow('join failed', error); return null; });
  if (!p?.h1) return null;
  const md = `# ${p.h1}\n\n${p.intro}\n\n${(p.sections as AnyRec[] ?? []).map((s) => `## ${s.heading}\n\n${s.body}`).join('\n\n')}\n\n## FAQ\n\n${(p.faq as AnyRec[] ?? []).map((f) => `**${f.q}**\n\n${f.a}`).join('\n\n')}\n\n**${p.cta}**`;
  return { kind: init.type, title: p.h1 || init.title, targetPath: `/${slug(p.h1 || init.title)}`, blocks: [{ labelKey: 'landingCopy', content: md }, metaBlock(p.metaTitle, p.metaDescription)] };
}

async function genTool(ai: GoogleGenAI, profile: AnyRec, init: SeoInitiative, language: string): Promise<Asset | null> {
  const p = await bestVariant<AnyRec>(ai, () => `Spec a FREE TOOL this brand could publish to attract organic traffic for "${init.targetQuery}".
Brand: ${profile.name} — ${String(profile.about).slice(0, 300)}
Idea: ${init.title}. Give the tool name, what it does, its inputs, its outputs, the SEO angle (why it earns links/traffic), a lean MVP scope, and short landing-page copy. Realistic and genuinely useful. Write in ${language}.`,
    TOOL_SCHEMA, REVIEWER, 'seo_tool', (v) => `${v.name}: ${v.whatItDoes}`).catch((error) => { swallow('angle failed', error); return null; });
  if (!p?.name) return null;
  const spec = `# ${p.name}\n\n**What it does:** ${p.whatItDoes}\n\n**Inputs:** ${(p.inputs ?? []).join(', ')}\n**Outputs:** ${(p.outputs ?? []).join(', ')}\n\n**SEO angle:** ${p.seoAngle}\n\n**MVP scope:** ${p.mvpScope}\n\n## Landing copy\n\n${p.landingCopy}`;
  return { kind: 'free_tool', title: p.name || init.title, targetPath: `/tools/${slug(p.name || init.title)}`, blocks: [{ labelKey: 'toolSpec', content: spec }] };
}

// Generate the asset for one initiative and store it as a draft in brand_geo_artifacts. Replaces any
// prior draft for the same initiative. Returns 1 on success, 0 otherwise.
export async function generateSeoAsset(admin: SupabaseClient, brand: AnyRec, initiativeId: string): Promise<number> {
  const { data: plan } = await admin
    .from('brand_seo_plans').select('initiatives').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const init = ((plan?.initiatives as SeoInitiative[]) ?? []).find((i) => i.id === initiativeId);
  if (!init) return 0;

  const ai = genaiClient();
  const { profile, language } = await loadProfile(admin, brand);
  // ponytail: comparison/glossary/programmatic are structurally landing pages — reuse genLanding
  // until one of them needs its own shape.
  const asset =
    init.type === 'blog' ? await genBlog(ai, profile, init, language)
    : init.type === 'free_tool' ? await genTool(ai, profile, init, language)
    : await genLanding(ai, profile, init, language);
  if (!asset) return 0;

  const source = `seo:${initiativeId}`;
  await admin.from('brand_geo_artifacts').delete().eq('brand_id', brand.id).eq('source_finding', source).eq('status', 'draft');
  const { error } = await admin.from('brand_geo_artifacts').insert({
    brand_id: brand.id, kind: asset.kind, title: asset.title, format: 'markdown',
    blocks: asset.blocks, body: asset.blocks.map((b) => b.content).join('\n\n'),
    target_path: asset.targetPath, source_finding: source
  });
  return error ? 0 : 1;
}
