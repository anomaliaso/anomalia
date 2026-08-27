import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleGenAI } from '@google/genai';
import { genaiClient } from './research';
import { aiStructured, parallelVariants } from './xiaomi';
import type { GeoSnapshot } from './geo';

// ── GEO artifacts: generate the FIXES for the gaps the audit finds ──────────────────────────────
//
// Each artifact closes ONE audit finding and is a copy-paste asset for the user's site (Anomalia doesn't
// host it — the "Anomalia proposes, the human ships" pattern, same as the Reddit engage suggestions).
// These are NOT posts: separate table, separate lifecycle. Every artifact is produced with the same
// rigor as real content — N variants generated in parallel, then a reviewer picks the most CITABLE
// one (accurate, on-brand, correctly structured). The LLM writes the CONTENT; this module assembles
// the exact structured format (JSON-LD / markdown) in code, so the machine-readable part is always
// valid regardless of model drift.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type GeoArtifactKind = 'faq' | 'org_schema' | 'llms_txt' | 'product_schema';
// A block is one copyable chunk that goes to ONE place (a page body, an <head>, a file). The UI
// renders one textarea + copy button per block. labelKey → i18n (app.studio.geo.blocks.<labelKey>).
export type GeoBlock = { labelKey: string; content: string };
export type GeoArtifact = {
  kind: GeoArtifactKind;
  title: string;
  format: 'markdown' | 'jsonld' | 'txt';
  blocks: GeoBlock[];
  targetPath: string;
  sourceFinding: string;
};

// ── variants + reviewer (mirrors synthesizeStrategyReport's parallelVariants usage) ─────────────

// Generate `count` variants of a structured payload, then let a GEO reviewer pick the best. The
// caller supplies how to summarise a variant for the judge (only the fields that matter to ranking).
export async function bestVariant<T>(
  ai: GoogleGenAI,
  makePrompt: () => string,
  schema: AnyRec,
  systemInstruction: string,
  label: string,
  summarize: (v: T) => string,
  opts?: { provider?: 'gemini' | 'xiaomi' | 'kie'; model?: string; noFallback?: boolean }
): Promise<T> {
  return parallelVariants<T>(
    ai,
    () => aiStructured<T>(ai, makePrompt(), schema, systemInstruction, `return_${label}`, opts),
    async (variants) => {
      if (variants.length === 1) return variants[0];
      const list = variants.map((v, i) => `\nOPTION ${i + 1}:\n${summarize(v)}`).join('\n---');
      const prompt = `You are a GEO reviewer. Pick the variant most likely to get this brand CITED by AI answer engines: factually accurate (invents nothing), directly answers the target questions, on-brand, and genuinely useful. Reject anything that reads like marketing fluff.\n${list}\nReturn JSON: { "winner": <1-based index> }`;
      const s = { type: 'object' as const, properties: { winner: { type: 'number' as const } }, required: ['winner'] };
      try {
        const raw = await aiStructured<{ winner?: number }>(ai, prompt, s, systemInstruction, 'pick_best', opts);
        const idx = Math.max(0, Math.min(variants.length - 1, (raw?.winner ?? 1) - 1));
        return variants[idx];
      } catch {
        return variants[0];
      }
    },
    3,
    label
  );
}

const REVIEWER = 'You are a GEO specialist writing content that AI answer engines will cite. Be concrete, accurate and on-brand; never invent facts.';

// ── FAQ (closes: no-faq-schema + citation gaps) ──────────────────────────────────────────────────

const FAQ_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const },
    faqs: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: { question: { type: 'string' as const }, answer: { type: 'string' as const } },
        required: ['question', 'answer']
      },
      description: '6-10 Q&A pairs answering the target questions in the brand voice.'
    }
  },
  required: ['title', 'faqs']
};

// FAQ → TWO blocks with different destinations: the visible page text, and the JSON-LD for the head.
function assembleFaq(title: string, faqs: Array<{ question: string; answer: string }>): GeoBlock[] {
  const clean = faqs.filter((f) => f?.question?.trim() && f?.answer?.trim());
  const page = `# ${title}\n\n${clean.map((f) => `## ${f.question}\n\n${f.answer}`).join('\n\n')}`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: clean.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer }
    }))
  };
  const head = `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>`;
  return [
    { labelKey: 'faqPage', content: page },
    { labelKey: 'jsonldHead', content: head }
  ];
}

async function generateFaq(ai: GoogleGenAI, profile: AnyRec, questions: string[]): Promise<GeoArtifact | null> {
  const payload = await bestVariant<{ title: string; faqs: Array<{ question: string; answer: string }> }>(
    ai,
    () => `Write an FAQ page for this brand that answers the questions its buyers actually ask AI engines — so the brand becomes the cited source.

Brand: ${profile?.name ?? ''}
About: ${String(profile?.about ?? '').slice(0, 500)}
Category: ${profile?.category ?? ''}
Voice/context: ${String(profile?.ai_context ?? '').slice(0, 1000)}

MUST directly answer these questions (rephrase naturally, don't drop any):
${questions.map((q) => `- ${q}`).join('\n')}

Add 2-3 more obvious buyer questions. Answers: concrete, factual, 2-4 sentences, no marketing fluff. Language: match the brand's.`,
    FAQ_SCHEMA, REVIEWER, 'faq',
    (v) => `${v.title}\n${(v.faqs ?? []).slice(0, 4).map((f) => `Q: ${f.question}`).join('\n')}`
  );
  if (!payload?.faqs?.length) return null;
  return {
    kind: 'faq', title: payload.title || 'FAQ',
    format: 'markdown', blocks: assembleFaq(payload.title || 'FAQ', payload.faqs),
    targetPath: '/faq', sourceFinding: 'no-faq-schema'
  };
}

// ── Organization JSON-LD (closes: no-org-schema) ─────────────────────────────────────────────────

const ORG_SCHEMA = {
  type: 'object' as const,
  properties: {
    description: { type: 'string' as const, description: 'One-sentence factual description of the organization.' },
    sameAs: { type: 'array' as const, items: { type: 'string' as const }, description: "URLs of the brand's official social/profile pages, if known. Empty if unsure." }
  },
  required: ['description', 'sameAs']
};

async function generateOrgSchema(ai: GoogleGenAI, profile: AnyRec, siteUrl: string, logo: string | null): Promise<GeoArtifact | null> {
  const payload = await bestVariant<{ description: string; sameAs: string[] }>(
    ai,
    () => `Write the Organization metadata for this brand — the facts an AI engine needs to attribute claims to it.

Brand: ${profile?.name ?? ''}
About: ${String(profile?.about ?? '').slice(0, 500)}
Category: ${profile?.category ?? ''}

Give: a one-sentence factual description, and the official social/profile URLs you are confident about (empty array if unsure — never invent URLs).`,
    ORG_SCHEMA, REVIEWER, 'org_schema',
    (v) => `${v.description}\nsameAs: ${(v.sameAs ?? []).join(', ')}`
  );
  if (!payload) return null;
  const jsonld: AnyRec = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: profile?.name ?? '',
    ...(siteUrl ? { url: siteUrl } : {}),
    ...(logo ? { logo } : {}),
    ...(payload.description ? { description: payload.description } : {}),
    ...(Array.isArray(payload.sameAs) && payload.sameAs.length ? { sameAs: payload.sameAs.filter((u) => /^https?:\/\//.test(u)) } : {})
  };
  return {
    kind: 'org_schema', title: 'Organization structured data',
    format: 'jsonld',
    blocks: [{ labelKey: 'orgHead', content: `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>` }],
    targetPath: 'homepage <head>', sourceFinding: 'no-org-schema'
  };
}

// ── Product + Offer (closes: no-product-schema / *-offer-schema) ─────────────────────────────────
//
// The offer layer is the one an assistant reads to RANK and to hand a buyer off, so the gap is worth
// an artifact of its own. What we can write is the shape and the words; what we must never write is
// the merchant's own numbers. Price, currency, SKU, image and the product URL come back as loud
// REPLACE_ markers rather than plausible inventions — a wrong price published as structured data is
// worse than no structured data, and the whole point of this module is being trustworthy to cite.
// Values the model cannot support from the brand context are dropped from the JSON-LD entirely and
// survive only as blanks in the human-facing spec table.

const SPEC_TODO = 'TO_FILL';

/** The fields only the merchant knows. Left as markers so nothing false is ever published. */
const PRODUCT_PLACEHOLDERS = {
  sku: 'REPLACE_WITH_SKU',
  price: 'REPLACE_WITH_PRICE',
  currency: 'REPLACE_WITH_CURRENCY_CODE',
  image: 'REPLACE_WITH_PRODUCT_IMAGE_URL',
  path: '/REPLACE_WITH_PRODUCT_PATH'
};

const PRODUCT_SCHEMA = {
  type: 'object' as const,
  properties: {
    productName: { type: 'string' as const, description: "The brand's flagship product or offering, named as a buyer would say it." },
    description: { type: 'string' as const, description: 'Two or three sentences, benefit-led, phrased the way a buyer asks about it. No slogans.' },
    category: { type: 'string' as const, description: 'The product category a buyer would browse, in plain words.' },
    specsTitle: { type: 'string' as const, description: 'Heading for the specification table, in the brand’s language (e.g. "Specifiche").' },
    specs: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: { label: { type: 'string' as const }, value: { type: 'string' as const } },
        required: ['label', 'value']
      },
      description: `4-8 attributes a buyer in this category compares on. The LABEL is always the category's real attribute; the VALUE must come from the brand context — write exactly "${SPEC_TODO}" when it is not stated there. Never guess a number, a material or a measurement.`
    }
  },
  required: ['productName', 'description', 'category', 'specsTitle', 'specs']
};

type ProductPayload = {
  productName: string;
  description: string;
  category: string;
  specsTitle: string;
  specs: Array<{ label: string; value: string }>;
};

// TWO destinations: a modular spec block for the page body (what an engine lifts as an answer) and
// the Product/Offer JSON-LD for that page's head (what an agent reads as data).
function assembleProduct(payload: ProductPayload, brandName: string, siteUrl: string): GeoBlock[] {
  const specs = (payload.specs ?? []).filter((sp) => sp?.label?.trim());
  const known = specs.filter((sp) => sp.value?.trim() && sp.value.trim() !== SPEC_TODO);

  const table = specs.length
    ? `## ${payload.specsTitle}\n\n| | |\n| --- | --- |\n${specs
        .map((sp) => `| ${sp.label} | ${sp.value?.trim() && sp.value.trim() !== SPEC_TODO ? sp.value.trim() : '—'} |`)
        .join('\n')}`
    : '';
  const page = [`# ${payload.productName}`, payload.description, table].filter(Boolean).join('\n\n');

  const origin = (() => { try { return new URL(siteUrl).origin; } catch { return ''; } })();
  const productUrl = `${origin}${PRODUCT_PLACEHOLDERS.path}`;
  const jsonld: AnyRec = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: payload.productName,
    description: payload.description,
    ...(payload.category ? { category: payload.category } : {}),
    ...(brandName ? { brand: { '@type': 'Brand', name: brandName } } : {}),
    sku: PRODUCT_PLACEHOLDERS.sku,
    image: PRODUCT_PLACEHOLDERS.image,
    url: productUrl,
    // Only attributes the model could actually support — an unfilled spec stays out of the data.
    ...(known.length
      ? { additionalProperty: known.map((sp) => ({ '@type': 'PropertyValue', name: sp.label, value: sp.value.trim() })) }
      : {}),
    offers: {
      '@type': 'Offer',
      price: PRODUCT_PLACEHOLDERS.price,
      priceCurrency: PRODUCT_PLACEHOLDERS.currency,
      availability: 'https://schema.org/InStock',
      url: productUrl
    }
  };
  return [
    { labelKey: 'productSpecs', content: page },
    { labelKey: 'productHead', content: `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>` }
  ];
}

async function generateProductSchema(
  ai: GoogleGenAI, profile: AnyRec, siteUrl: string, sourceFinding: string
): Promise<GeoArtifact | null> {
  const payload = await bestVariant<ProductPayload>(
    ai,
    () => `Write the product page building blocks for this brand — the description and specification table an AI assistant reads when a buyer asks it to compare options in this category.

Brand: ${profile?.name ?? ''}
About: ${String(profile?.about ?? '').slice(0, 500)}
Category: ${profile?.category ?? ''}
Voice/context: ${String(profile?.ai_context ?? '').slice(0, 1000)}

Pick the brand's main product or offering. Describe it the way a buyer would ask about it, not the way a brochure would sell it. For the specification table, use the attributes buyers in this category actually compare on — and write exactly "${SPEC_TODO}" as the value of anything the context above does not state. Inventing a spec is worse than leaving it blank. Language: match the brand's.`,
    PRODUCT_SCHEMA, REVIEWER, 'product_schema',
    (v) => `${v.productName}\n${v.description}\n${(v.specs ?? []).map((sp) => `${sp.label}: ${sp.value}`).join('\n')}`
  );
  if (!payload?.productName) return null;
  return {
    kind: 'product_schema',
    title: 'Product + Offer structured data',
    format: 'jsonld',
    blocks: assembleProduct(payload, String(profile?.name ?? ''), siteUrl),
    targetPath: 'product page <head>',
    sourceFinding
  };
}

// ── llms.txt (closes: no-llms-txt) ───────────────────────────────────────────────────────────────

const LLMS_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const, description: 'One or two sentences: what the brand is, for the top of the file.' },
    links: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: { title: { type: 'string' as const }, path: { type: 'string' as const, description: 'Relative path like /pricing (NOT invented — obvious pages only).' }, note: { type: 'string' as const } },
        required: ['title', 'path', 'note']
      },
      description: 'The key pages an LLM should read: product, pricing, about, docs, FAQ, contact — only ones that plausibly exist.'
    }
  },
  required: ['summary', 'links']
};

// extraPaths = pages we're creating in THIS same batch (e.g. /faq). They MUST appear in llms.txt,
// otherwise the artifacts we hand the user contradict each other.
async function generateLlmsTxt(ai: GoogleGenAI, profile: AnyRec, siteUrl: string, extraPaths: string[] = []): Promise<GeoArtifact | null> {
  const origin = (() => { try { return new URL(siteUrl).origin; } catch { return ''; } })();
  const payload = await bestVariant<{ summary: string; links: Array<{ title: string; path: string; note: string }> }>(
    ai,
    () => `Write an llms.txt for this brand — the curated map that tells AI engines which pages matter and what the brand is.

Brand: ${profile?.name ?? ''}
About: ${String(profile?.about ?? '').slice(0, 500)}
Category: ${profile?.category ?? ''}
Site: ${siteUrl}
${extraPaths.length ? `MUST include these pages (we are creating them now): ${extraPaths.join(', ')}\n` : ''}
Give a short summary and 4-8 key pages (title, relative path, one-line note). Only list pages that plausibly exist for this kind of business; never invent deep URLs.`,
    LLMS_SCHEMA, REVIEWER, 'llms_txt',
    (v) => `${v.summary}\n${(v.links ?? []).map((l) => `${l.path} — ${l.title}`).join('\n')}`
  );
  if (!payload?.links?.length) return null;
  const norm = (p: string) => (p.startsWith('/') ? p : `/${p}`);
  const links = payload.links.filter((l) => l?.title && l?.path).map((l) => ({ ...l, path: norm(l.path) }));
  // Belt-and-suspenders: force every new page in, even if the model dropped it.
  for (const p of extraPaths) {
    if (!links.some((l) => l.path === norm(p))) links.unshift({ title: norm(p).replace(/^\//, '').toUpperCase() || 'FAQ', path: norm(p), note: '' });
  }
  const md = links.map((l) => `- [${l.title}](${origin}${l.path})${l.note ? `: ${l.note}` : ''}`).join('\n');
  const body = `# ${profile?.name ?? ''}\n\n> ${payload.summary}\n\n## Key pages\n\n${md}`;
  return { kind: 'llms_txt', title: 'llms.txt', format: 'txt', blocks: [{ labelKey: 'llmsFile', content: body }], targetPath: '/llms.txt', sourceFinding: 'no-llms-txt' };
}

// ── orchestrator: from an audit snapshot → the artifacts that close its gaps ─────────────────────

// Which findings are present in this snapshot?
function hasIssue(snapshot: GeoSnapshot, id: string): boolean {
  return (snapshot.issues ?? []).some((i) => i.id === id);
}

// The offer-layer findings buildTechAudit can raise, worst first.
const OFFER_FINDINGS = ['no-product-schema', 'no-offer-schema', 'incomplete-offer-schema', 'unactionable-offer-schema'];

// Generate the artifacts for the gaps the latest audit found, persist them as fresh drafts (replacing
// any prior drafts — accepted/dismissed decisions are kept). Best-effort; returns how many were made.
export async function generateGeoArtifacts(admin: SupabaseClient, brand: AnyRec, snapshot: GeoSnapshot): Promise<number> {
  const { data: kit } = await admin
    .from('brand_kit').select('source_url, about, category, ai_context, logos').eq('brand_id', brand.id).maybeSingle();
  const siteUrl = String(kit?.source_url || brand.website || '').trim();
  const logo = Array.isArray(kit?.logos) && kit.logos.length ? String(kit.logos[0]) : null;
  const profile: AnyRec = { name: brand.name, about: kit?.about ?? '', category: kit?.category ?? '', ai_context: kit?.ai_context ?? '' };

  // Citation gaps: the category questions where the brand was NOT named — the FAQ's target list.
  const gapQuestions = (snapshot.citations ?? []).filter((c) => !c.brandMentioned).map((c) => c.prompt);

  const ai = genaiClient();

  // Pages we create must exist BEFORE llms.txt is written, so llms.txt can list them (otherwise the
  // artifacts contradict each other). Two waves: page artifacts first → collect their paths → the
  // rest (llms.txt gets those paths; org_schema is independent).
  const pageJobs: Array<Promise<GeoArtifact | null>> = [];
  // FAQ addresses both the missing schema AND the citation gaps — generate it if either applies.
  if (hasIssue(snapshot, 'no-faq-schema') || gapQuestions.length) pageJobs.push(generateFaq(ai, profile, gapQuestions.slice(0, 8)));
  const pageArtifacts = (await Promise.all(pageJobs.map((j) => j.catch((error) => { swallow('pageJobs.map failed', error); return null; })))).filter((a): a is GeoArtifact => !!a);
  const newPaths = pageArtifacts.map((a) => a.targetPath).filter((p) => p.startsWith('/'));

  const restJobs: Array<Promise<GeoArtifact | null>> = [];
  if (hasIssue(snapshot, 'no-org-schema')) restJobs.push(generateOrgSchema(ai, profile, siteUrl, logo));
  // Any point on the offer ladder — no Product at all, or a Product whose Offer is unrankable —
  // is closed by the same artifact, so the first finding present is the one it is filed against.
  const offerFinding = OFFER_FINDINGS.find((id) => hasIssue(snapshot, id));
  if (offerFinding) restJobs.push(generateProductSchema(ai, profile, siteUrl, offerFinding));
  if (hasIssue(snapshot, 'no-llms-txt') && siteUrl) restJobs.push(generateLlmsTxt(ai, profile, siteUrl, newPaths));
  const restArtifacts = (await Promise.all(restJobs.map((j) => j.catch((error) => { swallow('restJobs.map failed', error); return null; })))).filter((a): a is GeoArtifact => !!a);

  const artifacts = [...pageArtifacts, ...restArtifacts];
  if (!artifacts.length) return 0;

  // Fresh drafts replace stale ones; the user's accept/dismiss decisions survive.
  await admin.from('brand_geo_artifacts').delete().eq('brand_id', brand.id).eq('status', 'draft');
  const { error } = await admin.from('brand_geo_artifacts').insert(
    artifacts.map((a) => ({
      brand_id: brand.id, kind: a.kind, title: a.title, format: a.format,
      blocks: a.blocks, body: a.blocks.map((b) => b.content).join('\n\n'),
      target_path: a.targetPath, source_finding: a.sourceFinding
    }))
  );
  return error ? 0 : artifacts.length;
}
