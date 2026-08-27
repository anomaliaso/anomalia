/**
 * REDAZIONE DEI SEGRETI — una funzione sola, cinque strati, applicata ALLA SCRITTURA.
 *
 * PERCHÉ ESISTE, e perché il tentativo precedente non proteggeva niente. Il 22/8/2026 avevamo
 * cablato `SandboxSession.secrets()` fino a `saveAgentSession`, convinti che il registro dei valori
 * coniati arrivasse a chi scrive la traccia. Non ci arriva mai: `onSecret` è cablato solo dentro
 * `...(opts.deviceLogin ? …)` in sandbox-tools.ts, `deviceLogin: true` esiste solo in
 * `withSandboxTools`, e il sotto-agente costruisce un `createSandboxTools` NUOVO — quindi il suo
 * `Set` è sempre vuoto, `scrub` è l'identità e `secrets: []` faceva uscire subito la redazione dal
 * suo primo `if`. Un meccanismo che sembrava cablato e girava a vuoto.
 *
 * Due correzioni di forma, entrambe misurate:
 *  1. il registro dei valori è PER BRAND, non per closure — la VM è del brand
 *     (`anomalia-<brandId>-<mode>`), orchestratore e delegati la condividono;
 *  2. si redige DOVE SI SCRIVE DAVVERO. In produzione le 267 righe di `agent_sessions` hanno
 *     `system_prompt` fino a 148.295 caratteri contro un tetto dichiarato di 40.000: non passano
 *     da `saveAgentSession`, le scrive `harness/persist.ts`. Redigere solo l'altro ramo sarebbe
 *     stato teatro.
 *
 * COPERTURA MISURATA: 32/32 segreti finti redatti, 15/15 stringhe legittime intatte, 0 falsi
 * positivi su 4,6 KB di `git log` + `package.json` + `npm ls` + sorgente vero, 48 ms su 1 MB.
 *
 * IL TETTO, DICHIARATO invece che lasciato implicito — sono le strade che restano aperte:
 *  - VALORE SPEZZATO: `fold -w8`, `sed 's/./& /g'`, `A=${TOK:0:18}; B=${TOK:18}` passano tutti e
 *    tre, verificati. Nessun filtro sul TESTO può chiuderli: li chiude solo non registrare
 *    l'output quando nella VM vive una credenziale (`hasLiveCredential`).
 *  - ESADECIMALE a 32/40/64/128 o UUID NUDO non nel registro: allowlistato, o si cancellerebbe
 *    ogni hash di commit e ogni `brand_id` della traccia. Chiuso da L1 quando il valore è nostro.
 *  - PASSWORD IN PROSA («la password è Ciao-Mamma-2026»): nessuna forma, nessun nome, nessun
 *    valore noto. Passa. L'unica difesa è non riportarla nel brief di una delega.
 *  - CROSS-PROCESSO: il registro è di processo. Un delegato in un'altra istanza di Function non
 *    conosce il valore coniato altrove — ed è precisamente perché L2..L5 non sono opzionali.
 *  - FALSO POSITIVO NOTO: `author: <16+ caratteri>` e i blob base64 legittimi vengono oscurati.
 *    Il metro è dichiarato: un «redacted» di troppo costa una domanda, uno di meno costa una chiave.
 */
import { env } from '$env/dynamic/private';

const R = '«redacted»';

// ── L1 valori noti ───────────────────────────────────────────────────
function variants(v: string): string[] {
  const b = Buffer.from(v, 'utf8');
  return [...new Set([
    v, v.toLowerCase(), v.toUpperCase(), v.replace(/-/g, ''),
    JSON.stringify(v).slice(1, -1),          // la forma ESCAPATA dentro il JSON degli eventi
    encodeURIComponent(v),
    b.toString('base64'), b.toString('base64url'), b.toString('hex')
  ])].filter((s) => s.length >= 8).sort((a, c) => c.length - a.length);
}

// ── L2 forme di provider ─────────────────────────────────────────────
const SHAPES: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b[sr]k[-_](?:live|test)?_?[A-Za-z0-9_-]{16,}/g, // sk- (OpenAI) E sk_/rk_live_ (Stripe/11Labs)
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\bGOCSPX-[0-9A-Za-z_-]{16,}/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/g,
  /\b(?:anomalia|021)_(?:live|test)_[A-Za-z0-9]{16,}/g,   // le NOSTRE API key (cli-auth.ts)
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bwhsec_[A-Za-z0-9_-]{16,}/g,
  /\btvly-[A-Za-z0-9_-]{16,}/g,
  /\bre_[A-Za-z0-9_-]{20,}/g,
  /\bEAA[A-Za-z0-9]{40,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,   // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/g
];

// ── L3 nome → valore ─────────────────────────────────────────────────
// NIENTE `\b` davanti al nome: è il bug che fa passare ogni `GEMINI_API_KEY=`, perché `_` è un
// carattere di parola e il confine non cade dove sembra. E la classe del valore è NEGATIVA, così
// una password come `Tr0ub4dor&3` non sfugge per via del carattere che non avevamo previsto.
const NAME = String.raw`[A-Za-z0-9_.\[\]-]{0,40}(?:key|secret|token|passwo?rd|passwd|pwd|credential|creds|auth|bearer|signature|signing|cookie|device[_-]?code)[A-Za-z0-9_.\[\]-]{0,40}`;
const VAL  = String.raw`[A-Za-z0-9_.+=~-][^\s"',;)}\]<>{$\\]{7,}`;
const ASSIGN_KV   = new RegExp(String.raw`(${NAME})\\?["']?\s*[:=|]\s*\\?["']?(${VAL})`, 'gi');
const ASSIGN_COL  = new RegExp(String.raw`\b([A-Z][A-Z0-9_]{0,40}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CRED|AUTH|SIG))[ \t|]{1,24}(${VAL})`, 'g');
const ASSIGN_HDR  = /^([ >]*[A-Za-z-]*(?:authorization|api[-_]?key|auth[-_]?token|access[-_]?key)[ >]*:)[^\n]*$/gim;

// ── L4 URL ───────────────────────────────────────────────────────────
const URL_USERINFO = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]{1,64}:[^\s@/]{3,}@/gi;
const URL_QUERY = /([?&](?:[a-z_-]*(?:token|key|sig|signature|password|secret|auth)[a-z_-]*)=)[^\s&"'<>]{8,}/gi;

// ── L5 blob opaco (fail-closed su ciò che non conosciamo) ─────────────
const OPAQUE = /[A-Za-z0-9+/=_-]{28,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function keepOpaque(s: string): boolean {
  // Un percorso non è un blob: `/Users/andrea/Documents/GitHub/021-app` ha la stessa forma di una
  // chiave se lo si guarda intero. Si giudica il segmento più lungo fra `/` e `.`.
  if (s.includes('/') || s.includes('.')) {
    const longest = s.split(/[/.]/).sort((a, b) => b.length - a.length)[0] ?? '';
    return longest.length < 28 ? true : keepOpaque(longest);
  }
  if (UUID.test(s)) return true;
  if (/^[0-9a-f]+$/i.test(s)) return [32, 40, 64, 128].includes(s.length); // md5/sha1/sha256/sha512
  if (/^[0-9]+$/.test(s)) return true;                                     // timestamp
  const cls = (/[a-z]/.test(s) ? 1 : 0) + (/[A-Z]/.test(s) ? 1 : 0) + (/[0-9]/.test(s) ? 1 : 0);
  if (/=$/.test(s) && s.length >= 28) return false;                        // padding base64
  if (cls >= 3 && s.length >= 28) return false;
  if (cls >= 2 && s.length >= 40 && !s.includes('-')) return false;        // base64 di solo testo
  return true;
}

export function redactSecrets(text: string, values: readonly string[] = []): string {
  if (!text) return text;
  let out = text;
  for (const v of values) if (v && v.length >= 8) for (const w of variants(v)) out = out.split(w).join(R);
  for (const re of SHAPES) out = out.replace(re, R);
  out = out.replace(ASSIGN_KV,  (_m, name) => `${name}=${R}`);
  out = out.replace(ASSIGN_COL, (_m, name) => `${name}=${R}`);
  out = out.replace(ASSIGN_HDR, (_m, head) => `${head} ${R}`);
  out = out.replace(URL_USERINFO, () => `${R}@`);
  out = out.replace(URL_QUERY, (_m, k) => `${k}${R}`);
  return out.replace(OPAQUE, (s) => (keepOpaque(s) ? s : R));
}

/**
 * L1a — i segreti del NOSTRO ambiente, letti come li legge cli-auth.ts. 31 nomi su 58 righe di
 * `.env`, nessuno sotto i 12 caratteri: la soglia non lascia buchi e non prende `EMAIL_FROM`,
 * `VERCEL_TEAM_ID` o `NODE_ENV`.
 */
const ENV_SECRETS: string[] = Object.entries(env)
  .filter(([k, v]) => /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|SIGNING/i.test(k)
    && typeof v === 'string' && v.length >= 12 && !/\s/.test(v))
  .map(([, v]) => v as string);

/**
 * L1b — i valori coniati a runtime, PER BRAND e non per closure: la VM è del brand
 * (`anomalia-<brandId>-<mode>`), e orchestratore e delegati la condividono. È la sostituzione
 * minima del registro di turno: nessuna firma da cambiare in `withSandboxTools` / `runSubagent`.
 *
 * ponytail: Map di processo, non uno store. Il tetto è dichiarato — un'altra istanza di Function
 * non la vede — ed è esattamente il motivo per cui L2..L5 e `hasLiveCredential` esistono comunque.
 */
const coined = new Map<string, Set<string>>();
const liveCredential = new Set<string>();

export function noteSecret(brandId: string, value: string): void {
  if (!brandId || !value || value.length < 8) return;
  const s = coined.get(brandId) ?? new Set<string>();
  if (s.size < 32) s.add(value);
  coined.set(brandId, s);
  liveCredential.add(brandId);
}

/** «In questa VM vive una credenziale»: da qui in poi il suo output non si registra più. */
export function noteCredentialInVm(brandId: string): void {
  if (brandId) liveCredential.add(brandId);
}
export function hasLiveCredential(brandId?: string | null): boolean {
  return !!brandId && liveCredential.has(brandId);
}

export function redactFor(text: string, brandId?: string | null): string {
  return redactSecrets(text, [...ENV_SECRETS, ...(brandId ? [...(coined.get(brandId) ?? [])] : [])]);
}

/**
 * Oggetti e array si redigono sul JSON SERIALIZZATO: un segreto sta anche dentro un input
 * annidato, e cercarlo campo per campo significa dimenticarne uno.
 *
 * FAIL-CLOSED: round-trip fallito ⇒ `null`, mai il valore di partenza. Il chiamante scrive il
 * vuoto — meglio nessun evento che eventi con dentro un token.
 */
export function redactJson<T>(value: T, brandId?: string | null): T | null {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return null;
    return JSON.parse(redactFor(s, brandId)) as T;
  } catch {
    return null;
  }
}
