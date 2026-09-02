import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const adminStub = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => adminStub.current
}));

/**
 * `flagCache` è di modulo e vive 60 secondi: due test che leggono lo stesso flag si
 * passerebbero il valore. Ogni caso ricarica il modulo invece di condividerlo.
 */
async function freshAccess() {
  vi.resetModules();
  return import('./access');
}

type RpcResult = { data: unknown; error: unknown };

function stubClient(answers: Record<string, RpcResult>) {
  const seen: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: async (fn: string, args?: unknown) => {
      seen.push({ fn, args });
      return answers[fn] ?? { data: null, error: null };
    }
  } as unknown as SupabaseClient;
  return { client, seen };
}

const flagAnswer = (enabled: boolean) => ({ data: enabled, error: null });

describe('canEnter', () => {
  beforeEach(() => vi.resetModules());

  it('legge il flag closed_beta, non la vecchia waitlist', async () => {
    const { canEnter } = await freshAccess();
    const { client, seen } = stubClient({ flag_enabled: flagAnswer(false) });

    await canEnter(client);

    expect(seen[0].args).toMatchObject({ p_key: 'closed_beta' });
  });

  it('col prodotto aperto non spende un RPC per can_enter', async () => {
    const { canEnter } = await freshAccess();
    const { client, seen } = stubClient({ flag_enabled: flagAnswer(false) });

    expect(await canEnter(client)).toBe(true);
    expect(seen.map((c) => c.fn)).not.toContain('can_enter');
  });

  it('col prodotto chiuso lascia entrare solo chi can_enter approva', async () => {
    const closed = await freshAccess();
    const approved = stubClient({ flag_enabled: flagAnswer(true), can_enter: { data: true, error: null } });
    expect(await closed.canEnter(approved.client)).toBe(true);

    const other = await freshAccess();
    const pending = stubClient({ flag_enabled: flagAnswer(true), can_enter: { data: false, error: null } });
    expect(await other.canEnter(pending.client)).toBe(false);
  });

  /**
   * Un guasto transitorio della lettura del flag non deve chiudere fuori i clienti che pagano:
   * questa è una porta commerciale, non un confine di sicurezza. Fallisce aperta, di proposito.
   */
  it('se la lettura del flag esplode non chiude fuori nessuno', async () => {
    const { canEnter } = await freshAccess();
    const { client } = stubClient({ flag_enabled: { data: null, error: { message: 'boom' } } });

    expect(await canEnter(client)).toBe(true);
  });
});

/**
 * La CLI e l'MCP arrivano con una chiave API: il client è service-role, `auth.uid()` è nullo, e
 * `can_enter()` risponderebbe sempre no. La domanda va posta per id — e se questa non c'è, chiudere
 * il browser lascia l'API aperta, che non è chiudere il prodotto.
 */
describe('userCanEnter', () => {
  beforeEach(() => vi.resetModules());

  it('col prodotto aperto non chiede altro', async () => {
    const { userCanEnter } = await freshAccess();
    const { client, seen } = stubClient({ flag_enabled: flagAnswer(false) });
    adminStub.current = client;

    expect(await userCanEnter('user-1')).toBe(true);
    expect(seen.map((c) => c.fn)).not.toContain('is_user_approved');
  });

  it("col prodotto chiuso chiede l'approvazione di QUELL'utente", async () => {
    const { userCanEnter } = await freshAccess();
    const { client, seen } = stubClient({
      flag_enabled: flagAnswer(true),
      is_user_approved: { data: true, error: null }
    });
    adminStub.current = client;

    expect(await userCanEnter('user-1')).toBe(true);
    expect(seen.find((c) => c.fn === 'is_user_approved')?.args).toMatchObject({ p_user: 'user-1' });
  });

  /**
   * Il difetto visto in locale: la cache dello schema di PostgREST non conosceva ancora
   * `is_approved(uuid)`, l'RPC tornava errore, e OGNI utente — approvati e paganti compresi —
   * si prendeva un 403 sulla API. Stessa regola di `canEnter`: un guasto lascia entrare.
   */
  it('se il predicato esplode non chiude fuori nessuno', async () => {
    const { userCanEnter } = await freshAccess();
    const { client } = stubClient({
      flag_enabled: flagAnswer(true),
      is_user_approved: { data: null, error: { message: 'PGRST202' } }
    });
    adminStub.current = client;

    expect(await userCanEnter('user-1')).toBe(true);
  });

  it('un utente non approvato non entra dalla API', async () => {
    const { userCanEnter } = await freshAccess();
    const { client } = stubClient({
      flag_enabled: flagAnswer(true),
      is_user_approved: { data: false, error: null }
    });
    adminStub.current = client;

    expect(await userCanEnter('user-1')).toBe(false);
  });
});
