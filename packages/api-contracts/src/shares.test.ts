import { describe, expect, it } from 'vitest';
import { CREATE_SHARE, LIST_SHARES_READ, REVOKE_SHARE, SHARED_VIEW_TYPES } from './shares';

describe('il contratto delle viste pubbliche', () => {
  it('dichiara solo le viste che esistono davvero', () => {
    expect([...SHARED_VIEW_TYPES]).toEqual(['calendar', 'dashboard', 'monthly_report', 'strategy', 'workspace']);
    expect(CREATE_SHARE.input.safeParse({ view: 'proposal' }).success).toBe(false);
  });

  // Le pagine sotto /app/[brand] non sono viste condivisibili: indovinarne il nome non apre
  // niente, perché diventare pubblici passa da questo enum e da altre tre porte deliberate.
  it.each(['settings', 'api-keys', 'billing', 'team', 'knowledge', 'agents', 'usage', 'danger'])(
    'rifiuta %s: una pagina dell app non è una vista pubblica',
    (guessed) => {
      expect(CREATE_SHARE.input.safeParse({ view: guessed }).success).toBe(false);
    }
  );

  it('accetta un mese YYYY-MM e rifiuta qualunque altra forma', () => {
    expect(CREATE_SHARE.input.safeParse({ view: 'calendar', month: '2026-09' }).success).toBe(true);
    expect(CREATE_SHARE.input.safeParse({ view: 'calendar', month: '2026-9' }).success).toBe(false);
    expect(CREATE_SHARE.input.safeParse({ view: 'calendar', month: 'settembre' }).success).toBe(false);
  });

  it('limita la scadenza a un anno e la vuole intera', () => {
    expect(CREATE_SHARE.input.safeParse({ view: 'calendar', expires_in_days: 7 }).success).toBe(true);
    expect(CREATE_SHARE.input.safeParse({ view: 'calendar', expires_in_days: 0 }).success).toBe(false);
    expect(CREATE_SHARE.input.safeParse({ view: 'calendar', expires_in_days: 400 }).success).toBe(false);
  });

  it('promette il token solo a chi crea la vista', () => {
    expect(
      CREATE_SHARE.output.safeParse({
        ok: true,
        id: 'share-1',
        view: 'calendar',
        month: '2026-09',
        url: 'https://anomalia.so/share/abc',
        token: 'abc',
        expires_at: null
      }).success
    ).toBe(true);
  });

  it('la revoca è dichiarata distruttiva e sa già che una share può non esserci', () => {
    expect(REVOKE_SHARE.destructive).toBe(true);
    expect(REVOKE_SHARE.failures).toContainEqual({ error: 'share_not_found', status: 404 });
  });

  it('ogni endpoint sa dire che la tabella non è stata migrata', () => {
    for (const { failures } of [CREATE_SHARE, LIST_SHARES_READ, REVOKE_SHARE]) {
      expect(failures.map((f) => f.error)).toContain('shares_not_migrated');
    }
  });
});
