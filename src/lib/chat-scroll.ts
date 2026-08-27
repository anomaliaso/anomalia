/**
 * "Segui il flusso, ma solo se l'utente non è andato a leggersi qualcosa."
 *
 * I pannelli in overlay di UGC Creator, Media Generator e Motion Video si riportano in fondo a ogni
 * pezzo di stream che arriva. Finché l'utente guarda l'ultima riga è quello che vuole; nel momento
 * in cui scorre in su per rileggere il piano o un errore di due minuti fa, il chunk successivo lo
 * ributta in fondo — e il pannello sembra NON scrollabile anche quando tecnicamente lo è.
 *
 * `nearBottom` è la condizione che separa i due casi. La soglia non è zero perché lo scroll
 * smussato dei browser lascia quasi sempre qualche pixel di resto, e un `scrollTop` a 3px dal
 * fondo è a tutti gli effetti "in fondo".
 */

/** Quanti pixel dal fondo contano ancora come "sta guardando l'ultima riga". */
export const STICK_TO_BOTTOM_PX = 48;

export type ScrollBox = { scrollTop: number; scrollHeight: number; clientHeight: number };

export function nearBottom(el: ScrollBox | null | undefined, threshold = STICK_TO_BOTTOM_PX): boolean {
  if (!el) return true;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  // Un pannello più corto del suo contenuto (o non ancora misurato) è "in fondo" per definizione.
  if (!Number.isFinite(distance)) return true;
  return distance <= threshold;
}
