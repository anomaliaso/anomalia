/**
 * I due anelli della sezione Web della home: quanto sono pieni e cosa scrivono dentro.
 *
 * Stanno qui e non nel componente per la stessa ragione per cui ci sta `home-todos`: è il
 * calcolo, ed è l'unica parte che si può mettere sotto test senza un browser. Il componente
 * disegna e basta.
 *
 * La regola che li governa è una: **un anello vuoto non è uno zero misurato**. Quando l'analisi
 * non è mai stata fatta l'etichetta è un trattino, non «0%» — che si legge come un risultato.
 */
export type WebGaugeInput = {
  techScore: number | null;
  seoGrade: string | null;
  citationsMentioned: number;
  citationsTotal: number;
  shareOfVoice: number | null;
};

export type WebGauges = {
  seoFill: number;
  seoLabel: string;
  geoFill: number;
  geoLabel: string;
};

const NOT_MEASURED = '—';

/** Il riempimento è una percentuale: fuori dai binari l'anello mente, quindi si taglia. */
function pct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function webGauges(web: WebGaugeInput): WebGauges {
  const mentioned = web.citationsTotal > 0 ? (web.citationsMentioned / web.citationsTotal) * 100 : null;
  const geo = mentioned ?? web.shareOfVoice;

  return {
    seoFill: web.techScore == null ? 0 : pct(web.techScore),
    seoLabel: web.seoGrade ?? NOT_MEASURED,
    geoFill: geo == null ? 0 : pct(geo),
    geoLabel: geo == null ? NOT_MEASURED : `${pct(geo)}%`
  };
}
