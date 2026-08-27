import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { safeSecretEqual } from '$lib/server/secret-compare';
import { agentFilesManifest, syncAgentFiles } from '$lib/server/chat/agent-files';

/**
 * LA MAPPA DI COSA LEGGONO GLI AGENTI, e il riallineamento del bucket che la mostra.
 *
 * Una GET fa due cose insieme, ed è deliberato: **rigenera** `defaults/**` e `INDEX/*.md` nel
 * bucket `agent-docs`, poi **restituisce** il manifesto (quali file esistono, di quale mestiere
 * sono, quali azioni sbloccano, quanto sono lunghi, e quali sono stati sovrascritti a mano). Così
 * un solo indirizzo risponde alle due domande — «cosa può leggere ciascun agente?» e «è allineato
 * a quello che dice il codice?» — e lo stesso indirizzo va nel cron senza inventare una seconda
 * rotta.
 *
 * `overrides/` non viene MAI toccato: il riallineamento non può cancellare una modifica del
 * proprietario. Sta nella forma delle cartelle, non in un controllo che qualcuno può dimenticare.
 *
 * Auth: lo stesso Bearer dei cron (Vercel inietta `CRON_SECRET`). Niente sessione utente qui —
 * sono file globali, non di un brand, e il service role scrive nel bucket.
 */
// 129 file caricati in sequenza: ~50 ms l'uno, servono piu` dei 10s di default.
export const config = { maxDuration: 60 };

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || !safeSecretEqual(auth.replace(/^Bearer\s+/i, ''), secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const sync = await syncAgentFiles();
  const manifest = await agentFilesManifest();
  return Response.json({
    ...manifest,
    synced: sync.written,
    // Il bucket arriva con la migration 0214: finché non è applicata questo dice perché lo
    // specchio è vuoto, invece di far sembrare che non ci sia niente da vedere.
    sync_error: sync.error ?? null
  });
};
