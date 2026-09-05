import { describe, expect, it } from 'vitest';
import {
  ADD_RADAR_SOURCE,
  GET_RADAR,
  RADAR_PRO_SOURCE_KINDS,
  RADAR_SOURCE_KINDS,
  REMOVE_RADAR_SOURCE,
  SET_RADAR_PLATFORM
} from './radar';
import { BRAND_ENDPOINTS, statusForFailure } from './index';

const ALL = [GET_RADAR, SET_RADAR_PLATFORM, ADD_RADAR_SOURCE, REMOVE_RADAR_SOURCE];

describe('il Radar come contratto', () => {
  it('sta tutto nel registry, o nessun agente lo vede', () => {
    for (const endpoint of ALL) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('accetta solo le piattaforme e i tipi di fonte che il Radar conosce', () => {
    expect(SET_RADAR_PLATFORM.input.safeParse({ platform: 'reddit', enabled: true }).success).toBe(true);
    expect(SET_RADAR_PLATFORM.input.safeParse({ platform: 'instagram', enabled: true }).success).toBe(false);
    expect(ADD_RADAR_SOURCE.input.safeParse({ kind: 'rss', value: 'https://x.test/f' }).success).toBe(true);
    expect(ADD_RADAR_SOURCE.input.safeParse({ kind: 'newsletter', value: 'x' }).success).toBe(false);
  });

  it('non accetta una fonte senza valore: sarebbe una riga che non guarda niente', () => {
    expect(ADD_RADAR_SOURCE.input.safeParse({ kind: 'subreddit', value: '' }).success).toBe(false);
  });

  /**
   * I tipi Pro stanno NELLO schema — un agente su un piano inferiore deve poterli nominare per
   * sapere che esistono — ma il piano è un fatto del runtime, non della forma della richiesta:
   * per questo il rifiuto è un fallimento dichiarato e non un enum più corto.
   */
  it('i tipi del piano Pro esistono nel vocabolario e il rifiuto è dichiarato', () => {
    for (const k of RADAR_PRO_SOURCE_KINDS) {
      expect(RADAR_SOURCE_KINDS, k).toContain(k);
      expect(ADD_RADAR_SOURCE.input.safeParse({ kind: k, value: 'q' }).success, k).toBe(true);
    }
    expect(statusForFailure(ADD_RADAR_SOURCE, 'plan_required')).toBe(403);
    expect(statusForFailure(SET_RADAR_PLATFORM, 'plan_required')).toBe(403);
  });

  it('il tetto delle fonti è un rifiuto dichiarato, non un 500 a sorpresa', () => {
    expect(statusForFailure(ADD_RADAR_SOURCE, 'source_limit')).toBe(403);
    expect(statusForFailure(ADD_RADAR_SOURCE, 'invalid_value')).toBe(400);
  });

  it('togliere una fonte è distruttivo e lo dichiara; aggiungerla no', () => {
    expect(REMOVE_RADAR_SOURCE.destructive).toBe(true);
    expect(ADD_RADAR_SOURCE.destructive).toBe(false);
    expect(SET_RADAR_PLATFORM.destructive).toBe(false);
  });

  it('togliere una fonte che non c è è 404, non un successo che non ha tolto niente', () => {
    expect(statusForFailure(REMOVE_RADAR_SOURCE, 'not_found')).toBe(404);
  });

  it('la coppia che aggiunge è la stessa che toglie', () => {
    // Non c'è un id da ricordare: `(kind, value)` è già la chiave unica sul database, ed è
    // l'unica cosa che un agente ha in mano subito dopo aver aggiunto una fonte.
    expect(Object.keys(REMOVE_RADAR_SOURCE.input.shape).sort()).toEqual(['kind', 'value']);
  });

  it('la lettura dice cosa il piano permette, non solo cosa è già configurato', () => {
    const parsed = GET_RADAR.output.safeParse({
      brand: 'demo',
      plan: 'starter',
      platforms: [{ platform: 'threads', enabled: false, plan_locked: true }],
      sources: [{ id: 's1', kind: 'subreddit', value: 'coffee', lang: 'auto', active: true }],
      allowed_kinds: ['gnews_query', 'rss', 'subreddit', 'reddit_query'],
      source_limit: 10,
      sources_used: 1
    });
    expect(parsed.success).toBe(true);
  });
});
