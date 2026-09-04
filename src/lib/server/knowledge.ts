/**
 * Brand knowledge corpus: ingest → markdown → chunks → hybrid retrieval + graph edges.
 * See docs/23-brand-knowledge-graph.md (Fase 5: FTS + embeddings + RRF).
 */
import { swallow } from '$lib/server/swallow';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { isPaidPlan } from '$lib/server/plans';
import { withBrandContext, logAiCall } from '$lib/server/ai-log';
import { structured } from '$lib/server/research';
import { writeMemory, detectConflict, type MemoryCategory } from '$lib/server/brand-memory';
import { isSupportedKnowledgeFile, MAX_KNOWLEDGE_FILE_BYTES } from '$lib/chat-documents';

export const MAX_FILE_BYTES = MAX_KNOWLEDGE_FILE_BYTES;
export const MAX_CHUNKS_PER_BRAND = 4000;
export const DOC_LIMIT_STARTER = 50;
export const DOC_LIMIT_PRO = 300;

const EMBED_BATCH = 32;
const RRF_K = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const TEXT_EXTS = new Set(['txt', 'md', 'markdown']);
const CSV_EXTS = new Set(['csv']);
const HTML_EXTS = new Set(['html', 'htm']);

/** Closed list — a free-text taxonomy would fragment into synonyms and stop being a filter. */
export const COLLECTIONS = ['brand', 'product', 'commercial', 'legal', 'operations', 'research'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const LANGS = ['it', 'en', 'es', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

// Stopword frequency: no API call, no dependency, and good enough to pick a Postgres FTS config.
// Getting it wrong costs recall on one document, not correctness.
const STOPWORDS: Record<Lang, string[]> = {
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'che', 'e', 'per', 'con', 'non', 'una', 'del', 'dei', 'sono', 'più', 'come', 'anche', 'nel'],
  en: ['the', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'with', 'as', 'are', 'this', 'be', 'on', 'by', 'it', 'from', 'or', 'at', 'we'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'para', 'con', 'una', 'del', 'por', 'como', 'más', 'pero', 'sus', 'este', 'son', 'muy', 'sin'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'que', 'pour', 'avec', 'une', 'du', 'par', 'comme', 'plus', 'mais', 'ses', 'cette', 'sont', 'dans', 'sur']
};

/** Detect the document language for the FTS config. Pure, testable. Defaults to 'en'. */
export function detectLang(text: string): Lang {
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 4000);
  if (words.length < 20) return 'en';
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best: Lang = 'en';
  let bestScore = -1;
  for (const lang of LANGS) {
    let score = 0;
    for (const sw of STOPWORDS[lang]) score += counts.get(sw) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return best;
}

export type KnowledgeChunk = {
  idx: number;
  headingPath: string;
  content: string;
  tokens: number;
};

export type SearchHit = {
  chunkId: string;
  documentId: string;
  title: string;
  headingPath: string;
  content: string;
  score: number;
};

function ext(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? m[1].toLowerCase() : '';
}

function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

function sha256Hex(buf: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

export function isSupportedKnowledgeDoc(mimeType: string, fileName: string): boolean {
  return isSupportedKnowledgeFile(mimeType, fileName);
}

export function docLimitForPlan(plan: string | null | undefined): number {
  return isPaidPlan(plan) ? DOC_LIMIT_PRO : DOC_LIMIT_STARTER;
}

/**
 * JSON extraction for the ingest pipeline. Routing lives in aiStructured(): il lavoro di sfondo va
 * su Gemini Flash (prima passava da DeepSeek — vedi xiaomi.ts) e qui non serve né multimodale né web.
 * This wrapper only turns a failure into null so a bad extraction never fails the document.
 */
async function extractJson<T>(
  prompt: string,
  schema: AnyRec,
  system: string | undefined,
  opts: { label: string; brandId: string }
): Promise<T | null> {
  try {
    const { genaiClient } = await import('$lib/server/brand-context');
    return await structured<T>(genaiClient(), prompt, schema, system, {
      label: opts.label,
      brandId: opts.brandId,
      context: 'knowledge'
    });
  } catch (e) {
    console.error(`[knowledge] ${opts.label} failed`, e);
    return null;
  }
}

/** Reciprocal Rank Fusion — pure, testable. rank is 0-based. */
export function reciprocalRankFusion(rankedIdLists: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedIdLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}

/** Format a float array for pgvector / PostgREST. */
function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

async function embedTexts(brandId: string, texts: string[]): Promise<(number[] | null)[]> {
  if (!texts.length) return [];
  const { llmEmbed } = await import('$lib/server/llm');
  const out: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      const embeddings = await withBrandContext(brandId, () => llmEmbed(batch));
      for (let j = 0; j < batch.length; j++) {
        out[i + j] = embeddings[j] ?? null;
      }
    } catch (e) {
      logAiCall({
        label: 'knowledge-embed',
        provider: 'llm',
        model: 'embedding',
        ms: 0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        brandId,
        context: 'knowledge'
      });
    }
  }
  return out;
}

async function writeChunkEmbeddings(
  supabase: SupabaseClient,
  brandId: string,
  rows: { id: string; content: string; heading_path?: string | null }[]
): Promise<number> {
  if (!rows.length) return 0;
  const texts = rows.map((r) => {
    const head = (r.heading_path ?? '').trim();
    const body = r.content.slice(0, 8000);
    return head ? `${head}\n\n${body}` : body;
  });
  const vectors = await embedTexts(brandId, texts);
  const payload = rows
    .map((row, i) => (vectors[i] ? { id: row.id, e: vectorLiteral(vectors[i]!) } : null))
    .filter((r): r is { id: string; e: string } => !!r);
  if (!payload.length) return 0;

  // One round trip for the whole document (0118). A 200-chunk PDF used to fire 200 concurrent
  // UPDATEs at PostgREST.
  const { data, error } = await supabase.rpc('set_chunk_embeddings', { p_rows: payload });
  if (!error) return typeof data === 'number' ? data : payload.length;
  console.error('[knowledge] set_chunk_embeddings', error.message);

  // 0118 not applied yet — fall back to bounded per-row updates rather than silently
  // leaving the corpus un-embedded (which degrades retrieval to FTS-only without a trace).
  let written = 0;
  for (let i = 0; i < payload.length; i += 8) {
    const slice = payload.slice(i, i + 8);
    await Promise.all(
      slice.map(async (r) => {
        const { error: upErr } = await supabase
          .from('brand_doc_chunks')
          .update({ embedding: r.e })
          .eq('id', r.id);
        if (!upErr) written++;
      })
    );
  }
  return written;
}

/** Backfill embeddings for ready chunks that lack them (post-migration / failed batches). */
export async function backfillChunkEmbeddings(
  supabase: SupabaseClient,
  limit = 64
): Promise<number> {
  const { data, error } = await supabase
    .from('brand_doc_chunks')
    .select('id, brand_id, content, heading_path')
    .is('embedding', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    // Column missing until 0114 is applied — soft skip.
    if (/embedding|column/i.test(error.message)) return 0;
    console.error('[knowledge] backfill select', error.message);
    return 0;
  }
  if (!data?.length) return 0;

  const byBrand = new Map<string, typeof data>();
  for (const row of data) {
    const list = byBrand.get(row.brand_id) ?? [];
    list.push(row);
    byBrand.set(row.brand_id, list);
  }

  let total = 0;
  for (const [brandId, rows] of byBrand) {
    total += await writeChunkEmbeddings(supabase, brandId, rows);
  }
  return total;
}

/** Pure, testable markdown → chunks with heading paths. */
export function chunkMarkdown(
  md: string,
  opts?: { target?: number; overlap?: number }
): KnowledgeChunk[] {
  const targetChars = (opts?.target ?? 800) * 4; // ~800 tokens
  const overlapParas = opts?.overlap ?? 1;
  const normalized = md.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  type Section = { path: string[]; body: string };
  const sections: Section[] = [];
  const headingStack: { level: number; title: string }[] = [];
  let current: Section = { path: [], body: '' };

  const flush = () => {
    const body = current.body.trim();
    if (body) sections.push({ path: [...current.path], body });
    current = { path: headingStack.map((h) => h.title), body: '' };
  };

  for (const line of normalized.split('\n')) {
    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) {
      flush();
      const level = hm[1].length;
      const title = hm[2].trim();
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      current.path = headingStack.map((h) => h.title);
      continue;
    }
    current.body += (current.body ? '\n' : '') + line;
  }
  flush();

  // Merge micro-sections (< 200 chars) into the next.
  const merged: Section[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.body.length < 200 && i + 1 < sections.length) {
      sections[i + 1] = {
        path: sections[i + 1].path.length ? sections[i + 1].path : s.path,
        body: `${s.body}\n\n${sections[i + 1].body}`
      };
    } else {
      merged.push(s);
    }
  }

  const out: KnowledgeChunk[] = [];
  for (const section of merged) {
    const pathStr = section.path.join(' > ');
    const pieces = splitToTarget(section.body, targetChars);
    for (let i = 0; i < pieces.length; i++) {
      let content = pieces[i];
      if (i > 0 && overlapParas > 0) {
        const prevParas = pieces[i - 1].split(/\n\n+/).filter(Boolean);
        const overlap = prevParas.slice(-overlapParas).join('\n\n');
        if (overlap) content = `${overlap}\n\n${content}`;
      }
      out.push({
        idx: out.length,
        headingPath: pathStr,
        content: content.trim(),
        tokens: estimateTokens(content)
      });
    }
  }
  return out;
}

function splitToTarget(body: string, targetChars: number): string[] {
  if (body.length <= targetChars) return [body];
  const paras = body.split(/\n\n+/).filter((p) => p.trim());
  if (paras.length <= 1) return splitBySentence(body, targetChars);

  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (!buf) {
      buf = p;
      continue;
    }
    if ((buf + '\n\n' + p).length <= targetChars) {
      buf = `${buf}\n\n${p}`;
    } else {
      if (buf.length > targetChars) chunks.push(...splitBySentence(buf, targetChars));
      else chunks.push(buf);
      buf = p;
    }
  }
  if (buf) {
    if (buf.length > targetChars) chunks.push(...splitBySentence(buf, targetChars));
    else chunks.push(buf);
  }
  return chunks;
}

function splitBySentence(text: string, targetChars: number): string[] {
  if (text.length <= targetChars) return [text];
  const parts = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buf = '';
  for (const s of parts) {
    if (!buf) {
      buf = s;
      continue;
    }
    if ((buf + ' ' + s).length <= targetChars) buf = `${buf} ${s}`;
    else {
      chunks.push(buf);
      buf = s;
    }
  }
  if (buf) chunks.push(buf);
  // Hard split leftovers that are still too long.
  const hard: string[] = [];
  for (const c of chunks) {
    if (c.length <= targetChars) hard.push(c);
    else {
      for (let i = 0; i < c.length; i += targetChars) hard.push(c.slice(i, i + targetChars));
    }
  }
  return hard;
}

/** Convert raw file bytes to canonical markdown (markitdown-ts, then this fallback). */
export async function toMarkdown(
  buf: ArrayBuffer,
  mime: string,
  name: string
): Promise<{ markdown: string; pages?: number; title?: string | null }> {
  const { convertFileToMarkdown } = await import('$lib/server/file-to-markdown');
  return convertFileToMarkdown(buf, mime, name);
}

/**
 * Legacy converters used when markitdown-ts fails or for txt/md/csv pass-through.
 * Exported for `$lib/server/file-to-markdown` — not a public ingest API.
 */
export async function toMarkdownFallback(
  buf: ArrayBuffer,
  mime: string,
  name: string
): Promise<{ markdown: string; pages?: number }> {
  const e = ext(name);

  if (TEXT_EXTS.has(e) || mime === 'text/plain' || mime === 'text/markdown') {
    const text = new TextDecoder().decode(buf).replace(/\r\n/g, '\n').trim();
    return { markdown: text };
  }

  if (CSV_EXTS.has(e) || mime === 'text/csv') {
    return { markdown: csvToMarkdown(new TextDecoder().decode(buf)) };
  }

  if (HTML_EXTS.has(e) || mime === 'text/html') {
    const html = new TextDecoder().decode(buf);
    return { markdown: await htmlToMarkdown(html) };
  }

  if (e === 'pdf' || mime === 'application/pdf') {
    const { extractText: pdfExtract, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text, totalPages } = await pdfExtract(doc, { mergePages: false });
    const pages = Array.isArray(text) ? text : [String(text ?? '')];
    const parts: string[] = [];
    pages.forEach((p, i) => {
      const body = String(p ?? '').trim();
      if (!body) return;
      parts.push(`## p. ${i + 1}\n\n${body}`);
    });
    const markdown = parts.join('\n\n').trim();
    if (!markdown) throw new Error('No extractable text — need a PDF with selectable text (no OCR).');
    return { markdown, pages: typeof totalPages === 'number' ? totalPages : pages.length };
  }

  if (e === 'docx' || mime.includes('wordprocessingml')) {
    throw new Error('Could not convert this Word document.');
  }

  throw new Error(`Unsupported document type: ${mime || name}`);
}

function csvToMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').trim().split('\n').filter(Boolean);
  if (!lines.length) return '';
  const limit = lines.length > 200 ? 50 : lines.length;
  const slice = lines.slice(0, limit);
  const rows = slice.map((l) => l.split(',').map((c) => c.trim().replace(/\|/g, '\\|')));
  const header = rows[0];
  const sep = header.map(() => '---');
  const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`);
  let md = `| ${header.join(' | ')} |\n| ${sep.join(' | ')} |\n${body.join('\n')}`;
  if (lines.length > 200) md += `\n\n_Truncated: showing first 50 of ${lines.length} rows._`;
  return md;
}

export async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import('turndown')).default;
  // @ts-expect-error no types
  const { gfm } = await import('turndown-plugin-gfm');
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  });
  td.use(gfm);
  // Chrome, not content: inline scripts/styles and icon paths would otherwise land in the output
  // as text, and "Copy"/"✓" button labels would sit inside every code block.
  td.remove(['script', 'style', 'noscript', 'svg', 'button']);
  // Turndown only fences <pre> that wraps a <code>; a bare <pre> (how the docs pages write their
  // shell snippets) would otherwise flatten into prose and lose the line breaks that make it code.
  td.addRule('bare-pre', {
    filter: (node) => node.nodeName === 'PRE' && !node.querySelector('code'),
    replacement: (_content, node) => `\n\n\`\`\`\n${(node.textContent ?? '').trim()}\n\`\`\`\n\n`
  });
  // Flex/grid rows sit inline elements flush against each other (`<span>200</span><span>OK</span>`):
  // the visual gap is CSS, so without this the words collide into "200OK".
  return td.turndown(html.replace(/<\/(span|code|strong|b|em|a|kbd)>(?=<[a-z])/gi, '$& ')).trim();
}

async function htmlFromUrl(url: string): Promise<{ markdown: string; title?: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'AnomaliaKnowledge/1.0' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);
  const ct = res.headers.get('content-type') ?? '';
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error('Remote file exceeds 20 MB limit.');
  const name = url.split('/').pop()?.split('?')[0] || 'page.html';
  if (ct.includes('pdf') || name.toLowerCase().endsWith('.pdf')) {
    return toMarkdown(buf, 'application/pdf', name);
  }
  const html = new TextDecoder().decode(buf);
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return { markdown: await htmlToMarkdown(html), title: titleMatch?.[1]?.trim() };
}

export async function countBrandDocuments(
  supabase: SupabaseClient,
  brandId: string
): Promise<number> {
  const { count } = await supabase
    .from('brand_documents')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .neq('kind', 'image');
  return count ?? 0;
}

export async function countBrandChunks(supabase: SupabaseClient, brandId: string): Promise<number> {
  const { count } = await supabase
    .from('brand_doc_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);
  return count ?? 0;
}

/**
 * Ingest without inline extraction. Creates a pending row (or returns existing on sha dedup).
 * Caller uploads the file to storage first when providing `path`.
 */
export async function ingestDocument(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  input: {
    path?: string;
    fileName?: string;
    mimeType?: string;
    bytes?: number;
    title?: string;
    text?: string;
    url?: string;
    plan?: string | null;
    kind?: 'note' | 'document';
    sourceType?: string;
  }
): Promise<{ id: string; deduped: boolean }> {
  const limit = docLimitForPlan(input.plan);
  const existing = await countBrandDocuments(supabase, brandId);
  if (existing >= limit) {
    throw new Error(`Document limit reached (${limit}). Upgrade or delete unused documents.`);
  }

  // Note / pasted text
  if (input.text != null && !input.path && !input.url) {
    const title = (input.title || 'Note').slice(0, 200);
    const body = input.text.trim();
    if (!body) throw new Error('Empty note');
    const kind = input.kind === 'document' ? 'document' : 'note';
    const { data, error } = await supabase
      .from('brand_documents')
      .insert({
        brand_id: brandId,
        kind,
        title,
        content_text: body,
        markdown: body,
        source_type: input.sourceType ?? (kind === 'document' ? 'chat' : 'note'),
        status: 'pending',
        bytes: Buffer.byteLength(body, 'utf8')
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to save note');
    return { id: data.id as string, deduped: false };
  }

  // URL
  if (input.url) {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid URL protocol');

    const { data, error } = await supabase
      .from('brand_documents')
      .insert({
        brand_id: brandId,
        kind: 'document',
        title: input.title || parsed.hostname,
        source_type: 'url',
        source_url: input.url,
        status: 'pending',
        content_text: null
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to save URL document');
    return { id: data.id as string, deduped: false };
  }

  // Uploaded file (already in bucket)
  const path = input.path ?? '';
  const fileName = input.fileName ?? '';
  const mimeType = input.mimeType ?? '';
  if (!path.startsWith(`${userId}/${brandId}/`)) throw new Error('Invalid file path');
  if (!fileName || !isSupportedKnowledgeDoc(mimeType, fileName)) {
    throw new Error('Unsupported file. Use PDF, Word, Excel, TXT, Markdown, CSV, HTML or similar.');
  }
  if ((input.bytes ?? 0) > MAX_FILE_BYTES) throw new Error('File exceeds 20 MB limit.');

  // Dedup by sha if we can download cheaply — download once for hash.
  const dl = await supabase.storage.from('brand-knowledge').download(path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message ?? 'Download failed');
  const buf = await dl.data.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error('File exceeds 20 MB limit.');
  const hash = sha256Hex(buf);

  const { data: dup } = await supabase
    .from('brand_documents')
    .select('id')
    .eq('brand_id', brandId)
    .eq('sha256', hash)
    .maybeSingle();
  if (dup?.id) {
    // Remove the just-uploaded duplicate file.
    await supabase.storage.from('brand-knowledge').remove([path]).catch(swallow('remove failed'));
    return { id: dup.id as string, deduped: true };
  }

  const { data, error } = await supabase
    .from('brand_documents')
    .insert({
      brand_id: brandId,
      kind: 'document',
      title: input.title || fileName,
      file_url: path,
      file_name: fileName,
      mime_type: mimeType,
      source_type: 'upload',
      status: 'pending',
      bytes: buf.byteLength,
      sha256: hash,
      content_text: null
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to save document');
  return { id: data.id as string, deduped: false };
}

export async function kickKnowledgeWork(origin: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  await fetch(`${origin}/api/v1/knowledge/work`, { method: 'POST', headers }).catch(swallow('fetch failed'));
}

/** Claim up to `limit` pending docs (FIFO), with 15-min processing watchdog. */
export async function claimPendingDocuments(
  supabase: SupabaseClient,
  limit = 3
): Promise<string[]> {
  const stallIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Re-queue stalled processing (attempts < 3); fail the rest.
  await supabase
    .from('brand_documents')
    .update({ status: 'pending', processing_started_at: null })
    .eq('status', 'processing')
    .lt('processing_started_at', stallIso)
    .lt('attempts', 3);

  await supabase
    .from('brand_documents')
    .update({
      status: 'failed',
      error: 'Processing timed out after 3 attempts',
      processing_started_at: null
    })
    .eq('status', 'processing')
    .lt('processing_started_at', stallIso)
    .gte('attempts', 3);

  // Linear backoff between attempts (1 → 2 → 4 min): the worker drains in a loop, so without this
  // a transient provider error burns all 3 attempts within seconds and the doc lands in `failed`.
  const now = Date.now();
  const { data: candidates } = await supabase
    .from('brand_documents')
    .select('id, attempts, updated_at')
    .eq('status', 'pending')
    .neq('kind', 'image')
    .order('created_at', { ascending: true })
    .limit(limit * 3);

  const pending = (candidates ?? [])
    .filter((row) => {
      const attempts = (row.attempts as number) ?? 0;
      if (attempts === 0) return true;
      const last = row.updated_at ? new Date(row.updated_at as string).getTime() : 0;
      return now - last >= attempts * 60_000 * 2;
    })
    .slice(0, limit);

  const ids: string[] = [];
  for (const row of pending ?? []) {
    const nextAttempts = (row.attempts ?? 0) + 1;
    const { data: claimed } = await supabase
      .from('brand_documents')
      .update({
        status: 'processing',
        processing_started_at: new Date().toISOString(),
        attempts: nextAttempts,
        error: null
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimed?.id) ids.push(claimed.id as string);
  }
  return ids;
}

export async function processDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<{ chunks: number }> {
  const { data: doc, error } = await supabase
    .from('brand_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (error || !doc) throw new Error(error?.message ?? 'Document not found');
  if (doc.kind === 'image') {
    await supabase
      .from('brand_documents')
      .update({ status: 'ready', processed_at: new Date().toISOString() })
      .eq('id', documentId);
    return { chunks: 0 };
  }

  const brandId = doc.brand_id as string;
  // The doc's own chunks are about to be replaced — counting them would make a reprocess of a
  // large document trip the per-brand cap against itself.
  const chunkBudget =
    (await countBrandChunks(supabase, brandId)) - ((doc.chunk_count as number | null) ?? 0);

  try {
    let markdown = (doc.markdown as string | null) ?? '';
    let pages: number | undefined;

    // A document that already went through the pipeline and still has markdown was either
    // untouched or hand-edited in the drawer — re-extracting would silently discard the edit.
    // "Reprocess from source" is expressed by reprocessDocument() clearing markdown.
    const keepEdited = !!markdown.trim() && !!doc.processed_at;

    if (!keepEdited && doc.source_type === 'url' && doc.source_url) {
      const remote = await htmlFromUrl(doc.source_url as string);
      markdown = remote.markdown;
      if (remote.title && !doc.title) {
        await supabase.from('brand_documents').update({ title: remote.title }).eq('id', documentId);
      }
    } else if (!keepEdited && doc.file_url) {
      const dl = await supabase.storage.from('brand-knowledge').download(doc.file_url as string);
      if (dl.error || !dl.data) throw new Error(dl.error?.message ?? 'Download failed');
      const buf = await dl.data.arrayBuffer();
      const converted = await toMarkdown(
        buf,
        (doc.mime_type as string) || 'application/octet-stream',
        (doc.file_name as string) || 'file'
      );
      markdown = converted.markdown;
      pages = converted.pages;
    } else if (!markdown && doc.content_text) {
      markdown = String(doc.content_text);
    }

    markdown = markdown.trim();
    if (!markdown) throw new Error('No extractable text — need a PDF with selectable text (no OCR).');

    const lang = detectLang(markdown);
    const chunks = chunkMarkdown(markdown);
    if (chunkBudget + chunks.length > MAX_CHUNKS_PER_BRAND) {
      throw new Error(`Chunk limit reached (${MAX_CHUNKS_PER_BRAND} per brand).`);
    }

    // Replace chunks
    await supabase.from('brand_doc_chunks').delete().eq('document_id', documentId);
    if (chunks.length) {
      const rows = chunks.map((c) => ({
        brand_id: brandId,
        document_id: documentId,
        idx: c.idx,
        heading_path: c.headingPath || null,
        content: c.content,
        tokens: c.tokens,
        lang
      }));
      const { error: insErr } = await supabase.from('brand_doc_chunks').insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    // Structural edges: chunk → document
    await supabase
      .from('brand_knowledge_edges')
      .delete()
      .eq('brand_id', brandId)
      .eq('dst_kind', 'document')
      .eq('dst_id', documentId)
      .eq('rel', 'derived_from')
      .eq('src_kind', 'chunk');

    const { data: chunkRows } = await supabase
      .from('brand_doc_chunks')
      .select('id, content, heading_path')
      .eq('document_id', documentId)
      .order('idx', { ascending: true });

    if (chunkRows?.length) {
      await supabase.from('brand_knowledge_edges').upsert(
        chunkRows.map((c) => ({
          brand_id: brandId,
          src_kind: 'chunk',
          src_id: c.id,
          dst_kind: 'document',
          dst_id: documentId,
          rel: 'derived_from',
          weight: 1,
          confidence: 1,
          created_by: 'system'
        })),
        { onConflict: 'brand_id,src_kind,src_id,dst_kind,dst_id,rel', ignoreDuplicates: true }
      );
      // Fase 5: embeddings best-effort — doc stays ready even if embed fails.
      await writeChunkEmbeddings(supabase, brandId, chunkRows).catch((e) =>
        console.error('[knowledge] embed chunks', e)
      );
    }

    const { summary, collection } = await summarizeDocument(
      supabase,
      brandId,
      doc.title as string | null,
      markdown
    );

    await supabase
      .from('brand_documents')
      .update({
        status: 'ready',
        markdown,
        content_text: markdown.slice(0, 200_000),
        page_count: pages ?? doc.page_count ?? null,
        chunk_count: chunks.length,
        lang,
        // Never overwrite a collection the user set by hand.
        collection: (doc.collection as string | null) ?? collection,
        summary,
        error: null,
        processed_at: new Date().toISOString(),
        processing_started_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);

    // Best-effort semantic edges + memory extraction (never fail the doc).
    extractEntityEdges(supabase, brandId, documentId, chunkRows ?? []).catch((e) =>
      console.error('[knowledge] entity edges', e)
    );
    extractMemoriesFromChunks(supabase, brandId, documentId, chunks.slice(0, 40)).catch((e) =>
      console.error('[knowledge] memory extract', e)
    );

    return { chunks: chunks.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (doc.attempts as number) ?? 1;
    await supabase
      .from('brand_documents')
      .update({
        status: attempts >= 3 ? 'failed' : 'pending',
        error: msg.slice(0, 1000),
        processing_started_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    throw e;
  }
}

// Summary + collection in ONE call: the router (which slice of the corpus this belongs to) is a
// judgement about the same text the summary already reads.
async function summarizeDocument(
  supabase: SupabaseClient,
  brandId: string,
  title: string | null,
  markdown: string
): Promise<{ summary: string | null; collection: Collection | null }> {
  try {
    const excerpt = markdown.slice(0, 12_000);
    return await withBrandContext(brandId, async () => {
      const res = await extractJson<{ summary: string; collection: string }>(
        `Title: ${title ?? 'Untitled'}\n\n${excerpt}`,
        {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            collection: { type: 'string', enum: [...COLLECTIONS] }
          },
          required: ['summary', 'collection']
        },
        `Summarize this brand document in 2-3 short sentences for a knowledge index, and file it under exactly one collection: brand (identity, tone, guidelines), product (specs, catalogue), commercial (pricing, offers, sales), legal (terms, privacy, compliance), operations (processes, logistics, support), research (market, competitors, data).`,
        { label: 'knowledge-summary', brandId }
      );
      const summary = String(res?.summary ?? '').trim().slice(0, 600) || null;
      const c = String(res?.collection ?? '') as Collection;
      return { summary, collection: COLLECTIONS.includes(c) ? c : null };
    });
  } catch {
    return { summary: null, collection: null };
  }
}

async function extractEntityEdges(
  supabase: SupabaseClient,
  brandId: string,
  documentId: string,
  chunkRows: { id: string }[]
): Promise<void> {
  if (!chunkRows.length) return;
  const [{ data: products }, { data: competitors }, { data: people }, { data: rubrics }, { data: chunks }] =
    await Promise.all([
      supabase.from('products').select('id, title').eq('brand_id', brandId).limit(80),
      supabase.from('competitors').select('id, name').eq('brand_id', brandId).limit(80),
      supabase.from('people').select('id, name').eq('brand_id', brandId).limit(80),
      // 'active' non esiste tra gli status di `rubrics`: questa riga — che alimenta il CONTESTO
      // dell'agente — tornava vuota per ogni brand, quindi l'agente non ha mai visto una rubrica.
      supabase.from('rubrics').select('id, name').eq('brand_id', brandId).eq('status', 'approved').limit(40),
      supabase
        .from('brand_doc_chunks')
        .select('id, content, heading_path')
        .eq('document_id', documentId)
        .order('idx', { ascending: true })
        .limit(100)
    ]);

  const catalog = {
    products: (products ?? []).map((p) => ({ id: p.id, name: p.title })),
    competitors: (competitors ?? []).map((c) => ({ id: c.id, name: c.name })),
    people: (people ?? []).map((p) => ({ id: p.id, name: p.name })),
    rubrics: (rubrics ?? []).map((r) => ({ id: r.id, name: r.name }))
  };
  if (
    !catalog.products.length &&
    !catalog.competitors.length &&
    !catalog.people.length &&
    !catalog.rubrics.length
  ) {
    return;
  }

  const corpus = (chunks ?? [])
    .map((c) => `[${c.id}] ${c.heading_path ?? ''}\n${String(c.content).slice(0, 400)}`)
    .join('\n\n')
    .slice(0, 40_000);

  type Hit = { kind: string; id: string; chunkId: string; rel: string; confidence: number };
  const result = await withBrandContext(brandId, async () =>
    extractJson<{ mentions: Hit[] }>(
      `ENTITIES:\n${JSON.stringify(catalog)}\n\nCHUNKS:\n${corpus}`,
      {
        type: 'object',
        properties: {
          mentions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                id: { type: 'string' },
                chunkId: { type: 'string' },
                rel: { type: 'string' },
                confidence: { type: 'number' }
              },
              required: ['kind', 'id', 'chunkId', 'rel', 'confidence']
            }
          }
        },
        required: ['mentions']
      },
      `Given CLOSED entity lists and document chunks, return mentions. Only use ids from the lists. rel is mentions|about. confidence 0-1. kind must be product|competitor|person|rubric.`,
      { label: 'knowledge-entity-edges', brandId }
    )
  );

  const allowed = new Map<string, Set<string>>();
  for (const [kind, list] of Object.entries(catalog)) {
    const nodeKind =
      kind === 'products'
        ? 'product'
        : kind === 'competitors'
          ? 'competitor'
          : kind === 'people'
            ? 'person'
            : 'rubric';
    allowed.set(nodeKind, new Set(list.map((x) => x.id as string)));
  }
  const chunkIds = new Set((chunks ?? []).map((c) => c.id as string));

  const edges = (result?.mentions ?? [])
    .filter(
      (m) =>
        m.confidence >= 0.6 &&
        chunkIds.has(m.chunkId) &&
        allowed.get(m.kind)?.has(m.id) &&
        (m.rel === 'mentions' || m.rel === 'about')
    )
    .slice(0, 80)
    .map((m) => ({
      brand_id: brandId,
      src_kind: 'chunk',
      src_id: m.chunkId,
      dst_kind: m.kind,
      dst_id: m.id,
      rel: m.rel,
      weight: 1,
      confidence: m.confidence,
      evidence_chunk_id: m.chunkId,
      created_by: 'ai'
    }));

  if (edges.length) {
    await supabase.from('brand_knowledge_edges').upsert(edges, {
      onConflict: 'brand_id,src_kind,src_id,dst_kind,dst_id,rel',
      ignoreDuplicates: true
    });
  }
}

async function extractMemoriesFromChunks(
  supabase: SupabaseClient,
  brandId: string,
  documentId: string,
  chunks: KnowledgeChunk[]
): Promise<void> {
  if (!chunks.length) return;
  const text = chunks
    .map((c) => `${c.headingPath}\n${c.content}`)
    .join('\n\n')
    .slice(0, 20_000);

  type Mem = { category: MemoryCategory; key: string; value: string; confidence: number };
  const result = await withBrandContext(brandId, async () =>
    extractJson<{ memories: Mem[] }>(
      text,
      {
        type: 'object',
        properties: {
          memories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                key: { type: 'string' },
                value: { type: 'string' },
                confidence: { type: 'number' }
              },
              required: ['category', 'key', 'value', 'confidence']
            }
          }
        },
        required: ['memories']
      },
      `Extract lasting brand facts from this document. Categories: voice|constraint|fact|preference|insight. Max 8. Keys snake_case.`,
      { label: 'knowledge-memory-extract', brandId }
    )
  );

  for (const m of (result?.memories ?? []).slice(0, 8)) {
    if (!m.key || !m.value) continue;
    const conflict = await detectConflict(supabase, brandId, m.key, m.value);
    if (conflict) {
      const { data: existingMem } = await supabase
        .from('brand_memory')
        .select('id')
        .eq('brand_id', brandId)
        .eq('key', m.key)
        .maybeSingle();
      if (existingMem?.id) {
        // Placeholder edge until the new memory is written — updated below with both ids.
        try {
          await supabase.from('brand_knowledge_edges').upsert(
            {
              brand_id: brandId,
              src_kind: 'memory',
              src_id: existingMem.id,
              dst_kind: 'document',
              dst_id: documentId,
              rel: 'contradicts',
              confidence: 0.85,
              created_by: 'ai'
            },
            { onConflict: 'brand_id,src_kind,src_id,dst_kind,dst_id,rel', ignoreDuplicates: true }
          );
        } catch (error) { swallow('write knowledge edge', error); }
      }
    }
    const written = await writeMemory(supabase, brandId, {
      category: m.category,
      key: m.key,
      value: m.value,
      source: 'analysis',
      confidence: Math.min(0.9, Math.max(0.4, m.confidence ?? 0.6)),
      // Below the default 3: hand-written rules must win the core-memory budget (docs/23 §11).
      importance: 2
    });
    await supabase.from('brand_knowledge_edges').upsert(
      {
        brand_id: brandId,
        src_kind: 'memory',
        src_id: written.id,
        dst_kind: 'document',
        dst_id: documentId,
        rel: 'derived_from',
        confidence: 0.9,
        created_by: 'system'
      },
      { onConflict: 'brand_id,src_kind,src_id,dst_kind,dst_id,rel', ignoreDuplicates: true }
    );
  }
}

type SearchScope = { collection: Collection | null; documentIds?: string[] };

type RpcChunkRow = {
  id: string;
  document_id: string;
  heading_path: string | null;
  content: string;
  score: number;
  title: string | null;
};

function mapHits(rows: RpcChunkRow[]): SearchHit[] {
  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.document_id,
    title: r.title ?? 'Untitled',
    headingPath: r.heading_path ?? '',
    content: r.content,
    score: r.score
  }));
}

/** Embed the query and pull k-NN candidates. Soft-fail → [] (retrieval degrades to FTS-only). */
async function vectorCandidates(
  supabase: SupabaseClient,
  brandId: string,
  q: string,
  candidateLimit: number,
  scope: SearchScope
): Promise<RpcChunkRow[]> {
  try {
    const [vec] = await embedTexts(brandId, [q]);
    if (!vec) return [];
    const { data, error } = await supabase.rpc('match_brand_chunks', {
      p_brand: brandId,
      p_embedding: vectorLiteral(vec),
      p_limit: candidateLimit,
      p_collection: scope.collection ?? null,
      p_document_ids: scope.documentIds?.length ? scope.documentIds : null
    });
    if (error) {
      if (!/match_brand_chunks|embedding|vector|function/i.test(error.message)) {
        console.error('[searchKnowledge] match', error.message);
      }
      return [];
    }
    return (data ?? []) as RpcChunkRow[];
  } catch (e) {
    console.error('[searchKnowledge] embed query', e);
    return [];
  }
}

export async function searchKnowledge(
  supabase: SupabaseClient,
  brandId: string,
  query: string,
  opts?: { limit?: number; collection?: string | null; documentIds?: string[] }
): Promise<SearchHit[]> {
  const limit = opts?.limit ?? 8;
  const q = query.trim();
  if (!q) return [];

  // Scoping is the cheapest precision lever on a big corpus: a collection or a shortlist of
  // documents cuts the candidate set before ranking ever runs (docs/23 §11).
  const scope: SearchScope = {
    collection: COLLECTIONS.includes(opts?.collection as Collection) ? (opts?.collection as Collection) : null,
    documentIds: opts?.documentIds?.filter(Boolean).slice(0, 20)
  };
  const candidateLimit = Math.min(30, Math.max(limit * 3, 12));

  const { data: ftsData, error: ftsError } = await supabase.rpc('search_brand_chunks', {
    p_brand: brandId,
    p_query: q,
    p_limit: candidateLimit,
    p_collection: scope.collection,
    p_document_ids: scope.documentIds?.length ? scope.documentIds : null
  });
  if (ftsError) {
    console.error('[searchKnowledge]', ftsError.message);
  }
  const ftsRows = (ftsData ?? []) as RpcChunkRow[];

  // Hybrid (Fase 5) only when keyword recall is thin. FTS runs on 'simple' (no stemming), so a
  // paraphrase — "quanto dura la garanzia" vs "garanzie: 24 mesi" — misses and lands here; when
  // FTS already fills the page, an embedding round trip per search buys nothing and the agent
  // calls search_knowledge several times per turn.
  const vecRows: RpcChunkRow[] =
    ftsRows.length >= limit ? [] : await vectorCandidates(supabase, brandId, q, candidateLimit, scope);

  if (!vecRows.length) {
    return mapHits(ftsRows).slice(0, limit);
  }
  if (!ftsRows.length) {
    return mapHits(vecRows).slice(0, limit);
  }

  const scores = reciprocalRankFusion([
    ftsRows.map((r) => r.id),
    vecRows.map((r) => r.id)
  ]);
  const byId = new Map<string, RpcChunkRow>();
  for (const r of [...ftsRows, ...vecRows]) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => {
      const r = byId.get(id)!;
      return {
        chunkId: r.id,
        documentId: r.document_id,
        title: r.title ?? 'Untitled',
        headingPath: r.heading_path ?? '',
        content: r.content,
        score
      };
    });
}

/** Record that a post used a chunk (structural used_by edge). */
export async function recordChunkUsedByPost(
  supabase: SupabaseClient,
  brandId: string,
  postId: string,
  chunkIds: string[]
): Promise<void> {
  if (!chunkIds.length) return;
  await supabase.from('brand_knowledge_edges').upsert(
    chunkIds.map((cid) => ({
      brand_id: brandId,
      src_kind: 'post',
      src_id: postId,
      dst_kind: 'chunk',
      dst_id: cid,
      rel: 'used_by',
      confidence: 1,
      created_by: 'system'
    })),
    { onConflict: 'brand_id,src_kind,src_id,dst_kind,dst_id,rel', ignoreDuplicates: true }
  );
}

export async function reprocessDocument(
  supabase: SupabaseClient,
  brandId: string,
  documentId: string
): Promise<void> {
  // markdown = null is what tells processDocument to re-extract from the file/URL instead of
  // re-chunking the stored (possibly hand-edited) markdown. Notes recover from content_text.
  await supabase
    .from('brand_documents')
    .update({
      status: 'pending',
      attempts: 0,
      error: null,
      markdown: null,
      processing_started_at: null
    })
    .eq('id', documentId)
    .eq('brand_id', brandId)
    .neq('kind', 'image');
}

export async function saveDocumentMarkdown(
  supabase: SupabaseClient,
  brandId: string,
  documentId: string,
  markdown: string
): Promise<string> {
  const md = markdown.trim();
  // updated_at viene timbrato QUI e non da un trigger: il worker della pipeline tocca la stessa
  // riga (status/attempts) a ogni giro, e un bump automatico renderebbe stantio ogni receipt.
  const updatedAt = new Date().toISOString();
  await supabase
    .from('brand_documents')
    .update({
      markdown: md,
      content_text: md.slice(0, 200_000),
      status: 'pending',
      attempts: 0,
      error: null,
      updated_at: updatedAt
    })
    .eq('id', documentId)
    .eq('brand_id', brandId);
  return updatedAt;
}
