import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JOB_HOME,
  JOB_OWNERS,
  agentForTask,
  looksLikeARole,
  parseRoutineOwner,
  routineOwnerKey
} from './agent-owners';
import { ROSTER_JOB_KEYS } from './server/job-roster';

describe('agent-owners', () => {
  it('JOB_HOME copre esattamente i lavori del roster (la copia client non può invecchiare)', () => {
    expect(Object.keys(JOB_HOME).sort()).toEqual([...ROSTER_JOB_KEYS].sort());
  });

  it('JOB_OWNERS è totale: ogni routine del roster appartiene a un agente della squadra', () => {
    expect(Object.keys(JOB_OWNERS).sort()).toEqual([...ROSTER_JOB_KEYS].sort());
    // La mappa concordata: content produce, analyst legge e dirige, web presidia il sito.
    expect(JOB_OWNERS.autopilot).toBe('content');
    for (const k of ['analytics_review', 'weekly_recap', 'radar_recap', 'market_refs', 'strategy_review'] as const) {
      expect(JOB_OWNERS[k], k).toBe('analyst');
    }
    for (const k of ['seo', 'geo', 'library'] as const) {
      expect(JOB_OWNERS[k], k).toBe('web');
    }
  });

});

/**
 * IL PROPRIETARIO DI UNA ROUTINE, scritto nella colonna `agent` che c'era già. Le proprietà che
 * tengono in piedi tutto il resto: il round-trip non perde niente, e — la più importante — un
 * valore NUDO (`content`, null) non è un proprietario. Se lo diventasse, ogni custom agent già
 * scritto sparirebbe dalla sua card per ricomparire come routine di uno specialista.
 */
describe('routine owner', () => {
  it('legge team: e custom:, e ignora tutto il resto', () => {
    expect(parseRoutineOwner('team:analyst')).toEqual({ kind: 'builtin', agentId: 'analyst' });
    expect(parseRoutineOwner('team:auto')).toEqual({ kind: 'builtin', agentId: 'auto' });
    expect(parseRoutineOwner('custom:11111111-2222-3333-4444-555555555555')).toEqual({
      kind: 'custom',
      scheduleId: '11111111-2222-3333-4444-555555555555'
    });

    // Il punto di compatibilità: nudo = "chi la esegue", non "di chi è".
    expect(parseRoutineOwner('content')).toBeNull();
    expect(parseRoutineOwner(null)).toBeNull();
    expect(parseRoutineOwner('')).toBeNull();
    // E un prefisso con dentro spazzatura non è un proprietario a metà.
    expect(parseRoutineOwner('team:pippo')).toBeNull();
    expect(parseRoutineOwner('custom:non-un-uuid')).toBeNull();
  });

  it('round-trip: quello che si scrive è quello che si rilegge', () => {
    for (const raw of ['team:content', 'team:web', 'custom:11111111-2222-3333-4444-555555555555']) {
      const owner = parseRoutineOwner(raw);
      expect(owner, raw).not.toBeNull();
      expect(routineOwnerKey(owner!)).toBe(raw);
    }
  });

  it('un nome che suona come un ruolo si riconosce, in italiano e in inglese', () => {
    for (const n of ['Analyst', 'Social Media Manager', 'SEO Specialist', 'Copywriter', 'Assistente']) {
      expect(looksLikeARole(n), n).toBe(true);
    }
    for (const n of ['Recap del lunedì', 'Ronda competitor', 'Weekly SEO pass', 'Controllo prezzi']) {
      expect(looksLikeARole(n), n).toBe(false);
    }
  });

  it('la pagina /agents raggruppa con QUESTA funzione, non con una copia', () => {
    // Stessa tecnica del test qui sopra: se qualcuno reinventa il parsing nel markup, le due
    // grammatiche divergono al primo prefisso nuovo e le routine finiscono sulla card sbagliata.
    const src = readFileSync(
      join(__dirname, '../routes/app/[brand]/agents/+page.svelte'),
      'utf8'
    );
    expect(src).toContain('parseRoutineOwner');
    expect(src).toContain("from '$lib/agent-owners'");
    // Le card "i tuoi agenti" sono gli AGENTI (`custom_agents`, 0210), non le loro routine: una
    // card per persona, e sotto l'elenco dei suoi incarichi.
    expect(src).toMatch(/\{#each data\.agents as a/);
    expect(src).toContain('routinesOfAgent');
  });
});

/**
 * IL CLASSIFICATORE che impedisce di assumere un collega per un lavoro che qualcuno già fa.
 * Nato da un caso vero: routine SEO/GEO settimanale proposta come agente NUOVO, con il Web
 * Specialist a un centimetro. Sbaglia per DIFETTO (null = sceglie il modello), mai spingendo
 * una routine sul mestiere sbagliato.
 */
describe('agentForTask', () => {
  it('manda a web il lavoro del sito e della sua reperibilità', () => {
    // Il caso letterale dell'onboarding che ha motivato tutto questo.
    expect(agentForTask('SEO and GEO upkeep — weekly audit snapshot, priority fix, citation gaps')).toBe('web');
    expect(agentForTask('Controllo settimanale della sitemap e dei backlink')).toBe('web');
    expect(agentForTask('Scrivi un articolo per il blog ogni martedì')).toBe('web');
  });

  it('riconosce gli altri mestieri dalle parole del compito', () => {
    expect(agentForTask('Prepara i post e il calendario editoriale della settimana')).toBe('content');
    expect(agentForTask('Leggi le performance e manda un recap con i lead')).toBe('analyst');
    expect(agentForTask('Un video UGC testimonial al mese')).toBe('ugc');
    expect(agentForTask('Motion video con animazione cinetica del claim')).toBe('motion');
  });

  it('si fa da parte quando nessuno lo copre o quando due se lo contendono', () => {
    expect(agentForTask('Controlla i listini dei concessionari convenzionati')).toBeNull();
    expect(agentForTask('')).toBeNull();
    // Pareggio: meglio far scegliere il modello che spingere sul mestiere sbagliato.
    expect(agentForTask('post e seo')).toBeNull();
  });

});
