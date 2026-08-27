/**
 * CIÒ CHE IL CODICE NOMINA, CONTRO CIÒ CHE IL DATABASE HA.
 *
 * Il 14 agosto la 0167 aggiungeva `graphic_designs.source`; non è mai stata applicata in
 * produzione. `design-store.ts` selezionava quella colonna, PostgREST rispondeva 42703, il
 * codice leggeva `data` come null e OGNI lettura di una grafica tornava vuota. Nessun crash,
 * nessun allarme, otto giorni. In questo repo i deploy NON eseguono le migration: lo schema
 * e le aspettative del codice divergono in silenzio, e divergono.
 *
 * Questo script rifà il confronto da solo, e non esegue MAI una query del prodotto.
 * Il trucco è che PostgREST è già un validatore di schema gratuito: `?select=<colonna>&limit=0`
 * fa risolvere il nome a Postgres senza leggere una riga, e risponde
 *   42703  → la colonna non esiste          (DIVERGENZA)
 *   PGRST205 → la tabella non esiste         (DIVERGENZA)
 *   PGRST200 → la relazione per l'embed non esiste (DIVERGENZA)
 *   42501 / 200 → il nome esiste (la RLS nega le righe, ma il parse è passato)  → a posto
 * Con la chiave ANON: zero righe lette, nessun dato di cliente toccato, nessuna scrittura.
 * Si può lanciare contro la produzione senza avere paura.
 *
 * Tre confronti:
 *   A. CODICE → DATABASE     ogni .from().select()/.eq()/.insert() con nomi letterali, sondato live
 *   B. MIGRATION → DATABASE  ogni file di supabase/migrations, per dire quali NON sono applicate
 *   C. CODICE → VINCOLI      ogni literal scritto in una colonna con un CHECK ... in (...)
 * E dichiara quello che non sa guardare, invece di tacere.
 *
 *   node scripts/schema-drift-check.mjs
 *   node scripts/schema-drift-check.mjs --json      # per la CI
 *
 * Esce 1 se trova una divergenza grave (tabella/colonna assente, migration non applicata,
 * valore rifiutato da un check), 0 se è tutto allineato.
 *
 * ponytail: nessun parser TypeScript, nessuna dipendenza nuova. Un walker di catene
 * `.from(...).select(...)` e delle regex sulle migration. Il ceiling è dichiarato in fondo
 * ("NON VERIFICABILE"): il giorno in cui quella lista pesa più dei risultati, si passa a
 * ts-morph e si legge l'AST.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const JSON_OUT = process.argv.includes('--json');

const env = { ...process.env };
try {
	for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
		const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (m && !(m[1] in env)) env[m[1]] = m[2];
	}
} catch {
	/* no .env — rely on process.env */
}

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
// Deliberatamente la chiave ANON: basta a far risolvere i nomi a Postgres e non può leggere
// niente che la RLS non conceda. La service role non serve e non va usata per una diagnosi.
const ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
	console.error('Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY');
	process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// La sonda: un select a zero righe. L'unica cosa che questo script fa al database.
// ─────────────────────────────────────────────────────────────────────────────
const probeCache = new Map();

async function probe(table, selectExpr) {
	const key = `${table}::${selectExpr}`;
	const hit = probeCache.get(key);
	if (hit) return hit;
	const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(selectExpr)}&limit=0`;
	const run = (async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(url, {
					headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
					signal: AbortSignal.timeout(20_000)
				});
				if (res.status === 429 || res.status >= 500) {
					await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
					continue;
				}
				if (res.ok) return { ok: true };
				const body = await res.json().catch(() => ({}));
				// 42501 = la RLS/una funzione di policy nega l'accesso: il NOME però esiste,
				// perché Postgres ha già risolto la select prima di valutare la policy.
				if (body.code === '42501' || res.status === 401 || res.status === 403)
					return { ok: true };
				return { ok: false, code: body.code ?? String(res.status), message: body.message ?? '', hint: body.hint ?? '' };
			} catch (err) {
				if (attempt === 2)
					return { ok: false, code: 'NETWORK', message: err instanceof Error ? err.message : String(err) };
				await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
			}
		}
		return { ok: false, code: 'NETWORK', message: 'giro a vuoto' };
	})();
	probeCache.set(key, run);
	return run;
}

async function pool(items, worker, size = 12) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				out[i] = await worker(items[i]);
			}
		})
	);
	return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOTEST — se la sonda smette di distinguere "esiste" da "non esiste", tutto il resto
// diventa un verde bugiardo. È esattamente il modo in cui l'incidente è passato inosservato.
// Il caso di riferimento è quello vero: graphic_designs.source.
// ─────────────────────────────────────────────────────────────────────────────
async function selfTest() {
	const absent = await probe('graphic_designs', '__colonna_che_non_esiste__');
	const present = await probe('graphic_designs', 'id');
	const missingTable = await probe('__tabella_che_non_esiste__', 'id');
	const problems = [];
	if (absent.ok || absent.code !== '42703')
		problems.push(`una colonna inesistente NON viene segnalata (${absent.code ?? 'ok'})`);
	if (!present.ok) problems.push(`una colonna esistente viene segnalata a torto (${present.code})`);
	if (missingTable.ok || missingTable.code !== 'PGRST205')
		problems.push(`una tabella inesistente NON viene segnalata (${missingTable.code ?? 'ok'})`);
	// La prova richiesta: se `graphic_designs.source` sparisse, questo script direbbe cosa.
	const sourceNow = await probe('graphic_designs', 'source');
	return {
		problems,
		reference: sourceNow.ok
			? 'graphic_designs.source: PRESENTE (0167 applicata). Se sparisse, la sonda risponderebbe 42703 come per __colonna_che_non_esiste__ qui sopra.'
			: `graphic_designs.source: ASSENTE — ${sourceNow.code} ${sourceNow.message}`
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Lettura del codice: un walker di catene, non un parser.
// ─────────────────────────────────────────────────────────────────────────────
function walkFiles(dir, exts, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === '.svelte-kit' || name.startsWith('.')) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walkFiles(p, exts, out);
		else if (exts.some((e) => name.endsWith(e))) out.push(p);
	}
	return out;
}

/** Salta stringhe, template e commenti; ritorna l'indice dopo la parentesi che chiude s[i]. */
function skipBalanced(s, i) {
	let depth = 0;
	for (; i < s.length; i++) {
		const c = s[i];
		if (c === '"' || c === "'" || c === '`') {
			const q = c;
			for (i++; i < s.length; i++) {
				if (s[i] === '\\') i++;
				else if (s[i] === q) break;
			}
			continue;
		}
		if (c === '/' && s[i + 1] === '/') {
			while (i < s.length && s[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && s[i + 1] === '*') {
			const end = s.indexOf('*/', i + 2);
			i = end < 0 ? s.length : end + 1;
			continue;
		}
		if (c === '(') depth++;
		else if (c === ')' && --depth === 0) return i + 1;
	}
	return s.length;
}

/** Le chiamate concatenate subito dopo `.from('x')`, con il testo dei loro argomenti. */
function chainAfter(src, start) {
	const calls = [];
	let i = start;
	for (let n = 0; n < 40; n++) {
		const m = /^\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i, i + 300));
		if (!m) break;
		const open = i + m[0].length - 1;
		const close = skipBalanced(src, open);
		calls.push({ method: m[1], args: src.slice(open + 1, close - 1) });
		i = close;
	}
	return calls;
}

/** Toglie i commenti senza rompere le stringhe (un `https://` non è un commento). */
function stripComments(s) {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			for (; j < s.length; j++) {
				if (s[j] === '\\') j++;
				else if (s[j] === c) break;
			}
			out += s.slice(i, j + 1);
			i = j;
			continue;
		}
		if (c === '/' && s[i + 1] === '/') {
			while (i < s.length && s[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		if (c === '/' && s[i + 1] === '*') {
			const e = s.indexOf('*/', i + 2);
			i = e < 0 ? s.length : e + 1;
			out += ' ';
			continue;
		}
		out += c;
	}
	return out;
}

/**
 * Le chiavi di primo livello di un object literal, e se uno spread ne nasconde altre.
 * Ritorna null quando il primo argomento NON è un letterale: `.upsert(row, { onConflict })`
 * non è una riga, e leggerne le chiavi produrrebbe la colonna fantasma `onConflict`.
 * Le chiavi si contano solo dove ne è attesa una (dopo `{` o dopo una virgola di primo
 * livello): senza questo, `platforms.length ? platforms : null` diventa la colonna `platforms`.
 */
function objectKeys(args) {
	const head = args.trimStart();
	if (!head.startsWith('{') && !head.startsWith('[')) return null;
	const s = stripComments(args);
	const open = s.indexOf('{');
	if (open < 0) return null;
	const keys = [];
	let depth = 1;
	let expect = true;
	let spread = false;
	for (let i = open + 1; i < s.length; i++) {
		const c = s[i];
		if (c === '"' || c === "'" || c === '`') {
			for (i++; i < s.length; i++) {
				if (s[i] === '\\') i++;
				else if (s[i] === c) break;
			}
			expect = false;
			continue;
		}
		if ('([{'.includes(c)) {
			depth++;
			continue;
		}
		if (')]}'.includes(c)) {
			if (--depth === 0) break;
			continue;
		}
		if (depth !== 1) continue;
		if (c === ',') {
			expect = true;
			continue;
		}
		if (/\s/.test(c)) continue;
		if (!expect) continue;
		expect = false;
		if (s.startsWith('...', i)) {
			spread = true;
			continue;
		}
		const rest = s.slice(i, i + 160);
		const pair = /^([A-Za-z_$][\w$]*)\s*:/.exec(rest);
		if (pair) {
			keys.push({ key: pair[1], value: rest.slice(pair[0].length) });
			i += pair[0].length - 1;
			continue;
		}
		const shorthand = /^([A-Za-z_$][\w$]*)\s*(?=[,}])/.exec(rest);
		if (shorthand) {
			keys.push({ key: shorthand[1], value: '' });
			i += shorthand[0].length - 1;
		}
	}
	return { keys, spread };
}

const FILTERS = new Set([
	'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
	'contains', 'containedBy', 'overlaps', 'rangeGt', 'rangeLt', 'order', 'filter', 'not'
]);
const WRITES = new Set(['insert', 'update', 'upsert']);
const strLit = (s) => /^\s*(['"])((?:[^\\]|\\.)*?)\1\s*$/.exec(s.trim());
/** La stringa letterale in testa a un valore: `'autopilot'\n  });` → autopilot. */
const leadStr = (s) => /^\s*(['"])([^'"\\\n]*)\1\s*(?=$|[,;}\)\n])/.exec(s ?? '');

/** `.select(SELECT)` dove SELECT è una costante del file — è il caso di design-store.ts. */
function fileConsts(src) {
	const map = new Map();
	for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"`])([^'"`]*)\2\s*;/g))
		map.set(m[1], m[3]);
	// una passata di interpolazione: `${SELECT_BASE}, source`
	for (const [k, v] of map)
		map.set(k, v.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, n) => map.get(n) ?? `\${${n}}`));
	return map;
}

function extractCodeQueries() {
	const files = [
		...walkFiles(join(ROOT, 'src'), ['.ts', '.svelte', '.mjs', '.js']),
		...walkFiles(join(ROOT, 'scripts'), ['.ts', '.mjs'])
	];
	/** @type {{table:string, expr:string, kind:string, file:string, line:number}[]} */
	const probes = [];
	/** @type {{col:string, table:string, value:string, file:string, line:number}[]} */
	const literals = [];
	const unverifiable = [];
	const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

	for (const file of files) {
		if (file.endsWith('schema-drift-check.mjs')) continue;
		const src = readFileSync(file, 'utf8');
		if (!src.includes(".from('") && !src.includes('.from("')) continue;
		const rel = relative(ROOT, file);
		const consts = fileConsts(src);

		for (const m of src.matchAll(/\.from\(\s*(['"])([a-z0-9_]+)\1\s*\)/g)) {
			const table = m[2];
			const line = lineOf(src, m.index);
			const at = { file: rel, line };
			const calls = chainAfter(src, m.index + m[0].length);
			const cols = new Set();
			for (const { method, args } of calls) {
				if (method === 'select') {
					const lit = strLit(args.replace(/,\s*\{[\s\S]*$/, ''));
					const ident = /^\s*([A-Z][A-Z0-9_]*)\s*(?:,|$)/.exec(args);
					const tpl = /^\s*`([^`]*)`/.exec(args);
					let expr = null;
					if (lit) expr = lit[2];
					else if (ident && consts.has(ident[1])) expr = consts.get(ident[1]);
					else if (tpl)
						expr = tpl[1].replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, n) => consts.get(n) ?? ' ');
					if (expr == null || expr.includes(' '))
						unverifiable.push({ ...at, why: `.select() costruito a runtime su '${table}'` });
					else if (expr.trim() && expr.trim() !== '*')
						probes.push({ table, expr: expr.replace(/\s+/g, ''), kind: 'select', ...at });
				} else if (FILTERS.has(method)) {
					const first = strLit(args.split(/,(?![^(]*\))/)[0] ?? '');
					if (first && /^[a-z0-9_]+$/.test(first[2])) cols.add(first[2]);
					else if (!first && args.trim() && method !== 'order')
						unverifiable.push({ ...at, why: `.${method}() con nome di colonna calcolato su '${table}'` });
					// il valore letterale, per il confronto con i CHECK
					const val = first && method === 'eq' && leadStr(args.slice(first[0].length + 1));
					if (val) literals.push({ table, col: first[2], value: val[2], ...at });
				} else if (WRITES.has(method)) {
					const parsed = objectKeys(args);
					if (!parsed) {
						unverifiable.push({ ...at, why: `.${method}() con una variabile su '${table}'` });
						const ocv = /onConflict\s*:\s*(['"])([^'"]+)\1/.exec(args);
						if (ocv)
							unverifiable.push({
								...at,
								why: `onConflict '${ocv[2]}' su '${table}' — l'indice unico corrispondente non è verificabile in sola lettura`
							});
						continue;
					}
					const { keys, spread } = parsed;
					if (spread)
						unverifiable.push({ ...at, why: `.${method}() con uno spread su '${table}' (chiavi nascoste)` });
					for (const { key, value } of keys) {
						cols.add(key);
						const v = leadStr(value);
						if (v) literals.push({ table, col: key, value: v[2], ...at });
					}
					const oc = /onConflict\s*:\s*(['"])([^'"]+)\1/.exec(args);
					if (oc)
						unverifiable.push({
							...at,
							why: `onConflict '${oc[2]}' su '${table}' — l'indice unico corrispondente non è verificabile in sola lettura`
						});
				}
			}
			for (const c of cols) probes.push({ table, expr: c, kind: 'column', ...at });
		}
	}
	return { probes, literals, unverifiable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lettura delle migration: cosa ognuna introduce (e cosa una successiva ha tolto).
// ─────────────────────────────────────────────────────────────────────────────
function readMigrations() {
	const dir = join(ROOT, 'supabase/migrations');
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	const introduced = new Map(); // "table.col" | "table" -> migration file
	const dropped = new Set();
	const checks = new Map(); // "table.col" -> { values:Set, file }
	const constraintOnly = [];
	const widenings = [];

	for (const f of files) {
		const raw = readFileSync(join(dir, f), 'utf8');
		const sql = stripSql(raw).toLowerCase();
		let touched = false;

		for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/g)) {
			const table = m[1];
			introduced.set(table, f);
			touched = true;
			const body = sql.slice(m.index + m[0].length - 1);
			const end = (() => {
				let d = 0;
				for (let i = 0; i < body.length; i++) {
					if (body[i] === '(') d++;
					else if (body[i] === ')' && --d === 0) return i;
				}
				return body.length;
			})();
			let depth = 0;
			for (const item of splitTop(body.slice(1, end))) {
				const c = /^\s*([a-z0-9_]+)\s+/.exec(item);
				if (c && !['primary', 'unique', 'foreign', 'constraint', 'check', 'exclude'].includes(c[1]))
					introduced.set(`${table}.${c[1]}`, f);
			}
			void depth;
		}
		for (const m of sql.matchAll(
			/alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)([\s\S]*?);/g
		)) {
			const table = m[1];
			for (const a of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/g)) {
				introduced.set(`${table}.${a[1]}`, f);
				touched = true;
			}
			for (const d of m[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z0-9_]+)/g))
				dropped.add(`${table}.${d[1]}`);
		}

		// `check (col in ('a','b'))` — l'enum finto, la famiglia che ha già bloccato l'autopilot
		// per 30 giorni. Sta sia dentro `create table` sia in un `add constraint`, quindi si
		// legge su tutto il file e la tabella si risolve con l'ultimo `create/alter table` prima.
		const contexts = [...sql.matchAll(/(?:create|alter)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?(?:public\.)?([a-z0-9_]+)/g)];
		for (const m of sql.matchAll(/\bcheck\s*\(/g)) {
			const ctx = contexts.filter((t) => t.index < m.index).pop();
			if (!ctx) continue;
			const body = sqlBalanced(sql, m.index + m[0].length - 1);
			// dentro il corpo, ovunque: copre sia `check (col in (…))` sia
			// `check (col is null or col in (…))` sia `= any (array[…])`.
			for (const c of body.matchAll(
				/([a-z0-9_]+)\s*\)?(?:::text)?\s*(?:in\s*\(|=\s*any\s*\(\s*(?:array)?\s*\[)([^\])]*)/g
			)) {
				if (['null', 'array', 'any', 'not', 'and', 'or'].includes(c[1])) continue;
				const values = [...c[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);
				if (!values.length) continue;
				const key = `${ctx[1]}.${c[1]}`;
				// unione, non sostituzione: un valore va segnalato solo se NESSUNA migration
				// l'ha mai ammesso. Il database può essere stato allargato fuori dai file.
				const prev = checks.get(key);
				if (prev) {
					const added = values.filter((v) => !prev.values.has(v));
					for (const v of values) prev.values.add(v);
					if (added.length) widenings.push({ file: f, key, added });
				} else checks.set(key, { values: new Set(values), file: f });
			}
		}

		for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/g))
			dropped.add(m[1]);
		// una tabella rinominata non è una tabella mancante: il vecchio nome smette di esistere
		for (const m of sql.matchAll(
			/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s+rename\s+to\s+([a-z0-9_]+)/g
		)) {
			dropped.add(m[1]);
			for (const k of [...introduced.keys()])
				if (k.startsWith(`${m[1]}.`)) introduced.set(`${m[2]}.${k.slice(m[1].length + 1)}`, introduced.get(k));
			introduced.set(m[2], f);
		}
		for (const m of sql.matchAll(
			/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)[\s\S]{0,80}?rename\s+column\s+([a-z0-9_]+)\s+to\s+([a-z0-9_]+)/g
		)) {
			dropped.add(`${m[1]}.${m[2]}`);
			introduced.set(`${m[1]}.${m[3]}`, f);
		}
		if (!touched && /add\s+constraint|create\s+policy|create\s+index|create\s+or\s+replace\s+function/.test(sql))
			constraintOnly.push(f);
	}
	for (const k of dropped) {
		introduced.delete(k);
		if (!k.includes('.')) for (const j of [...introduced.keys()]) if (j.startsWith(`${k}.`)) introduced.delete(j);
	}
	return { files, introduced, checks, constraintOnly, widenings };
}

/** Il testo dentro la parentesi che si apre in s[i]. */
function sqlBalanced(s, i) {
	let d = 0;
	const start = i + 1;
	for (; i < s.length; i++) {
		if (s[i] === "'") {
			for (i++; i < s.length && s[i] !== "'"; i++);
			continue;
		}
		if (s[i] === '(') d++;
		else if (s[i] === ')' && --d === 0) return s.slice(start, i);
	}
	return s.slice(start);
}

/** Toglie i commenti `--` senza toccarli dentro le stringhe o i corpi `$$ … $$`. */
function stripSql(s) {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		if (s.startsWith('$$', i)) {
			const e = s.indexOf('$$', i + 2);
			const end = e < 0 ? s.length : e + 2;
			out += s.slice(i, end);
			i = end - 1;
			continue;
		}
		if (s[i] === "'") {
			let j = i + 1;
			for (; j < s.length; j++) if (s[j] === "'") break;
			out += s.slice(i, j + 1);
			i = j;
			continue;
		}
		if (s.startsWith('--', i)) {
			while (i < s.length && s[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		if (s.startsWith('/*', i)) {
			const e = s.indexOf('*/', i + 2);
			i = (e < 0 ? s.length : e + 1);
			out += ' ';
			continue;
		}
		out += s[i];
	}
	return out;
}

function splitTop(s) {
	const out = [];
	let depth = 0;
	let cur = '';
	for (const c of s) {
		if (c === '(') depth++;
		else if (c === ')') depth--;
		if (c === ',' && depth === 0) {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	if (cur.trim()) out.push(cur);
	return out;
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
	const st = await selfTest();
	if (st.problems.length) {
		console.error('AUTOTEST FALLITO — la sonda non distingue più ciò che esiste da ciò che non esiste:');
		for (const p of st.problems) console.error(`  · ${p}`);
		console.error('Nessun risultato è affidabile. Uscita.');
		process.exit(2);
	}

	const { probes, literals, unverifiable } = extractCodeQueries();
	const { files: migFiles, introduced, checks, constraintOnly, widenings } = readMigrations();

	// A + B insieme: un solo insieme di nomi da sondare.
	const wanted = new Map(); // "table::expr" -> { table, expr, sites:[] , fromMigration }
	const add = (table, expr, site) => {
		const k = `${table}::${expr}`;
		if (!wanted.has(k)) wanted.set(k, { table, expr, sites: [] });
		if (site) wanted.get(k).sites.push(site);
	};
	for (const p of probes) add(p.table, p.expr, { file: p.file, line: p.line, kind: p.kind });
	for (const [key, file] of introduced) {
		const [table, col] = key.split('.');
		add(table, col ?? 'count', null);
		wanted.get(`${table}::${col ?? 'count'}`).migration = file;
	}

	const list = [...wanted.values()];
	if (!JSON_OUT) process.stderr.write(`Sondo ${list.length} nomi (zero righe lette)…\n`);
	// PostgREST nomina UNA colonna assente per volta: si toglie quella e si richiede,
	// finché la select passa. Così una `select('a, b, c')` con due errori li dice entrambi.
	const colFromMessage = (msg) =>
		/column (?:"?[a-z0-9_]+"?\.)?"?([a-z0-9_]+)"? does not exist/i.exec(msg ?? '')?.[1] ?? null;
	const results = await pool(list, async (w) => {
		const first = await probe(w.table, w.expr);
		const missing = [];
		let res = first;
		let expr = w.expr;
		for (let n = 0; n < 8 && !res.ok && res.code === '42703'; n++) {
			const col = colFromMessage(res.message);
			if (!col) break;
			missing.push(col);
			const next = expr
				.split(',')
				.filter((c) => c.replace(/[!:(].*$/, '').trim() !== col)
				.join(',');
			if (!next || next === expr) break;
			expr = next;
			res = await probe(w.table, expr);
		}
		return { ...w, res: first, missing };
	});

	const badTables = new Map();
	const byCol = new Map(); // "table.col" -> { table, expr, sites, migration, hint }
	const badEmbeds = [];
	const network = [];
	for (const r of results) {
		if (r.missing.length) {
			for (const col of r.missing) {
				const k = `${r.table}.${col}`;
				if (!byCol.has(k))
					byCol.set(k, { table: r.table, expr: col, sites: [], migration: null, res: r.res });
				const e = byCol.get(k);
				e.sites.push(...r.sites);
				e.migration ??= r.migration ?? introduced.get(k) ?? null;
			}
			continue;
		}
		if (r.res.ok) continue;
		if (r.res.code === 'NETWORK') {
			network.push(r);
		} else if (r.res.code === 'PGRST205') {
			if (!badTables.has(r.table)) badTables.set(r.table, { sites: [], migration: null });
			const e = badTables.get(r.table);
			e.sites.push(...r.sites);
			e.migration ??= r.migration ?? introduced.get(r.table) ?? null;
		} else if (r.res.code === 'PGRST200' || /relationship/i.test(r.res.message)) badEmbeds.push(r);
	}
	// una colonna su una tabella che non esiste è la stessa notizia, detta due volte
	const badColsReal = [...byCol.values()].filter((c) => !badTables.has(c.table));

	// migration non applicate: raggruppa i nomi assenti che una migration introduce
	const unapplied = new Map();
	for (const r of [...badColsReal, ...[...badTables].map(([t, v]) => ({ table: t, expr: '', migration: v.migration, sites: v.sites }))]) {
		// una colonna assente non eredita la migration che ha creato la tabella:
		// `products.category` non è "0002 non applicata", è un nome sbagliato nel codice.
		const mig = r.migration ?? (r.expr ? introduced.get(`${r.table}.${r.expr}`) : introduced.get(r.table));
		if (!mig) continue;
		if (!unapplied.has(mig)) unapplied.set(mig, { names: new Set(), sites: [] });
		unapplied.get(mig).names.add(r.expr ? `${r.table}.${r.expr}` : r.table);
		unapplied.get(mig).sites.push(...(r.sites ?? []));
	}

	// C — literal contro i CHECK dichiarati nelle migration
	const badValues = [];
	for (const l of literals) {
		const c = checks.get(`${l.table}.${l.col}`);
		if (!c || c.values.has(l.value)) continue;
		badValues.push({ ...l, allowed: [...c.values], from: c.file });
	}

	const codeOnly = badColsReal.filter((c) => !c.migration && c.sites.length);
	const grave = badTables.size + badColsReal.length + badEmbeds.length + badValues.length;

	if (JSON_OUT) {
		console.log(JSON.stringify({ grave, badTables: [...badTables.keys()], badCols: badColsReal.map(short), badEmbeds: badEmbeds.map(short), unapplied: [...unapplied].map(([f, v]) => ({ file: f, names: [...v.names] })), badValues, unverifiable: unverifiable.length, reference: st.reference }, null, 2));
		process.exit(grave ? 1 : 0);
	}

	const host = new URL(SUPABASE_URL).host;
	console.log(`\nSCHEMA DRIFT — ciò che il codice nomina contro ciò che ${host} ha`);
	console.log(`  ${list.length} nomi sondati · ${migFiles.length} migration lette · zero righe lette, zero scritture`);
	console.log(`  autotest: ${st.reference}`);

	if (unapplied.size) {
		console.log(`\nMIGRATION SCRITTE MA NON APPLICATE (${unapplied.size}) — le applica una persona, non questo script`);
		for (const [file, v] of [...unapplied].sort()) {
			console.log(`  supabase/migrations/${file}`);
			console.log(`    assenti nel database: ${[...v.names].join(', ')}`);
			for (const s of dedupeSites(v.sites).slice(0, 4)) console.log(`    usata da ${s}`);
			if (v.sites.length > 4) console.log(`    …e altri ${dedupeSites(v.sites).length - 4} punti`);
			console.log(`    → APPLICA LA MIGRATION`);
		}
	}

	const badTablesUsed = [...badTables].filter(([, v]) => v.sites.length);
	if (badTablesUsed.length) {
		console.log(`\nTABELLE CHE IL CODICE NOMINA E CHE NON ESISTONO (${badTablesUsed.length})`);
		for (const [t, v] of badTablesUsed) {
			console.log(`  ${t}`);
			for (const s of dedupeSites(v.sites).slice(0, 5)) console.log(`    ${s}`);
			console.log(`    → ${v.migration ? `APPLICA supabase/migrations/${v.migration}` : 'CORREGGI IL CODICE (nessuna migration crea questa tabella)'}`);
		}
	}

	if (codeOnly.length) {
		console.log(`\nCOLONNE CHE IL CODICE NOMINA E CHE NON ESISTONO — nessuna migration le introduce (${codeOnly.length})`);
		console.log('  Qui non c\'è niente da applicare: è il codice a sbagliare nome.');
		for (const c of codeOnly.sort((a, b) => a.table.localeCompare(b.table))) {
			console.log(`  ${c.table}.${c.expr}`);
			for (const s of dedupeSites(c.sites).slice(0, 5)) console.log(`    ${s}`);
			console.log(`    sintomo: la query risponde 42703, il client legge data come null → la lettura torna vuota, senza errore a schermo`);
			console.log(`    → CORREGGI IL CODICE${c.res.hint ? ` — ${c.res.hint}` : ''}`);
		}
	}

	if (badEmbeds.length) {
		console.log(`\nEMBED SENZA RELAZIONE (${badEmbeds.length})`);
		for (const e of badEmbeds) {
			console.log(`  ${e.table} → '${e.expr}'`);
			for (const s of dedupeSites(e.sites).slice(0, 4)) console.log(`    ${s}`);
			console.log(`    → CORREGGI IL CODICE — ${e.res.message}`);
		}
	}

	if (badValues.length) {
		console.log(`\nVALORI CHE UN VINCOLO CHECK RIFIUTA (${badValues.length}) — confronto statico codice ↔ migration`);
		for (const v of badValues) {
			console.log(`  ${v.table}.${v.col} = '${v.value}'   ${v.file}:${v.line}`);
			console.log(`    ammessi (da ${v.from}): ${v.allowed.join(' | ')}`);
			console.log(`    sintomo: la scrittura fallisce con 23514; se l'errore non è letto, l'utente riceve un successo finto`);
			console.log(`    → CORREGGI IL CODICE, oppure allarga il check con una migration nuova`);
		}
	}

	if (network.length)
		console.log(`\nNON SONDATI (${network.length}) — la rete non ha risposto: ${network.slice(0, 3).map((n) => `${n.table}.${n.expr}`).join(', ')}`);

	// La parte che questo strumento NON sa guardare. Tacerne sarebbe peggio che non averla.
	const groups = new Map();
	for (const u of unverifiable) {
		const g = u.why.replace(/'[^']*'/g, "'…'");
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g).push(`${u.file}:${u.line}`);
	}
	console.log(`\nNON VERIFICABILE DA QUI (${unverifiable.length} punti nel codice + 4 famiglie di schema)`);
	for (const [why, where] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 8))
		console.log(`  ${String(where.length).padStart(4)}×  ${why}   es. ${where[0]}`);
	console.log('  Famiglie che la sola lettura via PostgREST non raggiunge — vanno guardate in SQL:');
	console.log('    · policy RLS (una tabella con RLS e zero policy legge sempre vuoto, senza errore)');
	console.log('    · indici e indici unici (compreso quello che serve a un onConflict)');
	console.log('    · NOT NULL e default mancanti su una insert');
	console.log('    · CHECK già presenti nel database ma non in nessun file, e viceversa');
	if (constraintOnly.length)
		console.log(`    · ${constraintOnly.length} migration cambiano solo vincoli/policy/funzioni: la loro applicazione non è deducibile da fuori`);
	const risky = widenings.filter((w) => constraintOnly.includes(w.file));
	if (risky.length) {
		console.log(`\n  DA VERIFICARE A MANO (${risky.length}) — migration che ALLARGANO un CHECK e non toccano nessuna colonna.`);
		console.log('  Se una di queste non è applicata, il codice che scrive il valore nuovo prende 23514 e, se');
		console.log("  l'errore non è letto, l'utente vede un successo finto. Da fuori sono indistinguibili.");
		for (const w of risky)
			console.log(`    ${w.file}   ${w.key} += ${w.added.map((v) => `'${v}'`).join(', ')}`);
	}

	console.log(
		grave
			? `\nROSSO — ${grave} divergenze. Le migration si applicano a mano: i deploy di questo repo non lo fanno.`
			: '\nVERDE — ogni nome che il codice pronuncia esiste nel database.'
	);
	process.exit(grave ? 1 : 0);
}

const short = (r) => ({ table: r.table, name: r.expr, code: r.res.code, sites: dedupeSites(r.sites), migration: r.migration ?? null });
const dedupeSites = (sites) => [...new Set((sites ?? []).map((s) => `${s.file}:${s.line}`))];

main().catch((err) => {
	console.error('lo script è esploso:', err instanceof Error ? err.stack : String(err));
	process.exit(2);
});
