/** Notion picker listing + scoped page collection (uses provider HTTP). */
import { normalizeNotionId, type NotionPageOption } from '$lib/notion-pages';
import { parseNotionChildren, parseNotionPickerResults, parseNotionSearch, selectedNotionIdSet, type NotionPickerItem } from './notion';
import {
  NOTION_VERSION,
  providerGetJson,
  providerPostJson,
  type ProviderAuth
} from './provider-fetch';

async function notionSearch(
  auth: ProviderAuth,
  body: Record<string, unknown>
): Promise<unknown> {
  return providerPostJson('https://api.notion.com/v1/search', auth, body, NOTION_VERSION);
}

export async function listNotionPickerItems(auth: ProviderAuth): Promise<NotionPageOption[]> {
  const items: NotionPickerItem[] = [];
  for (const filter of [{ value: 'page', property: 'object' }, { value: 'database', property: 'object' }] as const) {
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const data = await notionSearch(auth, {
        filter,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {})
      });
      const parsed = parseNotionPickerResults(data);
      items.push(...parsed.items);
      cursor = parsed.nextCursor;
      if (!cursor) break;
    }
  }
  const unique: NotionPageOption[] = [];
  for (const item of items) {
    const id = normalizeNotionId(item.id) ?? item.id;
    if (unique.some((u) => u.id === id)) continue;
    unique.push({ id, title: item.title, kind: item.kind });
  }
  unique.sort((a, b) => a.title.localeCompare(b.title));
  return unique;
}

export type ScopedNotionPage = { id: string; title: string; url: string | null };

export async function collectNotionScopedPages(
  auth: ProviderAuth,
  selected: NotionPageOption[],
  cap: number
): Promise<ScopedNotionPage[]> {
  const out: ScopedNotionPage[] = [];
  const seen = selectedNotionIdSet(selected.map((s) => s.id));
  const processed = new Set<string>();
  const queue: NotionPageOption[] = [...selected];

  while (queue.length && out.length < cap) {
    const next = queue.shift();
    if (!next) break;
    const id = normalizeNotionId(next.id) ?? next.id;
    if (processed.has(id)) continue;
    processed.add(id);
    if (next.kind === 'database') {
      const pages = await queryNotionDatabase(auth, id, cap - out.length);
      for (const page of pages) {
        const pid = normalizeNotionId(page.id) ?? page.id;
        if (seen.has(pid) && out.some((p) => p.id === pid)) continue;
        seen.add(pid);
        out.push(page);
        if (out.length >= cap) break;
      }
      continue;
    }
    if (!out.some((p) => p.id === id)) {
      const meta = await providerGetJson(
        `https://api.notion.com/v1/pages/${encodeURIComponent(id)}`,
        auth,
        NOTION_VERSION
      );
      const rec = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null;
      out.push({
        id,
        title: next.title,
        url: rec?.url ? String(rec.url) : `https://www.notion.so/${id.replace(/-/g, '')}`
      });
    }
    if (out.length >= cap) break;
    const children = await listChildPages(auth, id);
    for (const child of children) {
      const cid = normalizeNotionId(child.id) ?? child.id;
      if (seen.has(cid)) continue;
      seen.add(cid);
      queue.push({ id: cid, title: child.title, kind: 'page' });
    }
  }

  return out.slice(0, cap);
}

async function queryNotionDatabase(auth: ProviderAuth, databaseId: string, cap: number): Promise<ScopedNotionPage[]> {
  const pages: ScopedNotionPage[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 4 && pages.length < cap; i++) {
    let raw: unknown;
    try {
      raw = await providerPostJson(
        `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`,
        auth,
        { page_size: 50, ...(cursor ? { start_cursor: cursor } : {}) },
        NOTION_VERSION
      );
    } catch (e) {
      console.error('[notion-scope] database query', databaseId, e);
      break;
    }
    const parsed = parseNotionSearch(raw);
    pages.push(...parsed.pages);
    cursor = parsed.nextCursor;
    if (!cursor) break;
  }
  return pages.slice(0, cap);
}

async function listChildPages(auth: ProviderAuth, pageId: string): Promise<ScopedNotionPage[]> {
  const pages: ScopedNotionPage[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 4; i++) {
    const url =
      `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children?page_size=100` +
      (cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '');
    const data = await providerGetJson(url, auth, NOTION_VERSION);
    const parsed = parseNotionChildren(data);
    for (const block of parsed.blocks) {
      if (String(block.type ?? '') !== 'child_page') continue;
      const id = normalizeNotionId(String(block.id ?? '')) ?? String(block.id ?? '').trim();
      if (!id) continue;
      const inner = block.child_page && typeof block.child_page === 'object'
        ? (block.child_page as Record<string, unknown>)
        : {};
      pages.push({
        id,
        title: String(inner.title ?? 'Untitled'),
        url: `https://www.notion.so/${id.replace(/-/g, '')}`
      });
    }
    cursor = parsed.nextCursor;
    if (!cursor) break;
  }
  return pages;
}

