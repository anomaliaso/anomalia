import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'ingresso di ogni strada senza brand, in un posto solo.
 *
 * Quando queste risposte erano scritte dentro UNA rotta, la seconda rotta che nasceva le copiava —
 * e la terza ne copiava una versione vecchia. Qui si misurano una volta, ed è il motivo per cui
 * esistono: un render che parte quando non doveva è denaro speso, e uno che parte senza dire a chi
 * è stato addebitato è denaro speso in silenzio.
 */

const ensureOrgForUser = vi.fn();
const gateOrgCredits = vi.fn();

vi.mock('$lib/server/access', () => ({ userCanEnter: async () => true }));
vi.mock('$lib/server/org', () => ({ ensureOrgForUser: (...a: unknown[]) => ensureOrgForUser(...a) }));
vi.mock('./credits', () => ({
  gateOrgCredits: (...a: unknown[]) => gateOrgCredits(...a),
  CreditsExhaustedError: class CreditsExhaustedError extends Error {}
}));

import { orgScopeFor, brandStyleRefusal, apiKeyIsBrandScoped, type ApiKeyInfo } from './cli-auth';

function supabaseNaming(name: string | null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'org-1', name }, error: null }) }) })
    })
  };
}

const scopedKey: ApiKeyInfo = {
  id: 'key-1',
  name: 'solo acme',
  user_id: 'user-1',
  permissions: { brand_ids: ['brand-1'], scopes: ['write'] }
};

function caller(over: Record<string, unknown> = {}) {
  return {
    supabase: supabaseNaming('Acme'),
    user: { id: 'user-1', email: 'andrea@teta.so' },
    apiKey: undefined,
    error: undefined,
    ...over
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureOrgForUser.mockResolvedValue('org-1');
  gateOrgCredits.mockResolvedValue(undefined);
});

describe('orgScopeFor', () => {
  it('nomina chi paga, perché il chiamante non l ha scelto', async () => {
    const { scope } = await orgScopeFor(caller());

    expect(scope?.orgId).toBe('org-1');
    expect(scope?.organization).toEqual({ id: 'org-1', name: 'Acme' });
  });

  /**
   * Andrea ha visto agenti scegliere un brand a caso pur di avere un addebito che nessuno
   * controlla. Senza un'organizzazione ci si FERMA: non si cerca un ripiego.
   */
  it('senza un organizzazione si ferma, invece di cercarne una a caso', async () => {
    ensureOrgForUser.mockResolvedValue(null);

    const { scope, error } = await orgScopeFor(caller());

    expect(scope).toBeUndefined();
    expect(error?.status).toBe(500);
    expect(await error?.json()).toEqual({ error: 'no_organization' });
  });

  /**
   * Una chiave ristretta a certi brand è una restrizione che l'utente ha scelto. Lasciarla spendere
   * fuori da quei brand la allargherebbe in silenzio, proprio mentre si apre una strada nuova.
   */
  it('una chiave ristretta a certi brand si rifiuta, non si allarga', async () => {
    const { error } = await orgScopeFor(caller({ apiKey: scopedKey }));

    expect(error?.status).toBe(403);
    expect(await error?.json()).toEqual({ error: 'brand_scoped_key' });
    expect(ensureOrgForUser).not.toHaveBeenCalled();
  });

  it('una chiave che vale per tutti i brand passa', async () => {
    const wide = { ...scopedKey, permissions: { brand_ids: '*' as const, scopes: ['write'] } };

    const { scope } = await orgScopeFor(caller({ apiKey: wide }));

    expect(scope?.orgId).toBe('org-1');
  });

  it('senza crediti non si apre niente', async () => {
    const { CreditsExhaustedError } = await import('./credits');
    gateOrgCredits.mockRejectedValue(new CreditsExhaustedError({} as never));

    const { scope, error } = await orgScopeFor(caller());

    expect(scope).toBeUndefined();
    expect(error?.status).toBe(402);
  });

  it('un autenticazione fallita non arriva mai a scegliere un organizzazione', async () => {
    const { error } = await orgScopeFor(caller({ error: new Response('no', { status: 401 }) }));

    expect(error?.status).toBe(401);
    expect(ensureOrgForUser).not.toHaveBeenCalled();
  });
});

describe('apiKeyIsBrandScoped', () => {
  it('una chiave assente non è ristretta a niente', () => {
    expect(apiKeyIsBrandScoped(undefined)).toBe(false);
  });
});

describe('brandStyleRefusal', () => {
  it('senza brand_style non c è niente da rifiutare', () => {
    expect(brandStyleRefusal(undefined)).toBeUndefined();
  });

  it('chiedere lo stile di un brand che non c è dice la mossa, non viene ignorato', async () => {
    const refusal = brandStyleRefusal('apply');

    expect(refusal?.status).toBe(400);
    expect(await refusal?.json()).toMatchObject({
      error: 'brand_style_needs_a_brand',
      reason: expect.stringMatching(/pass a slug, or drop brand_style/)
    });
  });

  it('anche ignore è una risposta su un brand che non c è', () => {
    expect(brandStyleRefusal('ignore')?.status).toBe(400);
  });
});
