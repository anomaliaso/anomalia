import { describe, expect, it } from 'vitest';
import {
  connectableCatalog,
  inferConnectorKind,
  isConnectorKind,
  listedForToolkit,
  normalizeToolkitSlug,
  parseToolkitsPayload,
  searchCatalog,
  splitByKind,
  toCatalogItem
} from './composio-catalog';

const catalog = parseToolkitsPayload([
  { slug: 'NOTION', name: 'Notion', logo: 'https://logo/notion.png' },
  { slug: 'NOTION_ADMIN', name: 'Notion Admin' },
  { slug: 'ONENOTE', name: 'OneNote' },
  { slug: 'HUBSPOT', name: 'HubSpot' },
  { slug: 'GOOGLEDRIVE', name: 'Google Drive' }
]);

describe('toolkit slugs', () => {
  it('normalizes user input to the Composio shape', () => {
    expect(normalizeToolkitSlug(' google-drive ')).toBe('GOOGLE_DRIVE');
    expect(normalizeToolkitSlug('hubspot')).toBe('HUBSPOT');
  });

  it('labels the toolkits we ingest and falls back to the slug', () => {
    expect(listedForToolkit('GOOGLEDRIVE').displayName).toBe('Google Drive');
    expect(listedForToolkit('acme_crm').displayName).toBe('ACME_CRM');
  });
});

describe('connector kind', () => {
  it('is derived from the slug, never stored', () => {
    expect(inferConnectorKind('NOTION')).toBe('app');
    expect(inferConnectorKind('GMAIL')).toBe('app');
    expect(inferConnectorKind('HUBSPOT')).toBe('mcp');
    expect(isConnectorKind('app')).toBe(true);
    expect(isConnectorKind('sync')).toBe(false);
    expect(toCatalogItem(listedForToolkit('NOTION')).knowledgeProvider).toBe('notion');
    expect(toCatalogItem(listedForToolkit('HUBSPOT')).knowledgeProvider).toBeNull();
  });
});

describe('parseToolkitsPayload', () => {
  it('keeps every toolkit Composio returns, sorted, deduplicated', () => {
    const items = parseToolkitsPayload([
      { slug: 'ZOOM', name: 'Zoom' },
      { slug: 'ASANA', name: 'Asana' },
      { slug: 'ASANA', name: 'Asana duplicate' },
      { slug: '', name: 'nameless' },
      null
    ]);
    expect(items.map((i) => i.toolkitSlug)).toEqual(['ASANA', 'ZOOM']);
  });

  it('carries the logo and the managed-auth flag', () => {
    const notion = catalog.find((i) => i.toolkitSlug === 'NOTION');
    expect(notion).toMatchObject({ logo: 'https://logo/notion.png', managedAuth: true });
  });
});

describe('searchCatalog', () => {
  it('ranks an exact match first, then prefixes, then substrings', () => {
    expect(searchCatalog(catalog, 'notion').map((i) => i.toolkitSlug)).toEqual([
      'NOTION',
      'NOTION_ADMIN'
    ]);
    expect(searchCatalog(catalog, 'note').map((i) => i.toolkitSlug)).toEqual(['ONENOTE']);
  });

  it('returns the whole catalog for an empty query', () => {
    expect(searchCatalog(catalog, '   ')).toHaveLength(catalog.length);
    expect(searchCatalog(catalog, '', 2)).toHaveLength(2);
  });

  it('finds a toolkit by slug as well as by name', () => {
    expect(searchCatalog(catalog, 'hubspot').map((i) => i.displayName)).toEqual(['HubSpot']);
  });
});

describe('splitByKind', () => {
  it('separates the toolkits we ingest from the rest without dropping any', () => {
    const { apps, mcps } = splitByKind(catalog);
    expect(apps.map((i) => i.toolkitSlug)).toEqual(['GOOGLEDRIVE', 'NOTION']);
    expect(apps.length + mcps.length).toBe(catalog.length);
  });
});

describe('connectableCatalog', () => {
  const items = parseToolkitsPayload([
    { slug: 'NOTION', name: 'Notion', managedAuth: true },
    { slug: 'METAADS', name: 'Meta Ads', managedAuth: false },
    { slug: 'SHOPIFY', name: 'Shopify', managedAuth: false }
  ]);

  it('drops toolkits Composio does not manage and we have no credentials for', () => {
    expect(connectableCatalog(items).map((i) => i.toolkitSlug)).toEqual(['NOTION']);
  });

  it('keeps one we created an auth config for', () => {
    expect(connectableCatalog(items, new Set(['SHOPIFY'])).map((i) => i.toolkitSlug)).toEqual([
      'NOTION',
      'SHOPIFY'
    ]);
  });

  it('keeps one this brand already connected, whatever its auth story', () => {
    expect(
      connectableCatalog(items, new Set(), new Set(['METAADS'])).map((i) => i.toolkitSlug)
    ).toEqual(['METAADS', 'NOTION']);
  });
});
