/**
 * QUALE BRAND STO GUARDANDO — la domanda, in un punto solo.
 *
 * Oggi la risposta è una convenzione ripetuta: leggi lo slug dall'URL, cerca la riga, controlla
 * che l'utente la veda. Funziona, ed è già concentrata in un posto — `app/[brand]/+layout.server.ts`
 * la fa una volta e 64 file la ereditano da `parent()`. Ma è una convenzione, non un contratto:
 * niente impedisce al prossimo pezzo di codice di rifarla per conto suo.
 *
 * Qui diventa un contratto. Il guadagno non è oggi: è che una build a tenant singolo può
 * rispondere `{ brand: quello, peers: null }` senza toccare nessuno dei suoi chiamanti.
 *
 * `peers` sta a parte apposta: è l'UNICA cosa in questa funzione che esiste perché i brand sono
 * più di uno. Il giorno che non serve, si toglie un campo — non si riscrive la risoluzione.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasManyTenants } from '$lib/server/tenancy';
import {
	BRAND_SHELL_SELECT,
	BRAND_SWITCHER_SELECT,
	getBrandShell,
	setBrandShell
} from '$lib/server/nav-cache';

type Row = Record<string, unknown>;

export type Tenant = {
	/** Il brand di questa richiesta. `null` = lo slug non esiste, o la RLS lo nega. */
	brand: Row | null;
	/** Gli ALTRI brand dell'utente, per lo switcher. Solo il guscio multi-tenant lo legge. */
	peers: Row[] | null;
};

export async function resolveTenant(
	supabase: SupabaseClient,
	userId: string,
	slug: string
): Promise<Tenant> {
	const many = hasManyTenants();

	const cached = getBrandShell(userId, slug);
	if (cached) return { brand: cached.brand ?? null, peers: many ? (cached.brandRows ?? null) : null };

	// Con un tenant solo la seconda query non si fa: non c'è nessun «altro brand» da elencare, e
	// lo switcher si nasconde da sé (`{#if switcherBrands.length}` in DashboardSidebar).
	const [{ data: brand }, { data: peers }] = await Promise.all([
		supabase.from('brands').select(BRAND_SHELL_SELECT).eq('slug', slug).maybeSingle(),
		many
			? supabase.from('brands').select(BRAND_SWITCHER_SELECT).order('created_at', { ascending: true })
			: Promise.resolve({ data: null })
	]);

	if (brand) {
		setBrandShell(userId, slug, {
			brand: brand as Row,
			brandRows: (peers ?? null) as Row[] | null
		});
	}

	return { brand: (brand ?? null) as Row | null, peers: (peers ?? null) as Row[] | null };
}
