import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_HOME,
  JOB_HOME,
  JOB_OWNERS,
  agentForTask,
  jobThreadHref,
  looksLikeARole,
  owningJobForPath,
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

  it('ogni proprietario di pagina è un job del roster', () => {
    // owningJobForPath può solo restituire chiavi del roster: un typo nella mappa
    // produrrebbe un "Parla con" che punta a un agente inesistente.
    const pages = [
      'radar', 'leads', 'analytics', 'gtm', 'strategy', 'plan', 'calendar', 'content',
      'approvals', 'publish', 'seo', 'seo-geo', 'keywords', 'backlinks', 'geo',
      'citations', 'competitors'
    ];
    for (const seg of pages) {
      const owner = owningJobForPath(`/app/acme/${seg}`, '/app/acme');
      expect(owner, seg).not.toBeNull();
      expect(ROSTER_JOB_KEYS, `${seg} → ${owner}`).toContain(owner);
    }
  });

  it('la mappatura richiesta: pagina → agente proprietario', () => {
    const base = '/app/acme';
    expect(owningJobForPath(`${base}/radar`, base)).toBe('radar_recap');
    expect(owningJobForPath(`${base}/leads`, base)).toBe('radar_recap');
    expect(owningJobForPath(`${base}/analytics`, base)).toBe('analytics_review');
    expect(owningJobForPath(`${base}/gtm`, base)).toBe('strategy_review');
    expect(owningJobForPath(`${base}/plan`, base)).toBe('strategy_review');
    expect(owningJobForPath(`${base}/seo`, base)).toBe('seo');
    expect(owningJobForPath(`${base}/keywords`, base)).toBe('seo');
    expect(owningJobForPath(`${base}/geo`, base)).toBe('geo');
    expect(owningJobForPath(`${base}/competitors`, base)).toBe('market_refs');
    // Le rotte senza proprietario chiaro non mostrano niente, chat inclusa.
    expect(owningJobForPath(`${base}/chat/abc`, base)).toBeNull();
    expect(owningJobForPath(`${base}/settings`, base)).toBeNull();
  });

  it('jobThreadHref: prima il diario di squadra dell\'owner, poi il vecchio thread per-job, poi il composer', () => {
    const threads = [
      // Una normale chat dell'utente con l'analyst NON è il diario di squadra: senza surface non conta.
      { id: 't0', agent: 'analyst' },
      { id: 't1', agent: 'job:radar_recap' },
      { id: 't2', agent: null },
      { id: 't3', agent: 'analyst', surface: 'team' }
    ];
    expect(jobThreadHref(threads, 'acme', 'radar_recap')).toBe('/app/acme/chat/t3');
    // Senza thread di squadra si ripiega sul vecchio thread per-job (pre-unificazione).
    expect(jobThreadHref(threads.slice(0, 3), 'acme', 'radar_recap')).toBe('/app/acme/chat/t1');
    expect(jobThreadHref(threads, 'acme', 'seo')).toBe('/app/acme');
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

  it('la scheda in chat non usa il linguaggio dell’assunzione per una routine assegnata', () => {
    // Il difetto è visivo prima che testuale: se la card continua a dire "assumi questo" con una
    // faccia sorteggiata, l'utente vede un collega nuovo comunque.
    const src = readFileSync(
      join(__dirname, 'components/ChatAgentProposalCard.svelte'),
      'utf8'
    );
    expect(src).toContain('parseRoutineOwner');
    // Faccia e nome del proprietario, non un avatar tirato a sorte dal nome del compito.
    expect(src).toContain('BUILTIN_AGENT_AVATARS');
    for (const key of ['routineFor', 'confirmRoutine', 'createdRoutine', 'noteRoutine']) {
      expect(src, key).toContain(key);
    }
  });
});
