import { describe, expect, test } from 'bun:test';
import { BRAND_ENDPOINTS, OWN_TOOL_ENDPOINTS } from '../lib/contracts/index.ts';
import { handleMcpFetch } from './http-app.ts';
import { MCP_INSTRUCTIONS } from './server.ts';

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

describe('i tool sono quello che il registry dichiara', () => {
  // Il confronto legge titolo e descrizione DAL registry, quindi non puo` invecchiare: una tabella
  // di forme copiate qui dentro sarebbe la stessa prosa scritta in due posti.
  test('ogni endpoint del registry esiste in tools/list come lo dichiara', async () => {
    const all = await tools();

    for (const endpoint of OWN_TOOL_ENDPOINTS) {
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
 * Ogni lettura di tabella esce; `query` la serve. Il conteggio si misura QUI, sul transport, e non
 * sui sorgenti: contando le `registerTool` si sbaglia, ed è già successo tre volte.
 *
 * Il criterio è uno solo, e sta scritto accanto ai nove che restano: una lettura resta quando la
 * sua risposta non si ricostruisce con `query`. Un `select` con filtri e ordinamento — anche su
 * due tabelle da unire per id — non è mai quel caso.
 */
const RESTANO: ReadonlyArray<{ tool: string; perche: string }> = [
  { tool: 'list_brands', perche: '`query` vive sotto uno slug: senza questo non c’è il primo slug' },
  { tool: 'diagnose_brand', perche: 'nove tabelle → un verdetto per cancello, e quale blocca il ciclo' },
  { tool: 'diagnose_radar', perche: 'interroga ogni fonte dal vivo: non è nel database' },
  { tool: 'search_knowledge', perche: 'due funzioni SQL, un embedding e la fusione dei ranghi; `query` esclude `.rpc()`' },
  { tool: 'get_writing_skills', perche: 'due sorgenti su tre sono markdown del repo e costanti di codice' },
  { tool: 'get_creation_kit', perche: 'seleziona, pesa e taglia a budget; i template stanno in un file' },
  { tool: 'get_gsc', perche: 'somma 28 giorni di righe senza tetto e legge un segreto via rpc' },
  { tool: 'get_ads', perche: 'diagnosi di affaticamento su 500 righe di metriche per campagna' },
  { tool: 'get_media_models', perche: 'il catalogo dei modelli ammessi sta nel codice, in nessuna tabella' }
];

/**
 * Le letture ritirate. Ognuna era un `select` con filtri e ordinamento, e per ognuna la skill
 * porta la `query` equivalente già scritta.
 */
const RITIRATE = [
  'check_media_job',
  'get_analytics',
  'get_article',
  'get_audit_findings',
  'get_automations',
  'get_backlinks',
  'get_bio',
  'get_blog_settings',
  'get_brand_settings',
  'get_calendar',
  'get_dashboard',
  'get_geo',
  'get_goals',
  'get_gtm',
  'get_keywords',
  'get_knowledge_status',
  'get_market_field',
  'get_plan',
  'get_post',
  'get_radar',
  'get_ranks',
  'get_seo',
  'get_status',
  'get_studio',
  'get_voice',
  'get_weekly_plan',
  'list_audit_citations',
  'list_media',
  'list_posts',
  'list_shares',
  'list_social_accounts',
  'list_web_audits',
  'list_web_fixes'
] as const;

describe('le letture le serve `query`', () => {
  test('ne restano nove, e sono quelle dichiarate', async () => {
    const reads = (await tools())
      .filter((t) => t.annotations?.readOnlyHint === true)
      .map((t) => t.name)
      .sort();

    expect(reads).toEqual(RESTANO.map((r) => r.tool).sort());
  });

  test('ogni lettura ritirata è sparita da tools/list', async () => {
    const names = (await tools()).map((t) => t.name);

    for (const name of RITIRATE) expect(names, name).not.toContain(name);
  });

  test('e dal registry, quindi non torna dalla porta della CLI', () => {
    const declared = BRAND_ENDPOINTS.map((e) => e.tool);

    for (const name of RITIRATE) expect(declared, name).not.toContain(name);
  });

  /**
   * «Tool not found» non insegna niente. Chi aveva cablato una di queste ritrova la strada solo
   * qui — la mappa che il client mostra al handshake, prima di ogni descrizione.
   */
  test('le istruzioni del handshake mandano a `query`, e dicono la regola che la rende usabile', () => {
    expect(MCP_INSTRUCTIONS).toContain('query');
    expect(MCP_INSTRUCTIONS).toContain('columns');
    expect(MCP_INSTRUCTIONS).toMatch(/offset/i);
  });

  test('nessuna delle nove è un `select` travestito: ognuna porta il suo motivo', () => {
    for (const { tool, perche } of RESTANO) expect(perche.length, tool).toBeGreaterThan(20);
  });
});
