/**
 * CHI TIENE ACCESA LA MACCHINA, E QUANDO SPARLA.
 *
 * Vercel fattura la memoria della sandbox a orologio fino allo scadere del lease, idle incluso:
 * un turno di 40 secondi su una VM con lease a 15 minuti ne paga 15. Da qui il contatore:
 * ogni uso registra una riga, la macchina si spegne con `stop()` quando l'ultima esce.
 *
 * La riga SCADE: un processo serverless che muore a metà turno non lascia holder fantasma che
 * bloccano lo stop per sempre. Un holder per ciclo di vita noto (turno, render) viene rilasciato
 * alla fine; uno per ciclo di vita ignoto (chi guarda il desktop, la sessione harness) vive fino
 * alla scadenza e il prossimo evento spegne la VM.
 *
 * Ogni funzione ingoia i suoi errori: un database morto non deve spezzare un turno di AI.
 */
import { createAdminClient } from '$lib/server/supabase-admin';
import { swallow } from '$lib/server/swallow';

const TABLE = 'sandbox_holders';

/**
 * IL NOME DELL'INDICE IN COLONNE: l'upsert deduplica solo se questa coppia coincide con
 * l'unique index della migration. Un drift qui non dà errori vistosi — ogni upsert fallisce,
 * acquireHolder torna null, la contabilità tace e le VM restano accese. `sandbox-leases.test.ts`
 * confronta questa costante col file SQL: se divergono, il test lo urla.
 */
export const HOLDER_CONFLICT_TARGET = 'sandbox_name,holder_key';

/** Il pannello ripassa ogni ~2.5s: il TTL deve coprire più poll, non più di tanto. */
export const DESKTOP_HOLDER_TTL_MS = 120_000;

/**
 * L'holder di chi guarda il desktop. Nessuna release: il ciclo di vita lo conosce solo il browser,
 * quindi la riga scade da sola e ogni poll la rinfresca. Se il tab muore, la VM si spegne al
 * prossimo evento di contabilità — mai sotto gli occhi di chi la sta guardando.
 */
export function holdDesktop(name: string, brandId: string, agentId?: string): Promise<string | null> {
  return acquireHolder({
    name,
    brandId,
    key: `desktop:${agentId ?? 'brand'}`,
    kind: 'desktop',
    ttlMs: DESKTOP_HOLDER_TTL_MS
  });
}

export type HolderKind = 'turn' | 'desktop';

type Db = ReturnType<typeof createAdminClient>;
type Stoppable = { stop: () => Promise<unknown> };

async function stopWhenIdle(name: string, raw: Stoppable | undefined, db: Db): Promise<void> {
  if (!raw) return;
  try {
    const { count } = await db
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('sandbox_name', name)
      .gt('expires_at', new Date().toISOString());
    if (count === 0) await raw.stop();
  } catch (err) {
    swallow('stopIfIdle failed', err);
  }
}

/**
 * Registra (o rinfresca) un holder. La chiave deduplica: chi ripassa di qui — un poll del
 * pannello desktop ogni 2.5s — rinfresca la scadenza della SUA riga invece di accumularne.
 * Ritorna l'id della riga, o `null` se il database non c'è: il turno prosegue uguale.
 */
export async function acquireHolder(opts: {
  name: string;
  brandId: string;
  key: string;
  kind: HolderKind;
  ttlMs: number;
  db?: Db;
}): Promise<string | null> {
  try {
    const db = opts.db ?? createAdminClient();
    const expires_at = new Date(Date.now() + opts.ttlMs).toISOString();
    const { data, error } = await db
      .from(TABLE)
      .upsert(
        { sandbox_name: opts.name, brand_id: opts.brandId, holder_key: opts.key, kind: opts.kind, expires_at },
        { onConflict: HOLDER_CONFLICT_TARGET }
      )
      .select('id')
      .single();
    if (error) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

/** Chiude il ciclo di vita: via la riga, e se era l'ultima la macchina si spegne. */
export async function releaseHolder(id: string, raw: Stoppable | undefined, db?: Db): Promise<void> {
  try {
    const client = db ?? createAdminClient();
    const { data } = await client.from(TABLE).delete().eq('id', id).select('sandbox_name').maybeSingle();
    const name = data ? (data as { sandbox_name: string }).sandbox_name : null;
    if (!name) return;
    await stopWhenIdle(name, raw, client);
  } catch {
    // Il turno è già finito: una contabilità persa qui non rompe niente.
  }
}
