import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import en from '$lib/i18n/locales/en.json';
import it_ from '$lib/i18n/locales/it.json';
import fr from '$lib/i18n/locales/fr.json';
import es from '$lib/i18n/locales/es.json';
import { ROSTER_JOBS, clearJobRosterCache, jobEnabledForBrand } from './job-roster';

/**
 * LO STRATEGA. Due lavori (il ripasso del GTM nel passaggio di autopilot, il rinnovo del piano
 * editoriale) dietro UNA chiave, perché nel roster sono una card sola.
 *
 * Le proprietà che contano sono due, e sono quelle che rompono in silenzio:
 *  1. il gate risponde ACCESO quando non sa (tabella `brand_job_optouts` non ancora applicata):
 *     i deploy non eseguono le migration, quindi questa è la condizione normale per qualche ora
 *     ad ogni rilascio, e se sbagliasse verso "spento" fermerebbe la strategia di tutti;
 *  2. la card ha un nome e una descrizione in tutte e quattro le lingue. Senza, a schermo finisce
 *     la chiave grezza (`app.roster.job.strategy_review.name`) e nessun test la vedrebbe.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LOCALES: Record<string, any> = { en, it: it_, fr, es };

function fakeAdmin(res: { data?: { job_key: string }[]; error?: { message: string } }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: res.data ?? null, error: res.error ?? null })
      })
    })
  } as unknown as SupabaseClient;
}

beforeEach(() => clearJobRosterCache());

describe('strategy_review nel roster', () => {
  it('c’è, una volta sola, e non due voci per i due lavori', () => {
    const keys = ROSTER_JOBS.map((j) => j.key);
    expect(keys.filter((k) => k === 'strategy_review')).toHaveLength(1);
  });

  it('è acceso per default: nessuna riga di opt-out = si lavora', async () => {
    expect(await jobEnabledForBrand('b1', 'strategy_review', fakeAdmin({ data: [] }))).toBe(true);
  });

  it('si spegne davvero quando il brand ha detto no', async () => {
    const admin = fakeAdmin({ data: [{ job_key: 'strategy_review' }] });
    expect(await jobEnabledForBrand('b1', 'strategy_review', admin)).toBe(false);
    // …e spegne SOLO lui: gli altri lavori del roster restano accesi.
    expect(await jobEnabledForBrand('b1', 'seo', admin)).toBe(true);
  });

  it('resta acceso se la tabella non c’è ancora — i deploy non applicano le migration', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = fakeAdmin({ error: { message: 'relation "brand_job_optouts" does not exist' } });
    expect(await jobEnabledForBrand('b1', 'strategy_review', missing)).toBe(true);
  });
});

describe('le stringhe della card', () => {
  for (const lang of Object.keys(LOCALES)) {
    it(`${lang}: ogni lavoro del roster ha nome, descrizione e cadenza`, () => {
      const roster = LOCALES[lang]?.app?.roster;
      expect(roster, `app.roster manca in ${lang}.json`).toBeTruthy();
      for (const job of ROSTER_JOBS) {
        expect(roster.job?.[job.key]?.name, `${lang} → ${job.key}.name`).toBeTruthy();
        expect(roster.job?.[job.key]?.desc, `${lang} → ${job.key}.desc`).toBeTruthy();
        expect(roster.cadence?.[job.cadence], `${lang} → cadence.${job.cadence}`).toBeTruthy();
      }
    });
  }
});
