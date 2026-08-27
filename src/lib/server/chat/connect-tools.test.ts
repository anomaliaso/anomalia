import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APPS_UNAVAILABLE, normalizeConnectPayload } from '$lib/chat-connect';

/**
 * Le tre promesse di `propose_app_connection`:
 *   1. il toolkit è validato contro il catalogo Composio — mai una card per un'app inconnettibile;
 *   2. già connessa → lo dice, senza coniare una Connect Link nuova;
 *   3. nell'output viaggiano SOLO slug/nome/logo/URL: mai token, mai account id.
 */

const startSession = vi.fn();
const reconcile = vi.fn(async () => undefined);
let connections: Array<{ toolkit_slug: string; status: string; display_name: string | null }> = [];

let configured = true;
vi.mock('$lib/server/composio', () => ({
  composioConfigured: () => configured,
  composioErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}));
vi.mock('$lib/server/composio-catalog', () => ({
  loadConnectorCatalog: async () => ({
    items: [
      { toolkitSlug: 'GOOGLECALENDAR', displayName: 'Google Calendar', logo: 'https://logos.composio.dev/gcal.png', managedAuth: true, kind: 'mcp', knowledgeProvider: null },
      { toolkitSlug: 'NOTION', displayName: 'Notion', logo: null, managedAuth: true, kind: 'app', knowledgeProvider: 'notion' }
    ],
    error: null
  }),
  loadBrandConnections: async () => connections,
  reconcileBrandConnections: reconcile,
  startIntegrationConnectSession: startSession
}));

const fakeSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { slug: 'acme' }, error: null }) })
    })
  })
} as unknown as SupabaseClient;

async function makeTool() {
  const { createConnectTools } = await import('./connect-tools');
  const tools = createConnectTools({
    supabase: fakeSupabase,
    brandId: 'b1',
    userId: 'u1',
    threadId: 't1',
    origin: 'https://app.test'
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools.propose_app_connection as any).execute as (args: { toolkit: string; reason: string }) => Promise<Record<string, unknown>>;
}

beforeEach(() => {
  configured = true;
  connections = [];
  startSession.mockReset();
  startSession.mockResolvedValue({
    authorizationUrl: 'https://connect.composio.dev/link/abc',
    connectedAccountId: 'ca_SECRET_ID',
    expiresAt: null
  });
});

describe('propose_app_connection', () => {
  it('toolkit fuori catalogo → unknown_toolkit con suggerimenti, nessuna Connect Link coniata', async () => {
    const execute = await makeTool();
    const res = await execute({ toolkit: 'calend', reason: 'x' });
    expect(res.error).toBe('unknown_toolkit');
    expect(res.suggestions).toContain('GOOGLECALENDAR');
    expect(startSession).not.toHaveBeenCalled();
  });

  it('nessun suggerimento → dice di riprovare col nome per esteso, non "non esiste"', async () => {
    const execute = await makeTool();
    const res = await execute({ toolkit: 'gcal', reason: 'x' });
    expect(res.suggestions).toEqual([]);
    expect(String(res.message)).toMatch(/full common name/i);
    expect(startSession).not.toHaveBeenCalled();
  });

  it('già connessa → status connected, senza aprire un nuovo flusso', async () => {
    connections = [{ toolkit_slug: 'NOTION', status: 'active', display_name: 'Notion' }];
    const execute = await makeTool();
    const res = await execute({ toolkit: 'notion', reason: 'x' });
    expect(res.status).toBe('connected');
    expect(res.already_connected).toBe(true);
    expect(startSession).not.toHaveBeenCalled();
    // E prima di rispondere si riconcilia: una connessione fatta dal CLI non deve mentire.
    expect(reconcile).toHaveBeenCalled();
  });

  it('non connessa → card renderizzabile con connect_url, callback sul thread di chat', async () => {
    const execute = await makeTool();
    const res = await execute({ toolkit: 'googlecalendar', reason: 'Per pianificare i post sul tuo calendario' });
    expect(res.status).toBe('pending');
    expect(res.connect_url).toBe('https://connect.composio.dev/link/abc');
    expect(res.name).toBe('Google Calendar');
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ toolkitSlug: 'GOOGLECALENDAR', callbackUrl: 'https://app.test/app/acme/chat/t1' })
    );
    // Il payload che la persistenza salva e le due surface renderizzano.
    expect(normalizeConnectPayload(res)).toMatchObject({ toolkit: 'GOOGLECALENDAR', status: 'pending' });
  });

  it('mai token o account id nell\'output — in nessun esito', async () => {
    const execute = await makeTool();
    for (const args of [
      { toolkit: 'googlecalendar', reason: 'x' },
      { toolkit: 'sconosciuto', reason: 'x' }
    ]) {
      const out = JSON.stringify(await execute(args));
      expect(out).not.toMatch(/token|secret|ca_SECRET_ID|connectedAccountId/i);
    }
  });

  it('servizio non configurato: l\'output dice al MODELLO cosa fare, e il perché tecnico resta per i log', async () => {
    configured = false;
    const execute = await makeTool();
    const res = await execute({ toolkit: 'notion', reason: 'x' });
    expect(res.error).toBe('composio_unconfigured');
    // L'istruzione comportamentale è la parte che mancava: senza, il modello raccontava
    // all'utente che l'ambiente non ha il servizio configurato.
    const instruction = String(res.agent_instruction ?? '');
    expect(instruction).toMatch(/NEVER tell the user about configuration/);
    expect(instruction).toMatch(/ask which apps they use/i);
    expect(instruction).toMatch(/SATISFIES/);
    // E niente Connect Link, niente card renderizzabile da questo output.
    expect(startSession).not.toHaveBeenCalled();
    expect(normalizeConnectPayload(res)).toBeNull();
    expect(res).toMatchObject(APPS_UNAVAILABLE);
  });

  it('lo stesso trattamento per list/call_integrations_tools: un agente qualunque non spiega la configurazione', async () => {
    configured = false;
    const { listBrandComposioTools, callBrandComposioTool } = await import('$lib/server/composio-agent');
    for (const res of [
      await listBrandComposioTools(fakeSupabase, 'b1', 'NOTION'),
      await callBrandComposioTool(fakeSupabase, 'b1', { integration: 'NOTION', name: 'NOTION_CREATE_PAGE' })
    ]) {
      expect(res.error).toBe('composio_unconfigured');
      expect(String(res.agent_instruction ?? '')).toMatch(/NEVER tell the user about configuration/);
    }
  });

  it('un output di errore non diventa mai una card', () => {
    expect(normalizeConnectPayload({ error: 'unknown_toolkit', toolkit: 'X' })).toBeNull();
    expect(normalizeConnectPayload({ toolkit: 'X', status: 'pending' })).toBeNull(); // senza URL
    expect(normalizeConnectPayload({ toolkit: 'X', status: 'connected' })).toMatchObject({ status: 'connected' });
  });
});
