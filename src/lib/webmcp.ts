/**
 * Web MCP — il terzo consumatore del registry.
 *
 * `BRAND_ENDPOINTS` genera gia' i comandi della CLI e i tool del server MCP. Qui genera anche gli
 * strumenti che una pagina espone a un agente che gira NEL browser dell'utente: chi apre Anomalia
 * con un agente nel browser puo' farla lavorare senza passare dal nostro server MCP, e senza una
 * chiave API, perche' la sessione e' gia' quella della persona che sta guardando.
 *
 * Aggiungere un endpoint al registry lo fa comparire su tutte e tre le strade. Nessuno deve
 * ricordarsene.
 *
 * ## Lo stato della specifica, perche' conta
 *
 * WebMCP e' una **Draft Community Group Report** del W3C Web Machine Learning CG — incubazione,
 * non standards track. Chrome la offre in origin trial dalla 149 dietro
 * `chrome://flags/#enable-webmcp-testing`; WebKit ha registrato una posizione **contraria**,
 * Mozilla neutrale. La forma si e' mossa di recente: `navigator.modelContext` e' diventato
 * `document.modelContext`, e `provideContext()` e' diventato `registerTool()`.
 *
 * Da cui due scelte:
 *
 * 1. **Niente dipendenza.** Nessun polyfill installato: chi vuole provarla monta il suo
 *    (`@mcp-b/global`) e questo modulo lo trova. Una dipendenza per una specifica che si muove e'
 *    un aggiornamento obbligato al prossimo cambio.
 * 2. **Costo zero quando non c'e'.** Il rilevamento sta nel chiamante, che importa questo modulo
 *    solo se `document.modelContext` esiste — quindi zod e i descrittori non entrano nel bundle di
 *    nessun browser che non abbia la specifica accesa.
 *
 * Quando la specifica cambia, cambia questo file: e' l'unico che la conosce.
 */

import { BRAND_ENDPOINTS, RESOURCE_SEGMENT, pathFor, type BrandEndpoint } from '@anomalia/api-contracts';
import { z } from 'zod';

/** La forma che la specifica chiama `ModelContextTool`. */
export type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean; untrustedContentHint: boolean };
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void>;
};

export function modelContext(): ModelContext | null {
  const doc = globalThis.document as unknown as { modelContext?: ModelContext } | undefined;
  return doc?.modelContext ?? null;
}

const SLUG_PROPERTY = { type: 'string', minLength: 1, description: 'Brand URL slug' };

/**
 * Le annotazioni di WebMCP NON sono quelle di MCP: non esiste `destructiveHint`, e `openWorldHint`
 * e' diventato `untrustedContentHint`, che chiede una cosa leggermente diversa — se il risultato
 * puo' contenere testo di cui non rispondiamo. Il registry dice "esce su internet", che e' un
 * insieme piu' largo. Marcarne uno di troppo non costa niente; marcarne uno di meno toglie
 * all'agente un avviso che avrebbe dovuto vedere.
 */
function annotationsFor(endpoint: BrandEndpoint) {
  return {
    readOnlyHint: endpoint.method === 'GET',
    consequentialHint: endpoint.destructive,
    untrustedContentHint: endpoint.openWorld === true
  };
}

function inputSchemaFor(endpoint: BrandEndpoint): Record<string, unknown> {
  const base = z.toJSONSchema(endpoint.input, { io: 'input' }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = { slug: SLUG_PROPERTY, ...(base.properties ?? {}) };
  const required = ['slug', ...(base.required ?? [])];
  if (endpoint.resource !== undefined) {
    Object.assign(properties, {
      id: { type: 'string', minLength: 1, description: `${endpoint.resource} id` }
    });
    required.splice(1, 0, 'id');
  }
  return { ...base, type: 'object', properties, required };
}

/**
 * Il risultato nella busta che MCP usa per convenzione. La specifica non ha ancora un
 * `outputSchema` (issue aperta), quindi la forma e' quella che i client si aspettano oggi.
 */
const envelope = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

async function callApi(
  endpoint: BrandEndpoint,
  token: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const { slug, id, ...body } = input as { slug: string; id?: string } & Record<string, unknown>;
  const path =
    endpoint.resource === undefined
      ? pathFor(endpoint, slug)
      : pathFor(endpoint, slug, String(id ?? ''));

  const res = await fetch(path, {
    method: endpoint.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(endpoint.method === 'GET' ? {} : { 'Content-Type': 'application/json' })
    },
    ...(endpoint.method === 'GET' ? {} : { body: JSON.stringify(body) }),
    signal
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${endpoint.tool} failed (${res.status}): ${JSON.stringify(payload)}`);
  return payload;
}

/**
 * Gli strumenti di UN brand, per la sessione di chi sta guardando. Puro: nessun accesso al DOM,
 * cosi' che la generazione si possa provare senza un browser.
 *
 * `login`, `logout` e `whoami` non ci sono, e non e' una dimenticanza: in una pagina la sessione e'
 * gia' quella dell'utente e il token arriva come argomento. Dal 2026-09-05 non ci sono nemmeno sul
 * server MCP — su HTTP l'autenticazione la fa l'host col giro OAuth, su stdio la sessione e' quella
 * della CLI. Le due superfici dicono la stessa cosa, adesso per lo stesso motivo.
 */
export function brandWebMcpTools(slug: string, token: string): WebMcpTool[] {
  return BRAND_ENDPOINTS.map((endpoint) => ({
    name: endpoint.tool,
    title: endpoint.title,
    description: endpoint.description,
    inputSchema: inputSchemaFor(endpoint),
    annotations: annotationsFor(endpoint),
    execute: async (input: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
      envelope(await callApi(endpoint, token, { slug, ...input }, options?.signal))
  }));
}

/**
 * Registra gli strumenti del brand aperto. Il segnale li toglie tutti insieme: cambiando brand si
 * abortisce il precedente, o un agente vedrebbe gli strumenti di due brand con lo stesso nome.
 */
export async function registerBrandWebMcp(slug: string, token: string, signal: AbortSignal): Promise<number> {
  const context = modelContext();
  if (!context) return 0;
  const tools = brandWebMcpTools(slug, token);
  await Promise.all(tools.map((tool) => context.registerTool(tool, { signal })));
  return tools.length;
}

export { RESOURCE_SEGMENT };
