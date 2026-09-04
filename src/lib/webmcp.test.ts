import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BLOG_FONTS, BRAND_ENDPOINTS } from '@anomalia/api-contracts';
import { brandWebMcpTools, modelContext, registerBrandWebMcp } from './webmcp';

const TOKEN = 'eyJ-fake-session-token';
const tools = () => brandWebMcpTools('demo', TOKEN);
const byName = (name: string) => {
  const tool = tools().find((t) => t.name === name);
  if (!tool) throw new Error(`${name} non generato`);
  return tool;
};

describe('il registry alimenta anche Web MCP', () => {
  it('genera uno strumento per ogni endpoint, senza elenchi a mano', () => {
    expect(tools()).toHaveLength(BRAND_ENDPOINTS.length);
    expect(tools().map((t) => t.name).sort()).toEqual([...BRAND_ENDPOINTS].map((e) => e.tool).sort());
  });

  /**
   * La ragione per cui questo lavoro vale la pena: il prossimo endpoint arriva su CLI, MCP e Web
   * MCP senza che nessuno se ne ricordi. Se qualcuno introducesse un elenco a mano, questo test
   * resterebbe verde e il valore sparirebbe — quindi il test guarda l'inverso: nessuno strumento
   * che il registry non conosca.
   */
  it('e nessuno strumento che il registry non conosca', () => {
    const known = new Set(BRAND_ENDPOINTS.map((e) => e.tool));
    for (const tool of tools()) expect(known.has(tool.name), tool.name).toBe(true);
  });

  it('ogni strumento chiede lo slug del brand', () => {
    for (const tool of tools()) {
      const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
      expect(schema.properties.slug, tool.name).toBeDefined();
      expect(schema.required, tool.name).toContain('slug');
    }
  });

  it('uno strumento su una risorsa chiede anche il suo id', () => {
    const resourceEndpoint = BRAND_ENDPOINTS.find((e) => e.resource !== undefined);
    if (!resourceEndpoint) throw new Error('il registry non ha piu’ endpoint su risorsa');
    const schema = byName(resourceEndpoint.tool).inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties.id).toBeDefined();
    expect(schema.required).toContain('id');
  });

  it('lo schema di ingresso arriva dal contratto, non riscritto a mano', () => {
    // Un enum chiuso del contratto deve arrivare CHIUSO fino all'agente: se lo schema fosse
    // riscritto a mano, `font` diventerebbe una stringa libera e il primo valore inventato
    // arriverebbe fino alla rotta.
    const schema = byName('set_blog_settings').inputSchema as {
      properties: { font?: { enum?: string[] } };
    };
    expect(schema.properties.font?.enum).toEqual([...BLOG_FONTS]);
  });
});

/**
 * Le annotazioni di WebMCP non sono quelle di MCP: `destructiveHint` non esiste, e il suo posto lo
 * prende `consequentialHint`. Tradurle male e' peggio che non tradurle: un agente nel browser
 * userebbe un'azione irreversibile credendola innocua.
 */
describe('le annotazioni dicono la verita’ nel vocabolario giusto', () => {
  it('una lettura e’ readOnly, una scrittura no', () => {
    expect(byName('get_blog_settings').annotations.readOnlyHint).toBe(true);
    expect(byName('set_blog_settings').annotations.readOnlyHint).toBe(false);
  });

  it('cio’ che il registry chiama distruttivo diventa consequentialHint, non destructiveHint', () => {
    const destructive = BRAND_ENDPOINTS.find((e) => e.destructive);
    if (!destructive) throw new Error('il registry non ha piu’ endpoint distruttivi');
    const tool = byName(destructive.tool);
    expect(tool.annotations.consequentialHint).toBe(true);
    expect(tool.annotations).not.toHaveProperty('destructiveHint');
    expect(tool.annotations).not.toHaveProperty('openWorldHint');
  });

  it('cio’ che esce su internet e’ marcato come contenuto di cui non rispondiamo', () => {
    const openWorld = BRAND_ENDPOINTS.find((e) => e.openWorld === true);
    if (!openWorld) throw new Error('il registry non ha piu’ endpoint openWorld');
    expect(byName(openWorld.tool).annotations.untrustedContentHint).toBe(true);
    expect(byName('get_blog_settings').annotations.untrustedContentHint).toBe(false);
  });
});

/**
 * `login`, `logout` e `whoami` esistono nel server MCP perche' una CLI deve procurarsi un token e
 * dire di chi e'. In una pagina la sessione e' gia' quella di chi sta guardando: esporli darebbe a
 * un agente nel browser tre strumenti che non possono fare niente di utile — e uno di essi,
 * `logout`, farebbe un danno.
 */
describe('l’autenticazione nel browser non e’ quella di una CLI', () => {
  it('non offre login, logout o whoami', () => {
    const names = tools().map((t) => t.name);
    for (const absent of ['login', 'logout', 'whoami']) expect(names, absent).not.toContain(absent);
  });
});

describe('quello che l’esecuzione manda davvero in rete', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('porta la sessione di chi guarda, non una chiave API', async () => {
    await byName('get_blog_settings').execute({});
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/brands/demo/settings/blog');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('lo slug lo mette il registratore, non chi chiama lo strumento', async () => {
    await byName('set_blog_settings').execute({ title: 'Il blog' });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/brands/demo/settings/blog');
    expect(JSON.parse(init.body)).toEqual({ title: 'Il blog' });
  });

  it('un id di risorsa entra nel percorso, non nel corpo', async () => {
    await byName('get_post').execute({ id: 'post-1' });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toContain('post-1');
    expect(init.body).toBeUndefined();
  });

  it('un errore dell’API diventa un errore, non un successo silenzioso', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'API key is read-only' }) });
    await expect(byName('set_blog_settings').execute({ title: 'x' })).rejects.toThrow(/403/);
  });

  it('il risultato viaggia nella busta che i client si aspettano', async () => {
    const out = (await byName('get_blog_settings').execute({})) as { content: { type: string; text: string }[] };
    expect(out.content[0].type).toBe('text');
    expect(JSON.parse(out.content[0].text)).toEqual({ ok: true });
  });

  it('l’agente puo’ annullare: il segnale arriva fino alla fetch', async () => {
    const controller = new AbortController();
    await byName('get_blog_settings').execute({}, { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('quando il browser non ha la specifica', () => {
  it('non c’e’ nessun contesto da trovare', () => {
    expect(modelContext()).toBeNull();
  });

  it('registrare non fa niente e non esplode', async () => {
    await expect(registerBrandWebMcp('demo', TOKEN, new AbortController().signal)).resolves.toBe(0);
  });

  it('ma se c’e’, registra tutto il registry con un segnale per toglierlo', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('document', { modelContext: { registerTool } });
    const controller = new AbortController();

    const count = await registerBrandWebMcp('demo', TOKEN, controller.signal);

    expect(count).toBe(BRAND_ENDPOINTS.length);
    expect(registerTool).toHaveBeenCalledTimes(BRAND_ENDPOINTS.length);
    expect(registerTool.mock.calls[0][1]).toEqual({ signal: controller.signal });
    vi.unstubAllGlobals();
  });
});
