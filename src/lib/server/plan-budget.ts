/**
 * Quanti crediti di PRODUZIONE porta un piano, derivati dal suo prezzo e da un margine dichiarato.
 *
 * PERCHÉ ESISTE: i crediti erano tre numeri scritti a mano (2100 / 5500 / 12000) e il margine che ne
 * usciva non l'aveva scelto nessuno — 28% su Go, 38% su Starter, 47% su Pro. Tre margini diversi per
 * caso, e un cambio di listino che li lasciava indietro in silenzio.
 *
 * E soprattutto: il BUDGET è il limite, non un conteggio di post. Prima erano tre soffitti impilati
 * (l'enum delle cadenze, un tetto di 14 post a settimana, la quota di post), nessuno derivato dal
 * piano pagato, e un Pro da 90 post al mese ne vedeva pianificati 28. Quanti post entrino in una
 * settimana lo dice quanto costano — un video vale una manciata di immagini, una storia illustrata
 * ne vale sei — e quel conto lo fa `content-cost.ts`.
 *
 * La base è il prezzo in DOLLARI perché i crediti sono denominati in dollari (100 crediti = $1 di
 * `cost_usd`): usare l'euro darebbe un budget più stretto a parità di margine dichiarato.
 */
import { PLANS } from '$lib/plans';

const CREDITS_PER_USD = 100;

/** Quanto del prezzo NON va in produzione. Go tiene meno margine: è il piano d'ingresso. */
export const PRODUCTION_MARGIN = { standard: 0.5, go: 0.4 } as const;

export function marginFor(plan: string | null | undefined): number {
  return plan === 'go' ? PRODUCTION_MARGIN.go : PRODUCTION_MARGIN.standard;
}

export function productionCredits(plan: string | null | undefined): number {
  const entry = PLANS.find((p) => p.key === plan);
  if (!entry) return 0;
  return Math.round(entry.mUsd * (1 - marginFor(plan)) * CREDITS_PER_USD);
}

/**
 * I crediti che tocca spendere in `weeks` settimane di ciclo.
 *
 * Non esiste un numero di post: quanti ne entrino lo decide chi pianifica guardando il listino —
 * un video vale una manciata di immagini, una storia illustrata ne vale sei — e il gate rifiuta un
 * batch che non ci sta. `remaining` è quello che il brand ha davvero adesso e vince sempre sulla
 * quota teorica: a metà mese il budget non è più quello di inizio mese.
 */
export function weeklyCredits(
  plan: string | null | undefined,
  weeksInCycle: number,
  remaining?: number
): number {
  const span = Math.max(1, Math.floor(weeksInCycle));
  const share = Math.floor(productionCredits(plan) / span);
  const left = Number(remaining);
  return Math.max(0, Number.isFinite(left) ? Math.min(share, Math.floor(left)) : share);
}
