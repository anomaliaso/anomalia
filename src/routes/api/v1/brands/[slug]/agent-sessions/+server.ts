import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { redactJson } from '$lib/server/redact';

/** Mai `system_prompt`, mai `select('*')`: le colonne si scrivono, così una nuova non esce da sola. */
const SESSION_COLS =
  'id, brand_id, user_id, thread_id, job_id, agent, mode, surface, status, model, provider, transcript, events, event_count, error, format_version, created_at, updated_at, finished_at';

/** Il proprietario dell'organizzazione vede anche le run senza autore (cron, batch). */
async function viewerOwnsBrand(supabase: Parameters<typeof loadBrandForUser>[0], orgId: string, userId: string) {
  const { data } = await supabase.from('organizations').select('owner_id').eq('id', orgId).maybeSingle();
  return (data as { owner_id?: string } | null)?.owner_id === userId;
}

// GET /api/v1/brands/:slug/agent-sessions — la scatola nera dei sotto-agenti.
//
// Scrivere la traccia e non poterla leggere sarebbe metà del lavoro: questo è il lato che la
// rende utile. Due modi d'uso, e il secondo è quello che serve quando qualcosa è andato storto:
//
//   ?limit=20                    l'elenco delle run recenti (senza eventi: è un indice)
//   ?id=<uuid>                   UNA run per intero — system prompt, ogni comando della VM col suo
//                                exit code, ogni pagina aperta, ogni tool chiamato dal modello
//   ?mode=sandbox&status=error   filtri, per arrivare subito alle run che sono esplose
//
// Read-only, nessuna AI, nessun credito. Il client admin serve perché la scrittura di
// `agent_sessions` è service-role; l'autorizzazione l'ha già fatta loadBrandForUser sul client
// dell'utente, e la query è comunque vincolata a `brand_id`.
export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const admin = createAdminClient();
  const id = url.searchParams.get('id');

  if (id) {
    // NESSUNA TRACCIA È PIÙ PUBBLICA DELLA CONVERSAZIONE CHE TRASCRIVE.
    //
    // Fino al 22/8/2026 questa era `select('*')` col client ADMIN e un solo vincolo, `brand_id`:
    // restituiva `events`, `transcript`, `system_prompt` ed `error` GREZZI, di qualunque superficie,
    // a qualunque membro del brand e a qualunque API key `anomalia_`. Le 267 righe già in
    // produzione — con dentro gli argv dell'orchestratore, cioè il posto dove finisce un token
    // espanso a mano — uscivano da qui senza che nessuno dovesse costruire niente.
    //
    // Tre cose cambiano, e nessuna è una redazione: 1) l'elenco delle colonne è esplicito e
    // `system_prompt` NON c'è (dati del brand, email dell'utente, stripe_customer_id, fino a
    // 148.295 caratteri, e non serve a capire una run); 2) si vedono le proprie righe, o quelle
    // senza autore se chi guarda è il proprietario dell'organizzazione; 3) quel che esce passa
    // comunque da `redactFor`, perché le righe scritte prima di oggi non sono redatte.
    const isOwner = await viewerOwnsBrand(supabase, brand.org_id, user.id);
    let q = admin
      .from('agent_sessions')
      .select(SESSION_COLS)
      .eq('id', id)
      .eq('brand_id', brand.id);
    q = isOwner ? q.or(`user_id.eq.${user.id},user_id.is.null`) : q.eq('user_id', user.id);
    const { data, error: dbError } = await q.maybeSingle();
    if (dbError) return json({ error: dbError.message }, { status: 500 });
    if (!data) return json({ error: 'Session not found' }, { status: 404 });
    return json({ session: redactJson(data, brand.id) ?? { error: 'trace not readable' } });
  }

  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 100);
  const mode = url.searchParams.get('mode');
  const status = url.searchParams.get('status');
  const threadId = url.searchParams.get('thread_id');

  let q = admin
    .from('agent_sessions')
    // Senza `events` e `system_prompt`: un elenco di venti run con dentro tutti gli eventi è una
    // risposta da megabyte per rispondere a "cos'è successo ultimamente".
    .select('id, agent, mode, surface, status, model, provider, event_count, error, thread_id, created_at, finished_at')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  // L'indice non è meno riservato del dettaglio: `error` da solo cita il comando che è esploso.
  q = (await viewerOwnsBrand(supabase, brand.org_id, user.id))
    ? q.or(`user_id.eq.${user.id},user_id.is.null`)
    : q.eq('user_id', user.id);
  if (mode) q = q.eq('mode', mode);
  if (status) q = q.eq('status', status);
  if (threadId) q = q.eq('thread_id', threadId);

  const { data, error: dbError } = await q;
  if (dbError) return json({ error: dbError.message }, { status: 500 });

  return json({
    sessions: data ?? [],
    count: data?.length ?? 0,
    hint: 'Add ?id=<uuid> for the full trace of one run: every VM command with its exit code, every page opened, every tool the model called. Secrets are redacted at write time; the system prompt is never served.'
  });
};
