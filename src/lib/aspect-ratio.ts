/**
 * Il rapporto d'aspetto piu' vicino fra quelli che un modello serve davvero.
 *
 * Sta da solo perche' immagini e video hanno lo stesso problema e la stessa risposta: un post
 * Instagram e' 4:5, e i modelli che non ce l'hanno sono tanti. Ripiegare su un default quadrato
 * cambierebbe in silenzio l'inquadratura di ogni verticale del brand, quindi si sceglie il
 * rapporto con la PROPORZIONE piu' vicina — 4:5 diventa 3:4, non un quadrato.
 *
 * La distanza si misura sul logaritmo perche' il rapporto e' una scala moltiplicativa: fra 1:1 e
 * 2:1 c'e' lo stesso salto che fra 1:2 e 1:1, e una differenza semplice direbbe di no.
 */
export function nearestAspectRatio(ratios: readonly string[], wanted: string, fallback: string): string {
  if (ratios.includes(wanted)) return wanted;
  const target = ratioValue(wanted);
  if (!target || !ratios.length) return fallback;
  return ratios.reduce((best, candidate) => {
    const b = ratioValue(best);
    const c = ratioValue(candidate);
    if (!c) return best;
    if (!b) return candidate;
    return Math.abs(Math.log(c / target)) < Math.abs(Math.log(b / target)) ? candidate : best;
  }, ratios[0]);
}

function ratioValue(ratio: string): number | undefined {
  const [w, h] = ratio.split(':').map(Number);
  return w > 0 && h > 0 ? w / h : undefined;
}
