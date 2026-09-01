import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scrapeCreatorsGet } from '$lib/server/scrapecreators';
import { isOptOutSignal, platformOf, suppressAuthor } from '@anomalia/leads-core/contact';
import {
  CHECK_AFTER_HOURS,
  CHECK_BEFORE_DAYS,
  MAX_CHECKS_PER_RUN,
  isCheckable,
  pickMatch,
  type CommentLike
} from '@anomalia/leads-core/match';

// ── L'esito di un lead: cosa è successo al commento dopo che l'hai incollato ─────────────────────
//
// Il loop si chiudeva su "fatto". Da lì in poi il buio: misuravamo item trovati, lead scritti,
// profili costruiti — tutte metriche di processo — e nessun risultato. Se una bozza abbia mai
// ottenuto una risposta o si sia presa una rimozione non lo sapeva nessuno, quindi ogni giudizio
// sulla qualità ("le bozze sembrano migliori") era un'opinione con l'accento di un dato.
//
// Il commento non lo pubblichiamo noi: va RITROVATO nel thread, e come si ritrova sta in
// `@anomalia/leads-core/match`. Qui c'è il giro attorno — chi controllare, quando, e cosa
// registrare.
//
// Oggi solo Reddit: è dove stanno i lead veri, ed è l'unica delle nostre superfici da cui possiamo
// rileggere i commenti di un thread. Threads/X/LinkedIn passano ma restano non verificabili, e
// vengono registrati come tali invece di essere spacciati per zero.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** I commenti del thread, appiattiti (il nostro può essere una risposta a un altro). */
export async function fetchThreadComments(url: string): Promise<CommentLike[] | null> {
  const data = await scrapeCreatorsGet(`/v1/reddit/post/comments?url=${encodeURIComponent(url)}&trim=true`).catch((error) => { swallow('encodeURIComponent failed', error); return null; });
  const raw: AnyRec[] = Array.isArray(data?.comments) ? data.comments : [];
  if (!raw.length) return data ? [] : null; // [] = thread letto e vuoto; null = non letto

  const out: CommentLike[] = [];
  const walk = (list: AnyRec[], depth = 0) => {
    if (depth > 4) return;
    for (const c of list) {
      const body = String(c?.body ?? c?.text ?? '');
      const kids: AnyRec[] = Array.isArray(c?.replies?.items) ? c.replies.items : Array.isArray(c?.replies) ? c.replies : [];
      if (body) {
        out.push({
          body,
          author: c?.author ?? null,
          ups: num(c?.ups ?? c?.score),
          replies: kids.length || num(c?.reply_count) || 0,
          permalink: c?.permalink ? `https://www.reddit.com${String(c.permalink).replace(/^https?:\/\/[^/]+/, '')}` : null
        });
      }
      if (kids.length) walk(kids, depth + 1);
    }
  };
  walk(raw);
  return out;
}

export type OutcomeRow = {
  lead_id: string;
  brand_id: string;
  found: boolean;
  method: string | null;
  match_score: number | null;
  upvotes: number | null;
  replies: number | null;
  removed: boolean | null;
  comment_url: string | null;
};

/**
 * Un lead: ritrova il commento e registra com'è andata.
 *
 * `removed` viene messo SOLO quando il thread è stato letto davvero e il commento non c'è: se la
 * lettura fallisce non sappiamo niente, e un null onesto vale più di un falso "rimosso" che
 * finirebbe dritto nelle regole del profilo di community.
 */
export async function checkLeadOutcome(
  lead: { id: string; brand_id: string; url: string; suggestion: string | null; author_handle?: string | null; author_platform?: string | null },
  handle?: string | null,
  admin?: SupabaseClient
): Promise<OutcomeRow | null> {
  if (!lead.suggestion || !isCheckable(lead.url)) return null;

  const comments = await fetchThreadComments(lead.url);
  if (comments === null) return null; // thread non leggibile: si riproverà

  // Best-effort opt-out: il thread viene comunque letto — un "non contattarmi" dentro di esso
  // sopprime l'autore a livello globale. È un bonus, non una promessa: lo sweep vede solo questa
  // lettura, e serve l'autore noto dal momento dell'engage.
  if (admin && lead.author_handle && comments.some((c) => isOptOutSignal(c.body))) {
    await suppressAuthor(admin, {
      platform: lead.author_platform ?? platformOf(lead.url),
      handle: lead.author_handle,
      source: 'thread_scan',
      reason: 'opt-out signal in the thread'
    }, swallow);
  }

  const hit = pickMatch(lead.suggestion, comments, { handle });
  if (!hit) {
    return {
      lead_id: lead.id, brand_id: lead.brand_id,
      found: false, method: null, match_score: null,
      upvotes: null, replies: null,
      // Thread letto, commenti presenti, il nostro no → rimosso o mai pubblicato. Con zero commenti
      // letti non si conclude niente.
      removed: comments.length > 0,
      comment_url: null
    };
  }
  return {
    lead_id: lead.id, brand_id: lead.brand_id,
    found: true, method: hit.method, match_score: Math.round(hit.score * 100) / 100,
    upvotes: hit.comment.ups ?? null,
    replies: hit.comment.replies ?? null,
    removed: false,
    comment_url: hit.comment.permalink ?? null
  };
}

/**
 * I lead maturi e mai controllati.
 *
 * I campi autore fanno parte del contratto, non sono un extra: sono l'unica cosa che permette a
 * `checkLeadOutcome` di sopprimere chi ha chiesto di non essere ricontattato. Il tipo li ometteva
 * pur restituendoli, quindi rimuoverli dal mapper non avrebbe rotto niente in compilazione.
 */
export async function pendingOutcomeChecks(
  admin: SupabaseClient,
  limit = MAX_CHECKS_PER_RUN
): Promise<Array<{
  id: string;
  brand_id: string;
  url: string;
  suggestion: string | null;
  author_handle: string | null;
  author_platform: string | null;
}>> {
  const from = new Date(Date.now() - CHECK_BEFORE_DAYS * 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() - CHECK_AFTER_HOURS * 3600 * 1000).toISOString();

  const { data } = await admin
    .from('brand_news_items')
    .select('id, brand_id, url, suggestion, done_at, author_handle, author_platform')
    .eq('status', 'done')
    .not('done_at', 'is', null)
    .gte('done_at', from)
    .lte('done_at', to)
    .order('done_at', { ascending: true })
    .limit(limit * 4);
  if (!data?.length) return [];

  const ids = data.map((l) => l.id as string);
  const { data: already } = await admin.from('lead_outcomes').select('lead_id').in('lead_id', ids);
  const done = new Set((already ?? []).map((r) => r.lead_id as string));

  return data
    .filter((l) => !done.has(l.id as string) && isCheckable(String(l.url)))
    .slice(0, limit)
    .map((l) => ({
      id: l.id as string,
      brand_id: l.brand_id as string,
      url: String(l.url),
      suggestion: l.suggestion as string | null,
      author_handle: (l.author_handle as string | null) ?? null,
      author_platform: (l.author_platform as string | null) ?? null
    }));
}

/** Una passata: controlla i lead maturi e scrive gli esiti. Non lancia mai. */
export async function runOutcomeChecks(
  admin: SupabaseClient,
  limit = MAX_CHECKS_PER_RUN
): Promise<{ checked: number; found: number; removed: number }> {
  const leads = await pendingOutcomeChecks(admin, limit).catch((error) => { swallow('load pending checks', error); return []; });
  let checked = 0, found = 0, removed = 0;

  for (const lead of leads) {
    try {
      const row = await checkLeadOutcome(lead, undefined, admin);
      if (!row) continue;
      const { error } = await admin.from('lead_outcomes').insert(row);
      if (error) { console.warn('[lead-outcomes] insert:', error.message.slice(0, 120)); continue; }
      checked++;
      if (row.found) found++;
      if (row.removed) removed++;
    } catch (e) {
      console.warn('[lead-outcomes] check failed:', e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  return { checked, found, removed };
}

/**
 * Gli esiti come li legge chi riscrive il profilo di community: è qui che il loop si chiude.
 * "Cosa viene premiato e cosa sepolto" smette di essere dedotto dai titoli dei thread e diventa
 * quello che è successo ai NOSTRI commenti in quella stanza.
 */
export async function outcomeDigestFor(
  admin: SupabaseClient,
  brandId: string,
  community: string
): Promise<string> {
  const { data } = await admin
    .from('lead_outcomes')
    .select('found, upvotes, replies, removed, checked_at, brand_news_items!inner(source_name, title)')
    .eq('brand_id', brandId)
    .order('checked_at', { ascending: false })
    .limit(60);
  const rows = (data ?? []).filter((r: AnyRec) => String(r.brand_news_items?.source_name ?? '') === community);
  if (!rows.length) return '';

  const lines = rows.slice(0, 8).map((r: AnyRec) => {
    const t = String(r.brand_news_items?.title ?? '').slice(0, 70);
    if (r.removed) return `- RIMOSSO o mai apparso: "${t}"`;
    if (!r.found) return `- non ritrovato: "${t}"`;
    return `- ${r.upvotes ?? 0} upvote, ${r.replies ?? 0} risposte: "${t}"`;
  });
  const removedCount = rows.filter((r: AnyRec) => r.removed).length;

  return `COM'È ANDATA AI NOSTRI COMMENTI QUI (dati veri, non impressioni${removedCount ? ` — ${removedCount} rimossi su ${rows.length}` : ''}):\n${lines.join('\n')}`;
}
