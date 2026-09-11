import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';

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

type Tool = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
  annotations?: Record<string, unknown>;
};

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

/**
 * `create_product`, `update_product`, `update_person` e `update_competitor` erano un insert o un
 * update di UNA riga e nient'altro: aperti i quattro handler, nessun campo derivato, nessuna
 * attribuzione, nessun effetto collaterale. `insert_row` e `update_row` — arrivati con #392
 * proprio per assorbirli — fanno la stessa scrittura sulla stessa riga, con la RLS dell'utente.
 *
 * Una sola differenza di comportamento, e non è muta: `update_competitor` normalizzava
 * `example.com` in `https://example.com`. Quella regola vive nel vincolo
 * `competitors_website_check` (`website ~ '^https?://'`, validato in produzione), quindi ora il
 * sito nudo è RIFIUTATO invece che corretto — con il nome del vincolo e i valori che ammette
 * dentro la risposta. È scritto nella skill, dove un agente lo legge prima di provarci.
 */
describe('le scritture dello studio esposte dal registry', () => {
  const RETIRED = ['create_product', 'update_product', 'update_person', 'update_competitor'];

  test('i quattro CRUD di una riga non sono più tool', async () => {
    const names = (await tools()).map((t) => t.name);

    for (const gone of RETIRED) {
      expect(names, gone).not.toContain(gone);
    }
  });

  test('la loro capacità resta raggiungibile: una riga si aggiunge e si corregge lo stesso', async () => {
    const all = await tools();

    const insert = find(all, 'insert_row');
    expect(Object.keys(insert.inputSchema?.properties ?? {}).sort()).toEqual(['slug', 'table', 'values']);
    expect(insert.annotations?.destructiveHint).toBe(false);

    const update = find(all, 'update_row');
    expect(Object.keys(update.inputSchema?.properties ?? {}).sort()).toEqual(['slug', 'table', 'values', 'where']);
    expect(update.annotations?.destructiveHint).toBe(true);
  });

  test('creare, togliere e la bio restano dove stavano', async () => {
    const names = (await tools()).map((t) => t.name);

    for (const name of ['add_person', 'add_competitor', 'delete_product', 'delete_person', 'delete_competitor', 'set_bio']) {
      expect(names, name).toContain(name);
    }
  });

  test('solo le cancellazioni si annunciano distruttive', async () => {
    const all = await tools();

    expect(find(all, 'delete_product').annotations?.destructiveHint).toBe(true);
    for (const name of ['add_person', 'add_competitor', 'set_bio']) {
      expect(find(all, name).annotations?.destructiveHint, name).toBe(false);
    }
  });

  test('set_bio non è una lettura: la bio si legge da `social_accounts` con `query`', async () => {
    const all = await tools();

    expect(find(all, 'set_bio').annotations?.readOnlyHint).toBe(false);
    expect(all.map((x) => x.name)).not.toContain('get_bio');
  });

  test('nessun tool è registrato due volte', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toEqual([...new Set(names)]);
  });
});

/**
 * Il tool e la rotta accettavano forme diverse: `#aabbccdd` passava lo schema del tool e prendeva
 * un 400 dalla rotta. L'agente ha creduto di aver salvato un colore, la richiesta e' morta dopo,
 * e niente glielo ha detto in tempo per correggere.
 *
 * L'invariante non e' "gli stessi caratteri": il tool accetta apposta un `#` mancante e lo aggiunge
 * prima di partire. E' che TUTTO cio' che il tool accetta, una volta normalizzato, la rotta lo
 * salvi. Niente puo' passare di qui per morire di la'.
 */
describe('i colori di update_brand_identity non accettano niente che la rotta rifiuti', () => {
  const ROUTE_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const normalize = (c: string) => (c.startsWith('#') ? c : `#${c}`);

  test('quello che il tool lascia passare, la rotta lo salva', async () => {
    const schema = find(await tools(), 'update_brand_identity').inputSchema as {
      properties: { colors: { items: { pattern?: string } } };
    };
    const pattern = schema.properties.colors.items.pattern;
    expect(pattern).toBeDefined();
    const toolHex = new RegExp(pattern as string);

    // Il caso che ha rotto: otto cifre. Il tool le prendeva, la rotta no.
    for (const rejected of ['#aabbccdd', 'aabbccdd', '#abcd', '#12345', '#gggggg']) {
      expect(ROUTE_HEX.test(normalize(rejected)), `la rotta accetta ${rejected}?`).toBe(false);
      expect(toolHex.test(rejected), `il tool accetta ${rejected}, la rotta lo rifiuta`).toBe(false);
    }

    // E quello che il brand scrive davvero continua a passare, `#` o no.
    for (const accepted of ['#fff', '#7c5cff', '#FFFFFF', 'fff', '7c5cff']) {
      expect(toolHex.test(accepted), `il tool rifiuta ${accepted}`).toBe(true);
      expect(ROUTE_HEX.test(normalize(accepted)), `la rotta rifiuta ${accepted}`).toBe(true);
    }
  });
});
