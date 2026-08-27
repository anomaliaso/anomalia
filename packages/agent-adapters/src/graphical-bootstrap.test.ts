import { describe, expect, it } from 'vitest';
import { SandboxEmulator } from './sandbox-emulator';
import {
	DESKTOP_PORT,
	DISPLAY,
	GRAPHICAL_MARKER_PATH,
	captureScreenshot,
	ensureGraphicalMode,
	ensureRemoteDesktop,
	runActions,
	type GraphicalBootstrapDeps
} from './graphical-bootstrap';
import type { AdapterContext } from '@anomalia/agent-kit/types';

const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };
/** Finto: l'emulatore non installa mai un vero apt/npm, quindi la risposta non dipende dalla distro. */
const detachedCalls: Array<{ cmd: string; args: string[] }> = [];
const bootstrapDeps: GraphicalBootstrapDeps = {
	resolvePlaywrightEnv: () => ({}),
	// registrato, non eseguito: i test verificano che i LANCI passino da qui (detached),
	// perché il setsid-nohup dentro un comando normale viene mietuto dalla piattaforma.
	runDetached: async (_ref, cmd, args) => {
		detachedCalls.push({ cmd, args });
	}
};

/**
 * Una VM che ha l'immagine desktop: `command -v anomalia-desktop` risponde, e lo script stampa la
 * riga di stato. Tutto il resto resta l'emulatore.
 */
function withDesktopImage(
	sb: SandboxEmulator,
	opts: { statusLine?: string; chromeAt?: string } = {}
) {
	const statusLine = opts.statusLine ?? 'display=:1 wm=up panel=up desktop=up vnc=up web=up';
	const original = sb.execute.bind(sb);
	return async function* (r: Parameters<typeof original>[0], req: Parameters<typeof original>[1], c: Parameters<typeof original>[2]) {
		// Anche i comandi intercettati sono passati di qui: `commandsRun` è la prova per i test.
		sb.commandsRun.push(req.command);
		if (req.command.includes('command -v anomalia-desktop')) {
			yield { type: 'stdout' as const, data: '/usr/local/bin/anomalia-desktop' };
			yield { type: 'exit' as const, code: 0 };
			return;
		}
		// `chromeAt`: una VM che il browser ce l'ha già. L'immagine NON ce l'ha (non ci sta sotto il
		// tetto per blob del registry), quindi il default è che manchi e vada scaricato.
		if (opts.chromeAt && req.command.includes('-name chrome')) {
			yield { type: 'stdout' as const, data: opts.chromeAt };
			yield { type: 'exit' as const, code: 0 };
			return;
		}
		if (/(^|\s|;)anomalia-desktop(\s|$)/.test(req.command)) {
			yield { type: 'stdout' as const, data: statusLine };
			yield { type: 'exit' as const, code: 0 };
			return;
		}
		yield* original(r, req, c);
	};
}

async function provisioned(): Promise<{ sb: SandboxEmulator; ref: { kind: string; name: string } }> {
	const sb = new SandboxEmulator();
	const ref = await sb.provision({ brandId: 'b1' }, ctx);
	// L'emulatore dice sì a qualunque comando, quindi da solo fingerebbe SEMPRE l'immagine col
	// desktop cotto e nessun test toccherebbe più il percorso apt. La VM di default non ce l'ha.
	const original = sb.execute.bind(sb);
	sb.execute = async function* (r, req, c) {
		if (req.command.includes('command -v anomalia-desktop')) {
			yield { type: 'exit', code: 1 };
			return;
		}
		yield* original(r, req, c);
	};
	return { sb, ref };
}

describe('ensureGraphicalMode', () => {
	it('prima volta: installa (emulatore = tutto ok muto), Xvfb su, niente browser trovato — dichiara cached:false', async () => {
		const { sb, ref } = await provisioned();
		const status = await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.cached).toBe(false);
		expect(status.browser).toBe(false);
		expect(status.display).toBe(DISPLAY);
		// La sequenza vera è passata di qui — apt via shell, ma il LANCIO di Xvfb via detached:
		// il setsid-nohup dentro un comando normale viene mietuto dalla piattaforma (23/8).
		expect(sb.commandsRun.some((c) => c.includes('apt-get install'))).toBe(true);
		expect(detachedCalls.some((d) => d.cmd === 'Xvfb')).toBe(true);
	});

	/**
	 * IL SOCKET C'È PRIMA CHE IL SERVER RISPONDA. Visto dal vivo il 26/8: openbox lanciato subito
	 * dopo che `/tmp/.X11-unix/X1` compare muore con «Failed to open the display», nessuno lo
	 * rilancia dentro la stessa chiamata, e il desktop resta SENZA window manager — il mouse si
	 * muove e la tastiera non scrive, perché senza WM nessuna finestra prende il fuoco.
	 */
	it('aspetta che il server X RISPONDA, non che il socket esista, prima di lanciare il WM', async () => {
		const { sb, ref } = await provisioned();
		await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		const ready = sb.commandsRun.findIndex((c) => /xdpyinfo|getdisplaygeometry/.test(c));
		// La SONDA del WM, non la riga di apt che installa il pacchetto.
		const wmProbe = sb.commandsRun.findIndex((c) => c.includes('[o]penbox'));
		expect(ready).toBeGreaterThanOrEqual(0);
		expect(ready).toBeLessThan(wmProbe);
	});

	it('marcatore già scritto: legge cached:true senza rifare apt/npm', async () => {
		const { sb, ref } = await provisioned();
		sb.files.set(GRAPHICAL_MARKER_PATH, JSON.stringify({ browser: true }));
		const status = await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		// Il marker non è più creduto sulla parola: il lancio riprova, nell'emulatore il binario
		// non esiste → browser torna FALSE e il marker si rieduca. (In produzione era il caso
		// inverso — browser:false col binario sul disco — stessa cura, verso onesto.)
		expect(status).toMatchObject({ ok: true, cached: true, browser: false });
		expect(sb.commandsRun.some((c) => c.includes('apt-get install'))).toBe(false);
	});

	/**
	 * APT IN CHIARO NON PASSA. Misurato su una VM vera il 26/8 con la policy della lane `agent`:
	 * `archive.ubuntu.com` è nell'allowlist, ma apt lo chiama su HTTP e senza SNI il filtro non
	 * vede nessun nome — «Connection failed [IP: 185.125.190.83 80]», e ogni pacchetto grafico
	 * risultava «Unable to locate package». Sorgenti su HTTPS: apt-get update esce 0.
	 */
	it('riscrive le sorgenti apt su HTTPS prima di update: in chiaro il filtro di rete le blocca', async () => {
		const { sb, ref } = await provisioned();
		await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		const update = sb.commandsRun.find((c) => c.includes('apt-get update'));
		expect(update).toBeDefined();
		expect(update!.indexOf('https://')).toBeGreaterThanOrEqual(0);
		expect(update!.indexOf('https://')).toBeLessThan(update!.indexOf('apt-get update'));
	});

	it("l'errore-che-insegna: apt-get fallito propaga il motivo, non un ok bugiardo", async () => {
		const { sb, ref } = await provisioned();
		const original = sb.execute.bind(sb);
		sb.execute = async function* (r, req, c) {
			if (req.command.includes('apt-get install')) {
				yield { type: 'stderr', data: 'E: Unable to locate package xvfb' };
				yield { type: 'exit', code: 100 };
				return;
			}
			yield* original(r, req, c);
		};
		const status = await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		expect(status.ok).toBe(false);
		if (status.ok) return;
		expect(status.error).toMatch(/apt-get install/);
		expect(status.error).toMatch(/Unable to locate package xvfb/);
	});
});

describe('captureScreenshot', () => {
	it('scatta via import e legge i byte con readFile (mai dallo stdout clampato)', async () => {
		const { sb, ref } = await provisioned();
		const shot = await captureScreenshot(sb, ref, ctx);
		expect(shot.ok).toBe(true);
		if (!shot.ok) return;
		expect(shot.base64.length).toBeGreaterThan(0);
		expect(Buffer.from(shot.base64, 'base64').toString('utf-8')).toContain('FAKE-PNG');
	});
});

describe('runActions', () => {
	it('compone click/type/key/scroll/wait in una sola chiamata a execute', async () => {
		const { sb, ref } = await provisioned();
		const before = sb.commandsRun.length;
		const res = await runActions(sb, ref, ctx, [
			{ kind: 'move', x: 10, y: 20 },
			{ kind: 'click', x: 100, y: 200 },
			{ kind: 'type', text: 'ciao "mondo"' },
			{ kind: 'key', key: 'Return' },
			{ kind: 'scroll', amount: -3 },
			{ kind: 'wait', ms: 50 }
		]);
		expect(res.ok).toBe(true);
		expect(sb.commandsRun.length).toBe(before + 1);
		const cmd = sb.commandsRun[sb.commandsRun.length - 1];
		expect(cmd).toContain('xdotool mousemove 10 20');
		expect(cmd).toContain('xdotool click 1');
		expect(cmd).toContain('xdotool type');
		expect(cmd).toContain("'ciao \"mondo\"'");
		expect(cmd).toContain('xdotool key');
		expect(cmd).toContain('click --repeat 3');
	});

	it("azione senza i campi richiesti torna un errore-che-insegna, non esegue niente", async () => {
		const { sb, ref } = await provisioned();
		const before = sb.commandsRun.length;
		const res = await runActions(sb, ref, ctx, [{ kind: 'type' }]);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toMatch(/type.*text/);
		expect(sb.commandsRun.length).toBe(before); // niente è partito: la validazione è prima dell'invio
	});

	it("quoting sicuro: un apice nel testo non rompe il comando", async () => {
		const { sb, ref } = await provisioned();
		const res = await runActions(sb, ref, ctx, [{ kind: 'type', text: "it's ok" }]);
		expect(res.ok).toBe(true);
		const cmd = sb.commandsRun[sb.commandsRun.length - 1];
		expect(cmd).toContain(`'it'\\''s ok'`);
	});
});

describe('il browser si cerca in TUTTI i posti dove vive davvero', () => {
	it("trova il Chromium del percorso browse (/vercel/.anomalia/browsers), non solo il proprio", async () => {
		const { sb, ref } = await provisioned();
		// L'emulatore risponde al find: qui si prova che il COMANDO interroga anche quel root —
		// il 23/8 in produzione cercava solo in .anomalia-desktop e diceva «nessun browser»
		// col binario in .anomalia/browsers.
		await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		const findCmd = sb.commandsRun.find((c) => c.includes('-name chrome'));
		expect(findCmd).toBeDefined();
		expect(findCmd).toContain('/vercel/.anomalia/browsers');
		expect(findCmd).toContain('ms-playwright');
	});
});

/**
 * IL DESKTOP REMOTO — quello che rende la macchina guidabile DALL'UTENTE e non solo dall'agente:
 * x11vnc sullo stesso `:1` che l'agente già usa, websockify che serve noVNC sulla porta esposta.
 *
 * Verificato dal vivo il 26/8 su Ubuntu 26.04 con la rete in uscita chiusa: `/vnc.html` risponde
 * 200 dall'internet pubblico, e la password è l'unica cosa che sta fra quell'URL e un Chrome
 * loggato sui social del brand.
 */
/**
 * L'IMMAGINE CON IL DESKTOP GIÀ COTTO (`sandbox-desktop/Dockerfile`).
 *
 * Misurato il 26/8: installare XFCE a runtime costa 209s di apt più 68s di update su una VM
 * fredda — più del lease con cui la lane del computer apre la macchina. Con l'immagine, la stessa
 * VM è pronta in 7 secondi. Quindi quando `anomalia-desktop` c'è, non si installa NIENTE: si
 * accende e basta.
 */
describe('ensureGraphicalMode con immagine desktop', () => {
	it('non tocca apt: esegue lo script cotto nell’immagine', async () => {
		const { sb, ref } = await provisioned();
		sb.execute = withDesktopImage(sb);
		const status = await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		expect(status).toMatchObject({ ok: true, display: DISPLAY });
		expect(sb.commandsRun.some((c) => c.includes('apt-get'))).toBe(false);
		expect(sb.commandsRun.some((c) => c.includes('anomalia-desktop'))).toBe(true);
	});

	/**
	 * Chromium NON è nell'immagine: non ci sta sotto il tetto per blob del registry (e a strati la
	 * VM non parte). Quindi il percorso veloce salta apt, ma il browser se lo deve ancora
	 * procurare — altrimenti il desktop arriva senza la cosa per cui esiste.
	 */
	it('procura comunque il browser: nell’immagine non c’è', async () => {
		const { sb, ref } = await provisioned();
		sb.execute = withDesktopImage(sb);
		await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		expect(sb.commandsRun.some((c) => c.includes('playwright install chromium'))).toBe(true);
	});

	/**
	 * Il pannello decide se offrire «Prendi il controllo» leggendo `probeGraphicalMode`, che guarda
	 * SOLO il marcatore. Il percorso veloce lo saltava: desktop acceso e pulsante invisibile.
	 */
	it('scrive il marcatore, o per il pannello il desktop non esiste', async () => {
		const { sb, ref } = await provisioned();
		sb.execute = withDesktopImage(sb);
		await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		expect(sb.files.get(GRAPHICAL_MARKER_PATH)).toBeTruthy();
		const { probeGraphicalMode } = await import('./graphical-bootstrap');
		expect((await probeGraphicalMode(sb, ref, ctx)).active).toBe(true);
	});

	it('il pannello spento è un fallimento dichiarato, non un ok bugiardo', async () => {
		const { sb, ref } = await provisioned();
		sb.execute = withDesktopImage(sb, { statusLine: 'display=:1 wm=up panel=down desktop=down vnc=down web=down' });
		const status = await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		expect(status.ok).toBe(false);
		if (status.ok) return;
		expect(status.error).toMatch(/panel=down/);
	});
});

describe('ensureRemoteDesktop', () => {
	it('installa, semina la password e lancia x11vnc + websockify sulla porta esposta', async () => {
		const { sb, ref } = await provisioned();
		const res = await ensureRemoteDesktop(sb, ref, ctx, bootstrapDeps, 'pw123456');
		expect(res).toMatchObject({ ok: true, port: DESKTOP_PORT });
		expect(sb.commandsRun.some((c) => c.includes('x11vnc') && c.includes('storepasswd'))).toBe(true);
		expect(detachedCalls.some((d) => d.args.some((a) => a.includes('x11vnc')))).toBe(true);
		expect(detachedCalls.some((d) => d.args.some((a) => a.includes('websockify')))).toBe(true);
	});

	it('MAI un desktop senza password: rifiuta invece di aprire la VM a chiunque abbia l’URL', async () => {
		const { sb, ref } = await provisioned();
		const res = await ensureRemoteDesktop(sb, ref, ctx, bootstrapDeps, '');
		expect(res.ok).toBe(false);
	});

	it('x11vnc ascolta solo su loopback: l’unica porta pubblica è quella di websockify', async () => {
		const { sb, ref } = await provisioned();
		await ensureRemoteDesktop(sb, ref, ctx, bootstrapDeps, 'pw123456');
		const vnc = detachedCalls.find((d) => d.args.some((a) => a.includes('x11vnc -display')));
		expect(vnc?.args.join(' ')).toContain('-localhost');
	});
});

/**
 * GLI APPUNTI FRA VM E DISPOSITIVO.
 *
 * noVNC ha un suo pannello appunti, ma vive dentro un iframe di un ALTRO dominio
 * (`*.vercel.run`): la nostra pagina non può leggerlo né scriverlo. Quindi il ponte passa da qui,
 * dove la VM la comandiamo noi: `xclip` sul display `:1`, e la pagina usa la clipboard del
 * browser dalla sua parte.
 */
describe('appunti della VM', () => {
	it('legge la selezione clipboard del display, non un file a caso', async () => {
		const { sb, ref } = await provisioned();
		sb.files.set('/tmp/anomalia-clipboard', 'testo dalla VM\n');
		const { readClipboard } = await import('./graphical-bootstrap');
		const res = await readClipboard(sb, ref, ctx);
		expect(res).toMatchObject({ ok: true });
		expect(sb.commandsRun.some((c) => c.includes('xclip') && c.includes('clipboard'))).toBe(true);
	});

	it('scrive senza farsi iniettare: il testo passa quotato', async () => {
		const { sb, ref } = await provisioned();
		const { writeClipboard } = await import('./graphical-bootstrap');
		await writeClipboard(sb, ref, ctx, "ciao'; rm -rf /; echo '");
		const cmd = sb.commandsRun.find((c) => c.includes('xclip') && c.includes('-i')) ?? '';
		// L'apice che chiuderebbe la stringa è neutralizzato (`'\''`), quindi il resto del testo
		// resta TESTO: la shell non ci vede più un comando.
		expect(cmd).toContain(String.raw`'\''`);
		expect(cmd.split(String.raw`'\''`)[0]).toContain('printf %s');
	});

	it('un testo vuoto non è un comando da mandare alla VM', async () => {
		const { sb, ref } = await provisioned();
		const { writeClipboard } = await import('./graphical-bootstrap');
		expect((await writeClipboard(sb, ref, ctx, '')).ok).toBe(false);
	});
});


/**
 * IL BROWSER DEVE ESSERE TROVABILE DA CHI NON SA DOV'È.
 *
 * Il binario vive sotto `browsers/chromium-<build>/chrome-linux64/chrome`: `observe`/`act` lo
 * trovano con un `find`, ma un agente che lavora da shell guarda `$PATH`, non lo vede, e conclude
 * «non c'è nessun Chrome» — successo il 26/8, con tanto di proposta di scaricarne un secondo e
 * reinstallare librerie già presenti.
 */
describe('chrome nel PATH', () => {
	it('lascia un `chrome` invocabile dove chiunque lo cerca', async () => {
		const { sb, ref } = await provisioned();
		sb.execute = withDesktopImage(sb, { chromeAt: '/vercel/.anomalia-desktop/browsers/chromium-1223/chrome-linux64/chrome' });
		await ensureGraphicalMode(sb, ref, ctx, bootstrapDeps);
		const linked = sb.commandsRun.find((c) => c.includes('/usr/local/bin/chrome'));
		expect(linked).toBeTruthy();
		expect(linked).toContain('ln -sf');
	});
});
