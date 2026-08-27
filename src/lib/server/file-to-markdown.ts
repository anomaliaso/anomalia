/**
 * Convert uploaded files to markdown via markitdown-ts, with the existing
 * knowledge converters as fallback when markitdown fails (empty PDF, Vercel quirks).
 */
import { MarkItDown } from 'markitdown-ts';
import {
  dottedExtension,
  fileExt,
  isConvertibleDocument
} from '$lib/chat-documents';

export type ConvertedMarkdown = {
  markdown: string;
  title?: string | null;
  pages?: number;
};

function asBuffer(buf: ArrayBuffer | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(buf)) return buf;
  return Buffer.from(buf);
}

/**
 * markitdown-ts only. Throws or returns empty — callers fall back.
 * Images/audio are EXIF-only in this library; chat skips those entirely.
 */
export async function convertWithMarkitdown(
  buf: ArrayBuffer | Uint8Array | Buffer,
  mime: string,
  name: string
): Promise<ConvertedMarkdown> {
  const file_extension = dottedExtension(name, mime);
  if (!file_extension) {
    throw new Error(`Unsupported document type: ${mime || name}`);
  }
  const markitdown = new MarkItDown();
  const result = await markitdown.convertBuffer(asBuffer(buf), { file_extension });
  const markdown = (result?.markdown ?? result?.text_content ?? '').trim();
  if (!markdown) throw new Error('No extractable text in this file.');
  return {
    markdown,
    title: result?.title ?? null
  };
}

/**
 * Primary converter for chat + knowledge ingest.
 * Pass-through for txt/md; keep our CSV table + truncation; markitdown for the rest.
 */
export async function convertFileToMarkdown(
  buf: ArrayBuffer,
  mime: string,
  name: string
): Promise<ConvertedMarkdown> {
  if (!isConvertibleDocument(mime, name)) {
    throw new Error(`Unsupported document type: ${mime || name}`);
  }

  const { toMarkdownFallback } = await import('$lib/server/knowledge');
  const e = fileExt(name);
  const isPdf = e === 'pdf' || mime === 'application/pdf';
  // Large PDFs: extract page-by-page (unpdf) instead of one-shot markitdown/pdf-parse,
  // then the chat packer splits the markdown into chunks for the model.
  const LARGE_PDF_BYTES = 4 * 1024 * 1024;
  if (isPdf && buf.byteLength >= LARGE_PDF_BYTES) {
    try {
      return await toMarkdownFallback(buf, mime, name);
    } catch (err) {
      console.warn(
        '[file-to-markdown] page-wise PDF failed, trying markitdown',
        name,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Cheap, stable paths — also what knowledge.test.ts pins.
  if (e === 'txt' || e === 'md' || e === 'markdown' || mime === 'text/plain' || mime === 'text/markdown') {
    return toMarkdownFallback(buf, mime, name);
  }
  if (e === 'csv' || mime === 'text/csv') {
    return toMarkdownFallback(buf, mime, name);
  }

  try {
    return await convertWithMarkitdown(buf, mime, name);
  } catch (err) {
    console.warn(
      '[file-to-markdown] markitdown-ts failed, falling back',
      name,
      err instanceof Error ? err.message : err
    );
  }

  return toMarkdownFallback(buf, mime, name);
}
