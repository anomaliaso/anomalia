/** Client-safe Notion page/database selection for a brand. */

export const NOTION_PAGE_LIMIT = 8;

export type NotionScopeKind = 'page' | 'database';

export type NotionPageOption = { id: string; title: string; kind: NotionScopeKind };

export function normalizeNotionId(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const dashed = t.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (dashed) return dashed[0].toLowerCase();
  const hex = t.match(/^[0-9a-f]{32}$/i);
  if (!hex) return null;
  const h = hex[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function asPage(raw: unknown): NotionPageOption | null {
  if (typeof raw === 'string') {
    const tab = raw.indexOf('\t');
    const idPart = tab === -1 ? raw : raw.slice(0, tab);
    const rest = tab === -1 ? '' : raw.slice(tab + 1);
    const kindPart = rest.includes('\t') ? rest.slice(0, rest.indexOf('\t')) : '';
    const titlePart = rest.includes('\t') ? rest.slice(rest.indexOf('\t') + 1) : rest;
    const id = normalizeNotionId(idPart);
    if (!id) return null;
    const kind: NotionScopeKind = kindPart === 'database' ? 'database' : 'page';
    const title = titlePart.trim() || id;
    return { id, title, kind };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as { id?: unknown; title?: unknown; name?: unknown; kind?: unknown };
  const id = typeof o.id === 'string' ? normalizeNotionId(o.id) : null;
  if (!id) return null;
  const kind: NotionScopeKind = o.kind === 'database' ? 'database' : 'page';
  const title =
    (typeof o.title === 'string' && o.title.trim()) ||
    (typeof o.name === 'string' && o.name.trim()) ||
    id;
  return { id, title, kind };
}

export function parseNotionPageSelection(settings: unknown): NotionPageOption[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const pages = (settings as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const unique: NotionPageOption[] = [];
  for (const raw of pages) {
    const page = asPage(raw);
    if (!page || unique.some((p) => p.id === page.id)) continue;
    unique.push(page);
    if (unique.length >= NOTION_PAGE_LIMIT) break;
  }
  return unique;
}

export function notionNeedsPageSelection(settings: unknown): boolean {
  return parseNotionPageSelection(settings).length === 0;
}

export function parseNotionPageFormValues(raw: string[]): NotionPageOption[] {
  return parseNotionPageSelection({ pages: raw });
}

export function notionFormValue(item: NotionPageOption): string {
  return `${item.id}\t${item.kind}\t${item.title}`;
}

