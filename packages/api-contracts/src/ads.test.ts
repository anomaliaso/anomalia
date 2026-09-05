import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import { ADS_ACTION, ADS_ACTIONS } from './ads';

describe('il contratto delle azioni sugli annunci', () => {
  it('porta i campi propri dell’azione dentro extra, senza inventarne di nuovi', () => {
    expect(ADS_ACTION.input.safeParse({ action: 'sync' }).success).toBe(true);
    expect(
      ADS_ACTION.input.safeParse({ action: 'toggle', campaignId: 'c1', extra: { next: 'paused' } })
        .success
    ).toBe(true);
    expect(ADS_ACTION.input.safeParse({ action: 'toggle', next: 'paused' }).success).toBe(false);
    expect(ADS_ACTION.input.safeParse({ action: '' }).success).toBe(false);
  });

  /**
   * `action` era `z.string().min(1)` mentre lo switch della rotta ne accetta dieci e risponde
   * `unknown_action` a tutto il resto. Una stringa libera davanti a un elenco chiuso fa scoprire
   * l'elenco sbagliando, e uno dei dieci valori cancella una campagna vera.
   */
  it('elenca le azioni che la rotta accetta davvero, e rifiuta le altre', () => {
    expect([...ADS_ACTIONS]).toEqual([
      'sync', 'propose', 'create', 'approve', 'reject', 'pause', 'resume', 'toggle', 'duplicate', 'delete'
    ]);
    for (const action of ADS_ACTIONS) {
      expect(ADS_ACTION.input.safeParse({ action, campaignId: 'c1' }).success, action).toBe(true);
    }
    expect(ADS_ACTION.input.safeParse({ action: 'launch' }).success).toBe(false);
    expect(ADS_ACTION.input.safeParse({ action: 'DELETE' }).success).toBe(false);
  });

  /** `approve` è ciò che lancia — e la descrizione lo citava senza mai elencarlo fra i verbi. */
  it('nomina ogni azione nella descrizione, `approve` compreso', () => {
    for (const action of ADS_ACTIONS) {
      expect(ADS_ACTION.description, action).toContain(`\`${action}\``);
    }
  });

  it('si dichiara distruttivo: spegne e cancella campagne vere', () => {
    expect(ADS_ACTION.destructive).toBe(true);
    expect(pathFor(ADS_ACTION, 'demo')).toBe('/api/v1/brands/demo/ads');
  });
});
