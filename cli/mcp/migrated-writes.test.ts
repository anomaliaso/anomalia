import { describe, expect, test } from 'bun:test';
import { BRAND_ENDPOINTS } from '../lib/contracts/index.ts';
import { handleMcpFetch } from './http-app.ts';

const SLUG = { type: 'string', minLength: 1, description: 'Brand URL slug' };

const NOT_DESTRUCTIVE = { readOnlyHint: false, destructiveHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true };
const OPEN_WORLD = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

// Ogni riga è la forma che il tool aveva scritto a mano, catturata da tools/list prima della
// migrazione. Una descrizione riscritta o un campo perso qui è una regressione, non una
// migrazione: chi ha già l'integrazione non deve accorgersi di niente.
const MIGRATED_WRITES = [
  {
    name: 'propose_plan',
    title: 'Propose editorial plan',
    description: 'Generate the first / a new editorial plan proposal.',
    properties: { slug: SLUG },
    required: ['slug'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'revise_plan',
    title: 'Revise editorial plan',
    description: 'Request a revision of the proposed plan with feedback.',
    properties: { slug: SLUG, feedback: { type: 'string', minLength: 1 } },
    required: ['slug', 'feedback'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'approve_plan',
    title: 'Approve editorial plan',
    description: 'Approve the proposed editorial plan.',
    properties: { slug: SLUG },
    required: ['slug'],
    annotations: DESTRUCTIVE,
  },
  {
    name: 'discard_plan',
    title: 'Discard editorial plan',
    description: 'Discard the proposed editorial plan.',
    properties: { slug: SLUG },
    required: ['slug'],
    annotations: DESTRUCTIVE,
  },
  {
    name: 'refresh_keywords',
    title: 'Refresh keywords',
    description: 'Regenerate keyword research for the brand.',
    properties: { slug: SLUG },
    required: ['slug'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'seo_action',
    title: 'SEO action',
    description:
      'Run SEO actions: run (tech audit), plan, more (append initiatives), asset, article. For asset/article pass initiativeId.',
    properties: {
      slug: SLUG,
      action: { type: 'string', enum: ['run', 'plan', 'more', 'asset', 'article'] },
      initiativeId: { type: 'string' },
      guidance: { type: 'string', description: 'Optional guidance when action=more' },
    },
    required: ['slug', 'action'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'geo_action',
    title: 'GEO action',
    description: 'Run GEO citation audit or generate fix artifacts.',
    properties: { slug: SLUG, action: { type: 'string', enum: ['audit', 'fix'] } },
    required: ['slug', 'action'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'update_brand_kit',
    title: 'Update brand kit',
    description: 'Update brand kit fields (about, category, audience, style, language).',
    properties: {
      slug: SLUG,
      about: { type: 'string' },
      category: { type: 'string' },
      target_audience: { type: 'string' },
      brand_style: { type: 'string' },
      language: { type: 'string' },
    },
    required: ['slug'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'update_voice',
    title: 'Update voice',
    description:
      'Patch brand voice fields (mood, tone, register, avoid list, platform instructions).',
    properties: {
      slug: SLUG,
      mood: { type: 'string' },
      tone: { type: 'string' },
      register: { type: 'number' },
      emotion: { type: 'string' },
      character: { type: 'string' },
      syntax: { type: 'string' },
      avoid: { type: 'array', items: { type: 'string' } },
      platform_instructions: {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'string' },
      },
    },
    required: ['slug'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'add_competitor',
    title: 'Add competitor',
    description: 'Add a competitor to the studio.',
    properties: {
      slug: SLUG,
      name: { type: 'string', minLength: 1 },
      website: { type: 'string' },
      rationale: { type: 'string' },
    },
    required: ['slug', 'name'],
    annotations: NOT_DESTRUCTIVE,
  },
  {
    name: 'research_competitors',
    title: 'Research competitors',
    description: 'Run AI competitor research and add findings to the studio.',
    properties: { slug: SLUG },
    required: ['slug'],
    annotations: OPEN_WORLD,
  },
  {
    name: 'sync_history',
    title: 'Sync social history',
    description: 'Sync historical social posts into the studio.',
    properties: { slug: SLUG },
    required: ['slug'],
    annotations: OPEN_WORLD,
  },
] as const;

type Tool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
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

describe('le scritture migrate sul registry', () => {
  test('restano identiche dall’esterno: titolo, descrizione, campi, obbligatori', async () => {
    const all = await tools();

    for (const expected of MIGRATED_WRITES) {
      const tool = find(all, expected.name);

      expect(tool.title, expected.name).toBe(expected.title);
      expect(tool.description, expected.name).toBe(expected.description);
      expect(tool.inputSchema?.properties, expected.name).toEqual(expected.properties);
      // `required` è un insieme in JSON Schema: il registry lo emette con slug in coda, la
      // versione a mano lo emetteva in testa. Ordinati, o il test fallisce su una differenza
      // che nessun client può osservare.
      expect([...(tool.inputSchema?.required ?? [])].sort(), expected.name).toEqual(
        [...expected.required].sort(),
      );
    }
  });

  test('un tool che tocca il mondo fuori continua a dirlo', async () => {
    const all = await tools();

    for (const expected of MIGRATED_WRITES) {
      expect(find(all, expected.name).annotations, expected.name).toEqual(expected.annotations);
    }
  });

  test('rifiutano un campo che nessuno ha dichiarato, invece di scartarlo in silenzio', async () => {
    const all = await tools();

    for (const { name } of MIGRATED_WRITES) {
      expect(find(all, name).inputSchema?.additionalProperties, name).toBe(false);
    }
  });

  test('sono dichiarate nel registry, non registrate a mano', () => {
    const declared = BRAND_ENDPOINTS.map((e) => e.tool);

    for (const { name } of MIGRATED_WRITES) {
      expect(declared, name).toContain(name);
    }
  });
});
