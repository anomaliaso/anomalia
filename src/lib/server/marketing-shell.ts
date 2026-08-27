/**
 * NASCONDERE IL SITO DI MARKETING, TENERE L'APP.
 *
 * Su un'installazione self-hosted la homepage, il pricing e il resto del pitch
 * di anomalia.so sono mobili di un altro prodotto. `HIDE_MARKETING=1` (anche
 * `true` / `yes`) reindirizza quelle rotte a `/app`, che già manda chi non è
 * loggato al login. Non è nella guida: è un interruttore per chi installa e
 * non vuole il sito commerciale in casa.
 *
 * Si legge a ogni richiesta (`$env/dynamic/private`): si accende senza
 * ricostruire. Spento (default) il hosted product non cambia di una riga.
 *
 * Cosa NON è. Non toglie i file dal repo, non è una build. I blog dei brand
 * (`/_site`, `/blog/…`), login, auth, API, admin restano. `/start` (il funnel
 * ospite della landing) segue il marketing: senza landing non c'è funnel.
 */
import { env } from '$env/dynamic/private';

function truthy(raw: string | undefined): boolean {
	const v = raw?.trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

/** True quando questa installazione non deve mostrare il sito commerciale. */
export function hideMarketing(): boolean {
	return truthy(env.HIDE_MARKETING);
}

/**
 * Rotte del pitch: il gruppo `[[lang=locale]]` (homepage, pricing, tools, docs
 * pubbliche, waitlist, …) e `/start`. Tutto il resto — app, auth, API, blog,
 * asset, sitemap — non è marketing.
 *
 * Si giudica `route.id` e non il pathname: su un dominio custom del brand il
 * path è `/` ma la rotta è `/_site`. Guardare l'URL manderebbe il blog in `/app`.
 */
export function isMarketingRoute(routeId: string | null | undefined): boolean {
	if (!routeId) return false;
	if (routeId === '/start' || routeId.startsWith('/start/')) return true;
	return routeId === '/[[lang=locale]]' || routeId.startsWith('/[[lang=locale]]/');
}

/**
 * Destinazione del redirect, o `null` se questa richiesta deve restare dov'è.
 * `/app` decide il resto: anonimo → `/login`, un tenant → lo slug, molti →
 * ultimo brand. Non si duplica quella logica qui.
 */
export function marketingShellTarget(routeId: string | null | undefined): '/app' | null {
	if (!hideMarketing()) return null;
	if (!isMarketingRoute(routeId)) return null;
	return '/app';
}
