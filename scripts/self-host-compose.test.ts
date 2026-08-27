/**
 * Il percorso del self-host, sui punti dove una svista non si vede finché non si prova a INSTALLARE.
 *
 * Trovato provandolo: con `POSTGRES_PORT=5433` lo stack partiva sano — i servizi si parlano su
 * `db:${POSTGRES_PORT}` dentro la rete — ma dall'host il database era irraggiungibile, perché la
 * pubblicazione era `${POSTGRES_PORT}:5432` e dentro il container Postgres ascoltava su 5433.
 * `npm run db:migrate` moriva con ECONNRESET, cioè il primo comando della guida.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PKG = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

const ENV_EXAMPLE = readFileSync('.env.example', 'utf8');

const COMPOSE = readFileSync('infra/compose/docker-compose.yml', 'utf8');

const publishedPorts = (): string[] => [...COMPOSE.matchAll(/^\s*-\s*'([^']+:[^']+)'/gm)].map((m) => m[1]);

describe('docker-compose del self-host', () => {
	it('la porta del database è la stessa dentro e fuori: cambiarla non lo stacca dall’host', () => {
		const mapping = publishedPorts().find((p) => p.includes('POSTGRES_PORT')) ?? '';
		const sides = mapping.match(/^(\$\{[^}]*\}|\d+):(\$\{[^}]*\}|\d+)(\/tcp)?$/);

		expect(sides, `pubblicazione illeggibile: ${mapping}`).not.toBeNull();
		expect(sides?.[1]).toBe(sides?.[2]);
	});

	it('ogni servizio raggiunge il database sulla porta configurata, non su una cablata', () => {
		const dbRefs = [...COMPOSE.matchAll(/@db:(\d+|\$\{POSTGRES_PORT[^}]*\})/g)].map((m) => m[1]);

		expect(dbRefs.length).toBeGreaterThan(0);
		expect(dbRefs.filter((ref) => !ref.startsWith('${POSTGRES_PORT'))).toEqual([]);
	});
});

describe('avviare la build di produzione', () => {
	/**
	 * `$env/dynamic/private` legge `process.env` a runtime, e `node build` non legge nessun `.env`:
	 * lo carica Vite, che a quel punto non c'è più. La guida dice `npm run build:node && npm run
	 * start` e basta — chi la segue ottiene un'app che risponde 200 e non ha database
	 * («SUPABASE_SERVICE_ROLE_KEY not configured» su /api/status), il che sembra un guasto suo.
	 */
	it('`start` carica il .env, o l’app parte senza niente di privato configurato', () => {
		expect(PKG.scripts.start).toContain('--env-file');
	});
});

describe('.env.example', () => {
	/**
	 * adapter-node distingue «non impostata» da «vuota»: con `ORIGIN=` rifiuta di partire
	 * («Invalid ORIGIN: ''»), e il template la spediva vuota proprio mentre il commento sopra dice
	 * «lasciala non impostata». Finché `.env` non veniva letto a runtime nessuno se ne accorgeva.
	 */
	it('non spedisce ORIGIN vuota: adapter-node non parte', () => {
		expect(ENV_EXAMPLE).not.toMatch(/^ORIGIN=\s*$/m);
	});
});

describe('healthcheck dell’app', () => {
	/**
	 * wget --spider di busybox considera 3xx un errore. La homepage, con HIDE_MARKETING=1,
	 * risponde 303 verso /app: un healthcheck su `/` farebbe restare l'app forever-unhealthy
	 * nel momento in cui si accende la flag. robots.txt è sempre 200, senza sessione.
	 */
	it('non picchia la homepage: HIDE_MARKETING la reindirizza', () => {
		expect(COMPOSE).toMatch(/127\.0\.0\.1:3000\/robots\.txt/);
		expect(COMPOSE).not.toMatch(/127\.0\.0\.1:3000\/'/);
	});
});

describe('le migration ricostruiscono ciò che il codice scrive', () => {
	/**
	 * Trovato installando: su un database appena migrato ogni riga di `ai_calls` veniva rifiutata
	 * («Could not find the 'cached_tokens' column»), e il rifiuto è un `console.warn` — l'app
	 * funziona, il conto di quanto costa non esiste. In produzione le colonne ci sono perché sono
	 * state aggiunte a mano: nessuna migration le crea, quindi solo chi installa da zero le perde.
	 */
	it('ogni colonna che ai-log.ts inserisce esiste in qualche migration', () => {
		const source = readFileSync('src/lib/server/ai-log.ts', 'utf8');
		const insert = source.slice(source.indexOf("from('ai_calls').insert({"));
		const columns = [...insert.slice(0, insert.indexOf('});')).matchAll(/^\s{8}([a-z_]+):/gm)].map((m) => m[1]);

		// Solo le istruzioni che parlano di ai_calls: `input_tokens` esiste anche su chat_messages,
		// e cercarlo in tutto il corpus direbbe «c'è» mentre su questa tabella non c'è.
		const statements = readdirSync('supabase/migrations')
			.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
			.join('\n')
			.replace(/--[^\n]*/g, '')
			.split(';')
			.filter((statement) => statement.includes('ai_calls'))
			.join(';');

		// Le colonne DICHIARATE: nome + tipo, dentro il create table o in un add column. Cercare il
		// nome nudo direbbe «c'è» anche quando compare solo in un indice o in un commento.
		const declared = new Set(
			[...statements.matchAll(
				/(?:add column(?: if not exists)?\s+|[(,]\s*)([a-z_]+)\s+(text|integer|smallint|bigint|uuid|boolean|numeric|jsonb|timestamptz|timestamp)/gm
			)].map((m) => m[1])
		);

		expect(columns.length).toBeGreaterThan(10);
		expect(columns.filter((c) => !declared.has(c))).toEqual([]);
	});
});
