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
    description: 'Full studio dump: kit, people, documents, competitors, products, history summary.',
    properties: { slug: SLUG_PROPERTY },
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

  test('nessuna di esse è dichiarata due volte', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toEqual([...new Set(names)]);
  });
});
