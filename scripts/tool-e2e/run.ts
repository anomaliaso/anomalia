/**
 * IL BANCO DEI TOOL — ogni strumento contro dati VERI, senza un modello di mezzo.
 *
 * Gli scenari di `scripts/eval/` provano il GIUDIZIO dell'agente su un brand finto. Questo prova
 * il CONTRATTO dello strumento su un brand vero: la forma che una fixture sintetica non ha mai —
 * un brand con 200 post, media che esistono davvero, integrazioni collegate. Zero token, secondi.
 *
 *   E2E_BRAND_ID=<uuid>  npm run tool-e2e
 *
 * L'utente è quello dell'eval (`EVAL_USER_EMAIL`), quindi la RLS è quella vera: se il login non
 * vede quel brand il banco si ferma e lo DICE, invece di ripiegare sul service-role e dichiarare
 * verde una lettura che in produzione sarebbe negata.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createChatTools } from '$lib/agent/tools/index';
import { withBrandContext } from '$lib/server/brand-context';
import { NEVER, READ_ONLY, WRITES } from './catalogue';

const BRAND_ID = env.E2E_BRAND_ID ?? '';
const EMAIL = env.E2E_USER_EMAIL ?? env.EVAL_USER_EMAIL ?? 'test@anomalia.so';
const PASSWORD = env.E2E_USER_PASSWORD ?? env.EVAL_USER_PASSWORD ?? '123456';

if (!BRAND_ID) {
	console.error('E2E_BRAND_ID manca: serve il brand vero su cui provare i tool.');
	process.exit(2);
}

const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
	auth: { persistSession: false, autoRefreshToken: false }
});
const { data: session, error: loginError } = await client.auth.signInWithPassword({
	email: EMAIL,
	password: PASSWORD
});
if (loginError || !session.session) {
	console.error(`login fallito (${EMAIL}): ${loginError?.message ?? 'nessuna sessione'}`);
	process.exit(2);
}

// Il brand DEVE essere visibile a questo utente: se la RLS lo nega, ogni lettura tornerebbe vuota
// senza errore e il banco direbbe verde su niente.
const { data: brand } = await client.from('brands').select('id, slug, name').eq('id', BRAND_ID).maybeSingle();
if (!brand) {
	console.error(`${EMAIL} non vede il brand ${BRAND_ID}: la RLS lo nega, oppure non esiste.`);
	console.error('Aggiungi quell\'utente ai membri del brand, o usa E2E_USER_EMAIL/E2E_USER_PASSWORD.');
	process.exit(2);
}

const userId = session.session.user.id;
const tools = createChatTools(client, BRAND_ID, 'Europe/Rome', userId, env.PUBLIC_APP_URL ?? '', 'it');
const mounted = Object.keys(tools).sort();

console.log(`brand ${brand.slug} (${brand.name}) · utente ${EMAIL}`);
console.log(`${mounted.length} tool montati\n`);

type Row = { name: string; ok: boolean; detail: string; ms: number };
const rows: Row[] = [];

for (const name of mounted) {
	if (!(name in READ_ONLY)) continue;
	const probe = READ_ONLY[name];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tool = (tools as any)[name];
	const t0 = Date.now();
	try {
		const out = await withBrandContext(BRAND_ID, () => tool.execute(probe ?? {}, {}));
		const ms = Date.now() - t0;
		if (out && typeof out === 'object' && 'error' in out && out.error) {
			rows.push({ name, ok: false, detail: String(out.error).slice(0, 140), ms });
		} else {
			const keys = out && typeof out === 'object' ? Object.keys(out).slice(0, 5).join(',') : typeof out;
			rows.push({ name, ok: true, detail: keys, ms });
		}
	} catch (e) {
		rows.push({ name, ok: false, detail: `ECCEZIONE ${e instanceof Error ? e.message : String(e)}`.slice(0, 140), ms: Date.now() - t0 });
	}
}

for (const r of rows) {
	console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(26)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
}

// LA COPERTURA, dichiarata: un banco che tace su ciò che non ha provato mente come un agente che
// promette e non consegna.
const classified = new Set([...Object.keys(READ_ONLY), ...WRITES, ...NEVER]);
const unclassified = mounted.filter((n) => !classified.has(n));
const red = rows.filter((r) => !r.ok);

console.log(`\n═══ ${rows.length} provati · ${red.length} rossi ═══`);
console.log(`  scrivono, non provati qui: ${WRITES.filter((w) => mounted.includes(w)).length} (serve il brand usa-e-getta)`);
console.log(`  mai in automatico:         ${NEVER.filter((n) => mounted.includes(n)).length}`);
if (unclassified.length) {
	console.log(`  NON CLASSIFICATI:          ${unclassified.length} — nessuno sa se scrivono:`);
	console.log(`    ${unclassified.join(' ')}`);
}
process.exit(red.length ? 1 : 0);
