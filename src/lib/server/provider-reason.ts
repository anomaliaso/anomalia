/**
 * Il motivo di un rifiuto del fornitore, reso sicuro da ripassare a chi ha chiamato.
 *
 * Il messaggio serve — senza, l'agente riprova identico — ma arriva da fuori e cita gli argomenti
 * che gli abbiamo mandato, URL firmati compresi. Il token di firma vive nella query string: un log
 * del cliente che lo cattura e' un token vivo in un posto in cui nessuno l'ha messo apposta, e la
 * parte utile del messaggio sta comunque PRIMA del `?`.
 *
 * Quindi: si taglia la query string e si mette un tetto alla lunghezza. Non si nasconde l'URL —
 * e' lo stesso che il chiamante ci ha dato, e sapere QUALE riferimento e' stato rifiutato e' meta'
 * della diagnosi.
 */
const MAX_REASON_CHARS = 400;

/** Un URL con la sua query: e' li' che sta la firma. */
const URL_WITH_QUERY = /(https?:\/\/[^\s'"]+?)\?[^\s'"]*/gi;

export function safeProviderReason(raw: unknown): string | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;

  const stripped = text.replace(URL_WITH_QUERY, '$1');

  return stripped.length > MAX_REASON_CHARS
    ? `${stripped.slice(0, MAX_REASON_CHARS)}…`
    : stripped;
}
