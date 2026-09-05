/**
 * Cosa fare di una sessione dell'harness trovata viva in cache.
 *
 * Riusarla è un'ottimizzazione: risparmia l'avvio, che è secondi. Quando smette di essere gratis,
 * non si fa — ed è esattamente il caso che costava 78 secondi al primo token su un thread già
 * avviato: la sessione aveva un turno non finito, si provava a drenarlo, il drain non tornava, e
 * il guardiano a 60 secondi era l'unica cosa che sbloccava la chat. Poi si ripartiva comunque da
 * zero. Sessanta secondi per non risparmiare niente.
 *
 * L'eccezione è una sola, e non è un'ottimizzazione: la risposta a un'approvazione. Quel turno non
 * è finito perché sta fermo ad aspettare proprio quella, e buttarlo perderebbe il lavoro già
 * fatto — insieme all'approvazione che l'utente ha appena dato.
 */
export type SessionReuse = 'reuse' | 'evict';

export function reuseDecision(
  session: { hasUnfinishedTurn?: () => boolean },
  turn: { isApprovalResponse: boolean }
): SessionReuse {
  if (!session.hasUnfinishedTurn?.()) return 'reuse';
  return turn.isApprovalResponse ? 'reuse' : 'evict';
}
