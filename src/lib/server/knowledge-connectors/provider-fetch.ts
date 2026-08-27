/**
 * Shared provider HTTP + Drive/Notion → markdown.
 * Used by periodic ingest and by live chat reads.
 *
 * Every provider call goes through the Composio proxy: Composio injects the connection's
 * credentials server-side, so no access token is ever held, logged, or passed around here.
 */
import { toMarkdown } from '$lib/server/knowledge';
import { composioProxy } from '$lib/server/composio';
import { driveExportMime, type DriveFile } from './drive';
import { notionBlocksToMarkdown, parseNotionChildren, type NotionBlock } from './notion';

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const NOTION_VERSION = { 'Notion-Version': '2022-06-28' };

/** Handle for one brand's connection to a provider. Replaces the raw OAuth token. */
export type ProviderAuth = {
  connectedAccountId: string;
  /** Composio toolkit slug — kept for error messages and for callers that branch per provider. */
  toolkit: string;
};

export function providerAuth(connectedAccountId: string, toolkit: string): ProviderAuth {
  return { connectedAccountId, toolkit };
}

function failed(url: string, status: number, body: unknown): Error {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return new Error(`${url} failed (${status}): ${text.slice(0, 200)}`);
}

export async function providerGetJson(
  url: string,
  auth: ProviderAuth,
  extra?: Record<string, string>
): Promise<unknown> {
  const res = await composioProxy({
    connectedAccountId: auth.connectedAccountId,
    endpoint: url,
    method: 'GET',
    headers: extra,
    timeoutMs: 25_000
  });
  if (res.status === 404) return null;
  if (!res.ok) throw failed(url, res.status, res.data);
  return res.data;
}

export async function providerPostJson(
  url: string,
  auth: ProviderAuth,
  body: unknown,
  extra?: Record<string, string>
): Promise<unknown> {
  const res = await composioProxy({
    connectedAccountId: auth.connectedAccountId,
    endpoint: url,
    method: 'POST',
    body,
    headers: extra,
    timeoutMs: 25_000
  });
  if (res.status === 404) return null;
  if (!res.ok) throw failed(url, res.status, res.data);
  return res.data;
}

/**
 * Binary responses do not come back inline: the proxy stores them and returns a short-lived
 * download URL, which needs no credentials of its own.
 */
export async function providerGetBuffer(
  url: string,
  auth: ProviderAuth,
  extra?: Record<string, string>
): Promise<ArrayBuffer> {
  const res = await composioProxy({
    connectedAccountId: auth.connectedAccountId,
    endpoint: url,
    method: 'GET',
    headers: extra,
    timeoutMs: 40_000
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  if (res.binary?.url) {
    if (res.binary.size > 20 * 1024 * 1024) throw new Error('File exceeds 20 MB limit.');
    const file = await fetch(res.binary.url, { signal: AbortSignal.timeout(40_000) });
    if (!file.ok) throw new Error(`Download failed (${file.status})`);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) throw new Error('File exceeds 20 MB limit.');
    return buf;
  }
  // Text payloads (plain text, CSV, JSON exports) come back inline instead.
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
  const buf = new TextEncoder().encode(text);
  if (buf.byteLength > 20 * 1024 * 1024) throw new Error('File exceeds 20 MB limit.');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function driveFileToMarkdown(
  file: DriveFile,
  auth: ProviderAuth
): Promise<string | null> {
  const exportMime = driveExportMime(file.mimeType);
  if (exportMime) {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}`;
    const buf = await providerGetBuffer(url, auth);
    if (buf.byteLength > MAX_TEXT_BYTES && exportMime !== 'application/pdf') {
      return new TextDecoder().decode(buf.slice(0, MAX_TEXT_BYTES)).trim() + '\n\n_Truncated._';
    }
    const converted = await toMarkdown(buf, exportMime, file.name);
    return converted.markdown;
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;
  const buf = await providerGetBuffer(url, auth);
  const converted = await toMarkdown(buf, file.mimeType, file.name);
  return converted.markdown;
}

export async function notionPageMarkdown(pageId: string, auth: ProviderAuth): Promise<string> {
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 8; i++) {
    const url =
      `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children?page_size=100` +
      (cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '');
    const data = await providerGetJson(url, auth, NOTION_VERSION);
    const parsed = parseNotionChildren(data);
    blocks.push(...parsed.blocks);
    cursor = parsed.nextCursor;
    if (!cursor) break;
  }
  return notionBlocksToMarkdown(blocks);
}
