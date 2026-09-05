// Humanizer pipeline for blog articles. Multi-pass AI rewrites to strip AI-typical patterns,
// add human touches (rhythm variation, reader engagement, specificity), and polish flow.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient } from './research';
import { aiStructured, PIN_GATEWAY } from './ai-text';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const AI_PATTERNS: RegExp[] = [
  /in today's (?:fast-paced|rapidly evolving|ever-changing)/gi,
  /it's worth noting that/gi,
  /delve (?:into|deeper)/gi,
  /\blandscape\b/gi,
  /\btapestry\b/gi,
  /at the end of the day/gi,
  /\bleverage\b/gi,
  /holistic (?:approach|view)/gi,
  /comprehensive (?:guide|overview)/gi,
  /\bnuanced\b/gi,
  /\bmultifaceted\b/gi,
  /\bparadigm\b/gi,
  /\bsynerg/gi,
  /robust (?:framework|solution)/gi,
  /cutting-edge/gi,
  /game-changer/gi,
  /in conclusione/gi,
  /è importante notare che/gi,
  /nel panorama (?:attuale|odierno)/gi,
  /senza dubbio/gi,
  /in sintesi/gi,
  /non va dimenticato/gi
];

const HUMANIZE_SCHEMA = {
  type: 'object' as const,
  properties: {
    bodyMarkdown: { type: 'string' as const, description: 'The COMPLETE humanized article in Markdown. Keep all headings, links, images, lists, tables.' },
    changes: { type: 'string' as const, description: 'Brief summary of what was changed (1-2 sentences, in the article language).' }
  },
  required: ['bodyMarkdown', 'changes']
};

export async function humanizeArticle(
  admin: SupabaseClient,
  brandId: string,
  bodyMd: string,
  title: string,
  language: string
): Promise<{ bodyMd: string; changes: string } | null> {
  const { data: kit } = await admin.from('brand_kit')
    .select('about, ai_context, target_audience')
    .eq('brand_id', brandId).maybeSingle();

  const patternCount = AI_PATTERNS.reduce((n, re) => n + (bodyMd.match(re)?.length ?? 0), 0);

  const prompt = `You are a senior editor making this article sound genuinely human-written. Rewrite it to:

1. REMOVE AI-typical patterns: generic openers ("In today's fast-paced world..."), filler phrases ("it's worth noting that", "delve into", "landscape", "tapestry"), overused adjectives ("robust", "comprehensive", "holistic", "cutting-edge").${patternCount > 0 ? ` Detected ${patternCount} AI-pattern instances to fix.` : ''}
2. VARY sentence rhythm: mix short punchy sentences (5-10 words) with longer explanatory ones. No monotonous mid-length sentences.
3. ADD human touches: direct address to the reader, rhetorical questions, specific concrete examples, occasional contractions where natural in ${language}.
4. KEEP all facts, links, statistics, headings, and structure exactly as they are. Only change HOW things are said, not WHAT is said.
5. Brand voice: ${String(kit?.ai_context ?? '').slice(0, 500) || 'professional but approachable'}.
6. Target audience: ${String(kit?.target_audience ?? '').slice(0, 200)}.
7. Write in ${language}. Return the COMPLETE article.

CURRENT TITLE: ${title}
CURRENT ARTICLE:
${bodyMd.slice(0, 20000)}

Return JSON with the full humanized bodyMarkdown and a brief changes summary.`;

  const out = await aiStructured<{ bodyMarkdown?: string; changes?: string }>(
    genaiClient(), prompt, HUMANIZE_SCHEMA,
    'You are a precise editor. Preserve all factual content, links, and structure. Only change writing style to sound more human.',
    'humanize_article',
    PIN_GATEWAY
  ).catch((error) => { swallow('genaiClient failed', error); return null; });

  if (!out?.bodyMarkdown) return null;
  return { bodyMd: out.bodyMarkdown, changes: out.changes ?? 'Stile reso più naturale.' };
}
