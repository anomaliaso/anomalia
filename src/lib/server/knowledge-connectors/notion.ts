/** Notion block tree → markdown. Closed set of block types; unknown types are skipped. */
import { normalizeNotionId, type NotionScopeKind } from '$lib/notion-pages';

type RichText = { plain_text?: string; href?: string | null };

function plain(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return (rich as RichText[])
    .map((t) => {
      const s = String(t.plain_text ?? '');
      if (t.href) return `[${s}](${t.href})`;
      return s;
    })
    .join('');
}

export type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  [k: string]: unknown;
};

export function notionBlockToMarkdown(block: NotionBlock, depth = 0): string {
  const type = String(block.type ?? '');
  const inner = (block[type] && typeof block[type] === 'object'
    ? (block[type] as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const text = plain(inner.rich_text ?? inner.text);
  const indent = '  '.repeat(Math.max(0, depth));

  switch (type) {
    case 'paragraph':
      return text;
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `${indent}- ${text}`;
    case 'numbered_list_item':
      return `${indent}1. ${text}`;
    case 'to_do':
      return `${indent}- [${inner.checked ? 'x' : ' '}] ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'callout':
      return `> ${text}`;
    case 'code':
      return `\`\`\`${String(inner.language ?? '')}\n${text}\n\`\`\``;
    case 'divider':
      return '---';
    case 'bookmark':
    case 'link_preview':
    case 'embed': {
      const url = String(inner.url ?? '');
      return url ? `[${text || url}](${url})` : text;
    }
    case 'child_page':
      return `## ${String(inner.title ?? (text || 'Page'))}`;
    case 'child_database':
      return `## ${String(inner.title ?? 'Database')}`;
    default:
      return text;
  }
}

export function notionBlocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const line = notionBlockToMarkdown(b).trim();
    if (line) lines.push(line);
  }
  return lines.join('\n\n').trim();
}

export function parseNotionSearch(data: unknown): {
  pages: Array<{ id: string; title: string; url: string | null }>;
  nextCursor: string | null;
} {
  const picker = parseNotionPickerResults(data);
  return {
    pages: picker.items
      .filter((i) => i.kind === 'page')
      .map((i) => ({ id: i.id, title: i.title, url: i.url })),
    nextCursor: picker.nextCursor
  };
}

function rBool(v: unknown): boolean {
  return v === true;
}

export function notionPageTitle(page: Record<string, unknown>): string {
  const props = page.properties && typeof page.properties === 'object'
    ? (page.properties as Record<string, unknown>)
    : {};
  for (const val of Object.values(props)) {
    if (!val || typeof val !== 'object') continue;
    const p = val as Record<string, unknown>;
    if (p.type === 'title') {
      const t = plain(p.title);
      if (t) return t;
    }
  }
  return 'Untitled';
}

export function parseNotionUser(data: unknown): string | null {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const name = String(o.name ?? '').trim();
  const person = o.person && typeof o.person === 'object' ? (o.person as Record<string, unknown>) : null;
  const email = String(person?.email ?? '').trim();
  return email || name || null;
}

export function parseNotionChildren(data: unknown): { blocks: NotionBlock[]; nextCursor: string | null } {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(o.results) ? o.results : [];
  const blocks: NotionBlock[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') blocks.push(item as NotionBlock);
  }
  return {
    blocks,
    nextCursor: o.has_more && o.next_cursor ? String(o.next_cursor) : null
  };
}

export type NotionPickerItem = {
  id: string;
  title: string;
  url: string | null;
  kind: NotionScopeKind;
  parentId: string | null;
};

export function parseNotionPickerResults(data: unknown): {
  items: NotionPickerItem[];
  nextCursor: string | null;
} {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(o.results) ? o.results : [];
  const items: NotionPickerItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const object = String(r.object ?? 'page');
    if (object !== 'page' && object !== 'database') continue;
    const kind: NotionScopeKind = object === 'database' ? 'database' : 'page';
    const id = normalizeNotionId(String(r.id ?? '')) ?? String(r.id ?? '').trim();
    if (!id) continue;
    items.push({
      id,
      title: kind === 'database' ? notionDatabaseTitle(r) : notionPageTitle(r),
      url: r.url ? String(r.url) : null,
      kind,
      parentId: parseNotionParentId(r)
    });
  }
  return {
    items,
    nextCursor: rBool(o.has_more) && o.next_cursor ? String(o.next_cursor) : null
  };
}

export function notionDatabaseTitle(db: Record<string, unknown>): string {
  const t = plain(db.title);
  return t || 'Untitled';
}

export function parseNotionParentId(page: Record<string, unknown>): string | null {
  const parent = page.parent && typeof page.parent === 'object' ? (page.parent as Record<string, unknown>) : {};
  const type = String(parent.type ?? '');
  if (type === 'page_id') return String(parent.page_id ?? '').trim() || null;
  if (type === 'database_id') return String(parent.database_id ?? '').trim() || null;
  if (type === 'block_id') return String(parent.block_id ?? '').trim() || null;
  return null;
}

export function selectedNotionIdSet(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const n = normalizeNotionId(id);
    if (n) out.add(n);
  }
  return out;
}

export function notionItemInScope(id: string, parentId: string | null, selected: Set<string>): boolean {
  const nid = normalizeNotionId(id);
  if (nid && selected.has(nid)) return true;
  const pid = parentId ? normalizeNotionId(parentId) : null;
  return !!(pid && selected.has(pid));
}
