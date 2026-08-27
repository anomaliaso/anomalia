/** Client-safe connector catalog: the Composio toolkit list, as-is. */

import { providerForToolkit, type KnowledgeProvider } from '$lib/knowledge-providers';

export const CONNECTOR_KINDS = ['app', 'mcp'] as const;
/**
 * `app` — a toolkit we also ingest into the brand corpus (Drive, Notion, GitHub, Gmail).
 * `mcp` — every other toolkit: connectable, and its tools are callable by the chat agent.
 *
 * This is derived from the toolkit slug, not stored: with Composio's managed auth there is
 * nothing to register per integration, so there is no catalog table and no allow list — the
 * catalog is whatever Composio answers.
 */
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

const KNOWN_NAMES: Record<string, string> = {
  GOOGLEDRIVE: 'Google Drive',
  NOTION: 'Notion',
  GITHUB: 'GitHub',
  GMAIL: 'Gmail'
};

export type ListedToolkit = {
  toolkitSlug: string;
  displayName: string;
  logo: string | null;
  /** Composio ships the OAuth app: connecting needs no credentials of ours. */
  managedAuth: boolean;
};

export type ConnectorCatalogItem = ListedToolkit & {
  kind: ConnectorKind;
  knowledgeProvider: KnowledgeProvider | null;
};

/**
 * Composio manages OAuth apps for most toolkits, but not all: the rest answer
 * "Default auth config not found for toolkit X" on the first connect. Those only belong in the
 * list once someone adds credentials for them in the Composio dashboard.
 */
export function connectableCatalog(
  items: ConnectorCatalogItem[],
  ownAuthConfigs: Set<string> = new Set(),
  keep: Set<string> = new Set()
): ConnectorCatalogItem[] {
  return items.filter(
    (item) =>
      item.managedAuth || ownAuthConfigs.has(item.toolkitSlug) || keep.has(item.toolkitSlug)
  );
}

/** What a connect flow hands back: an authorization URL to open, plus the account it created. */
export type ConnectStart = {
  authorizationUrl: string | null;
  connectedAccountId: string;
  expiresAt: string | null;
};

export function normalizeToolkitSlug(slug: string): string {
  return slug.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function listedForToolkit(toolkitSlug: string): ListedToolkit {
  const slug = normalizeToolkitSlug(toolkitSlug);
  return {
    toolkitSlug: slug,
    displayName: KNOWN_NAMES[slug] ?? slug,
    logo: null,
    managedAuth: true
  };
}

export function isConnectorKind(v: string): v is ConnectorKind {
  return v === 'app' || v === 'mcp';
}

/** A toolkit we ingest documents from is an app; anything else is agent tooling. */
export function inferConnectorKind(toolkitSlug: string): ConnectorKind {
  return providerForToolkit(toolkitSlug) ? 'app' : 'mcp';
}

export function toCatalogItem(listed: ListedToolkit): ConnectorCatalogItem {
  const kind = inferConnectorKind(listed.toolkitSlug);
  return {
    ...listed,
    kind,
    knowledgeProvider: kind === 'app' ? providerForToolkit(listed.toolkitSlug) : null
  };
}

export function parseToolkitsPayload(raw: unknown): ConnectorCatalogItem[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ConnectorCatalogItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const toolkitSlug = normalizeToolkitSlug(String(r.slug ?? r.toolkitSlug ?? ''));
    if (!toolkitSlug || seen.has(toolkitSlug)) continue;
    seen.add(toolkitSlug);
    out.push(
      toCatalogItem({
        toolkitSlug,
        displayName: String(r.name ?? r.displayName ?? toolkitSlug).trim() || toolkitSlug,
        logo: r.logo ? String(r.logo) : null,
        managedAuth: r.managedAuth !== false
      })
    );
  }
  return sortCatalog(out);
}

/** Alphabetical by display name — the catalog is a directory, not a ranking. */
export function sortCatalog(items: ConnectorCatalogItem[]): ConnectorCatalogItem[] {
  return [...items].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function splitByKind(items: ConnectorCatalogItem[]): {
  apps: ConnectorCatalogItem[];
  mcps: ConnectorCatalogItem[];
} {
  return {
    apps: items.filter((i) => i.kind === 'app'),
    mcps: items.filter((i) => i.kind === 'mcp')
  };
}

/**
 * Search the catalog. An exact slug match wins, then a name prefix, then any substring — with
 * 1000+ toolkits, "notion" must not bury Notion under Notion-adjacent names.
 */
export function searchCatalog(
  items: ConnectorCatalogItem[],
  query: string,
  limit?: number
): ConnectorCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return limit ? items.slice(0, limit) : items;
  const scored: { item: ConnectorCatalogItem; rank: number }[] = [];
  for (const item of items) {
    const slug = item.toolkitSlug.toLowerCase();
    const name = item.displayName.toLowerCase();
    const rank =
      slug === needle || name === needle
        ? 0
        : name.startsWith(needle) || slug.startsWith(needle)
          ? 1
          : name.includes(needle) || slug.includes(needle)
            ? 2
            : -1;
    if (rank < 0) continue;
    scored.push({ item, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.item.displayName.localeCompare(b.item.displayName));
  const ranked = scored.map((s) => s.item);
  return limit ? ranked.slice(0, limit) : ranked;
}
