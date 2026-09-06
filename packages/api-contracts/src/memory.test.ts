import { describe, expect, it } from 'vitest';
import {
  AGENT_MEMORY_CATEGORIES,
  MEMORY_CATEGORIES,
  MEMORY_USED_MAX,
  RECORD_MEMORY_USED,
  SAVE_MEMORY
} from './memory';
import { BRAND_ENDPOINTS } from './index';

const MEMORY = [SAVE_MEMORY, RECORD_MEMORY_USED];

describe('il contratto della memoria del brand', () => {
  it('sono registrati, o i tool MCP non nascono', () => {
    for (const endpoint of MEMORY) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('nessuno di essi è distruttivo: niente qui cancella', () => {
    for (const endpoint of MEMORY) {
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });

  it('rifiutano un parametro che non dichiarano', () => {
    for (const endpoint of MEMORY) {
      expect(endpoint.input.safeParse({ campo_inventato: 'x' }).success, endpoint.tool).toBe(false);
    }
  });

  /** LA RIGA CHE MANCA È LA REGOLA: voice e constraint non si scrivono da fuori. */
  it('`voice` e `constraint` sono leggibili e NON scrivibili', () => {
    for (const category of ['voice', 'constraint'] as const) {
      expect(MEMORY_CATEGORIES).toContain(category);
      expect(AGENT_MEMORY_CATEGORIES as readonly string[], category).not.toContain(category);
      expect(SAVE_MEMORY.input.safeParse({ key: 'k', value: 'v', category }).success, category).toBe(false);
    }
  });

  it('scrivibili sono e solo sono quelle che un agente impara lavorando', () => {
    expect([...AGENT_MEMORY_CATEGORIES]).toEqual(['fact', 'preference', 'insight', 'skill']);
    for (const category of AGENT_MEMORY_CATEGORIES) {
      expect(SAVE_MEMORY.input.safeParse({ key: 'k', value: 'v', category }).success, category).toBe(true);
    }
  });

  it('la segnalazione d’uso vuole almeno un id e non più del tetto', () => {
    expect(RECORD_MEMORY_USED.input.safeParse({ ids: [] }).success).toBe(false);
    expect(RECORD_MEMORY_USED.input.safeParse({ ids: ['a'] }).success).toBe(true);
    expect(
      RECORD_MEMORY_USED.input.safeParse({ ids: Array.from({ length: MEMORY_USED_MAX + 1 }, () => 'a') }).success
    ).toBe(false);
  });

  it('dichiara il conflitto invece di far scoprire una sovrascrittura', () => {
    expect(SAVE_MEMORY.failures).toContainEqual({ error: 'memory_conflict', status: 409 });
    expect(SAVE_MEMORY.failures).toContainEqual({ error: 'category_not_writable', status: 403 });
    expect(SAVE_MEMORY.failures).toContainEqual({ error: 'skill_limit_reached', status: 409 });
  });

  /**
   * Il decadimento presume che qualcuno segnali. Se la descrizione non lo dice, nessuno lo fa e
   * le voci che funzionavano escono dai prompt in silenzio.
   */
  it('la segnalazione dice che senza di lei la voce decade', () => {
    expect(RECORD_MEMORY_USED.description).toContain('decay');
  });

  /**
   * `get_memory` era un `select` su `brand_memory` che `query` sa scrivere, e se ne e' andato. I
   * suoi due filtri — niente note di chat, niente note di mestiere dei colleghi — erano imposti
   * dall'handler: ora sono DICHIARATI qui, dove chi legge la memoria passa comunque.
   */
  it('dice come si legge la memoria, con i filtri che l’handler imponeva', () => {
    expect(RECORD_MEMORY_USED.description).toContain('query({ table: "brand_memory"');
    expect(RECORD_MEMORY_USED.description).toContain('"layer",op:"neq",value:"session"');
    expect(RECORD_MEMORY_USED.description).toContain('"agent",op:"is",value:null');
  });

  it('la scrittura dice che l’ultimo arrivato non vince', () => {
    expect(SAVE_MEMORY.description).toContain('409');
    expect(SAVE_MEMORY.description).toContain('NOT writable');
  });
});
