/**
 * Il payload della card "accedi con il codice" (tool `sandbox_device_login`).
 *
 * Client-safe per la stessa ragione di chat-connect.ts: lo leggono la persistenza (che
 * arricchisce la tool-call part), la ChatColumn e la chat a pagina piena — un normalizzatore
 * solo, così le superfici non divergono su cosa è renderizzabile.
 *
 * Due forme, entrambe legittime:
 * - lo `start` porta il codice pubblico (user_code + verification_uri): card grande col codice;
 * - il `check` porta solo lo stato (authorized / expired / denied): card compatta di esito.
 * Il token NON esiste in nessuna delle due — non lascia mai la VM, per design.
 */
export type DeviceLoginState = {
  /** Oggi solo 'github'; il campo esiste perché la card non deve cambiare al secondo provider. */
  provider: string;
  status: 'pending' | 'authorized' | 'expired' | 'denied';
  /** Il codice che l'utente digita: pubblico per design. Nullo nelle risposte di solo stato. */
  user_code: string | null;
  verification_uri: string | null;
  /** Epoch ms: la card ci fa il countdown e si dichiara scaduta da sola. */
  expires_at: number | null;
};

export function normalizeDeviceLoginPayload(raw: unknown): DeviceLoginState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.error) return null;
  const status =
    r.status === 'pending' || r.status === 'authorized' || r.status === 'expired' || r.status === 'denied'
      ? r.status
      : null;
  if (!status) return null; // 'none' e stati sconosciuti non hanno card
  if (typeof r.provider !== 'string' || !r.provider) return null;
  const userCode = typeof r.user_code === 'string' && r.user_code ? r.user_code : null;
  // Un "pending" senza codice è il ritorno di un check ancora in attesa: la card dello start è
  // già in chat con il codice — una seconda card muta non aggiungerebbe niente.
  if (status === 'pending' && !userCode) return null;
  return {
    provider: r.provider,
    status,
    user_code: userCode,
    verification_uri: typeof r.verification_uri === 'string' && r.verification_uri ? r.verification_uri : null,
    expires_at: typeof r.expires_at === 'number' && Number.isFinite(r.expires_at) ? r.expires_at : null
  };
}
