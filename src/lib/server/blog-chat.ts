// Per-article AI chat + version history. The user chats feedback ("make it shorter", "add a section
// on costs"); the AI returns the FULL revised article. Each revision is a version snapshot; undo/redo
// move brand_articles.version_seq across them (a new edit truncates the redo tail).
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient } from './research';
import { aiStructured, PIN_GEMINI } from './xiaomi';
import { getBrandPages } from './content-library';
import { formatProductsList, getBrandProductsForAi } from './product-context';
import { blogStyleInstructions, blogStyleBlock } from './blog-style';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type ArticleRow = { id: string; brand_id: string; title: string; body_md: string; meta_title?: string; meta_description?: string; version_seq: number };

const REVISE_SCHEMA = {
  type: 'object' as const,
  properties: {
    reply: { type: 'string' as const, description: "A short first-person reply to the user (1-2 sentences, in their language) describing what you changed." },
    bodyMarkdown: { type: 'string' as const, description: "The COMPLETE revised article in Markdown after applying the request. Keep everything the request does NOT touch; preserve headings, lists, tables, links and images. Never invent facts or URLs." },
    title: { type: 'string' as const, description: "The revised article title (H1). Only change if the user explicitly asks for a title change; otherwise return the current title verbatim." },
    metaTitle: { type: 'string' as const, description: "The revised SEO meta title (max 60 chars). Only change if the user explicitly asks; otherwise return the current value verbatim." },
    metaDescription: { type: 'string' as const, description: "The revised SEO meta description (max 155 chars). Only change if the user explicitly asks; otherwise return the current value verbatim." }
  },
  required: ['reply', 'bodyMarkdown', 'title', 'metaTitle', 'metaDescription']
};

// Ask the model to revise the article per the user's instruction. Pure (no DB writes).
export async function reviseArticleBody(
  admin: SupabaseClient, brand: AnyRec,
  opts: { instruction: string; currentBodyMd: string; currentTitle: string; currentMetaTitle: string; currentMetaDescription: string; language: string }
): Promise<{ reply: string; bodyMd: string; title: string; metaTitle: string; metaDescription: string }> {
  const { data: kit } = await admin.from('brand_kit').select('about, ai_context').eq('brand_id', brand.id).maybeSingle();
  const [pages, products, styleInstructions] = await Promise.all([
    getBrandPages(admin, brand.id, 15).catch((error) => { swallow('load brand pages', error); return []; }),
    getBrandProductsForAi(admin, brand.id, 20).catch((error) => { swallow('load product catalog', error); return []; }),
    blogStyleInstructions(admin, brand.id).catch((error) => { swallow('load blog style instructions', error); return ''; })
  ]);
  const pagesList = pages.length
    ? pages.map((p) => `- ${p.title || p.url} → ${p.url}`).join('\n')
    : '(none)';
  const productsList = formatProductsList(products);

  const prompt = `You are the blog editor for this brand. Revise the article to satisfy the user's request, keeping the brand's voice. Change ONLY what the request asks; return the COMPLETE revised article.

BRAND: ${brand.name} — ${String(kit?.about ?? '').slice(0, 300)}
Voice & context: ${String(kit?.ai_context ?? '').slice(0, 900) || '(none)'}
The brand's OWN pages you may link to (exact urls only; never invent a URL):
${pagesList}
PRODUCTS & SERVICES you may link to (exact product urls only; never invent; skip "(no page URL)"):
${productsList}

CURRENT TITLE: ${opts.currentTitle}
CURRENT META TITLE: ${opts.currentMetaTitle || '(none)'}
CURRENT META DESCRIPTION: ${opts.currentMetaDescription || '(none)'}
CURRENT ARTICLE (Markdown):
"""
${opts.currentBodyMd.slice(0, 24000)}
"""

USER REQUEST: ${opts.instruction}

${blogStyleBlock(styleInstructions)}

Reply and write the full revised Markdown in ${opts.language}. Do NOT include the H1 title inside the body. If the request itself asks for a specific style, follow the request; otherwise keep the STYLE above.
IMPORTANT: Only change title, metaTitle, metaDescription if the user EXPLICITLY asks for it. Otherwise return the current values verbatim.`;

  const out = await aiStructured<{ reply?: string; bodyMarkdown?: string; title?: string; metaTitle?: string; metaDescription?: string }>(
    genaiClient(), prompt, REVISE_SCHEMA,
    'You are a precise, on-brand blog editor. Never fabricate facts, statistics or URLs.', 'revise_article',
    PIN_GEMINI
  );
  return {
    reply: String(out?.reply ?? '').trim() || 'Fatto.',
    bodyMd: String(out?.bodyMarkdown ?? '').trim() || opts.currentBodyMd,
    title: String(out?.title ?? '').trim() || opts.currentTitle,
    metaTitle: String(out?.metaTitle ?? '').trim() || opts.currentMetaTitle,
    metaDescription: String(out?.metaDescription ?? '').trim() || opts.currentMetaDescription
  };
}

const SELECTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    reply: { type: 'string' as const, description: "A short first-person reply (1-2 sentences, in the user's language) describing what you changed in the selected passage." },
    revisedText: { type: 'string' as const, description: "The revised selected passage only, in Markdown. Do NOT return the full article. Preserve formatting unless the request asks to change it. Never invent facts or URLs." }
  },
  required: ['reply', 'revisedText']
};

/** Revise only a selected passage; caller replaces it in the full article markdown. */
export async function reviseSelectedPassage(
  admin: SupabaseClient, brand: AnyRec,
  opts: { instruction: string; selectedText: string; currentBodyMd: string; language: string }
): Promise<{ reply: string; revisedText: string }> {
  const { data: kit } = await admin.from('brand_kit').select('about, ai_context').eq('brand_id', brand.id).maybeSingle();
  const styleInstructions = await blogStyleInstructions(admin, brand.id).catch((error) => { swallow('load blog style instructions', error); return ''; });

  const prompt = `You are the blog editor for this brand. The user selected a PASSAGE inside an article and wants you to rewrite ONLY that passage. Return the revised passage only — never the full article.

BRAND: ${brand.name} — ${String(kit?.about ?? '').slice(0, 300)}
Voice & context: ${String(kit?.ai_context ?? '').slice(0, 600) || '(none)'}

FULL ARTICLE (context only — do not rewrite it):
"""
${opts.currentBodyMd.slice(0, 12000)}
"""

SELECTED PASSAGE TO REWRITE:
"""
${opts.selectedText.slice(0, 8000)}
"""

USER REQUEST: ${opts.instruction}

${blogStyleBlock(styleInstructions)}

Reply and write the revised passage in ${opts.language}. Keep links/images inside the passage unless asked to remove them. If the request itself asks for a specific style, follow the request; otherwise keep the STYLE above.`;

  const out = await aiStructured<{ reply?: string; revisedText?: string }>(
    genaiClient(), prompt, SELECTION_SCHEMA,
    'You are a precise, on-brand blog editor. Rewrite only the selected passage. Never fabricate facts or URLs.',
    'revise_selection',
    PIN_GEMINI
  );
  return {
    reply: String(out?.reply ?? '').trim() || 'Fatto.',
    revisedText: String(out?.revisedText ?? '').trim() || opts.selectedText
  };
}

/** Replace the first exact occurrence of selectedText in bodyMd. Falls back to a
 *  whitespace-normalized match when TipTap slice→md differs slightly from full-doc md. */
export function replaceSelectedPassage(bodyMd: string, selectedText: string, revisedText: string): string | null {
  const idx = bodyMd.indexOf(selectedText);
  if (idx >= 0) return bodyMd.slice(0, idx) + revisedText + bodyMd.slice(idx + selectedText.length);

  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const needle = norm(selectedText);
  if (!needle) return null;
  // Build a map from normalized index → original index by walking bodyMd.
  let normBody = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < bodyMd.length; i++) {
    const ch = bodyMd[i];
    if (/\s/.test(ch)) {
      if (!prevSpace && normBody.length > 0) {
        map.push(i);
        normBody += ' ';
        prevSpace = true;
      }
    } else {
      map.push(i);
      normBody += ch;
      prevSpace = false;
    }
  }
  const nIdx = normBody.indexOf(needle);
  if (nIdx < 0) return null;
  const start = map[nIdx];
  const endNorm = nIdx + needle.length - 1;
  const end = map[endNorm] + 1;
  return bodyMd.slice(0, start) + revisedText + bodyMd.slice(end);
}

// Commit a new version (truncating any redo tail), seeding the seq-0 snapshot from the pre-edit body
// on first use. Returns the new seq.
export async function commitVersion(
  admin: SupabaseClient, article: ArticleRow,
  v: { baseBodyMd: string; newBodyMd: string; title: string; metaTitle: string; metaDescription: string; instruction: string; reply: string }
): Promise<number> {
  const { data: rows } = await admin.from('brand_article_versions').select('seq').eq('article_id', article.id).limit(1);
  if (!rows || rows.length === 0) {
    await admin.from('brand_article_versions').insert({
      article_id: article.id, brand_id: article.brand_id, seq: 0, body_md: v.baseBodyMd, title: article.title, source: 'initial'
    });
  } else {
    await admin.from('brand_article_versions').delete().eq('article_id', article.id).gt('seq', article.version_seq);
  }
  const newSeq = (article.version_seq ?? 0) + 1;
  await admin.from('brand_article_versions').insert({
    article_id: article.id, brand_id: article.brand_id, seq: newSeq,
    body_md: v.newBodyMd, title: v.title, meta_title: v.metaTitle || null, meta_description: v.metaDescription || null,
    source: 'ai', instruction: v.instruction, reply: v.reply
  });
  await admin.from('brand_articles').update({
    body_md: v.newBodyMd, title: v.title,
    meta_title: v.metaTitle || null, meta_description: v.metaDescription || null,
    version_seq: newSeq, updated_at: new Date().toISOString()
  }).eq('id', article.id);
  return newSeq;
}

// Move the version pointer. Returns the applied snapshot, or null if there's nothing that direction.
export async function navVersion(
  admin: SupabaseClient, article: ArticleRow, dir: 'undo' | 'redo'
): Promise<{ seq: number; bodyMd: string; title: string; metaTitle: string; metaDescription: string } | null> {
  const target = dir === 'undo' ? (article.version_seq - 1) : (article.version_seq + 1);
  if (target < 0) return null;
  const { data: v } = await admin.from('brand_article_versions')
    .select('seq, body_md, title, meta_title, meta_description').eq('article_id', article.id).eq('seq', target).maybeSingle();
  if (!v) return null;
  await admin.from('brand_articles').update({
    body_md: v.body_md, title: v.title,
    meta_title: v.meta_title, meta_description: v.meta_description,
    version_seq: target, updated_at: new Date().toISOString()
  }).eq('id', article.id);
  return { seq: target, bodyMd: v.body_md, title: v.title ?? '', metaTitle: v.meta_title ?? '', metaDescription: v.meta_description ?? '' };
}

// The chat log (exchanges) + undo/redo availability for the current pointer.
export async function loadChatState(admin: SupabaseClient, articleId: string, versionSeq: number) {
  const { data: versions } = await admin.from('brand_article_versions')
    .select('seq, instruction, reply').eq('article_id', articleId).order('seq', { ascending: true });
  const list = versions ?? [];
  const messages = list.filter((v) => v.instruction).map((v) => ({ seq: v.seq, instruction: v.instruction as string, reply: v.reply as string }));
  const maxSeq = list.length ? Math.max(...list.map((v) => v.seq)) : 0;
  return { messages, canUndo: versionSeq > 0, canRedo: versionSeq < maxSeq };
}
