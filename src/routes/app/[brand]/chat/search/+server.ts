import { json } from '@sveltejs/kit';
import { snippetText } from '$lib/server/chat/persistence';
import type { RequestHandler } from './$types';

/**
 * Ricerca nei MESSAGGI del brand — la parte della palette che non può stare nel client (i thread
 * sono già in memoria, i messaggi no).
 *
 * `ilike` e non full-text di proposito: l'indice che esiste dal 0043 è
 * `(brand_id, user_id, created_at desc)`, e con brand+utente fissati il pianificatore scansiona
 * quelle righe e basta — poche migliaia per un utente vero. Un indice trigram/tsvector vorrebbe
 * una migration, e questo giro non ne fa: se un giorno il filtro si sente, si aggiunge un
 * `gin (content gin_trgm_ops)` e questa query non cambia di una riga.
 *
 * ponytail: substring, non ranking. Trova "carosello" dentro un messaggio; non fa stemming né
 * ordina per rilevanza — ordina per data, che è ciò che serve per ritrovare una conversazione.
 */
export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const q = (url.searchParams.get('q') ?? '').trim();
  // Sotto i due caratteri la ricerca torna mezzo brand: meglio niente che tutto.
  if (q.length < 2) return json({ messages: [] });

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  // `%` e `_` sono jolly di LIKE: senza escape una ricerca di "50%" diventa "tutto".
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, thread_id, role, content, created_at')
    .eq('brand_id', brand.id)
    .eq('user_id', user.id)
    .in('role', ['user', 'assistant'])
    .not('thread_id', 'is', null)
    .ilike('content', pattern)
    .order('created_at', { ascending: false })
    .limit(8);

  // Mai un 500 in faccia alla palette: la ricerca messaggi degrada in silenzio e restano
  // pagine, impostazioni, agenti e thread.
  if (error) return json({ messages: [] });

  return json({
    messages: (data ?? []).map((m) => ({
      id: m.id,
      thread_id: m.thread_id,
      role: m.role,
      created_at: m.created_at,
      snippet: excerpt(snippetText(m.content, 4000), q)
    }))
  });
};

/**
 * Il pezzo di messaggio INTORNO alla parola cercata: un troncamento dall'inizio mostrerebbe
 * spesso testo che non contiene ciò che si è scritto — e la riga sembrerebbe un risultato a caso.
 */
function excerpt(text: string, q: string, span = 120): string {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text.length > span ? `${text.slice(0, span - 1).trimEnd()}…` : text;
  const start = Math.max(0, at - Math.floor(span / 3));
  const end = Math.min(text.length, start + span);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
