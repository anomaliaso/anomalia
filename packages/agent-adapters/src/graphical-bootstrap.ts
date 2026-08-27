/**
 * MODO GRAFICO — Xvfb + Chromium + xdotool + ImageMagick nella STESSA VM che `shell` già usa
 * (vercel-sandbox.ts, computer.ts): nessuna seconda macchina, uno stato di processo più un
 * marcatore su file.
 *
 * Tre vincoli scoperti su una VM vera, che il resto del codice non si aspettava:
 *  - l'immagine di default è Ubuntu, non Amazon Linux: si usa `apt`, non `dnf`;
 *  - `chromium` via apt non esiste e `chromium-browser` è uno stub snap che senza `snapd` non
 *    parte. Il binario vero è quello che Playwright scarica da `cdn.playwright.dev` (già in
 *    `BROWSER_DOMAINS`), lanciato SENZA `--headless` sotto Xvfb;
 *  - Ubuntu 26.04 non è fra le distro note di Playwright: serve l'override che
 *    `resolvePlaywrightEnv` (sandbox.ts) produce già — si IMPORTA da lì, non si riscrive.
 *
 * Lo stop vero della VM (`sleepIdleComputers`) conserva il disco come snapshot ma UCCIDE i
 * processi, e nessuno li rilancia al risveglio. Per questo `ensureGraphicalMode` separa i
 * **pacchetti** (lenti, dietro il marcatore) dai **processi** (verificati con `pgrep` e rilanciati
 * a OGNI chiamata: pochi millisecondi quando sono già vivi).
 */
import type { AdapterContext, SandboxRef } from '@anomalia/agent-kit/types';
import type { SandboxProvider } from '@anomalia/agent-kit/interfaces';

/** Un solo display per VM, non negoziabile da nessun tool. */
export const DISPLAY = ':1';
/** Il socket di `DISPLAY`: la sua esistenza è l'unico modo, da dentro la VM, di sapere se c'è uno schermo. */
export const X_SOCKET = '/tmp/.X11-unix/X1';
const SCREEN = '1280x800x24';
/** Fuori da `work/`: il checkpoint applicativo cammina solo quell'albero (vedi checkpoint-storage.ts). */
const ROOT = '/vercel/.anomalia-desktop';
const BROWSERS_PATH = `${ROOT}/browsers`;
/**
 * Il profilo sta su disco PERSISTENTE, non in /tmp: è la ragione per cui un login fatto in
 * takeover sopravvive al sonno della macchina, senza mai passare dal contesto del modello.
 *
 * Il prezzo è `SingletonLock`, che sopravvive al processo morto e blocca OGNI avvio successivo
 * («profile appears to be in use ... on another computer»), per sempre. Si toglie PRIMA di ogni
 * lancio: se un processo vivo lo tenesse davvero, il pgrep l'avrebbe trovato e non lanceremmo.
 */
const CHROME_PROFILE = `${ROOT}/chrome-profile`;
const CLEAR_CHROME_LOCKS =
	`mkdir -p ${CHROME_PROFILE} && rm -f ${CHROME_PROFILE}/Singleton* && ` +
	// Una VM spenta è sempre un'uscita "sporca": senza riscrivere `exit_type`, Chromium mostra la
	// barra «non si è chiuso correttamente» e RIFIUTA di ripristinare le tab.
	`f=${CHROME_PROFILE}/Default/Preferences; [ -f "$f" ] && ` +
	`sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$f" || true`;
/**
 * Più radici perché la stessa VM può avere già il Chromium del percorso browse o quello di
 * Playwright: cercare in un posto solo fa dire «nessun browser installabile» col binario sul disco.
 */
const BROWSER_SEARCH_ROOTS = [BROWSERS_PATH, '/vercel/.anomalia/browsers', '/vercel/.cache/ms-playwright', '$HOME/.cache/ms-playwright'];
const FIND_CHROME = `find ${BROWSER_SEARCH_ROOTS.join(' ')} -type f -name chrome -perm -u+x 2>/dev/null | head -1`;
/** Esportato per i test: seminarlo prova il ramo "cached". */
export const GRAPHICAL_MARKER_PATH = '/vercel/.anomalia/graphical-ready';
const MARKER = GRAPHICAL_MARKER_PATH;
const SCREENSHOT_PATH = '/tmp/anomalia-observe.png';
const DEFAULT_PLAYWRIGHT_VERSION = '1.60.0';

/**
 * APT PARLA IN CHIARO, E IL FILTRO DI RETE NON LO SENTE.
 *
 * `archive.ubuntu.com` sta nell'allowlist (DESKTOP_DOMAINS, sandbox.ts), eppure su una lane
 * chiusa ogni fetch moriva con «Connection failed [IP: 185.125.190.83 80]»: l'allowlist è per
 * NOME, il nome viaggia nell'SNI, e una richiesta HTTP non ne ha uno. Su HTTPS lo stesso
 * `apt-get update` esce 0 — misurato su una VM vera il 26/8.
 *
 * Ubuntu 26.04 tiene le sorgenti in deb822 (`ubuntu.sources`); il vecchio `sources.list` si
 * riscrive comunque per le immagini che ce l'hanno ancora.
 */
const APT_SOURCES_HTTPS =
	"sudo -n sed -i 's|http://|https://|g' /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true";

/** La porta che la sandbox espone (`ports` alla creazione): websockify serve noVNC qui sopra. */
export const DESKTOP_PORT = 6080;
/** VNC resta su loopback: l'unica cosa raggiungibile da fuori è websockify. */
const VNC_PORT = 5900;
const VNC_PASSWORD_FILE = `${ROOT}/vncpass`;
/** Il pacchetto Ubuntu mette qui i file statici del client noVNC. */
const NOVNC_WEB = '/usr/share/novnc';
/** Separato da quello grafico: una VM già grafica non deve reinstallare, né saltare, il desktop. */
const DESKTOP_MARKER = '/vercel/.anomalia/desktop-ready';

/**
 * Deps e non import: un pacchetto di `packages/` non può importare $lib/$env (vedi
 * `packages/no-app-imports.test.ts`), quindi chi monta l'adapter nell'app le passa qui.
 */
export interface GraphicalBootstrapDeps {
	resolvePlaywrightEnv: (distro: string, machine: string) => Record<string, string>;
	playwrightVersion?: string;
	/**
	 * Lancia un processo che DEVE sopravvivere alla fine del comando: `setsid nohup … &` non basta,
	 * la piattaforma lo miete alla chiusura del comando. Solo `detached: true` dell'SDK regge.
	 */
	runDetached: (ref: SandboxRef, cmd: string, args: string[]) => Promise<void>;
}

export type GraphicalStatus =
	| { ok: true; cached: boolean; browser: boolean; display: string; error?: string }
	| { ok: false; error: string };

async function runShell(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	command: string,
	timeoutMs = 60_000
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	let stdout = '';
	let stderr = '';
	let exitCode = -1;
	for await (const event of sandbox.execute(ref, { command, timeoutMs }, ctx)) {
		if (event.type === 'stdout') stdout += event.data;
		else if (event.type === 'stderr') stderr += event.data;
		else if (event.type === 'exit') exitCode = event.code;
	}
	return { exitCode, stdout, stderr };
}

function fail(step: string, r: { exitCode: number; stdout: string; stderr: string }): string {
	const detail = [r.stderr.trim() && `stderr: ${r.stderr.trim()}`, r.stdout.trim() && `stdout: ${r.stdout.trim()}`]
		.filter(Boolean)
		.join(' | ');
	return `${step} failed (exit ${r.exitCode}): ${detail || 'no output on either stream'}`.slice(0, 700);
}

async function readMarker(sandbox: SandboxProvider, ref: SandboxRef, ctx: AdapterContext): Promise<{ browser: boolean } | null> {
	const r = await runShell(sandbox, ref, ctx, `cat ${MARKER}`, 10_000);
	if (r.exitCode !== 0 || !r.stdout.trim()) return null;
	try {
		const parsed = JSON.parse(r.stdout.trim());
		return { browser: Boolean(parsed.browser) };
	} catch {
		return null;
	}
}

/** La parte lenta (minuti al primo giro): sta dietro il marcatore apposta. */
async function installPackages(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	bootstrap: GraphicalBootstrapDeps
): Promise<{ ok: true; browser: boolean } | { ok: false; error: string }> {
	const apt = await runShell(
		sandbox,
		ref,
		ctx,
		`${APT_SOURCES_HTTPS} && sudo -n apt-get update -qq && sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb xdotool imagemagick openbox feh xterm`,
		180_000
	);
	if (apt.exitCode !== 0) return { ok: false, error: fail('apt-get install (xvfb/xdotool/imagemagick)', apt) };

	// Il browser è un ripiego dichiarato, non un blocco: Xvfb+xdotool+import bastano per un
	// desktop testuale. Se Chromium non arriva: `ok:true, browser:false`, mai un fallimento.
	return { ok: true, browser: await fetchChromium(sandbox, ref, ctx, bootstrap) };
}

/**
 * SCARICA CHROMIUM, se non c'è già.
 *
 * Non sta nell'immagine e non è una dimenticanza: l'immagine deve stare in uno strato solo (a
 * strati la sandbox non parte) e con Chromium dentro il blob sfonda il tetto del registry. Quindi
 * il primo avvio di una VM se lo tira giù — ~60s — e da lì in poi vive nello snapshot.
 *
 * Ritorna `false` senza far fallire niente: Xvfb, xdotool e il desktop restano usabili anche
 * senza browser, e un `ok:true, browser:false` è una verità utile, non un errore.
 */
async function fetchChromium(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	bootstrap: GraphicalBootstrapDeps
): Promise<boolean> {
	const already = await runShell(sandbox, ref, ctx, FIND_CHROME, 10_000);
	if (already.stdout.trim()) {
		await linkChromeIntoPath(sandbox, ref, ctx);
		return true;
	}

	const osRelease = await runShell(sandbox, ref, ctx, '. /etc/os-release 2>/dev/null && echo "$ID $VERSION_ID $(uname -m)"', 10_000);
	const probe = osRelease.stdout.trim().toLowerCase();
	const machine = probe.split(/\s+/).pop() ?? '';
	const distro = probe.replace(machine, '').trim();
	const pwEnv = bootstrap.resolvePlaywrightEnv(distro, machine);
	const pwEnvPrefix = Object.entries({ ...pwEnv, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH })
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(' ');
	const playwrightVersion = bootstrap.playwrightVersion || DEFAULT_PLAYWRIGHT_VERSION;

	const install = await runShell(
		sandbox,
		ref,
		ctx,
		`mkdir -p ${ROOT} && cd ${ROOT} && npm install --no-audit --no-fund --no-save playwright@${playwrightVersion}`,
		180_000
	);
	if (install.exitCode !== 0) return false;

	// Le .so di sistema le porta l'immagine; su una VM senza immagine questo è l'unico posto che
	// le installa. Non fatale: giudica il download qui sotto.
	await runShell(
		sandbox,
		ref,
		ctx,
		`cd ${ROOT} && sudo -n env ${pwEnvPrefix} ./node_modules/.bin/playwright install-deps chromium`,
		180_000
	);

	const download = await runShell(
		sandbox,
		ref,
		ctx,
		`cd ${ROOT} && env ${pwEnvPrefix} ./node_modules/.bin/playwright install chromium`,
		180_000
	);
	if (download.exitCode !== 0) return false;

	const found = await runShell(sandbox, ref, ctx, FIND_CHROME, 10_000);
	if (!found.stdout.trim()) return false;
	await linkChromeIntoPath(sandbox, ref, ctx);
	return true;
}

/**
 * UN `chrome` NEL PATH, che punta al binario vero.
 *
 * Il browser vive sotto `browsers/chromium-<build>/chrome-linux64/chrome`, che `observe`/`act`
 * trovano con un `find` e nessun altro. Un agente che lavora da shell guarda `$PATH`, non trova
 * niente, e conclude che il browser non è installato: il 26/8 ha proposto di scaricarne un secondo
 * e reinstallare librerie già presenti. Il collegamento costa un comando e chiude la domanda.
 *
 * Un link e non uno script: chi lo invoca vuole `chrome`, con i suoi argomenti, senza che noi ci
 * mettiamo in mezzo a decidere i flag.
 */
async function linkChromeIntoPath(sandbox: SandboxProvider, ref: SandboxRef, ctx: AdapterContext): Promise<void> {
	await runShell(
		sandbox,
		ref,
		ctx,
		`CHROME=$(${FIND_CHROME}); [ -n "$CHROME" ] && sudo -n ln -sf "$CHROME" /usr/local/bin/chrome`,
		20_000
	);
}

async function ensureXvfb(sandbox: SandboxProvider, ref: SandboxRef, ctx: AdapterContext, deps: GraphicalBootstrapDeps): Promise<void> {
	const alive = await runShell(sandbox, ref, ctx, `pgrep -f "[X]vfb ${DISPLAY}" >/dev/null && echo up || echo down`, 10_000);
	if (!alive.stdout.includes('up')) {
		await deps.runDetached(ref, 'Xvfb', [DISPLAY, '-screen', '0', SCREEN]);
	}
	// L'attesa è sul SOCKET e non uno sleep fisso: mezzo secondo non bastava e la cattura moriva.
	await runShell(sandbox, ref, ctx, `i=0; while [ ! -S ${X_SOCKET} ] && [ $i -lt 20 ]; do sleep 0.25; i=$((i+1)); done`, 15_000);
	// ...ma il socket compare PRIMA che il server accetti connessioni, e openbox lanciato in quel
	// buco muore con «Failed to open the display». Nessuno lo rilancia dentro la stessa chiamata,
	// e il desktop resta senza window manager: il mouse si muove, la tastiera non scrive, perché
	// senza WM nessuna finestra prende il fuoco. Quindi si aspetta una RISPOSTA, non un file.
	await runShell(
		sandbox,
		ref,
		ctx,
		`i=0; while ! DISPLAY=${DISPLAY} xdotool getdisplaygeometry >/dev/null 2>&1 && [ $i -lt 40 ]; do sleep 0.25; i=$((i+1)); done`,
		20_000
	);
	// Senza window manager il framebuffer è nero. openbox arriva da installPackages; se manca,
	// si degrada al nero invece di fallire.
	let wm = await runShell(sandbox, ref, ctx, `pgrep -f "[o]penbox" >/dev/null && echo up || { command -v openbox >/dev/null && echo launch || echo missing; }`, 10_000);
	// Il marker copre i PACCHETTI: una VM nata prima di openbox resterebbe nera per sempre, perché
	// quel marker non tornerà mai indietro. Si installa qui, una volta.
	if (wm.stdout.includes('missing')) {
		await runShell(sandbox, ref, ctx, 'sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openbox >/dev/null 2>&1 || true', 180_000);
		wm = await runShell(sandbox, ref, ctx, `command -v openbox >/dev/null && echo launch || echo missing`, 10_000);
	}
	if (wm.stdout.includes('launch')) {
		await deps.runDetached(ref, 'env', [`DISPLAY=${DISPLAY}`, 'openbox']);
		await runShell(sandbox, ref, ctx, `sleep 0.4; DISPLAY=${DISPLAY} xsetroot -solid '#16161d' 2>/dev/null || true`, 10_000);
	}
}

async function ensureChromium(sandbox: SandboxProvider, ref: SandboxRef, ctx: AdapterContext, deps: GraphicalBootstrapDeps): Promise<boolean> {
	const probe = await runShell(
		sandbox,
		ref,
		ctx,
		`pgrep -f "[c]hrome-linux64/chrome" >/dev/null && echo up || { CHROME=$(${FIND_CHROME}); [ -n "$CHROME" ] && echo "launch $CHROME" || echo missing; }`,
		20_000
	);
	if (probe.stdout.includes('up')) return true;
	const m = probe.stdout.match(/launch (\S+)/);
	if (!m) return false;
	await runShell(sandbox, ref, ctx, CLEAR_CHROME_LOCKS, 10_000);
	await deps.runDetached(ref, 'env', [
		`DISPLAY=${DISPLAY}`,
		m[1],
		'--no-sandbox',
		'--disable-dev-shm-usage',
		'--disable-gpu',
		'--no-first-run',
		'--no-default-browser-check',
		// Il profilo è persistente: senza questo flag Chromium riparte su una finestra vuota e il
		// lavoro del turno prima sembra perso.
		'--restore-last-session',
		`--user-data-dir=${CHROME_PROFILE}`,
		'--window-size=1280,760',
		'--window-position=0,20',
		'about:blank'
	]);
	return true;
}

/**
 * Sola lettura, per lo status endpoint: SOLO il marcatore (un `cat`, niente install) — mai il ramo
 * lento di `ensureGraphicalMode`. Marcatore assente vuol dire "mai attivato", non "errore".
 */
export async function probeGraphicalMode(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext
): Promise<{ active: boolean; browser: boolean }> {
	const marker = await readMarker(sandbox, ref, ctx);
	return marker ? { active: true, browser: marker.browser } : { active: false, browser: false };
}

/** Lo script cotto nell'immagine desktop: se c'è, l'ambiente grafico è già installato. */
const DESKTOP_SCRIPT = 'anomalia-desktop';

/**
 * LA STRADA CORTA: l'immagine porta già XFCE, VNC e noVNC (`sandbox-desktop/Dockerfile`).
 *
 * Installare a runtime costava 209s di apt più 68s di update su una VM fredda — più del lease con
 * cui la lane del computer apre la macchina, quindi la prima apertura falliva sempre. Con
 * l'immagine la stessa VM è pronta in 7 secondi, e qui non si tocca apt: si accende e si legge
 * cosa è salito.
 *
 * Lo script è IDEMPOTENTE (rilancia solo i pezzi caduti), quindi si esegue a ogni chiamata: lo
 * stop della VM conserva il disco e uccide i processi, e al risveglio il desktop è installato ma
 * spento.
 */
async function ensureBakedDesktop(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	deps: GraphicalBootstrapDeps
): Promise<GraphicalStatus | null> {
	// Il PERCORSO, non l'exit code: un sandbox che risponde 0 a qualunque comando (l'emulatore dei
	// test, e qualunque shell che non conosce `command -v`) farebbe credere che il desktop sia già
	// cotto, e `observe` fallirebbe su una VM che invece va provvista a runtime.
	const present = await runShell(sandbox, ref, ctx, `command -v ${DESKTOP_SCRIPT}`, 10_000);
	if (present.exitCode !== 0 || !present.stdout.trim()) return null;

	const started = await runShell(sandbox, ref, ctx, DESKTOP_SCRIPT, 120_000);
	const line = started.stdout.trim();
	// «Verde» qui vuol dire un desktop USABILE: senza pannello non c'è dock, senza WM la tastiera
	// non scrive perché nessuna finestra prende il fuoco. Dirlo adesso, non farlo scoprire a chi
	// guarda uno schermo nero.
	if (started.exitCode !== 0 || !/wm=up/.test(line) || !/panel=up/.test(line)) {
		return { ok: false, error: fail(`${DESKTOP_SCRIPT} (desktop dall'immagine)`, started) };
	}

	// L'immagine porta il desktop, NON il browser (vedi `fetchChromium`): senza questo, chi apre
	// il computer trova un desktop senza la cosa per cui l'ha aperto.
	const browser = await fetchChromium(sandbox, ref, ctx, deps);
	await ensureChromium(sandbox, ref, ctx, deps);

	// Il marcatore lo legge `probeGraphicalMode`, ed è l'UNICA cosa che il pannello guarda per
	// decidere se il computer ha uno schermo. Saltarlo qui voleva dire desktop acceso e pulsante
	// «Prendi il controllo» invisibile.
	// Due comandi e non uno incatenato: `mkdir && printf` in una riga sola è un pezzo di bash che
	// nessun test può leggere, e questo marcatore decide se il pannello mostra il desktop.
	await runShell(sandbox, ref, ctx, `mkdir -p ${MARKER.slice(0, MARKER.lastIndexOf('/'))}`, 10_000);
	await runShell(sandbox, ref, ctx, `echo '${JSON.stringify({ browser })}' > ${MARKER}`, 10_000);
	return { ok: true, cached: true, browser, display: DISPLAY };
}

export async function ensureGraphicalMode(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	deps: GraphicalBootstrapDeps
): Promise<GraphicalStatus> {
	const baked = await ensureBakedDesktop(sandbox, ref, ctx, deps);
	if (baked) return baked;

	let browser: boolean;
	let cached: boolean;

	const marker = await readMarker(sandbox, ref, ctx);
	if (marker) {
		browser = marker.browser;
		cached = true;
	} else {
		const installed = await installPackages(sandbox, ref, ctx, deps);
		if (!installed.ok) return { ok: false, error: installed.error };
		browser = installed.browser;
		cached = false;
		await runShell(sandbox, ref, ctx, `mkdir -p $(dirname ${MARKER}) && printf '%s' '${JSON.stringify({ browser })}' > ${MARKER}`, 10_000);
	}

	await ensureXvfb(sandbox, ref, ctx, deps);
	// Il marker può MENTIRE al ribasso (`browser:false` col binario già sul disco, scaricato dal
	// percorso browse): per questo il lancio riprova SEMPRE — trova il binario da sé, e no-opa
	// se davvero non c'è — invece di fidarsi di quello che il marker dichiara.
	const browserUp = await ensureChromium(sandbox, ref, ctx, deps);
	if (browserUp !== browser) {
		browser = browserUp;
		await runShell(sandbox, ref, ctx, `printf '%s' '${'${JSON.stringify({ browser: browserUp })}'}' > ${'${MARKER}'}`, 10_000).catch(() => {});
	}

	return { ok: true, cached, browser, display: DISPLAY };
}

export type ShotResult = { ok: true; base64: string } | { ok: false; error: string };

/**
 * Screenshot via `readFile`, MAI attraverso lo stdout di `execute()`: quel canale è clampato a
 * 20.000 caratteri e un PNG base64 lo sfonda subito, troncato a metà immagine e in silenzio.
 */
export async function captureScreenshot(sandbox: SandboxProvider, ref: SandboxRef, ctx: AdapterContext): Promise<ShotResult> {
	const shot = await runShell(sandbox, ref, ctx, `import -window root -display ${DISPLAY} ${SCREENSHOT_PATH}`, 15_000);
	if (shot.exitCode !== 0) return { ok: false, error: fail('import -window root', shot) };
	try {
		const bytes = await sandbox.readFile(ref, SCREENSHOT_PATH, ctx);
		return { ok: true, base64: Buffer.from(bytes).toString('base64') };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** La forma che il tool `act` accetta (vedi tools/builtin.ts). */
export type DesktopAction = {
	kind: 'click' | 'move' | 'type' | 'key' | 'scroll' | 'wait';
	x?: number;
	y?: number;
	text?: string;
	key?: string;
	amount?: number;
	ms?: number;
};

/** Quoting POSIX: niente iniezione dal testo che scrive il modello. */
function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function actionToCommand(a: DesktopAction, index: number): { cmd: string } | { error: string } {
	switch (a.kind) {
		case 'move':
			if (typeof a.x !== 'number' || typeof a.y !== 'number') return { error: `azione ${index} (move): richiede x e y` };
			return { cmd: `xdotool mousemove ${Math.round(a.x)} ${Math.round(a.y)}` };
		case 'click': {
			const move = typeof a.x === 'number' && typeof a.y === 'number' ? `xdotool mousemove ${Math.round(a.x)} ${Math.round(a.y)} && ` : '';
			return { cmd: `${move}xdotool click 1` };
		}
		case 'type':
			if (!a.text) return { error: `azione ${index} (type): richiede text` };
			return { cmd: `xdotool type --delay 40 -- ${shQuote(a.text)}` };
		case 'key':
			if (!a.key) return { error: `azione ${index} (key): richiede key` };
			return { cmd: `xdotool key -- ${shQuote(a.key)}` };
		case 'scroll': {
			const amount = typeof a.amount === 'number' ? a.amount : 0;
			if (!amount) return { error: `azione ${index} (scroll): richiede amount (righe, negativo = su)` };
			const button = amount > 0 ? 5 : 4;
			return { cmd: `xdotool click --repeat ${Math.min(50, Math.abs(Math.round(amount)))} --delay 20 ${button}` };
		}
		case 'wait': {
			const ms = typeof a.ms === 'number' && a.ms > 0 ? Math.min(10_000, a.ms) : 300;
			return { cmd: `sleep ${(ms / 1000).toFixed(3)}` };
		}
		default:
			return { error: `azione ${index}: kind '${(a as { kind?: string }).kind}' sconosciuto` };
	}
}

export type ActResult = { ok: true } | { ok: false; error: string };

/** Tutte le azioni in una sola pipeline: un giro di rete verso la VM, non uno per azione. */
export async function runActions(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	actions: DesktopAction[]
): Promise<ActResult> {
	const parts: string[] = [];
	for (let i = 0; i < actions.length; i++) {
		const step = actionToCommand(actions[i], i);
		if ('error' in step) return { ok: false, error: step.error };
		parts.push(step.cmd);
	}
	if (!parts.length) return { ok: false, error: 'nessuna azione da eseguire' };
	const command = `export DISPLAY=${DISPLAY}; ${parts.join(' && ')}`;
	const r = await runShell(sandbox, ref, ctx, command, 30_000);
	if (r.exitCode !== 0) return { ok: false, error: fail('act', r) };
	return { ok: true };
}


export type DesktopStatus = { ok: true; port: number; cached: boolean } | { ok: false; error: string };

/**
 * IL DESKTOP CHE GUIDA L'UTENTE, non l'agente.
 *
 * `observe`/`act` danno alla macchina un utente solo — il modello. Qui la stessa `:1` esce da
 * `x11vnc`, e `websockify` serve il client noVNC sulla porta che la sandbox espone: l'utente apre
 * un URL e ha mouse e tastiera, sulle stesse finestre e sullo stesso profilo Chrome persistente
 * che l'agente sta usando. Nessuna seconda macchina, nessuna seconda sessione.
 *
 * **La password non è un dettaglio di comodo: è l'unico confine.** `sandbox.domain(port)` è un URL
 * PUBBLICO — chi ce l'ha, senza password, guida un Chrome loggato sui social del brand. Per questo
 * una password vuota è un rifiuto, non un default.
 *
 * Come `ensureGraphicalMode`: i PACCHETTI stanno dietro il marcatore (lenti, una volta), i
 * PROCESSI si verificano a ogni chiamata — `sleepIdleComputers` conserva il disco e uccide tutto,
 * e nessuno li rilancia al risveglio.
 */
export async function ensureRemoteDesktop(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	deps: GraphicalBootstrapDeps,
	password: string
): Promise<DesktopStatus> {
	if (!password.trim()) {
		return { ok: false, error: 'desktop remoto senza password: rifiutato — la porta esposta è pubblica' };
	}

	const marker = await runShell(sandbox, ref, ctx, `test -f ${DESKTOP_MARKER} && echo yes`, 10_000);
	const cached = marker.stdout.includes('yes');
	if (!cached) {
		const apt = await runShell(
			sandbox,
			ref,
			ctx,
			`${APT_SOURCES_HTTPS} && sudo -n apt-get update -qq && sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq x11vnc novnc websockify`,
			300_000
		);
		if (apt.exitCode !== 0) return { ok: false, error: fail('apt-get install (x11vnc/novnc/websockify)', apt) };
		await runShell(sandbox, ref, ctx, `mkdir -p $(dirname ${DESKTOP_MARKER}) && touch ${DESKTOP_MARKER}`, 10_000);
	}

	// Riscritta a ogni chiamata: la password è derivata, non conservata — se cambia il segreto,
	// il file segue senza che nessuno debba ricordarsi di ripulirlo.
	const stored = await runShell(
		sandbox,
		ref,
		ctx,
		`mkdir -p ${ROOT} && x11vnc -storepasswd ${shQuote(password)} ${VNC_PASSWORD_FILE}`,
		20_000
	);
	if (stored.exitCode !== 0) return { ok: false, error: fail('x11vnc -storepasswd', stored) };

	const vncUp = await runShell(sandbox, ref, ctx, `pgrep -f "[x]11vnc" >/dev/null && echo up || echo down`, 10_000);
	if (!vncUp.stdout.includes('up')) {
		await deps.runDetached(ref, 'sh', [
			'-c',
			`x11vnc -display ${DISPLAY} -rfbauth ${VNC_PASSWORD_FILE} -rfbport ${VNC_PORT} -localhost -forever -shared -noxdamage`
		]);
	}

	const proxyUp = await runShell(sandbox, ref, ctx, `pgrep -f "[w]ebsockify" >/dev/null && echo up || echo down`, 10_000);
	if (!proxyUp.stdout.includes('up')) {
		await deps.runDetached(ref, 'sh', [
			'-c',
			`websockify --web=${NOVNC_WEB} ${DESKTOP_PORT} localhost:${VNC_PORT}`
		]);
	}

	return { ok: true, port: DESKTOP_PORT, cached };
}


export type ClipboardRead = { ok: true; text: string } | { ok: false; error: string };

/**
 * GLI APPUNTI DELLA VM, letti e scritti da fuori.
 *
 * Il pannello appunti di noVNC esiste, ma sta dentro un iframe di un altro dominio: la nostra
 * pagina non può né leggerlo né scriverlo, e chiedere all'utente di passare da quel pannello
 * significa spiegargli un'interfaccia che non è nostra. Qui il ponte è esplicito — `xclip` sul
 * display che l'utente sta guardando — e dalla parte del browser ci pensa la clipboard nativa.
 */
export async function readClipboard(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext
): Promise<ClipboardRead> {
	const r = await runShell(
		sandbox,
		ref,
		ctx,
		`DISPLAY=${DISPLAY} xclip -selection clipboard -o 2>/dev/null`,
		15_000
	);
	// Appunti vuoti: `xclip` esce diverso da zero e non è un errore da mostrare.
	if (r.exitCode !== 0 && !r.stdout) return { ok: true, text: '' };
	return { ok: true, text: r.stdout };
}

export async function writeClipboard(
	sandbox: SandboxProvider,
	ref: SandboxRef,
	ctx: AdapterContext,
	text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!text) return { ok: false, error: 'niente da incollare' };
	// `printf %s` e non `echo`: `echo` interpreta le sequenze e aggiungerebbe un a capo che
	// nell'appunto non c'era. Il testo è quotato: viene da un utente, non da noi.
	const r = await runShell(
		sandbox,
		ref,
		ctx,
		`printf %s ${shQuote(text)} | DISPLAY=${DISPLAY} xclip -selection clipboard -i`,
		15_000
	);
	if (r.exitCode !== 0) return { ok: false, error: fail('xclip -i', r) };
	return { ok: true };
}
