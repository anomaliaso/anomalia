/**
 * Quanto ci è costato DAVVERO questo turno, detto da chi ce lo fattura.
 *
 * `RATES` in ai-log.ts prezza per token i modelli che qualcuno ha scritto lì a mano, e un modello
 * assente non vale "prudentemente null": vale zero crediti. Misurato sul database — 54 righe
 * `llm/z-ai/glm-5.3-flash`, 30 `google/gemini-3.7-flash` e ogni riga del modello di default,
 * tutte senza costo. Un listino a mano non regge un catalogo che sceglie l'utente.
 *
 * OpenRouter allega `usage.cost` alla risposta quando glielo si chiede (`usage: {include: true}`),
 * anche in streaming, dentro l'ULTIMO chunk. È la fattura: copre il modello che ha risposto
 * davvero, il provider a monte e il markup.
 *
 * L'alternativa era `GET /generation?id=` con l'`x-generation-id` dell'header. Scartata dopo
 * averla misurata: il record compare **9 secondi** dopo la risposta, e tenere in vita una
 * funzione serverless per aspettarlo significa perdere anche la riga di log.
 */

const OPENROUTER_HOST = 'openrouter.ai';

function costOf(usage: unknown): number | null {
  const raw = (usage as { cost?: unknown } | null | undefined)?.cost;
  // `Number(null)` è 0, e uno zero finto è peggio di un costo mancante: sarebbe un turno
  // dichiarato gratuito invece che non misurato.
  const cost = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(cost) ? cost : null;
}

export function costFromJson(body: unknown): number | null {
  return costOf((body as { usage?: unknown } | null | undefined)?.usage);
}

/** L'ultimo chunk che porta un costo vince: i precedenti sono parziali o assenti. */
export function costFromStreamText(text: string): number | null {
  let last: number | null = null;
  for (const line of text.split('\n')) {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!payload || payload === '[DONE]') continue;
    try {
      const cost = costFromJson(JSON.parse(payload));
      if (cost != null) last = cost;
    } catch {
      // Un chunk troncato non è un guasto: il costo sta nell'ultimo, che arriva intero.
    }
  }
  return last;
}

/**
 * Il corpo della richiesta con la contabilità chiesta, o null se non c'è niente da cambiare.
 * Solo verso OpenRouter: su un altro gateway OpenAI-compatibile un campo sconosciuto nel corpo
 * è un 400 su ogni chiamata.
 */
export function withUsageAccounting(body: string, baseUrl: string): string | null {
  if (!new URL(baseUrl).hostname.endsWith(OPENROUTER_HOST)) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.usage) return null;
    return JSON.stringify({ ...parsed, usage: { include: true } });
  } catch {
    return null;
  }
}
