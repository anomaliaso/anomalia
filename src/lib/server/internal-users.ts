// Chi siamo noi.
//
// Sta in `$lib/server` apposta: SvelteKit rifiuta di importare questo file da codice che gira nel
// browser, quindi gli indirizzi non finiscono mai in un bundle pubblico. Chi ne ha bisogno lato
// client riceve un booleano già calcolato (vedi `analyticsOptOut` nel root +layout.server.ts).
//
// Usato per non registrare le nostre stesse sessioni negli analytics: un giro di test del founder
// che diventa una "sessione utente" in PostHog o una "CompleteRegistration" per Meta non è un dato,
// è rumore che poi guida decisioni sbagliate.
//
// ponytail: lista + domini, niente tabella. Sono tre persone. Se un giorno il team cresce oltre i
// domini qui sotto, la mossa è una colonna `internal` sul profilo, non allungare questo array.

import { env } from '$env/dynamic/private';

/** Domini dell'azienda: chiunque abbia una mail qui è dei nostri. */
function internalDomains(): string[] {
  const raw = env.INTERNAL_EMAIL_DOMAINS?.trim();
  if (!raw) {
    return ['anomalia.so'];
  }
  const list = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : ['anomalia.so'];
}

/**
 * Account personali del team (founder + Marco). Sono gli stessi che compaiono in
 * `brand-limits.ts` (slot illimitati) e in `ads-fee.ts` (preview Ads): liste separate di proposito,
 * perché "è dei nostri" e "ha diritto a X" sono domande diverse e non devono muoversi insieme.
 */
// Da env, non dal sorgente: il repo va open source e un'email personale hardcoded è
// igiene mancata (audit pre-pubblicazione, 23/8). Stessi valori, spostati in INTERNAL_EMAILS.
// Per CHIAMATA, non al load del modulo: $env/dynamic è dinamica apposta (e i test la iniettano
// dopo l'import — una costante congelata li vedrebbe sempre vuoti).
function internalEmails(): string[] {
  return (env.INTERNAL_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True se l'indirizzo è di un account interno. Confronto case-insensitive; null/'' → false. */
export function isInternalEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  if (internalEmails().includes(e)) return true;
  const domain = e.slice(e.lastIndexOf('@') + 1);
  return internalDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Dogfood Ads: questi account vedono la UI self-serve anche con la flag globale spenta.
 * Da env (`ADS_PREVIEW_EMAILS`, lista separata da virgole) — prima era una costante in
 * `$lib/ads-fee.ts`, cioè NEL BUNDLE DEL BROWSER: due email personali servite a ogni visitatore.
 */
export function isAdsPreviewUser(email?: string | null): boolean {
  const e = (email ?? '').trim().toLowerCase();
  const list = (env.ADS_PREVIEW_EMAILS ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(e);
}
