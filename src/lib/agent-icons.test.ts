import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_META,
  DEFAULT_AGENT_ID,
  NEW_CHAT_AGENT_ID,
  agentMetaForBrand,
  normalizeAgentId
} from './agent-icons';

const ids = (list: Array<{ id: string }>) => list.map((a) => a.id);

describe('agentMetaForBrand — Anomalia non e’ piu’ una scelta', () => {
  it('il picker offre solo i cinque mestieri', () => {
    expect(ids(agentMetaForBrand(true))).toEqual(['content', 'ugc', 'motion', 'web', 'analyst']);
    expect(ids(agentMetaForBrand(true))).not.toContain(DEFAULT_AGENT_ID);
  });

  it('rientra in lista SOLO quando e’ gia’ lei l’agente aperto (thread vecchi)', () => {
    expect(ids(agentMetaForBrand(true, DEFAULT_AGENT_ID))).toContain(DEFAULT_AGENT_ID);
    // Uno specialista selezionato non la fa riapparire.
    expect(ids(agentMetaForBrand(true, 'content'))).not.toContain(DEFAULT_AGENT_ID);
  });

  it('il lock del Web hub resta indipendente', () => {
    expect(ids(agentMetaForBrand(false))).not.toContain('web');
    expect(ids(agentMetaForBrand(false, DEFAULT_AGENT_ID))).toEqual([
      'auto',
      'content',
      'ugc',
      'motion',
      'analyst'
    ]);
  });
});

describe('i due default', () => {
  it('un thread senza agente resta Anomalia — normalizzarlo su uno specialista lo dirotterebbe', () => {
    expect(normalizeAgentId(null)).toBe(DEFAULT_AGENT_ID);
    expect(normalizeAgentId('')).toBe(DEFAULT_AGENT_ID);
    // Legacy: gli id vecchi continuano a mappare sul mestiere giusto.
    expect(normalizeAgentId('publish')).toBe('content');
  });

  it('una chat NUOVA parte da un mestiere vero, presente nel picker', () => {
    expect(NEW_CHAT_AGENT_ID).not.toBe(DEFAULT_AGENT_ID);
    expect(ids(agentMetaForBrand(true))).toContain(NEW_CHAT_AGENT_ID);
    expect(AGENT_META.some((a) => a.id === NEW_CHAT_AGENT_ID)).toBe(true);
  });
});

/**
 * LA PILA IN FINTO 3D. Le regole sono state regolate a mano guardandola, e sono esattamente il
 * tipo di cosa che un ritocco distratto rompe in silenzio: si prova sul sorgente (stessa tecnica
 * di agent-owners.test.ts), perche' e' geometria dentro un componente, non una funzione pura.
 */
describe('AgentStack3D — le regole della composizione', () => {
  const src = readFileSync(join(__dirname, 'components/AgentStack3D.svelte'), 'utf8');

  it('conosce una disposizione per QUATTRO dietro: i cinque mestieri ci stanno', () => {
    expect(src).toMatch(/\n\s*4: \[/);
  });

  it('ogni posto a SINISTRA e’ specchiato — le facce laterali guardano verso l’esterno', () => {
    const left = [...src.matchAll(/\{ x: (-[\d.]+),[^}]*mirror: (true|false) \}/g)];
    expect(left.length).toBeGreaterThanOrEqual(4);
    expect(left.every((m) => m[2] === 'true')).toBe(true);
  });

  it('si dipinge dalla piu’ LONTANA alla piu’ vicina, o la profondita’ va al contrario', () => {
    // Un solo z-index per tutte: chi copre chi lo decide l'ordine del DOM.
    expect(src).toMatch(/\.sort\(\(p, q\) => p\.slot\.s - q\.slot\.s\)/);
  });

  it('niente sfocatura su chi sta dietro: il distacco lo fanno scala, offset e parallasse', () => {
    expect(src).not.toMatch(/filter:\s*blur/);
  });
});
