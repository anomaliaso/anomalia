/** Sources cited under a chat assistant reply — built from real tool results, never invented. */

export type ChatSource =
  | { kind: 'web'; label: string; url: string; snippet?: string }
  | {
      kind: 'knowledge';
      label: string;
      documentId: string;
      chunkId?: string;
      headingPath?: string;
    }
  | {
      kind: 'brand';
      label: string;
      entity:
        | 'strategy'
        | 'plan'
        | 'post'
        | 'product'
        | 'competitor'
        | 'person'
        | 'article'
        | 'media'
        | 'seo';
      href: string;
      id?: string;
    }
  | { kind: 'social'; label: string; url: string; platform: string }
  | { kind: 'memory'; label: string; memoryId: string; layer: 'session' | 'project' }
  | { kind: 'drive'; label: string; url: string }
  | { kind: 'notion'; label: string; url: string };

const MAX_SOURCES = 12;

type SourceMapper = (out: unknown, brandSlug: string) => ChatSource[];

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Declarative tool → sources. Unmapped tools produce nothing (no inventing defaults). */
const SOURCE_MAP: Record<string, SourceMapper> = {
  search_web: (out) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const citations = Array.isArray(o.citations) ? o.citations : [];
    return citations
      .map((c) => {
        const row = asRec(c);
        if (!row) return null;
        const url = str(row.uri || row.url);
        if (!url) return null;
        return {
          kind: 'web' as const,
          label: str(row.title) || url,
          url,
          snippet: str(row.snippet) || undefined
        };
      })
      .filter((s) => s !== null) as ChatSource[];
  },

  search_knowledge: (out) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const results = Array.isArray(o.results) ? o.results : [];
    return results
      .map((r) => {
        const row = asRec(r);
        if (!row) return null;
        const documentId = str(row.documentId);
        if (!documentId) return null;
        const heading = str(row.headingPath);
        const title = str(row.title) || 'Document';
        return {
          kind: 'knowledge' as const,
          label: heading ? `${title} › ${heading}` : title,
          documentId,
          chunkId: str(row.chunkId) || undefined,
          headingPath: heading || undefined
        };
      })
      .filter((s) => s !== null) as ChatSource[];
  },

  read_document: (out) => {
    const o = asRec(out);
    if (!o || o.error || !str(o.id)) return [];
    return [
      {
        kind: 'knowledge',
        label: str(o.title) || 'Document',
        documentId: str(o.id)
      }
    ];
  },

  read_posts: (out, slug) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const posts = Array.isArray(o.posts) ? o.posts : [];
    if (!posts.length) return [];
    return [
      {
        kind: 'brand',
        entity: 'post',
        label: `${posts.length} post`,
        href: `/app/${slug}/calendar`
      }
    ];
  },

  read_strategy: (out, slug) => {
    const o = asRec(out);
    if (o?.error) return [];
    return [
      {
        kind: 'brand',
        entity: 'strategy',
        label: 'GTM strategy',
        href: `/app/${slug}/gtm`
      }
    ];
  },

  read_editorial_plan: (out, slug) => {
    const o = asRec(out);
    if (o?.error) return [];
    return [
      {
        kind: 'brand',
        entity: 'plan',
        label: 'Piano editoriale',
        href: `/app/${slug}/plan`
      }
    ];
  },

  read_competitors: (out, slug) => {
    const o = asRec(out);
    if (o?.error) return [];
    const list = Array.isArray(o?.competitors) ? o.competitors : [];
    if (!list.length && o && Object.keys(o).length === 0) {
      // empty object still means we read the table
    }
    return [
      {
        kind: 'brand',
        entity: 'competitor',
        label: list.length ? `${list.length} competitor` : 'Competitor',
        href: `/app/${slug}/competitors`
      }
    ];
  },

  read_products: (out, slug) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const products = Array.isArray(o.products) ? o.products : [];
    if (!products.length) return [];
    return [
      {
        kind: 'brand',
        entity: 'product',
        label: `${products.length} prodotti`,
        href: `/app/${slug}/settings/products`
      }
    ];
  },

  read_people: (out, slug) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const people = Array.isArray(o.people) ? o.people : [];
    if (!people.length) return [];
    return [
      {
        kind: 'brand',
        entity: 'person',
        label: `${people.length} persone`,
        href: `/app/${slug}/settings/people`
      }
    ];
  },

  read_seo_plan: (out, slug) => {
    const o = asRec(out);
    if (o?.error) return [];
    return [
      {
        kind: 'brand',
        entity: 'seo',
        label: 'SEO plan',
        href: `/app/${slug}/seo`
      }
    ];
  },

  list_articles: (out, slug) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const articles = Array.isArray(o.articles) ? o.articles : Array.isArray(o.items) ? o.items : [];
    if (!articles.length) return [];
    return [
      {
        kind: 'brand',
        entity: 'article',
        label: `Blog · ${articles.length}`,
        href: `/app/${slug}/site`
      }
    ];
  },

  sync_social_history: (out, slug) => {
    const o = asRec(out);
    if (!o || o.error || !o.success) return [];
    const n = typeof o.posts_synced === 'number' ? o.posts_synced : 0;
    return [
      {
        kind: 'social',
        label: n > 0 ? `${n} post social` : 'Social sync',
        url: `/app/${slug}/calendar`,
        platform: 'synced'
      }
    ];
  },

  read_memory: (out) => {
    const o = asRec(out);
    if (!o || o.error) return [];
    const entries = Array.isArray(o.entries) ? o.entries : [];
    return entries
      .slice(0, 5)
      .map((e) => {
        const row = asRec(e);
        if (!row || !str(row.id)) return null;
        return {
          kind: 'memory' as const,
          label: str(row.key) || str(row.value).slice(0, 48) || 'memory',
          memoryId: str(row.id),
          layer: row.layer === 'session' ? ('session' as const) : ('project' as const)
        };
      })
      .filter((s): s is ChatSource & { kind: 'memory' } => !!s);
  }
};

function sourceKey(s: ChatSource): string {
  if (s.kind === 'web' || s.kind === 'social' || s.kind === 'drive' || s.kind === 'notion') {
    return `${s.kind}:${s.url}`;
  }
  if (s.kind === 'knowledge') return `knowledge:${s.documentId}:${s.chunkId ?? ''}`;
  if (s.kind === 'brand') return `brand:${s.href}:${s.id ?? ''}`;
  return `memory:${s.memoryId}`;
}

/**
 * Walk AI SDK steps and collect sources from mapped tool results.
 * Cap 12, deduped. Unknown tools → no sources.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sourcesFromSteps(steps: any[], brandSlug: string): ChatSource[] {
  if (!brandSlug || !Array.isArray(steps) || !steps.length) return [];

  const outputByCallId = new Map<string, unknown>();
  for (const r of steps.flatMap((s) => s.toolResults ?? [])) {
    outputByCallId.set(r.toolCallId, r.output ?? r.result);
  }

  const out: ChatSource[] = [];
  const seen = new Set<string>();

  for (const tc of steps.flatMap((s) => s.toolCalls ?? [])) {
    const name = String(tc.toolName ?? '');
    const mapper = SOURCE_MAP[name];
    if (!mapper) continue;
    const result = outputByCallId.get(tc.toolCallId);
    if (result == null) continue;
    for (const src of mapper(result, brandSlug)) {
      const key = sourceKey(src);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(src);
      if (out.length >= MAX_SOURCES) return out;
    }
  }

  return out;
}

/** True when a JSON value looks like a ChatSource (for UI hydration). */
export function isChatSource(v: unknown): v is ChatSource {
  const o = asRec(v);
  if (!o || typeof o.kind !== 'string' || typeof o.label !== 'string') return false;
  switch (o.kind) {
    case 'web':
    case 'social':
    case 'drive':
    case 'notion':
      return typeof o.url === 'string';
    case 'knowledge':
      return typeof o.documentId === 'string';
    case 'brand':
      return typeof o.href === 'string' && typeof o.entity === 'string';
    case 'memory':
      return typeof o.memoryId === 'string';
    default:
      return false;
  }
}

export function parseChatSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isChatSource).slice(0, MAX_SOURCES);
}
