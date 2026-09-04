import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_COLLECTIONS,
  KNOWLEDGE_EXCERPT_CHARS,
  KNOWLEDGE_HITS_DEFAULT,
  KNOWLEDGE_HITS_MAX,
  SEARCH_KNOWLEDGE
} from './knowledge';
import { BRAND_ENDPOINTS } from './index';

describe('il contratto della ricerca nella conoscenza', () => {
  it('è registrato, o il tool MCP non nasce', () => {
    expect(BRAND_ENDPOINTS).toContain(SEARCH_KNOWLEDGE);
  });

  it('è una lettura: cercare non cambia il corpus', () => {
    expect(SEARCH_KNOWLEDGE.method).toBe('GET');
    expect(SEARCH_KNOWLEDGE.destructive).toBe(false);
    expect(SEARCH_KNOWLEDGE.openWorld).toBeUndefined();
  });

  it('la domanda è obbligatoria, e vuota non passa', () => {
    expect(SEARCH_KNOWLEDGE.input.safeParse({}).success).toBe(false);
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: '' }).success).toBe(false);
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'quanto dura la garanzia' }).success).toBe(true);
  });

  it('dichiara il tetto che la rotta applica in silenzio', () => {
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'x', limit: KNOWLEDGE_HITS_MAX }).success).toBe(true);
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'x', limit: KNOWLEDGE_HITS_MAX + 1 }).success).toBe(false);
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'x', limit: 0 }).success).toBe(false);
  });

  it('accetta solo le collezioni che il corpus conosce', () => {
    for (const collection of KNOWLEDGE_COLLECTIONS) {
      expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'x', collection }).success, collection).toBe(true);
    }
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'x', collection: 'inventata' }).success).toBe(false);
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    expect(SEARCH_KNOWLEDGE.input.safeParse({ query: 'x', brand_id: 'altro' }).success).toBe(false);
  });

  /**
   * La descrizione è l'unica documentazione che un modello esterno legge prima di chiamare.
   * Se non dice il prezzo e il tetto, li scopre riempiendosi la finestra.
   */
  it('la descrizione dice il prezzo e il tetto, perché è tutto ciò che il modello legge', () => {
    expect(SEARCH_KNOWLEDGE.description).toContain('no credits');
    expect(SEARCH_KNOWLEDGE.description).toContain(String(KNOWLEDGE_EXCERPT_CHARS));
    expect(SEARCH_KNOWLEDGE.description).toContain(String(KNOWLEDGE_HITS_MAX));
  });

  it('il campo di ogni passo dice da dove viene, o la citazione non è verificabile', () => {
    const hit = SEARCH_KNOWLEDGE.output.safeParse({
      query: 'garanzia',
      count: 1,
      hits: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          title: 'Condizioni',
          headingPath: 'Garanzia',
          excerpt: '24 mesi',
          truncated: false,
          score: 1
        }
      ]
    });

    expect(hit.success).toBe(true);
  });

  it('il default sta sotto il tetto', () => {
    expect(KNOWLEDGE_HITS_DEFAULT).toBeLessThanOrEqual(KNOWLEDGE_HITS_MAX);
  });
});
