import { describe, expect, it } from 'vitest';
import { reuseDecision } from './harness-reuse';

/**
 * IL COSTO PAGATO, 2026-09-03. Su un thread gia` avviato il primo token arrivava dopo 78 secondi.
 *
 * Il ramo che riusa la sessione viva trovava un turno precedente NON finito e provava a drenarlo
 * (`continueGenerate` + `await drained.text`). Il drain non tornava mai; il guardiano
 * `HARNESS_START_TIMEOUT_MS` scattava a 60 secondi esatti; e solo allora si ripartiva con una
 * sessione fresca, pagando comunque gli ~8s che si sarebbero pagati subito.
 *
 * Il riuso e` un'OTTIMIZZAZIONE: quando non e` gratis, non si fa. L'unico caso in cui un turno non
 * finito va riusato e` la risposta a un'approvazione — quel turno e` fermo esattamente li`, ad
 * aspettarla, e ripartire da capo perderebbe il lavoro gia` fatto.
 */
describe('cosa fare di una sessione viva trovata in cache', () => {
  it('un turno non finito si sfratta: drenarlo costava 60 secondi al prossimo messaggio', () => {
    expect(reuseDecision({ hasUnfinishedTurn: () => true }, { isApprovalResponse: false })).toBe('evict');
  });

  it("ma la risposta a un'approvazione riusa quel turno: e` lui che la sta aspettando", () => {
    expect(reuseDecision({ hasUnfinishedTurn: () => true }, { isApprovalResponse: true })).toBe('reuse');
  });

  it('una sessione pulita si riusa: e` il caso per cui la cache esiste', () => {
    expect(reuseDecision({ hasUnfinishedTurn: () => false }, { isApprovalResponse: false })).toBe('reuse');
  });

  /** Una sessione che non sa dire come sta non e` una ragione per buttarla. */
  it('senza `hasUnfinishedTurn` si riusa', () => {
    expect(reuseDecision({}, { isApprovalResponse: false })).toBe('reuse');
  });
});
