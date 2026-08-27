/**
 * LA SCATOLA NERA DEI SOTTO-AGENTI.
 *
 * `agent_sessions` esisteva da agosto e non ci scriveva nessuno: una tabella vuota con dentro
 * esattamente le colonne che servivano. Il conto di quella mancanza si è visto due volte di fila
 * sulla sandbox — un `browser: false` senza motivo, poi un provisioning che non risultava nemmeno
 * tentato — e in entrambi i casi l'unico modo di capire cosa fosse successo è stato interrogare a
 * mano il database sui `tool_calls` della chat, che contengono il *riepilogo* e non il *percorso*.
 *
 * Qui dentro finisce il percorso: ogni comando eseguito nella VM col suo exit code, ogni pagina
 * aperta, ogni file salvato, e il giro del modello che li ha chiesti — system prompt, modello,
 * tool chiamati, rapporto finale.
 *
 * ## Tre vincoli, che sono il motivo per cui non è un semplice insert
 *
 * 1. **Una scrittura sola, alla fine.** Una run di sandbox fa fino a 40 comandi: quaranta INSERT
 *    dentro un turno di chat sono quaranta round trip che l'utente aspetta. Gli eventi si
 *    accumulano in memoria e partono in un colpo, dopo che il lavoro è finito.
 * 2. **Non deve poter rompere il turno.** È diagnostica: se l'insert fallisce, il turno prosegue e
 *    l'errore resta nel log. Un sotto-agente che va a buon fine ma non riesce a raccontarlo ha
 *    comunque fatto il lavoro.
 * 3. **Tetti, perché qui dentro passa output di comandi.** Un `pip install` verboso o un dump
 *    accidentale riempiono la riga: ogni evento è troncato, e gli eventi sono contati. Meglio una
 *    traccia potata e dichiarata che una tabella che diventa il posto più pesante del database.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasLiveCredential, redactFor, redactJson } from '$lib/server/redact';

/** Oltre questo una traccia non si legge più, si archivia. */
const MAX_EVENTS = 300;
/** Per evento: abbastanza per uno stack trace, non abbastanza per un CSV intero. */
const MAX_EVENT_CHARS = 4_000;
const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_SYSTEM_PROMPT_CHARS = 40_000;

export type AgentSessionEvent = {
  /** `sandbox_exec`, `sandbox_browse`, `provisioning`, `tool_call`, `report`, … */
  kind: string;
  at: string;
  ms?: number;
  ok?: boolean;
  /** Il payload dell'evento, già potato da chi lo registra. */
  data?: Record<string, unknown>;
};

export type AgentSessionRecorder = {
  event: (kind: string, data?: Record<string, unknown>, meta?: { ms?: number; ok?: boolean }) => void;
  /** Quanti eventi sono stati scartati per il tetto: dirlo evita di leggere una traccia potata come completa. */
  dropped: () => number;
  count: () => number;
  events: () => AgentSessionEvent[];
};

/**
 * NON REDIGERE — NON REGISTRARE. È l'unica difesa contro il valore SPEZZATO.
 *
 * `fold -w8`, `sed 's/./& /g'`, `A=${TOK:0:18}; B=${TOK:18}`: provati, passano ogni strato di
 * `redact.ts`, e nessun filtro sul testo puo` chiuderli — un segreto tagliato in due non e' piu'
 * una stringa da cercare. Quindi quando in quella VM vive davvero una credenziale (device login,
 * `.github.env`), l'output dei comandi non entra nella traccia PERSISTITA.
 *
 * Il modello continua a vedere l'output nel proprio turno: e' gia' pulito al confine del tool. E'
 * la copia che resta scritta per sempre a non conservarlo.
 */
/**
 * Il payload di un evento, redatto. `undefined` resta `undefined`: un evento senza dati non ha
 * niente da proteggere, e farlo passare per il fail-closed lo trasformerebbe in `{redacted:true}`
 * — cioè in una bugia su un dato che non è mai esistito.
 */
function redactEventData(
  kind: string,
  data: Record<string, unknown> | undefined,
  brandId?: string
): Record<string, unknown> | undefined {
  if (data === undefined) return undefined;
  return redactJson(withheldIfCredentialLive(kind, data, brandId), brandId) ?? { redacted: true };
}

function withheldIfCredentialLive(
  kind: string,
  data: Record<string, unknown> | undefined,
  brandId?: string
): Record<string, unknown> | undefined {
  if (!data || !hasLiveCredential(brandId)) return data;
  const isSandbox = kind === 'sandbox_exec' || (kind === 'tool_call' && String(data.tool ?? '').startsWith('sandbox_'));
  if (!isSandbox) return data;
  const out = { ...data };
  for (const f of ['stdout', 'stderr', 'output', 'content'] as const) {
    const v = out[f];
    if (typeof v === 'string' && v.length) out[f] = `«${v.length} caratteri non registrati: in questa VM vive una credenziale»`;
    else if (v && typeof v === 'object') out[f] = '«non registrato: in questa VM vive una credenziale»';
  }
  return out;
}

/** `JSON.stringify` lancia sui riferimenti circolari, e un output di tool può contenerne. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '[uncircularizable object]';
  }
}

/** Tronca qualunque valore testuale dentro un payload, ricorsivamente ma senza esagerare. */
export function clipEventData(data: Record<string, unknown> | undefined, max = MAX_EVENT_CHARS): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      out[k] = v.length > max ? `${v.slice(0, max)}…[+${v.length - max}]` : v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 50);
    } else if (v && typeof v === 'object') {
      // Serializzare e ritagliare produce JSON invalido — `JSON.parse` su un oggetto tagliato a
      // metà stringa lancia, e lancerebbe DENTRO la diagnostica di una run già andata storta.
      // Quindi: se ci sta resta un oggetto, se non ci sta diventa una stringa dichiarata.
      const raw = safeStringify(v);
      out[k] = raw.length <= max ? v : `${raw.slice(0, max)}…[+${raw.length - max}]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Un registratore in memoria. Non tocca il database finché non si chiude la sessione. */
export function createRecorder(
  now: () => number = Date.now,
  /**
   * A CHI appartiene la traccia. Serve al registro dei valori coniati, che è per BRAND e non per
   * closure: la VM è del brand, e orchestratore e delegati la condividono.
   */
  brandId?: string
): AgentSessionRecorder {
  const events: AgentSessionEvent[] = [];
  let dropped = 0;
  return {
    event(kind, data, meta) {
      if (events.length >= MAX_EVENTS) {
        dropped++;
        return;
      }
      events.push({
        kind,
        at: new Date(now()).toISOString(),
        ...(meta?.ms !== undefined ? { ms: meta.ms } : {}),
        ...(meta?.ok !== undefined ? { ok: meta.ok } : {}),
        // REDIGERE PRIMA DI TAGLIARE, e non è un dettaglio d'ordine: `clipEventData` taglia a
        // 4.000 caratteri, quindi redigere dopo lascerebbe i primi caratteri di un token appesi al
        // confine del troncamento — dieci caratteri in chiaro sono sedici tentativi di forza
        // bruta, non un segreto protetto. `redactJson` fallisce chiuso: `{ redacted: true }`
        // invece del dato grezzo.
        data: clipEventData(redactEventData(kind, data, brandId))
      });
    },
    dropped: () => dropped,
    count: () => events.length,
    events: () => events
  };
}

export type AgentSessionInsert = {
  brandId: string;
  userId?: string | null;
  threadId?: string | null;
  jobId?: string | null;
  /** Quale specialista (`grow`, `publish`, …) o null. */
  agent: string;
  /** Il ruolo del sotto-agente: research | execute | verify | sandbox. */
  mode: string;
  surface: string;
  status: 'ok' | 'error' | 'cancelled';
  model?: string | null;
  provider?: string | null;
  systemPrompt?: string | null;
  transcript: string;
  error?: string | null;
  recorder: AgentSessionRecorder;
};

/**
 * Chiude la sessione e la scrive. Non lancia mai: la diagnostica non può essere il motivo per cui
 * un turno fallisce, e un errore qui è comunque visibile nel log della Function.
 */
/**
 * LA RIGA, come funzione pura — così il test può guardarla senza un database.
 *
 * OGNI campo passa da `redactFor`, non solo `transcript`: fino al 22/8/2026 `system_prompt` ed
 * `error` non passavano da nessuna redazione, ed è dove finiscono l'ambiente del brand e il
 * messaggio d'errore che cita il comando che è esploso — cioè il comando con dentro il token.
 *
 * E la redazione viene PRIMA dello `slice`, sempre: tagliare per primo lascia un moncone di
 * segreto che nessuno strato riconosce più.
 *
 * `format_version: 2` è il marcatore «redatta alla scrittura». La colonna esiste già in
 * produzione, quindi qui non serve nessuna migration — e i lettori la usano per rifiutare le
 * righe vecchie invece di servirle in chiaro.
 */
export function agentSessionRow(s: AgentSessionInsert, events = s.recorder.events()) {
  const b = s.brandId;
  return {
    brand_id: s.brandId,
    user_id: s.userId ?? null,
    thread_id: s.threadId ?? null,
    job_id: s.jobId ?? null,
    agent: s.agent,
    mode: s.mode,
    surface: s.surface,
    status: s.status,
    model: s.model ?? null,
    provider: s.provider ?? null,
    system_prompt: s.systemPrompt ? redactFor(s.systemPrompt, b).slice(0, MAX_SYSTEM_PROMPT_CHARS) : null,
    transcript: redactFor(s.transcript ?? '', b).slice(0, MAX_TRANSCRIPT_CHARS),
    // Gli eventi sono già redatti a uno a uno dal recorder (prima del taglio). Questo secondo giro
    // è la cintura: prende ciò che fosse entrato per altre strade, e fallisce chiuso.
    events: redactJson(events, b) ?? [],
    event_count: events.length,
    error: s.error ? redactFor(s.error, b) : null,
    format_version: 2,
    finished_at: new Date().toISOString()
  };
}

export async function saveAgentSession(s: AgentSessionInsert): Promise<string | null> {
  try {
    // Admin, e non il client dell'utente: su `agent_sessions` esiste una sola policy ed è di
    // SELECT ("readable by brand members"). Con il client RLS ogni insert verrebbe rifiutato, e
    // dato che qui gli errori si ingoiano di proposito il risultato sarebbe una tabella che resta
    // vuota senza che nessuno se ne accorga — cioè la stessa classe di bug che questo file esiste
    // per rendere impossibile. La lettura resta dell'utente, vincolata dalla policy.
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const supabase: SupabaseClient = createAdminClient();
    const dropped = s.recorder.dropped();
    // Gli eventi si redigono INTERI, serializzati: un segreto può stare in un input annidato, in un
  // messaggio d'errore o nel testo del modello, e cercarlo campo per campo significherebbe
  // dimenticarne uno. Il round-trip costa una serializzazione su una scrittura che ne fa già una.
  const events = s.recorder.events();
    if (dropped > 0) {
      events.push({
        kind: 'truncated',
        at: new Date().toISOString(),
        data: { dropped, reason: `event cap (${MAX_EVENTS}) reached — this trace is NOT complete` }
      });
    }
    const { data, error } = await supabase
      .from('agent_sessions')
      .insert(agentSessionRow(s, events))
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[agent-sessions] insert failed', error.message);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[agent-sessions] insert threw', e instanceof Error ? e.message : String(e));
    return null;
  }
}
