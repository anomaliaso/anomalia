/**
 * QUALE CLIENT PORTA I PERMESSI DELL'UTENTE, E QUALE LI SCAVALCA.
 *
 * Due client parlano allo stesso database e non hanno niente in comune: quello costruito con la
 * chiave anon (più i cookie del browser o il JWT che arriva sull'header) fa valutare le policy a
 * Postgres, e quello service-role le scavalca — `service_role` ha `bypassrls=true`, verificato su
 * `pg_roles`. Un lettore che accetta il secondo legge OGNI brand di OGNI cliente.
 *
 * Distinguerli guardando il client non si può: sono lo stesso oggetto con dentro una chiave
 * diversa. Chiedergli `auth.getSession()` sembra la stessa domanda e NON lo è — sul percorso API
 * il client è costruito con i cookie a vuoto, quindi non ha sessione pur essendo perfettamente
 * scoped: quella sonda rifiutava i JWT della CLI e di MCP, che erano esattamente i client giusti.
 *
 * Allora la risposta non si deduce: la dichiara chi costruisce il client, che è l'unico a saperla.
 * Il marchio si mette dove nasce un client a chiave anon — `hooks.server.ts` per il browser,
 * `cli-auth.ts` per il percorso JWT — e in nessun altro posto. Chi non è marchiato non è scoped:
 * il default è il rifiuto, quindi un percorso nuovo che si dimentica di marchiare resta chiuso
 * invece di aprirsi da solo.
 */
const rlsScoped = new WeakSet<object>();

/**
 * Il tipo resta quello che entra: `createServerClient` restituisce un client con i suoi generici,
 * e stringerlo a `SupabaseClient` qui in mezzo romperebbe l'assegnazione a `locals.supabase`.
 */
export function markRlsScoped<T extends object>(client: T): T {
  rlsScoped.add(client);
  return client;
}

export function isRlsScoped(client: unknown): boolean {
  return typeof client === 'object' && client !== null && rlsScoped.has(client);
}
