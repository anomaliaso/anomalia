import { describe, expect, test } from 'bun:test';
import { BRAND_ENDPOINTS } from '../lib/contracts/index.ts';
import { handleMcpFetch } from './http-app.ts';

const SLUG_PROPERTY = { type: 'string', minLength: 1, description: 'Brand URL slug' };

const MIGRATED_READS = [
  {
    name: 'get_plan',
    title: 'Editorial plan',
    description: 'View active editorial plan and any pending proposal.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_weekly_plan',
    title: 'Weekly plan',
    description: 'View weekly plan seeds and related posts.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_studio',
    title: 'Studio',
    // Cambiata di proposito, due volte: l'elenco dei documenti dice se sono stati digeriti, e il
    // testo non viaggia più per difetto — `documents: "full"` lo restituisce a chi lo leggeva.
    description:
      'Full studio dump: kit, people, documents, competitors, products, history summary. ' +
      'Each document carries `status` and `chunkCount` (a document that is not `ready` with at least one chunk exists here but is invisible to `search_knowledge`) and `textBytes`, which says how much text it holds. ' +
      'The text itself is NOT included: to answer a question, ask `search_knowledge` — it returns the passages that answer it with the document each came from, instead of the whole corpus. ' +
      '`documents: "full"` restores the complete text of every document; it exists for callers that were reading it before and is almost never what you want.',
    properties: {
      slug: SLUG_PROPERTY,
      documents: {
        type: 'string',
        enum: ['index', 'full'],
        description: '`index` (default) lists documents without their text; `full` includes content_text',
      },
    },
    required: ['slug'],
  },
  {
    name: 'get_seo',
    title: 'SEO overview',
    description: 'Tech score, search performance, SEO grade and initiatives.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_geo',
    title: 'GEO overview',
    description: 'AI visibility: share of voice, citations, ready fixes.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_keywords',
    title: 'Keywords',
    description: 'Keyword strategy: volume, difficulty, opportunity, action.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_ads',
    title: 'Ads overview',
    description: 'Ad campaigns summary, candidates, and connected ad accounts.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'list_articles',
    title: 'List blog articles',
    description: 'List web/blog articles. status: draft, scheduled, published, or all.',
    properties: {
      slug: SLUG_PROPERTY,
      status: { type: 'string', enum: ['draft', 'scheduled', 'published', 'all'] },
    },
    required: ['slug'],
  },
  {
    name: 'get_analytics',
    title: 'Analytics',
    description: 'Brand analytics: totals, engagement, recent activity.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_gtm',
    title: 'GTM roadmap',
    description: 'View the go-to-market roadmap for a brand.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_voice',
    title: 'Voice rules',
    description: 'View brand voice framework and platform rules.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'list_products',
    title: 'List products',
    description: 'List products in the brand catalog.',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
] as const;

type Tool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
  annotations?: Record<string, unknown>;
};

async function rpc(method: string, params: unknown, id = 1) {
  const res = await handleMcpFetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
  );
  return (await res.json()) as { result?: Record<string, unknown> };
}

async function tools(): Promise<Tool[]> {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.1' },
  });
  const listed = await rpc('tools/list', {}, 2);
  return (listed.result?.tools ?? []) as Tool[];
}

const find = (all: Tool[], name: string): Tool => {
  const tool = all.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} non registrato`);
  return tool;
};

describe('le letture migrate sul registry', () => {
  test('restano identiche dall’esterno: titolo, descrizione, campi, obbligatori', async () => {
    const all = await tools();

    for (const expected of MIGRATED_READS) {
      const tool = find(all, expected.name);

      expect(tool.title, expected.name).toBe(expected.title);
      expect(tool.description, expected.name).toBe(expected.description);
      expect(tool.inputSchema?.properties, expected.name).toEqual(expected.properties);
      expect(tool.inputSchema?.required ?? [], expected.name).toEqual([...expected.required]);
    }
  });

  test('restano letture: readOnlyHint non si perde nella migrazione', async () => {
    const all = await tools();

    for (const { name } of MIGRATED_READS) {
      expect(find(all, name).annotations?.readOnlyHint, name).toBe(true);
    }
  });

  test('sono dichiarate nel registry, non registrate a mano', () => {
    const declared = BRAND_ENDPOINTS.map((e) => e.tool);

    for (const { name } of MIGRATED_READS) {
      expect(declared, name).toContain(name);
    }
  });

  test('ogni endpoint del registry esiste in tools/list come lo dichiara', async () => {
    const all = await tools();

    for (const endpoint of BRAND_ENDPOINTS) {
      const tool = find(all, endpoint.tool);

      expect(tool.title, endpoint.tool).toBe(endpoint.title);
      expect(tool.description, endpoint.tool).toBe(endpoint.description);
      expect(tool.annotations?.readOnlyHint, endpoint.tool).toBe(endpoint.method === 'GET');
      expect(tool.annotations?.destructiveHint, endpoint.tool).toBe(endpoint.destructive);
    }
  });

  test('nessuna di esse è dichiarata due volte', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toEqual([...new Set(names)]);
  });
});
