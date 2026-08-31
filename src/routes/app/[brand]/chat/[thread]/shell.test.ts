import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Il difetto del 23/8: il poll del run attivo chiamava `/chat/${data.threadId}/kit-run`, ma il
 * campo si chiama `data.thread.id` — l'url usciva con «undefined», l'endpoint rispondeva 404, e
 * la riga «sta lavorando» non compariva MAI dopo un reload. Nessun errore a schermo: solo il
 * silenzio. Qui si pinna che la pagina usi solo campi che esistono davvero nel suo `data`.
 */
describe('thread page: gli url si compongono con campi veri', () => {
	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
	const server = readFileSync(new URL('./+page.server.ts', import.meta.url), 'utf8');

	it('non usa data.threadId (non esiste: il campo è data.thread.id)', () => {
		expect(src).not.toContain('data.threadId');
	});

	it('ogni data.<campo> usato nella pagina esiste nel payload del server', () => {
		const used = [...src.matchAll(/\bdata\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
		// il payload può esporre un campo per scorciatoia (`messages,`) oltre che per coppia
		// (`messages: ...`): entrambe le forme valgono come «esiste».
		const unknown = [...new Set(used)].filter(
			(k) => !new RegExp(`\\b${k}\\s*[:,]`).test(server) && !server.includes(`${k} =`)
		);
		expect(unknown, `campi non presenti in +page.server.ts: ${unknown.join(', ')}`).toEqual([]);
	});
});

/**
 * I difetti del 24/8 — la classe «l'invio fallisce e nessuno lo dice»: POST mai arrivato al
 * server ma bolla mostrata come inviata, banner d'errore che lampeggia e sparisce, enqueue
 * perso in silenzio, `?message=` cancellato dall'URL prima che il server accetti. Nessuno di
 * questi dava un errore: solo silenzio. Qui si pinna che le guardie restino al loro posto.
 */
describe('thread page: un invio fallito non sparisce mai in silenzio', () => {
	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
	const column = readFileSync(
		new URL('../../../../../lib/components/ChatColumn.svelte', import.meta.url),
		'utf8'
	);

	it('finalize ha la guardia pre-stream: errore senza job né buffer non si finalizza né dismissa', () => {
		const fn = src.slice(
			src.indexOf('async function finalizeCompletedSession'),
			src.indexOf('await fetchFreshMessages')
		);
		expect(fn).toContain('if (isPreStreamFailure(snap)) return;');
	});

	it("l'errore sopravvive al dismiss della sessione (staleError), e il banner lo legge", () => {
		// catturato PRIMA che dismissSession porti via la sessione
		expect(src).toMatch(/if \(snap\?\.error\) staleError = snap\.error;\s*\n\s*dismissSession\(data\.thread\.id\);/);
		// e il derived del banner lo considera
		expect(src).toMatch(/session\?\.error \?\? staleError/);
	});

	it("l'enqueue fallito (coda o busy) restituisce il testo al composer e accende il banner", () => {
		expect(src).toMatch(/if \(queued\.ok\) \{\s*\n\s*await refreshQueue\(\);\s*\n\s*\} else \{[\s\S]{0,300}?input = t;/);
		expect(src).toMatch(/if \(queuedBusy\.ok\) \{[\s\S]{0,500}?\} else \{[\s\S]{0,300}?input = t;/);
	});

	it('`?message=` resta nell’URL finché il server non ha accettato il messaggio', () => {
		expect(src).toContain('if (!isPreStreamFailure(getSession(data.thread.id))) clearParam();');
		// il vecchio pattern — cancella subito, spedisci 100ms dopo — non deve tornare
		expect(src).not.toContain('setTimeout(() => send(), 100)');
	});

	it('il deep-link in ChatColumn scrive la bozza prima di spedire e la cancella solo ad accettazione', () => {
		expect(column).toMatch(/writeChatDraft\(sendDraftKey\(brandSlug\), msg\);\s*\n\s*void send\(msg\);/);
		expect(column).toContain("if (result !== 'error') writeChatDraft(sendDraftKey(brandSlug), '');");
	});
});

/**
 * Casi 4 e 5 del censimento avversario (24/8): quando un turno ORFANO (un altro dispositivo, o
 * questa scheda dopo un reload) finiva, il messaggio vero e la bolla "sta lavorando" potevano
 * comparire insieme per un fotogramma (`thread-changed` arriva prima di `kit_stream_done` — vedi
 * persistence.ts/live.ts), e lo scroll automatico non seguiva il parziale orfano mentre cresceva.
 * Stesso metodo di sopra: si pinna il codice vero, non un mount del componente.
 */
describe('thread page: il turno orfano si chiude senza doppione, e lo scroll lo segue', () => {
	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

	it('reloadMessages azzera orphanRun/orphanState nello STESSO aggiornamento in cui applica i messaggi freschi', () => {
		const fn = src.slice(src.indexOf('async function reloadMessages'), src.indexOf('async function finalizeOrphanRun'));
		expect(fn).toMatch(/messages = fresh;[\s\S]{0,500}orphanRun = null;[\s\S]{0,50}orphanState = emptyStreamState\(\);/);
	});

	it('finalizeOrphanRun spegne la bolla orfana anche se il refetch fallisce (finally, non solo il ramo happy)', () => {
		const fn = src.slice(src.indexOf('async function finalizeOrphanRun'), src.indexOf('async function clearHistory'));
		expect(fn).toMatch(/finally\s*\{\s*orphanRun = null;\s*orphanState = emptyStreamState\(\);/);
	});

	it('i due punti di completamento del run orfano passano da finalizeOrphanRun, non più da un invalidateAll disaccoppiato', () => {
		expect(src).not.toContain('invalidateAll');
		const calls = src.match(/void finalizeOrphanRun\(\)/g) ?? [];
		expect(calls.length).toBe(2); // onKitStreamDone (Realtime) + onFinished del poll
	});

	it('lo scroll automatico segue anche il parziale orfano (text/reasoning/tools), non solo lo stream vivo', () => {
		const fn = src.slice(src.indexOf('// Auto-scroll (messages + live stream)'), src.indexOf('async function onAgentChange'));
		expect(fn).toContain('void orphanRun;');
		expect(fn).toContain('void orphanState.text;');
		expect(fn).toContain('void orphanState.reasoning;');
		expect(fn).toContain('void orphanState.tools.length;');
		expect(fn).toContain('void artifacts.length;');
	});

	it('i fotogrammi pubblicati come artefatti si disegnano sulla pagina del thread, non solo in ChatColumn', () => {
		const server = readFileSync(new URL('./+page.server.ts', import.meta.url), 'utf8');
		const turn = readFileSync(new URL('../components/ChatTurn.svelte', import.meta.url), 'utf8');
		const list = readFileSync(new URL('../components/TranscriptList.svelte', import.meta.url), 'utf8');
		expect(turn).toContain('ChatArtifactCard');
		expect(list).toContain('artifactsByCall');
		expect(list).toContain('looseArtifacts');
		expect(server).toContain('listThreadArtifacts');
		expect(src).toContain('artifacts: freshArts');
	});
});

/**
 * L'incidente del 26/8: chat riaperta a turno già partito e risposta illeggibile — «Il nastro è
 * risultato troppoo compress… batt peruta con certzaez». Il canale Realtime appendeva incrementi
 * sopra lo snapshot assoluto del poll: due sorgenti, nessuna posizione. La regola vive in
 * `chat-live-join.ts`; qui si pinna che la pagina non torni a mescolarle da sé.
 */
describe('thread page: il turno orfano non mescola canale e poll', () => {
	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

	it('i chunk del canale passano da applyLiveChunk, con la posizione', () => {
		expect(src).toContain('applyLiveChunk(orphanState, orphanPending, chunk, at)');
		expect(src).not.toContain('applyChatStreamEvent(orphanState');
	});

	it('lo snapshot del poll passa da applyLiveSnapshot, non da assegnazioni diritte al testo', () => {
		expect(src).toContain('applyLiveSnapshot(orphanState, orphanPending, orphanRun.partial)');
		expect(src).not.toMatch(/orphanState\.text = /);
		expect(src).not.toMatch(/orphanState\.reasoning = /);
	});

	it("la finestra a tempo non torna: l'allineamento è per posizione, non per orologio", () => {
		expect(src).not.toContain('REALTIME_OWNS_TEXT_MS');
		expect(src).not.toContain('lastRealtimeChunkAt');
	});

	it('cambiando run si azzerano anche i chunk in attesa', () => {
		expect(src).toMatch(/orphanState = emptyStreamState\(\);\s*\n\s*orphanPending = \[\];/);
	});
});
