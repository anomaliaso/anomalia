/**
 * Il payload della card "la tua squadra" (tool `show_team`).
 *
 * Client-safe e con UN normalizzatore, per la stessa ragione di chat-connect.ts: lo leggono tre
 * posti — la persistenza (che arricchisce la tool-call part perché la compattazione dei turni
 * lunghi butta gli output), la ChatColumn e la chat a pagina piena — e due copie della regola
 * "cosa è renderizzabile" divergono al primo cambio.
 *
 * Qui NON viaggia nessun testo da mostrare: solo id di agenti e chiavi di routine. I nomi e le
 * descrizioni li mette la card dai cataloghi che esistono già (`chat.agents.*`,
 * `app.roster.job.*`), quindi la squadra si legge nella lingua di chi guarda anche se la chat era
 * in un'altra — e un turno salvato mesi fa non si porta dietro etichette invecchiate.
 */

/** Una routine custom del brand, come la mostra la card. */
export type TeamCardRoutine = {
  id: string;
  name: string;
  days: number[];
  times: string[];
  enabled: boolean;
};

export type TeamCardAgent = {
  /** content | analyst | web | ugc | motion | auto — gli stessi id del composer. */
  id: string;
  /** Le routine incluse (chiavi del roster), con l'interruttore per brand. */
  routines: { key: string; enabled: boolean }[];
  /** Le routine custom assegnate a questo agente (owner `team:<id>`). */
  custom: TeamCardRoutine[];
};

export type TeamCard = {
  agents: TeamCardAgent[];
  /** I custom agent senza proprietario: colleghi a sé, non routine di qualcuno. */
  standalone: TeamCardRoutine[];
  /** false = il lavoro ricorrente non parte finché il piano non è attivo (scheduledWorkAllowed). */
  scheduled: boolean;
};

const str = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function routine(raw: unknown): TeamCardRoutine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 80);
  if (!name) return null;
  return {
    id: str(r.id, 64),
    name,
    days: Array.isArray(r.days) ? r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
    times: Array.isArray(r.times) ? r.times.map((t) => str(t, 5)).filter(Boolean).slice(0, 4) : [],
    enabled: r.enabled !== false
  };
}

/** Accetta sia la part arricchita dalla persistenza sia l'output grezzo del turno live. */
export function normalizeTeamPayload(raw: unknown): TeamCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const t = (src.team && typeof src.team === 'object' ? src.team : src) as Record<string, unknown>;
  if (!Array.isArray(t.agents)) return null;

  const agents: TeamCardAgent[] = [];
  for (const a of t.agents) {
    if (!a || typeof a !== 'object') continue;
    const row = a as Record<string, unknown>;
    const id = str(row.id, 24);
    if (!id) continue;
    agents.push({
      id,
      routines: Array.isArray(row.routines)
        ? row.routines
            .map((r) => (r && typeof r === 'object' ? r : null))
            .filter((r): r is Record<string, unknown> => !!r)
            .map((r) => ({ key: str(r.key, 40), enabled: r.enabled !== false }))
            .filter((r) => !!r.key)
        : [],
      custom: Array.isArray(row.custom)
        ? row.custom.map(routine).filter((r): r is TeamCardRoutine => !!r)
        : []
    });
  }
  // Una card senza nessun agente non è una squadra: meglio niente che un riquadro vuoto.
  if (!agents.length) return null;

  return {
    agents,
    standalone: Array.isArray(t.standalone)
      ? t.standalone.map(routine).filter((r): r is TeamCardRoutine => !!r)
      : [],
    scheduled: t.scheduled !== false
  };
}
