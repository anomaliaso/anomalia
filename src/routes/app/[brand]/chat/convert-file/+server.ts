import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  chatConvertMarkdownPath,
  isChatConvertStoragePath,
  isConvertibleDocument,
  isImageOrMediaFile,
  MAX_CHAT_CONVERT_BYTES
} from '$lib/chat-documents';
import { convertFileToMarkdown } from '$lib/server/file-to-markdown';

export const config = { maxDuration: 300 };

const BUCKET = 'brand-knowledge';
const LIMIT_MB = Math.round(MAX_CHAT_CONVERT_BYTES / (1024 * 1024));

/**
 * Convert a file the client already uploaded to Storage into markdown for the chat composer.
 * Same pattern as Knowledge ingest: bytes never go through the Vercel function body (~4.5 MB).
 * Does NOT ingest into brand knowledge — the agent decides via add_document.
 * The original binary under `{user}/{brand}/chat-convert/` is always deleted after conversion.
 * Converted markdown is stored next to it (`….md`) so a 100 MB PDF does not round-trip through JSON.
 */
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  let body: { path?: unknown; fileName?: unknown; mimeType?: unknown; bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Expected JSON { path, fileName, mimeType }');
  }

  const path = typeof body.path === 'string' ? body.path : '';
  const name = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'document';
  const mime = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType : 'application/octet-stream';
  const declaredBytes = typeof body.bytes === 'number' ? body.bytes : Number(body.bytes) || 0;

  if (!isChatConvertStoragePath(path, user.id, brand.id)) {
    throw error(400, 'Invalid file path');
  }
  if (isImageOrMediaFile(mime, name)) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error(400, 'Images and video stay as visual attachments — they are not converted to markdown.');
  }
  if (!isConvertibleDocument(mime, name)) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error(400, 'Unsupported file. Use PDF, Word, Excel, HTML, CSV, TXT, Markdown, XML, notebook or ZIP.');
  }
  if (declaredBytes > MAX_CHAT_CONVERT_BYTES) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error(413, `File exceeds ${LIMIT_MB} MB limit.`);
  }

  const dl = await supabase.storage.from(BUCKET).download(path);
  try {
    if (dl.error || !dl.data) throw error(400, dl.error?.message ?? 'Download failed');
    const buf = await dl.data.arrayBuffer();
    if (!buf.byteLength) throw error(400, 'Empty file');
    if (buf.byteLength > MAX_CHAT_CONVERT_BYTES) {
      throw error(413, `File exceeds ${LIMIT_MB} MB limit.`);
    }
    const converted = await convertFileToMarkdown(buf, mime, name);
    const mdPath = chatConvertMarkdownPath(path);
    const up = await supabase.storage.from(BUCKET).upload(mdPath, Buffer.from(converted.markdown, 'utf8'), {
      contentType: 'text/markdown; charset=utf-8',
      upsert: false
    });
    if (up.error) throw error(500, up.error.message);
    return json({
      name,
      title: converted.title ?? null,
      pages: converted.pages ?? null,
      chars: converted.markdown.length,
      path: mdPath
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    const message = e instanceof Error ? e.message : 'Conversion failed';
    throw error(422, message);
  } finally {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
  }
};
