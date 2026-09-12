import { describe, expect, it } from 'vitest';
import { webGauges } from './home-gauges';

/**
 * I due anelli della sezione Web della home. Sono spariti una volta: le loro variabili erano
 * dichiarate insieme ai tre gauge grandi, quei gauge sono stati tolti e le variabili con loro —
 * ma gli anelli erano rimasti nel markup. Il componente esplodeva a `seoGauge is not defined`, e
 * il ramo che disegna la home non veniva mai creato: shimmer per sempre, senza un errore visibile.
 *
 * Qui sta il calcolo, puro: cosa mostra l'anello quando il dato c'è, e cosa quando non c'è.
 */
describe('webGauges', () => {
  it('il voto SEO riempie con il punteggio tecnico e si etichetta col voto', () => {
    const g = webGauges({ techScore: 72, seoGrade: 'B+', citationsMentioned: 0, citationsTotal: 0, shareOfVoice: null });
    expect(g.seoFill).toBe(72);
    expect(g.seoLabel).toBe('B+');
  });

  it('senza analisi SEO l’anello è vuoto e lo dice con un trattino', () => {
    const g = webGauges({ techScore: null, seoGrade: null, citationsMentioned: 0, citationsTotal: 0, shareOfVoice: null });
    expect(g.seoFill).toBe(0);
    expect(g.seoLabel).toBe('—');
  });

  it('il GEO conta le citazioni in cui il brand è nominato', () => {
    const g = webGauges({ techScore: null, seoGrade: null, citationsMentioned: 3, citationsTotal: 12, shareOfVoice: 40 });
    expect(g.geoFill).toBe(25);
    expect(g.geoLabel).toBe('25%');
  });

  it('senza citazioni ripiega sulla quota di voce', () => {
    const g = webGauges({ techScore: null, seoGrade: null, citationsMentioned: 0, citationsTotal: 0, shareOfVoice: 40 });
    expect(g.geoFill).toBe(40);
    expect(g.geoLabel).toBe('40%');
  });

  it('senza niente da mostrare non inventa uno zero che sembra misurato', () => {
    const g = webGauges({ techScore: null, seoGrade: null, citationsMentioned: 0, citationsTotal: 0, shareOfVoice: null });
    expect(g.geoFill).toBe(0);
    expect(g.geoLabel).toBe('—');
  });

  it('il riempimento resta fra 0 e 100 anche se il dato esce dai binari', () => {
    const g = webGauges({ techScore: 140, seoGrade: 'A', citationsMentioned: 9, citationsTotal: 3, shareOfVoice: null });
    expect(g.seoFill).toBe(100);
    expect(g.geoFill).toBe(100);
  });
});
