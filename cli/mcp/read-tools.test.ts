import { describe, expect, test } from 'bun:test';
import { BRAND_ENDPOINTS } from '../lib/contracts/index.ts';
import { handleMcpFetch } from './http-app.ts';
import { MCP_INSTRUCTIONS } from './server.ts';

const SLUG_PROPERTY = { type: 'string', minLength: 1, description: 'Brand URL slug' };

const MIGRATED_READS = [
  {
    name: 'get_plan',
    title: 'Editorial plan',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_weekly_plan',
    title: 'Weekly plan',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_studio',
    title: 'Studio',
    // Cambiata di proposito, due volte: l'elenco dei documenti dice se sono stati digeriti, e il
    // testo non viaggia più per difetto — `documents: "full"` lo restituisce a chi lo leggeva.
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
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_geo',
    title: 'GEO overview',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_keywords',
    title: 'Keywords',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_ads',
    title: 'Ads overview',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_analytics',
    title: 'Analytics',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_gtm',
    title: 'GTM roadmap',
    properties: { slug: SLUG_PROPERTY },
    required: ['slug'],
  },
  {
    name: 'get_voice',
    title: 'Voice rules',
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
  // La descrizione NON si confronta qui, e la copia in questo file non esiste piu`: sarebbe la
  // stessa prosa scritta in due posti, che diverge alla prima riscrittura. Il confronto vero e`
  // automatico e sta piu` sotto — `ogni endpoint del registry esiste in tools/list come lo
  // dichiara` legge la descrizione DAL registry, quindi non puo` invecchiare. Qui resta la forma:
  // titolo, campi, obbligatori, annotazioni, cioe` cio` che si rompe in silenzio.
  test('restano identiche dall’esterno: titolo, campi, obbligatori', async () => {
    const all = await tools();

    for (const expected of MIGRATED_READS) {
      const tool = find(all, expected.name);

      expect(tool.title, expected.name).toBe(expected.title);
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

/**
 * Le quattro letture il cui handler era un `select` che `query` sa già scrivere. Il criterio non è
 * il nome: `list_posts` si chiama come loro ed è rimasto, perché il tetto di 20.000 caratteri gli
 * taglia 35 righe su 50.
 */
const RITIRATE = ['get_appearance', 'get_memory', 'list_articles', 'list_ideas'] as const;

/** Letture che `query` NON copre: la riga grezza è più larga dei tetti, o il tool aggrega. */
const NON_COPERTE = ['list_posts', 'list_shares', 'get_article', 'list_web_fixes', 'get_dashboard'] as const;

describe('le letture che `query` copriva già', () => {
  test('non sono più in tools/list', async () => {
    const names = (await tools()).map((t) => t.name);

    for (const name of RITIRATE) expect(names, name).not.toContain(name);
  });

  test('non sono più nel registry, quindi nemmeno sul percorso CLI', () => {
    const declared = BRAND_ENDPOINTS.map((e) => e.tool);

    for (const name of RITIRATE) expect(declared, name).not.toContain(name);
  });

  test('quelle che `query` taglierebbe restano, e restano letture', async () => {
    const all = await tools();

    for (const name of NON_COPERTE) {
      expect(find(all, name).annotations?.readOnlyHint, name).toBe(true);
    }
  });

  /**
   * Il "tool not found" del protocollo non insegna niente. Chi aveva cablato una delle quattro
   * ritrova il nome QUI, nella mappa che il client mostra al handshake prima di ogni descrizione —
   * ed è anche l'unico posto dove sta la regola che le rende usabili: senza `columns` la lettura
   * torna monca e nessuno lo dice.
   */
  test('le istruzioni del handshake dicono cosa si chiama al loro posto', () => {
    for (const name of RITIRATE) expect(MCP_INSTRUCTIONS, name).toContain(name);

    expect(MCP_INSTRUCTIONS).toContain('columns');
  });
});
