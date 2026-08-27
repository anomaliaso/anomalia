/**
 * Client-safe helpers for chat file attachments converted to markdown.
 * Binary conversion lives in `$lib/server/file-to-markdown`.
 */

export const MAX_CHAT_DOCS = 4;
/** Small files are inlined in the model prompt. Larger files: grep/read/summarize tools (like motion-video source). */
export const CHAT_INLINE_DOC_CHARS = 8_000;
/** Per-file cap persisted on the user message for follow-up turns. */
export const CHAT_HISTORY_DOC_CAP = 12_000;
/** Target size of one chat chunk (~1.5k tokens) before packing history. */
export const CHAT_CHUNK_TARGET_CHARS = 6_000;
export const ATTACH_READ_DEFAULT_CHARS = 6_000;
export const ATTACH_READ_MAX_CHARS = 12_000;
export const ATTACH_OUTLINE_MAX = 40;
/** Chat attach cap — bytes go through Storage, not the function body. */
export const MAX_CHAT_CONVERT_BYTES = 100 * 1024 * 1024;
/** Knowledge ingest stays tighter: embedding/chunking a 100 MB dump is a different job. */
export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024;

export const ATTACHED_DOCS_MARKER = '<!--anomalia-attached-docs-->';
export const CHAT_CONVERT_FOLDER = 'chat-convert';

/** Formats markitdown-ts (and the knowledge ingest) can turn into markdown. */
export const CONVERTIBLE_EXTS = new Set([
  'pdf',
  'docx',
  'xlsx',
  'xls',
  'html',
  'htm',
  'csv',
  'txt',
  'md',
  'markdown',
  'xml',
  'rss',
  'atom',
  'ipynb',
  'zip'
]);

/** Knowledge ingest: same as chat convert, minus zip (unbounded corpus dump). */
export const KNOWLEDGE_DOC_EXTS = new Set(
  [...CONVERTIBLE_EXTS].filter((e) => e !== 'zip')
);

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/html': 'html',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'application/x-ipynb+json': 'ipynb'
};

export const CHAT_DOCUMENT_ACCEPT = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.xls',
  '.html',
  '.htm',
  '.csv',
  '.txt',
  '.md',
  '.xml',
  '.ipynb',
  '.zip',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/html',
  'text/csv',
  'text/plain',
  'text/markdown'
].join(',');

export type ChatDocument = {
  name: string;
  markdown: string;
  title?: string | null;
  /** Storage path of converted markdown (`…/chat-convert/….md`). Hydrated on the server. */
  path?: string;
};

export function isReadyChatDoc(d: {
  markdown?: string;
  path?: string;
  converting?: boolean;
  error?: string;
}): boolean {
  return !d.converting && !d.error && Boolean(d.path?.trim() || d.markdown?.trim());
}

/** Payload for chat POST / queued jobs — prefer the Storage path so the body stays small. */
export function chatDocumentRefs(docs: ChatDocument[]): ChatDocument[] {
  return docs.map((d) => {
    if (d.path) return { name: d.name, title: d.title ?? null, path: d.path, markdown: '' };
    return { name: d.name, title: d.title ?? null, markdown: d.markdown };
  });
}

export function fileExt(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? m[1].toLowerCase() : '';
}

export function extFromMime(mimeType: string): string {
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[mime] ?? '';
}

/** Extension with leading dot, as markitdown-ts `file_extension` requires. */
export function dottedExtension(fileName: string, mimeType = ''): string {
  const e = fileExt(fileName) || extFromMime(mimeType);
  return e ? `.${e}` : '';
}

export function isImageOrMediaFile(mimeType: string, fileName = ''): boolean {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) {
    return true;
  }
  const e = fileExt(fileName);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a'].includes(
    e
  );
}

export function isConvertibleDocument(mimeType: string, fileName: string): boolean {
  if (isImageOrMediaFile(mimeType, fileName)) return false;
  const e = fileExt(fileName) || extFromMime(mimeType);
  return CONVERTIBLE_EXTS.has(e);
}

export function isSupportedKnowledgeFile(mimeType: string, fileName: string): boolean {
  if (isImageOrMediaFile(mimeType, fileName)) return false;
  const e = fileExt(fileName) || extFromMime(mimeType);
  return KNOWLEDGE_DOC_EXTS.has(e);
}

/** `${userId}/${brandId}/chat-convert/` — binaries deleted after conversion; `.md` kept until the turn. */
export function chatConvertStoragePrefix(userId: string, brandId: string): string {
  return `${userId}/${brandId}/${CHAT_CONVERT_FOLDER}/`;
}

export function isChatConvertStoragePath(path: string, userId: string, brandId: string): boolean {
  const prefix = chatConvertStoragePrefix(userId, brandId);
  return path.startsWith(prefix) && path.length > prefix.length && !path.includes('..');
}

export function chatConvertMarkdownPath(originalPath: string): string {
  return `${originalPath}.md`;
}

export function isChatConvertMarkdownPath(path: string, userId: string, brandId: string): boolean {
  return isChatConvertStoragePath(path, userId, brandId) && path.endsWith('.md');
}

export function truncateMarkdown(
  md: string,
  cap: number
): { markdown: string; truncated: boolean; originalChars: number } {
  const originalChars = md.length;
  if (originalChars <= cap) return { markdown: md, truncated: false, originalChars };
  return {
    markdown: md.slice(0, cap).trimEnd() + '\n',
    truncated: true,
    originalChars
  };
}

/**
 * Split markdown into ordered chunks (headings, then paragraphs, then hard slices).
 * Each chunk is converted/handled on its own, then packed together for the model.
 */
export function splitMarkdownIntoChatChunks(
  md: string,
  targetChars = CHAT_CHUNK_TARGET_CHARS
): string[] {
  const text = md.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  if (text.length <= targetChars) return [text];

  const headingPieces = text.split(/(?=^#{1,4} )/m).map((s) => s.trim()).filter(Boolean);
  const pieces = headingPieces.length > 1 ? headingPieces : [text];
  const out: string[] = [];

  for (const piece of pieces) {
    if (piece.length <= targetChars) {
      out.push(piece);
      continue;
    }
    const paras = piece.split(/\n\n+/);
    let buf = '';
    for (const p of paras) {
      const next = buf ? `${buf}\n\n${p}` : p;
      if (next.length <= targetChars) {
        buf = next;
        continue;
      }
      if (buf) out.push(buf);
      if (p.length <= targetChars) {
        buf = p;
      } else {
        for (let i = 0; i < p.length; i += targetChars) out.push(p.slice(i, i + targetChars));
        buf = '';
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

export function packChatChunks(
  chunks: string[],
  cap: number
): { markdown: string; chunkCount: number; shortened: boolean; originalChars: number } {
  const originalChars = chunks.reduce((n, c) => n + c.length, 0);
  const n = chunks.length;
  if (!n) return { markdown: '', chunkCount: 0, shortened: false, originalChars: 0 };

  const label = (i: number, body: string) =>
    n === 1 ? body : `#### Chunk ${i + 1}/${n}\n\n${body}`;
  const join = (bodies: string[]) => bodies.map((b, i) => label(i, b)).join('\n\n');
  const clip = (c: string, share: number) =>
    c.length <= share ? c : `${c.slice(0, share).trimEnd()}\n…`;

  const full = join(chunks);
  if (full.length <= cap) {
    return { markdown: full, chunkCount: n, shortened: false, originalChars };
  }

  // Fair share: keep every chunk (start + later sections), never head-only.
  let lo = 40;
  let hi = Math.max(40, Math.max(...chunks.map((c) => c.length)));
  let best = join(chunks.map((c) => clip(c, lo)));
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = join(chunks.map((c) => clip(c, mid)));
    if (candidate.length <= cap) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { markdown: best, chunkCount: n, shortened: true, originalChars };
}

export function parseChatDocuments(raw: unknown): ChatDocument[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatDocument[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 200) : '';
    const markdown = typeof rec.markdown === 'string' ? rec.markdown : '';
    const path = typeof rec.path === 'string' ? rec.path.trim().slice(0, 500) : '';
    if (!name || (!markdown.trim() && !path)) continue;
    const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 200) : null;
    out.push({ name, markdown, title, ...(path ? { path } : {}) });
    if (out.length >= MAX_CHAT_DOCS) break;
  }
  return out;
}

export function formatAttachedDocsBlock(docs: ChatDocument[], cap: number): string {
  if (!docs.length) return '';
  const parts = docs.map((d) => {
    const chunks = splitMarkdownIntoChatChunks(d.markdown);
    const packed = packChatChunks(chunks, cap);
    let note = '';
    if (packed.chunkCount > 1 && packed.shortened) {
      note = `\n\n_Split into ${packed.chunkCount} ordered chunks covering the whole file (${packed.originalChars.toLocaleString()} chars). Every chunk is included; some were shortened to fit context. Full text: add_document with from_attachment._`;
    } else if (packed.chunkCount > 1) {
      note = `\n\n_Split into ${packed.chunkCount} ordered chunks covering the full text._`;
    } else if (packed.shortened) {
      note = `\n\n_Truncated: showing ${packed.markdown.length.toLocaleString()} of ${packed.originalChars.toLocaleString()} characters._`;
    }
    return `### ${d.name}\n\n${packed.markdown}${note}`;
  });
  return `\n\n${ATTACHED_DOCS_MARKER}\n## Attached documents (converted to markdown)\nThese files are for THIS turn. They are NOT brand knowledge unless you save them with add_document (prefer from_attachment = the filename so the full text is stored).\n\n${parts.join('\n\n')}`;
}

export type AttachmentHeading = { heading: string; index: number; chars: number };

/** Heading map with char indexes — same idea as grep_source hits for motion video. */
export function attachmentOutline(md: string, maxHeadings = ATTACH_OUTLINE_MAX): AttachmentHeading[] {
  const text = md.replace(/\r\n/g, '\n');
  const marks: { heading: string; index: number }[] = [];
  const re = /^(#{1,4} .+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    marks.push({ heading: m[1].trim(), index: m.index });
  }
  const items: AttachmentHeading[] = [];
  if (!marks.length) {
    items.push({ heading: '(start)', index: 0, chars: text.length });
  } else {
    if (marks[0].index > 0) {
      items.push({ heading: '(preamble)', index: 0, chars: marks[0].index });
    }
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      items.push({ heading: marks[i].heading, index: marks[i].index, chars: end - marks[i].index });
    }
  }
  if (items.length <= maxHeadings) return items;
  const picked: AttachmentHeading[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < maxHeadings; i++) {
    const idx = Math.round((i * (items.length - 1)) / (maxHeadings - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(items[idx]);
  }
  return picked;
}

export function summarizeAttachmentMarkdown(
  md: string,
  opts: { excerptChars?: number; maxHeadings?: number } = {}
): {
  chars: number;
  headings: Array<AttachmentHeading & { excerpt: string }>;
} {
  const excerptChars = opts.excerptChars ?? 180;
  const headings = attachmentOutline(md, opts.maxHeadings ?? ATTACH_OUTLINE_MAX).map((h) => {
    const raw = md.slice(h.index, h.index + h.chars);
    const excerpt = raw
      .replace(/^#+\s+.+\n*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, excerptChars);
    return { ...h, excerpt };
  });
  return { chars: md.length, headings };
}

/** Model prompt: inline small files; large files get a heading index (tools read the rest). */
export function formatAttachedDocsForModel(docs: ChatDocument[]): string {
  if (!docs.length) return '';
  const parts = docs.map((d) => {
    if (d.markdown.length <= CHAT_INLINE_DOC_CHARS) {
      return `### ${d.name}\n\n${d.markdown}`;
    }
    const outline = attachmentOutline(d.markdown);
    const lines = outline
      .map((h) => `- ${h.heading}  @${h.index} (${h.chars.toLocaleString()} chars)`)
      .join('\n');
    return `### ${d.name}\n${d.title ? `Title: ${d.title}\n` : ''}${d.markdown.length.toLocaleString()} characters — too large to dump. grep_attachment / read_attachment (start_from = heading @index, max_chars ≤ ${ATTACH_READ_MAX_CHARS}) / summarize_attachment with file="${d.name}".\n\nHeadings:\n${lines}`;
  });
  return `\n\n${ATTACHED_DOCS_MARKER}\n## Attached documents (this turn, not knowledge)
Small files are inlined. Large files: summarize_attachment → grep_attachment → read_attachment. Do not guess unread pages. Save with add_document from_attachment = filename (full text, not a slice).

${parts.join('\n\n')}`;
}

export function stripAttachedDocsForDisplay(text: string): string {
  const i = text.indexOf(ATTACHED_DOCS_MARKER);
  if (i < 0) return text;
  return text.slice(0, i).replace(/\s+$/, '');
}

export function attachedDocNamesFromContent(text: string): string[] {
  const i = text.indexOf(ATTACHED_DOCS_MARKER);
  if (i < 0) return [];
  const names: string[] = [];
  for (const m of text.slice(i).matchAll(/^### (?!#)(.+)$/gm)) {
    const name = m[1].trim();
    if (name) names.push(name);
  }
  return names;
}

export function matchTurnDocument(
  docs: ChatDocument[],
  fromAttachment: string
): ChatDocument | undefined {
  const needle = fromAttachment.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    docs.find((d) => d.name.toLowerCase() === needle) ??
    docs.find((d) => d.name.toLowerCase().endsWith(needle)) ??
    docs.find((d) => needle.endsWith(d.name.toLowerCase()))
  );
}
