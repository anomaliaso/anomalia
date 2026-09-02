/**
 * Cosa disegna la shell del brand MENTRE una navigazione è in volo.
 *
 * Lo scheletro è ottimistico: parte al clic, non a load finita, o la pagina di prima resterebbe
 * a schermo per tutta la load. Le eccezioni sono poche e ognuna ha il suo motivo, quindi stanno
 * tutte qui: una regola scritta in due `$derived` di un file .svelte non si può né leggere tutta
 * insieme né mettere sotto test, ed è così che ci è passata sotto la più cara — la chat.
 */

export type ShellShimmer = 'page' | 'overview' | 'chat' | 'calendar' | 'media';

/** Il primo segmento di `/app/...` quando è uno slug di brand (non una rotta sorella). */
const NON_BRAND_APP_SEGMENTS = new Set(['onboarding']);

export function appBrandSlug(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const seg = pathname.match(/^\/app\/([^/]+)/)?.[1];
  if (!seg || NON_BRAND_APP_SEGMENTS.has(seg)) return null;
  return seg;
}

/** Un thread APERTO. Il composer vuoto (`/chat/new`) non è un thread: non ha niente da caricare. */
export function isThreadPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /\/chat\/[^/]+\/?$/.test(pathname) && !pathname.endsWith('/chat/new');
}

/** Le rotte che si aprono dentro la shell ma non ne fanno parte: nessuno scheletro sopra. */
const PASSTHROUGH = ['/success', '/activate', '/proposal'];

export type ShellNavigation = {
  from: string | null | undefined;
  to: string | null | undefined;
  fromSearch: string;
  toSearch: string;
  brandSlug: string;
};

export function shellShimmerFor(nav: ShellNavigation): ShellShimmer | null {
  const { from, to } = nav;
  if (!to) return null;
  if (PASSTHROUGH.some((p) => to.includes(p))) return null;

  const toBrand = appBrandSlug(to);
  const brandSwitch = !!toBrand && toBrand !== nav.brandSlug;

  // Panoramica → thread: la Panoramica È il composer, e un invio può essere in volo dentro. Uno
  // scheletro qui lo smonta a metà e il turno appena spedito sparisce dallo schermo.
  //
  // Thread → THREAD è il caso opposto, e senza scheletro mente: la testata cambia al clic (il
  // nome viene dallo store, in memoria) e il transcript solo a load finita (viene dal server),
  // quindi nel mezzo si legge la conversazione di PRIMA sotto il nome dell'agente NUOVO. Con due
  // agenti appena presentati, che si somigliano, è come se dicessero la stessa cosa.
  if (isThreadPath(to) && !isThreadPath(from) && !brandSwitch) return null;

  const base = `/app/${nav.brandSlug}`;
  if (!brandSwitch && !(to === base || to.startsWith(`${base}/`))) return null;
  if (!brandSwitch && !toBrand) return null;
  if (from === to && nav.fromSearch === nav.toSearch) return null;

  const toBase = toBrand ? `/app/${toBrand}` : base;
  if (to === toBase || to === `${toBase}/`) return 'overview';
  if (isThreadPath(to)) return 'chat';
  if (/\/calendar\/?$/.test(to)) return 'calendar';
  if (/\/(media-generator|ugc-creator|motion-video)\/?$/.test(to)) return 'media';
  return 'page';
}
