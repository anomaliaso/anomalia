/**
 * QUESTA INSTALLAZIONE HA UN TENANT SOLO?
 *
 * Una riga di configurazione che decide se esiste un guscio multi-brand: lo switcher, la lista
 * dei brand, i membri, gli inviti. Non decide COME si risolve il brand corrente — quello lo fa
 * `tenant.ts` — decide se ha senso chiederselo.
 *
 * SOLO LO UUID, e non anche nome e slug: quelli vivono nella riga `brands`, e duplicarli in
 * ambiente significa il giorno in cui divergono avere un'app che si chiama in un modo e un
 * database che dice l'altro, senza un errore da nessuna parte. L'ambiente porta il puntatore.
 *
 * Il valore si legge a ogni richiesta (`$env/dynamic/private`): un'installazione può passare da
 * uno a molti senza ricostruire, ed è ciò che rende provabile la configurazione a tenant singolo
 * dentro lo stesso repo, prima che esista una build separata.
 */
import { env } from '$env/dynamic/private';

/** Lo UUID del brand unico, o `null` quando i brand sono molti. */
export function soleTenantId(): string | null {
	const raw = env.TENANT_BRAND_ID?.trim();
	return raw ? raw : null;
}

/** True quando i brand possono essere più di uno: è la condizione del guscio. */
export function hasManyTenants(): boolean {
	return soleTenantId() === null;
}
