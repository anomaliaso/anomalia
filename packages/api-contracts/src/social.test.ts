import { describe, expect, it } from 'vitest';
import { TARGET_PLATFORMS } from './brand-settings';
import { LIST_SOCIAL_ACCOUNTS, SOCIAL_CONNECT_LINK } from './social';

describe('il vocabolario delle piattaforme', () => {
  it('è quello del prodotto, non una copia scritta qui', () => {
    const parsed = SOCIAL_CONNECT_LINK.input.safeParse({ platform: 'instagram' });

    expect(parsed.success).toBe(true);
    for (const platform of TARGET_PLATFORMS) {
      expect(SOCIAL_CONNECT_LINK.input.safeParse({ platform }).success, platform).toBe(true);
    }
  });

  it('rifiuta una piattaforma che il prodotto non pubblica, e dice quali sono ammesse', () => {
    const parsed = SOCIAL_CONNECT_LINK.input.safeParse({ platform: 'myspace' });

    expect(parsed.success).toBe(false);
    const allowed = parsed.error?.issues.flatMap((i) =>
      'values' in i ? (i.values as string[]) : []
    );
    expect(allowed).toEqual([...TARGET_PLATFORMS]);
  });

  it("rifiuta `twitter`: è l'alias storico di `x`, e due nomi insegnano quello sbagliato", () => {
    expect(SOCIAL_CONNECT_LINK.input.safeParse({ platform: 'twitter' }).success).toBe(false);
  });
});

describe('la coppia leggi-e-conia', () => {
  it('la lettura è una GET e non è distruttiva', () => {
    expect(LIST_SOCIAL_ACCOUNTS.method).toBe('GET');
    expect(LIST_SOCIAL_ACCOUNTS.destructive).toBe(false);
  });

  it('coniare un link non è distruttivo: non collega e non scollega niente', () => {
    expect(SOCIAL_CONNECT_LINK.method).toBe('POST');
    expect(SOCIAL_CONNECT_LINK.destructive).toBe(false);
  });

  it('non vive sotto /connections, che è Composio e non ha niente a che vedere', () => {
    expect(LIST_SOCIAL_ACCOUNTS.pathUnderBrand.startsWith('/social/')).toBe(true);
    expect(SOCIAL_CONNECT_LINK.pathUnderBrand.startsWith('/social/')).toBe(true);
  });

  it('non accetta campi non dichiarati invece di scartarli in silenzio', () => {
    expect(SOCIAL_CONNECT_LINK.input.safeParse({ platform: 'x', token: 'abc' }).success).toBe(false);
    expect(LIST_SOCIAL_ACCOUNTS.input.safeParse({ platform: 'x' }).success).toBe(false);
  });
});

describe('nessun segreto attraversa il confine', () => {
  const forbidden = /token|secret|credential|access|refresh|password|cookie|zernio/i;

  it('la lettura non dichiara un solo campo che somigli a una credenziale', () => {
    const account = LIST_SOCIAL_ACCOUNTS.output.shape.accounts.element.shape;

    for (const field of Object.keys(account)) {
      expect(forbidden.test(field), field).toBe(false);
    }
    for (const field of Object.keys(LIST_SOCIAL_ACCOUNTS.output.shape)) {
      expect(forbidden.test(field), field).toBe(false);
    }
  });

  it('il link coniato non porta con sé nessun campo credenziale', () => {
    for (const field of Object.keys(SOCIAL_CONNECT_LINK.output.shape)) {
      expect(forbidden.test(field), field).toBe(false);
    }
  });

  it('scarta ogni chiave in più che una rotta si lasciasse sfuggire', () => {
    const leaked = LIST_SOCIAL_ACCOUNTS.output.safeParse({
      brand: 'demo',
      accounts: [
        {
          platform: 'instagram',
          username: 'demo',
          display_name: 'Demo',
          profile_url: null,
          status: 'active',
          connected_at: '2026-09-04T00:00:00.000Z',
          access_token: 'ig-secret'
        }
      ],
      connected_platforms: ['instagram'],
      broken_platforms: [],
      platform_choices: [...TARGET_PLATFORMS],
      can_connect: true,
      slots: { used: 1, limit: 3 },
      manage_url: 'https://anomalia.so/app/demo/settings/connected-accounts'
    });

    expect(leaked.success).toBe(true);
    expect(JSON.stringify(leaked.data)).not.toContain('ig-secret');
  });
});

describe('i rifiuti che un agente deve saper leggere', () => {
  it('dice che il piano non collega account, invece di consegnare una porta chiusa', () => {
    expect(SOCIAL_CONNECT_LINK.failures).toContainEqual({
      error: 'plan_cannot_connect',
      status: 409
    });
  });

  it('dice che i posti sono finiti, che è un altro problema e un altro rimedio', () => {
    expect(SOCIAL_CONNECT_LINK.failures).toContainEqual({ error: 'account_limit', status: 409 });
  });
});
