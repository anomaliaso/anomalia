import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoopName } from '$lib/server/loop-ticks';

/**
 * Equità fra brand per i tick ricorrenti, in una forma sola.
 *
 * Il difetto che chiude: una select senza `order by` tiene un ordine di fatto stabile, quindi un
 * lavoro da ~60s a brand in una finestra da 300s ne serve sempre gli stessi cinque e gli altri
 * mai — senza errori né allarmi (misurato: 3 brand serviti sei settimane di fila, 2 mai in 45
 * giorni). Le tre parti devono stare insieme:
 *   1. ordine dichiarato — chi ha aspettato di più per primo, mai servito davanti a tutti;
 *   2. claim PRIMA dei gate — `served_at` si scrive quando il brand viene PRESO, non quando il
 *      lavoro riesce, o un brand che fallisce i gate si tiene lo slot per sempre;
 *   3. tetto dichiarato dal chiamante — chi non ci sta in questo giro è primo nel prossimo.
 *
 * I quattro tick che avevano già risolto il problema con una colonna propria su `brands`
 * (`last_review_at`, `last_crawl_at`, `last_visual_at`, `last_rank_check_at`) restano come sono:
 * riscrivere un cursore che gira è rischio senza guadagno. Qui la stessa cosa vive su
 * `loop_cursors`, così il prossimo lavoro ricorrente ha l'equità senza una migration.
 */

/**
 * Mai servito per primo, poi dal più vecchio. Il pareggio si rompe sull'ID e non sull'ordine di
 * arrivo: due brand mai serviti devono avere una priorità stabile fra un tick e l'altro, o il
 * secondo giro ripesca il primo e la copertura completa non è più garantita.
 */
export function orderLeastRecentlyServed<T extends { id: string }>(
  candidates: readonly T[],
  servedAt: ReadonlyMap<string, string>
): T[] {
  const key = (b: T) => {
    const iso = servedAt.get(String(b.id));
    if (!iso) return Number.NEGATIVE_INFINITY; // mai servito → sempre davanti
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  return [...candidates].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    // Confronto, non sottrazione: `-Infinity - -Infinity` è NaN, e un comparatore che torna NaN
    // lascia l'array com'era — cioè esattamente il difetto che questo file chiude.
    if (ka !== kb) return ka < kb ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * La coda di questo tick. **Non marca niente**: il claim è `markServed`, brand per brand dentro il
 * ciclo. Marcare l'intera coda qui sarebbe una riga in meno e un difetto in più — se la finestra
 * finisce a metà, i brand claimati e mai lavorati finiscono in fondo senza aver ricevuto niente.
 *
 * Lancia se il cursore non si legge, deliberatamente: senza cursore il tick tornerebbe a servire
 * sempre gli stessi in silenzio, e un cron che degrada non si vede — uno che risponde 500 sì.
 *
 * ponytail: due query e un ordinamento in memoria invece di una RPC. Irrilevante fino a migliaia di
 * candidati; oltre, l'upgrade è una funzione SQL che ordina e limita in un colpo solo.
 */
export async function queueForLoop<T extends { id: string }>(
  admin: SupabaseClient,
  loop: LoopName,
  candidates: readonly T[],
  limit: number
): Promise<T[]> {
  if (!candidates.length || limit <= 0) return [];

  const { data, error } = await admin
    .from('loop_cursors')
    .select('brand_id, served_at')
    .eq('loop', loop)
    .in(
      'brand_id',
      candidates.map((b) => String(b.id))
    );
  if (error) throw new Error(`loop_cursors read failed for '${loop}': ${error.message}`);

  const servedAt = new Map((data ?? []).map((r) => [String(r.brand_id), String(r.served_at)]));
  return orderLeastRecentlyServed(candidates, servedAt).slice(0, limit);
}

/**
 * Il claim: appena PRIMA dei gate del brand, mai dopo il lavoro — un brand senza sito o senza piano
 * deve avanzare comunque, o si tiene lo slot per sempre.
 *
 * Non lancia: un claim perso costa un doppio servizio, un tick morto costa la flotta. Il caso
 * "migration non applicata" resta rumoroso perché lancia `queueForLoop`.
 *
 * ponytail: fra lettura della coda e claim c'è una finestra in cui due tick sovrapposti prendono lo
 * stesso brand — il peggio è servirlo due volte.
 */
export async function markServed(admin: SupabaseClient, loop: LoopName, brandId: string): Promise<void> {
  const { error } = await admin
    .from('loop_cursors')
    .upsert({ loop, brand_id: String(brandId), served_at: new Date().toISOString() }, { onConflict: 'loop,brand_id' });
  if (error) console.warn(`[loop-fairness] claim '${loop}' failed:`, error.message.slice(0, 160));
}

/**
 * Quando ogni brand è stato servito l'ultima volta. `loop_cursors` dice SE il tick lo ha raggiunto,
 * `loop_ticks` dice cosa ne è uscito: senza le due, un brand mai raggiunto e uno scartato da un
 * gate sono indistinguibili.
 *
 * Tollera la tabella assente — è una lettura di visualizzazione, non il meccanismo dell'equità.
 */
export async function loopServedAt(
  admin: SupabaseClient,
  loops: readonly string[],
  brandId: string
): Promise<Map<string, string>> {
  if (!loops.length) return new Map();
  try {
    const res = await admin
      .from('loop_cursors')
      .select('loop, served_at')
      .eq('brand_id', brandId)
      .in('loop', [...loops]);
    const rows = (res?.data ?? []) as { loop: unknown; served_at: unknown }[];
    return new Map(rows.map((r) => [String(r.loop), String(r.served_at)]));
  } catch {
    return new Map();
  }
}
