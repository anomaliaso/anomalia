/**
 * RENDER NELLA VM: l'agente Motion guarda quello che ha scritto.
 *
 * Fino a qui il giro era: il modello scrive TSX, `compileMotionSource` lo transpila con sucrase in
 * questo processo, e se non esplode si considera fatto. Poi l'MP4 lo rendeva il **browser
 * dell'utente**, e il server si limitava a rattoppare TSX. Due conseguenze che si vedono nei
 * video:
 *
 * 1. **Sucrase non esegue niente.** Prende la sintassi e gli import e si ferma lì. Un
 *    `undefined.map`, una `<Sequence>` che finisce prima di iniziare, un `<Img>` che 403a, un
 *    layout che va in overflow al frame 47 — tutto questo passa la compilazione. Il primo a
 *    scoprirlo è chi apre l'anteprima.
 * 2. **Il modello giudica il proprio codice, non i propri fotogrammi.** La QC di craft legge il
 *    TSX. Un agente che scrive video e non li ha mai visti è la definizione del problema.
 *
 * Qui il render succede davvero, in una microVM, e i PNG tornano **attaccati al risultato del
 * tool** — quindi il modello che ha scritto la scena è il modello che la guarda. È lo stesso
 * meccanismo di `study_motion_reference` (`toModelOutput`), rivolto verso l'interno.
 *
 * ## Perché `research` e non `compute`
 *
 * Un motion video di questo prodotto è pieno di `<Img src="https://…">`: still coniati con Nano
 * Banana, foto della libreria, il logo del brand. In `compute` la rete è chiusa a tutto tranne i
 * registry, quindi il render riuscirebbe **e i fotogrammi tornerebbero con dei buchi** — il modo
 * peggiore di fallire, perché sembra funzionare. Quindi `research`, con le subnet private negate
 * come sempre, e in cambio la regola che qui non si negozia: **su una run di render i dati del
 * brand non entrano nella VM**. Ci entra il TSX, che l'abbiamo scritto noi, e basta.
 *
 * ## Perché il progetto sta nella home e non nella run
 *
 * `remotion` + `@remotion/cli` sono ~570 MB di `node_modules` (i compositor per piattaforma e il
 * browser che Remotion si porta dietro): decine di secondi e mezzo gigabyte, a ogni render, per
 * una VM che li ha già. La directory delle run viene cancellata da `release()`, l'ambiente della
 * macchina no — stessa ragione per cui `browse.mjs` vive in `.anomalia/`. Quindi il progetto di
 * render sta lì, si installa una volta per macchina, e ogni render ci riscrive dentro solo
 * `src/Video.tsx`.
 *
 * Lo scaffold qui sotto (Root + index + gli export del contratto) è stato verificato rendendo
 * davvero: 1080×1080, `<Series>` con `offset` negativo e una `<TransitionSeries>`, PNG corretti.
 */
import { swallow } from '$lib/server/swallow';
import { tool } from 'ai';
import { z } from 'zod';
import {
	describeSandboxDeath,
	isSandboxConfigured,
	openBrandSandbox,
	SANDBOX_MAX_LEASE_MS,
	type SandboxHandle
} from '$lib/server/sandbox';
import { createHash, randomUUID } from 'node:crypto';
import {
	MOTION_REMOTION_VERSION,
	MOTION_RENDER_PACKAGES
} from '$lib/motion-video/modules';
import { compileMotionSource } from '$lib/motion-video/compile';
import { withSandboxBilling } from '$lib/server/sandbox-credits';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Di chi è la macchina su cui Remotion gira: la stessa chiave con cui il pannello nomina l'agente. */
const MOTION_AGENT = 'motion';

/** Il progetto di render, nella home della VM: sopravvive alla run, non ai riavvii della macchina. */
const PROJECT_DIR = '.anomalia/motion-render';

/** Fotogrammi per chiamata. Oltre, il contesto si riempie di PNG e il modello smette di guardarli. */
export const MAX_STILLS_PER_RENDER = 4;
/** Render per turno: ognuno è una VM, un render e dei megabyte di immagini nel contesto. */
export const MAX_RENDERS_PER_TURN = 3;

/**
 * L'installazione del progetto di render, e perché dieci minuti e non quattro.
 *
 * Erano 240 secondi, scelti a occhio. In produzione i primi tre render sono falliti — 245s, 342s,
 * 342s — e il quarto è riuscito in 62: cioè la PRIMA volta su una macchina fredda l'installazione
 * sforava, e solo quando il progetto era già lì il render andava. Sono ~570 MB di `node_modules`
 * (i compositor per piattaforma e il browser di Remotion) tirati giù da npm su 2 vCPU: quattro
 * minuti sono ottimismo, non un tetto.
 *
 * Si paga una volta per macchina — la cache è per dipendenze, non per run — quindi un tetto largo
 * qui non costa a regime: costa solo la prima volta, ed è esattamente la volta che finora falliva.
 */
const INSTALL_TIMEOUT_MS = 600_000;
const RENDER_TIMEOUT_MS = 120_000;
/** Sotto questo, non si fa in tempo nemmeno a installare: meglio dirlo che aprire una VM per niente. */
const MIN_RENDER_MS = 150_000;

/**
 * I BUDGET DEVONO STARE DENTRO L'AFFITTO, non accanto.
 *
 * Erano tre numeri decisi ognuno per conto suo: installazione 600s, render 480s, e una macchina
 * affittata al massimo `SANDBOX_MAX_LEASE_MS` (900s). 600 + 480 = 1080: una macchina fredda con
 * un'installazione lenta — in produzione se ne sono viste da 342s — più un 4K pesante arrivava
 * contro il muro del lease, che non è un timeout gentile: la macchina si spegne, i 900 secondi si
 * pagano lo stesso e non esce nessun file.
 *
 * Quindi ogni passo chiede quanto tempo resta DAVVERO, tolto il margine per portare fuori il
 * risultato (leggere l'MP4 dalla VM e caricarlo su Storage succede dentro l'affitto). Il tetto
 * scritto qui sopra resta il massimo, non la promessa.
 */
export function budgetWithin(
	leaseMs: number,
	elapsedMs: number,
	reserveMs: number,
	capMs: number
): number {
	return Math.max(0, Math.min(capMs, leaseMs - elapsedMs - reserveMs));
}

export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image-data'; data: string; mediaType: string };

/** Il `Root` che Remotion si aspetta, costruito dagli export del nostro contratto TSX. */
const ROOT_TSX = `import React from 'react';
import { Composition, continueRender, delayRender } from 'remotion';
import { transform } from 'sucrase';
import MotionVideo, { fps, durationInFrames, width, height } from './Video';

/**
 * La grafica: il sorgente arriva come PROP e viene compilato QUI, nel browser.
 *
 * E' cio' che rende il bundle indipendente da cosa si sta renderizzando, e quindi riusabile. Un
 * bundle che importa './Video' e' STANTIO appena il sorgente cambia — misurato: due sorgenti
 * diversi, stesso bundle, PNG identici. Cachare quello significherebbe consegnare in silenzio la
 * grafica precedente.
 */
const GraphicFromSource: React.FC<{ source: string }> = ({ source }) => {
  const [el, setEl] = React.useState(null);
  const [handle] = React.useState(() => delayRender('compiling the graphic source'));
  React.useEffect(() => {
    try {
      const code = transform(source, { transforms: ['typescript', 'jsx'], jsxRuntime: 'classic' }).code;
      // L'a capo NON e' cosmetico: il sorgente puo' finire con un commento di riga, e senza
      // questo il \`return\` ci finisce dentro — la funzione torna undefined e l'errore dice
      // "the source does not define Graphic", che accusa il modello di un difetto nostro.
      const factory = new Function('React', code + '\\n; return typeof Graphic !== "undefined" ? Graphic : null;');
      const C = factory(React);
      if (!C) throw new Error('the source does not define Graphic');
      setEl(React.createElement(C));
    } finally {
      continueRender(handle);
    }
  }, [source, handle]);
  return el;
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="MotionVideo"
      component={MotionVideo as React.FC}
      durationInFrames={durationInFrames ?? 180}
      fps={fps ?? 30}
      width={width ?? 1080}
      height={height ?? 1080}
    />
    <Composition
      id="Graphic"
      component={GraphicFromSource}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{ source: 'const Graphic = () => <div />;' }}
      calculateMetadata={({ props }) => {
        const m = /__w=(\\d{3,4}).__h=(\\d{3,4})/.exec(props.source);
        return { width: m ? Number(m[1]) : 1080, height: m ? Number(m[2]) : 1080, durationInFrames: 1, fps: 30 };
      }}
    />
  </>
);
`;

const INDEX_TS = `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
`;

/**
 * Le dipendenze della VM escono da `MOTION_RENDER_PACKAGES`, non da una lista scritta qui: se il
 * player accetta `@remotion/transitions` e la VM non ce l'ha, un video che si vede in anteprima
 * fallisce il render — e il modello leggerebbe quell'errore come un difetto del proprio codice.
 * `@remotion/cli` si aggiunge qui perché serve a RENDERE, non a essere importato da un video.
 */
function packageJson(): string {
	return JSON.stringify(
		{
			name: 'motion-render',
			private: true,
			version: '1.0.0',
			dependencies: {
				...MOTION_RENDER_PACKAGES,
				'@remotion/cli': MOTION_REMOTION_VERSION
			}
		},
		null,
		2
	);
}

/**
 * I fotogrammi da guardare quando il modello non li sceglie: mai il primo e mai l'ultimo — sono i
 * due che un difetto di animazione NON mostra, perché all'inizio non si è ancora mosso niente e
 * alla fine tutto è già a posto. Si guarda dentro il movimento.
 */
export function defaultStillFrames(durationInFrames: number, count: number): number[] {
	const total = Math.max(1, Math.floor(durationInFrames));
	const n = Math.max(1, Math.min(count, MAX_STILLS_PER_RENDER, total));
	const out: number[] = [];
	for (let i = 1; i <= n; i++) {
		const frame = Math.round((total * i) / (n + 1));
		out.push(Math.min(total - 1, Math.max(0, frame)));
	}
	return [...new Set(out)];
}

/** `at_seconds` del modello → indici di fotogramma dentro la clip, deduplicati e in ordine. */
export function framesFromSeconds(
	seconds: number[],
	fps: number,
	durationInFrames: number
): number[] {
	const last = Math.max(0, Math.floor(durationInFrames) - 1);
	const frames = seconds
		.filter((s) => Number.isFinite(s) && s >= 0)
		.map((s) => Math.min(last, Math.max(0, Math.round(s * fps))));
	return [...new Set(frames)].sort((a, b) => a - b).slice(0, MAX_STILLS_PER_RENDER);
}

/**
 * `fps` e `durationInFrames` si leggono dal sorgente, non dalla riga del database: in create mode
 * la bozza non è ancora salvata, e dopo un `write_source` la riga è vecchia di un passo.
 *
 * LA REGEX NON BASTA, ed è costata la cecità del gate sulla voce. Il commento qui sopra diceva
 * «il contratto TSX li impone come export LETTERALI»: non è vero, e non lo è proprio dove conta.
 * Misurato il 23/08/2026 sulla libreria di animazioni — le venti voci che l'agente è istruito a
 * COPIARE — **17 su 20** calcolano la durata (`export const durationInFrames = Math.round(BEAT *
 * fps) * STEPS`). Su tutte e diciassette la regex non trovava niente e vinceva il fallback: dentro
 * `renderMotionMp4` quel fallback è il letterale 180, quindi `assertMotionVoiceGate` giudicava un
 * video da 180 frame mentre dalla VM ne uscivano 110 (`transitions/1-slide-up`) o 174
 * (`posts/1-carousel-pullback`). Due secondi e mezzo di bugia sono esattamente lo spazio in cui
 * una battuta viene mozzata — cioè il guasto che quel gate esiste per impedire.
 *
 * Quindi quando la regex non trova un letterale si ESEGUE il modulo, che è l'unica lettura che non
 * può mentire: sono gli stessi export che il `ROOT_TSX` qui sopra passa a `<Composition>`, quindi
 * i numeri giudicati sono per costruzione quelli renderizzati. Il fallback resta per il sorgente a
 * metà che non compila — meglio di rifiutare il render.
 *
 * ponytail: si compila una volta per render (sucrase + il corpo del modulo, millisecondi), non in
 * un ciclo. Se un giorno questo finisse su un percorso caldo, il passo è passare la meta già
 * compilata dal chiamante invece di ricavarla due volte.
 */
export function readSourceMeta(
	source: string,
	fallback: { fps: number; durationInFrames: number }
): { fps: number; durationInFrames: number } {
	const num = (name: string): number | null => {
		const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\d+)`).exec(source);
		const n = m ? Number(m[1]) : NaN;
		return Number.isFinite(n) && n > 0 ? n : null;
	};
	/**
	 * Si esegue solo per un export CHE C'È ma non è un letterale. Se il nome non è dichiarato
	 * affatto, vince il fallback del chiamante e non i default di `compileMotionSource` — che sono
	 * 30/180 e cancellerebbero la durata scelta nel picker (`agent.ts`, dove il fallback è
	 * `motionFramesForDuration(duration)`: 450 frame per un video da 15s).
	 */
	const declares = (name: string) =>
		new RegExp(`export\\s+const\\s+${name}\\s*=`).test(source);
	let fps = num('fps');
	let durationInFrames = num('durationInFrames');
	if ((fps === null && declares('fps')) || (durationInFrames === null && declares('durationInFrames'))) {
		try {
			const compiled = compileMotionSource(source);
			if (fps === null && declares('fps')) fps = compiled.fps;
			if (durationInFrames === null && declares('durationInFrames')) {
				durationInFrames = compiled.durationInFrames;
			}
		} catch (error) { swallow('compile motion source', error); }
	}
	return {
		fps: fps ?? fallback.fps,
		durationInFrames: durationInFrames ?? fallback.durationInFrames
	};
}

/**
 * La cache non è "esiste node_modules" ma "esiste node_modules PER QUESTE dipendenze".
 *
 * La differenza conta il giorno in cui la allowlist si allarga: una VM che ha già installato il
 * progetto salterebbe l'installazione, e il primo video che importa il pacchetto nuovo fallirebbe
 * il render con un errore di modulo mancante — che il modello leggerebbe come un difetto del
 * proprio codice e proverebbe a "correggere" riscrivendo la scena. Quindi si confronta il
 * package.json che c'è con quello che vogliamo, e si reinstalla quando divergono.
 */
/**
 * L'impronta di TUTTO ciò che il bundle contiene: dipendenze, Root e index.
 *
 * Chiavare la cache sul solo `package.json` è il difetto che questo file ha già pagato due volte:
 * cambiando `ROOT_TSX` per aggiungere una composizione, le dipendenze restavano identiche, il
 * progetto risultava «cached» e il bundle vecchio rispondeva «Could not find composition with ID
 * Graphic» — un errore che non nomina né il bundle né la cache. Un bundle stantio è peggio ancora
 * quando compila: renderizza in silenzio la grafica di prima.
 */
function projectStamp(): string {
	return createHash('sha1').update(packageJson()).update(ROOT_TSX).update(INDEX_TS).digest('hex');
}

async function ensureProject(
	sb: SandboxHandle,
	onLog?: (l: string) => void,
	/** Quanto tempo l'installazione può prendersi senza mangiarsi il render che viene dopo. */
	budgetMs = INSTALL_TIMEOUT_MS
): Promise<void> {
	const stamp = projectStamp();
	const installed = await sb.run('test', ['-d', `${PROJECT_DIR}/node_modules/remotion`]);
	if (installed.exitCode === 0) {
		const current = await sb.read(`${PROJECT_DIR}/.stamp`).catch((error) => { swallow('sb.read failed', error); return null; });
		const hasBundle = await sb.run('test', ['-d', `${PROJECT_DIR}/bundle`]);
		if (current?.trim() === stamp && hasBundle.exitCode === 0) {
			onLog?.('render project cached');
			return;
		}
		onLog?.(current?.trim() === stamp ? 'render project cached, bundling' : 'render project changed — reinstalling');
	} else {
		onLog?.('installing render project');
	}

	// Il bundle va con il progetto: uno rimasto da prima non ha le composizioni nuove.
	await sb.run('rm', ['-rf', `${PROJECT_DIR}/bundle`]);
	await sb.run('mkdir', ['-p', `${PROJECT_DIR}/src`, `${PROJECT_DIR}/out`]);
	await sb.write([
		{ path: `${PROJECT_DIR}/package.json`, content: packageJson() },
		{ path: `${PROJECT_DIR}/src/Root.tsx`, content: ROOT_TSX },
		{ path: `${PROJECT_DIR}/src/index.ts`, content: INDEX_TS }
	]);
	const install = await sb.run('npm', ['install', '--no-audit', '--no-fund'], {
		cwd: PROJECT_DIR,
		timeoutMs: Math.max(30_000, budgetMs)
	});
	if (install.exitCode !== 0) {
		throw new Error(`npm install failed in the sandbox: ${install.stderr.slice(-600)}`);
	}
	await buildBundle(sb, onLog);
	// Lo stamp si scrive per ULTIMO: un'installazione interrotta a metà non deve risultare valida.
	await sb.write([{ path: `${PROJECT_DIR}/.stamp`, content: stamp }]);
}

/**
 * L'MP4 COMPLETO, reso nella VM — e ormai l'unico posto dove un MP4 nasce.
 *
 * C'è stato un percorso browser (`renderMotionAdBlob`, cancellato): gratis e con la CPU di chi
 * guarda, ma `@remotion/web-renderer` muxa solo `inline-audio`, quindi una composizione con un
 * `<Audio src="https://…">` usciva **muta** senza che nessuno se ne accorgesse fino alla
 * pubblicazione — e l'encoder faceva chiudere la scheda mentre il Player teneva in memoria
 * l'audio decodificato. Il renderer Node, qui dentro, l'audio remoto lo scarica e lo muxa: è
 * l'unico posto dove quel video può esistere davvero.
 *
 * Senza sandbox configurata non si rende e basta: non c'è più un ripiego. Chi chiama lo dichiara
 * all'utente (la rotta `render` risponde 503 con un messaggio tradotto, il tool dell'agente
 * ritorna `render_failed`), invece di fingere un file che non c'è.
 *
 * Il tempo di macchina è addebitato al brand — `withSandboxBilling`, a secondi, anche se il render
 * fallisce. Vedi `sandbox-credits.ts` per il perché.
 */
export const MP4_RENDER_TIMEOUT_MS = 480_000;
/** Sotto questo non si apre nemmeno la VM: un render tagliato a metà è tempo pagato per niente. */
const MIN_MP4_RENDER_MS = 300_000;
/** Leggere l'MP4 dalla VM e caricarlo su Storage succede DENTRO l'affitto: va riservato. */
const MP4_UPLOAD_MARGIN_MS = 45_000;
/** La fetta minima che si lascia al render quando si decide quanto può durare l'installazione. */
const MP4_MIN_RENDER_SLICE_MS = 120_000;

export type MotionMp4Result = {
	/** WAV/MP4 caricato: l'url pubblico da cui la pagina lo scarica. */
	url: string;
	bytes: number;
	seconds: number;
};

export async function renderMotionMp4(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId?: string;
	videoId?: string | null;
	source: string;
	/** Scala di supersampling, come nel percorso browser (`motionMp4Scale`). */
	scale?: number;
	crf?: number;
	remainingMs?: () => number;
	abortSignal?: AbortSignal;
	onLog?: (line: string) => void;
}): Promise<MotionMp4Result> {
	if (!isSandboxConfigured()) {
		throw new Error('Sandbox not configured: this deployment cannot render an MP4 with audio.');
	}
	const left = opts.remainingMs?.();
	if (typeof left === 'number' && left < MIN_MP4_RENDER_MS) {
		throw new Error('Not enough time left in this turn to render an MP4 — try again from a fresh turn.');
	}

	// IL GATE SULLA VOCE, PRIMA DELLA VM. Qui e non nel tool: questo è l'unico posto dove un MP4
	// nasce (tool dell'agente, chat e rotta del designer passano tutti di qui), quindi è l'unico
	// posto dove "impossibile consegnare un video che lo viola" è vero per costruzione. Il trailer
	// `anomalia` del 21/8 — voce troncata a metà parola, due beat muti, chiusura a metà frase — è
	// uscito da un percorso che nessun giudice ha guardato; questo controllo è aritmetica sui
	// frame e sui campioni, gira sempre, e fallisce prima di spendere un secondo di macchina.
	{
		const { assertMotionVoiceGate } = await import('$lib/server/motion-video/voice-gate');
		// Stessi fallback del ROOT_TSX qui sopra: se il sorgente non esporta i suoi numeri, il
		// render userà davvero 30fps/180 frame — e il gate deve giudicare il video che uscirà.
		const meta = readSourceMeta(opts.source, { fps: 30, durationInFrames: 180 });
		await assertMotionVoiceGate({
			supabase: opts.supabase,
			brandId: opts.brandId,
			source: opts.source,
			fps: meta.fps,
			durationInFrames: meta.durationInFrames
		});
	}

	return withSandboxBilling(
		{ brandId: opts.brandId, userId: opts.userId, use: 'motion_render', detail: opts.videoId ?? undefined },
		async () => {
			let sb: SandboxHandle | null = null;
			// L'orologio parte con l'affitto: da qui in poi ogni passo chiede quanto ne resta.
			const startedAt = Date.now();
			const lease = Math.min(
				typeof left === 'number' ? left : SANDBOX_MAX_LEASE_MS,
				SANDBOX_MAX_LEASE_MS
			);
			try {
				sb = await openBrandSandbox({
					brandId: opts.brandId,
					// La macchina è dell'AGENTE (`sandboxName`), e chi rende un motion video è il
					// Motion Specialist: la cache di Remotion vive sul suo disco, non su quello di
					// un agente che non renderà mai niente.
					mode: 'research',
					agentId: MOTION_AGENT,
					// Remotion lancia chrome-headless-shell: senza le librerie di sistema di Chromium
					// (`libnspr4`, `libnss3`, `libatk*`, …) muore all'avvio, e l'immagine di default
					// non le ha. `needsBrowser` porta l'immagine Ubuntu e `playwright install-deps`,
					// che installa esattamente quella lista — una volta per VM, poi è nello snapshot.
					needsBrowser: true,
					timeoutMs: lease,
					runId: randomUUID(),
					abortSignal: opts.abortSignal,
					onLog: opts.onLog
				});
				// Il NOME della macchina, sempre: il render gira sulla VM del Motion Specialist, che
				// non è quella della shell di chi ha chiesto il video. Un agente che va a
				// diagnosticare un fallimento senza questo nome guarda il disco sbagliato e
				// conclude che manca tutto (successo il 26/8).
				opts.onLog?.(`render su ${sb.name}`);
				await ensureProject(
					sb,
					opts.onLog,
					budgetWithin(
						lease,
						Date.now() - startedAt,
						MP4_UPLOAD_MARGIN_MS + MP4_MIN_RENDER_SLICE_MS,
						INSTALL_TIMEOUT_MS
					)
				);
				await sb.write([{ path: `${PROJECT_DIR}/src/Video.tsx`, content: opts.source }]);
				await sb.run('rm', ['-rf', `${PROJECT_DIR}/out`]);
				await sb.run('mkdir', ['-p', `${PROJECT_DIR}/out`]);

				const args = [
					'remotion',
					'render',
					'src/index.ts',
					'MotionVideo',
					'out/video.mp4',
					'--codec=h264',
					'--log=error'
				];
				if (opts.scale && opts.scale > 0) args.push(`--scale=${opts.scale}`);
				if (opts.crf != null) args.push(`--crf=${opts.crf}`);

				const renderBudget = budgetWithin(
					lease,
					Date.now() - startedAt,
					MP4_UPLOAD_MARGIN_MS,
					MP4_RENDER_TIMEOUT_MS
				);
				if (renderBudget < 30_000) {
					// L'installazione si è presa quasi tutto l'affitto. Meglio dirlo adesso che far
					// morire il render sul muro del lease: il file non uscirebbe comunque.
					throw new Error(
						'The render project install used up the sandbox lease — try again, the next render on this machine starts from the cache.'
					);
				}
				const res = await sb.run('npx', args, {
					cwd: PROJECT_DIR,
					timeoutMs: renderBudget
				});
				if (res.exitCode !== 0) {
					throw new Error(`remotion render failed: ${`${res.stderr || res.stdout}`.slice(-1200)}`);
				}
				const mp4 = await sb.readBuffer(`${PROJECT_DIR}/out/video.mp4`);
				if (!mp4.byteLength) throw new Error('remotion render produced an empty file');

				const path = `${opts.brandId}/motion/${randomUUID()}.mp4`;
				const { error } = await opts.supabase.storage.from('media').upload(path, mp4, {
					contentType: 'video/mp4',
					upsert: false
				});
				if (error) throw new Error(`MP4 upload failed: ${error.message}`);

				return {
					url: opts.supabase.storage.from('media').getPublicUrl(path).data.publicUrl,
					bytes: mp4.byteLength,
					seconds: res.durationMs / 1000
				};
			} catch (e) {
				throw describeSandboxDeath(e);
			} finally {
				await sb?.release().catch((error) => { swallow('release failed', error); return undefined; });
			}
		}
	);
}

/**
 * I FOTOGRAMMI, in UNA sola apertura di macchina.
 *
 * Estratto da `render_stills` perché lo storyboard (`storyboard.ts`) ha bisogno esattamente di
 * questo e di niente altro: dammi N fotogrammi di questo TSX. Aprire una VM per scena costerebbe
 * l'apertura N volte — misurato in produzione, l'apertura pesa ~5s e ogni fotogramma dopo il primo
 * ~4-5s, quindi sei scene in un'apertura sola stanno in ~30s contro i ~85s (p50) di un MP4.
 * Sei aperture separate ne costerebbero il triplo e avrebbero cambiato il progetto.
 */
/**
 * Il bundle webpack del progetto, una volta sola.
 *
 * `remotion still src/index.ts` ribundla a OGNI invocazione: misurato nella VM, 3969ms contro
 * 1754ms partendo da un bundle già fatto. Cachearlo è lecito solo perché la composizione `Graphic`
 * riceve il sorgente come prop invece di importarlo — con l'import, due sorgenti diversi sullo
 * stesso bundle davano PNG IDENTICI, cioè la grafica precedente consegnata in silenzio.
 */
async function buildBundle(sb: SandboxHandle, onLog?: (l: string) => void): Promise<void> {
	const res = await sb.run('npx', ['remotion', 'bundle', 'src/index.ts', '--out-dir=bundle', '--log=error'], {
		cwd: PROJECT_DIR,
		timeoutMs: INSTALL_TIMEOUT_MS
	});
	if (res.exitCode !== 0) {
		// Non fatale: senza bundle si renderizza dall'entry, più lento ma corretto.
		onLog?.(`bundle failed, stills will bundle per render: ${(res.stderr || res.stdout).slice(-200)}`);
	}
}

/**
 * Una grafica: un fotogramma, dal bundle cachato, col sorgente passato come prop.
 *
 * Sta accanto ai fotogrammi del motion perché è la stessa macchina, lo stesso Chromium e lo stesso
 * progetto — una grafica È un motion video da un fotogramma. Quello che NON condivide è il modo di
 * arrivare al sorgente: qui via `--props`, così il bundle resta riusabile.
 */
export async function renderGraphicStill(opts: {
	brandId: string;
	userId?: string;
	source: string;
	width: number;
	height: number;
	remainingMs?: () => number;
	abortSignal?: AbortSignal;
	onLog?: (line: string) => void;
}): Promise<{ png: Buffer } | { error: string }> {
	const left = opts.remainingMs?.();
	let sb: SandboxHandle | null = null;
	return await withSandboxBilling(
		{ brandId: opts.brandId, userId: opts.userId, use: 'graphic_still', detail: `${opts.width}x${opts.height}` },
		async () => {
			const startedAt = Date.now();
			const lease = Math.min(typeof left === 'number' ? left : 600_000, 600_000);
			try {
				sb = await openBrandSandbox({
					brandId: opts.brandId,
					mode: 'research',
					agentId: MOTION_AGENT,
					needsBrowser: true,
					timeoutMs: lease,
					runId: randomUUID(),
					abortSignal: opts.abortSignal,
					onLog: opts.onLog
				});
				await ensureProject(
					sb,
					opts.onLog,
					budgetWithin(lease, Date.now() - startedAt, RENDER_TIMEOUT_MS + 15_000, INSTALL_TIMEOUT_MS)
				);
				opts.onLog?.(`[t] progetto pronto +${Date.now() - startedAt}ms`);
				await sb.run('mkdir', ['-p', `${PROJECT_DIR}/out`]);
				const out = `out/graphic-${Date.now()}.png`;
				// Le misure viaggiano DENTRO il sorgente perché `calculateMetadata` legge da lì: un
				// marcatore, non un parametro in più da tenere allineato in due posti.
				const source = `${opts.source}\n// __w=${opts.width} __h=${opts.height}`;
				const hasBundle = await sb.run('test', ['-d', `${PROJECT_DIR}/bundle`]);
				const entry = hasBundle.exitCode === 0 ? 'bundle' : 'src/index.ts';
				const res = await sb.run(
					'npx',
					['remotion', 'still', entry, 'Graphic', out, `--props=${JSON.stringify({ source })}`, '--log=error'],
					{ cwd: PROJECT_DIR, timeoutMs: RENDER_TIMEOUT_MS }
				);
				opts.onLog?.(`[t] still finito +${Date.now() - startedAt}ms`);
				if (res.exitCode !== 0) return { error: `[${sb.name}] ${res.stderr || res.stdout}`.slice(-800) };
				const png = await sb.readBuffer(`${PROJECT_DIR}/${out}`);
				opts.onLog?.(`[t] png letto +${Date.now() - startedAt}ms`);
				return { png };
			} catch (e) {
				throw describeSandboxDeath(e);
			} finally {
				await sb?.release().catch((error) => { swallow('release failed', error); return undefined; });
			}
		}
	);
}

export async function renderMotionStills(opts: {
	brandId: string;
	userId?: string;
	source: string;
	frames: number[];
	/** Finisce nella riga di addebito, per distinguere uno storyboard da un controllo. */
	detail?: string;
	remainingMs?: () => number;
	abortSignal?: AbortSignal;
	onLog?: (line: string) => void;
}): Promise<{
	rendered: Array<{ frame: number; png: Buffer }>;
	failures: Array<{ frame: number; error: string }>;
}> {
	const left = opts.remainingMs?.();
	let sb: SandboxHandle | null = null;
	return await withSandboxBilling(
		{
			brandId: opts.brandId,
			userId: opts.userId,
			use: 'motion_stills',
			detail: opts.detail ?? `f${opts.frames.length}`
		},
		async () => {
			const startedAt = Date.now();
			// L'installazione e i fotogrammi vivono dentro QUESTO affitto, non accanto.
			const lease = Math.min(typeof left === 'number' ? left : 600_000, 600_000);
			const rendered: Array<{ frame: number; png: Buffer }> = [];
			const failures: Array<{ frame: number; error: string }> = [];
			try {
				sb = await openBrandSandbox({
					brandId: opts.brandId,
					mode: 'research',
					agentId: MOTION_AGENT,
					// Stesso Chromium dell'MP4, stesse .so mancanti senza questo.
					needsBrowser: true,
					timeoutMs: lease,
					runId: randomUUID(),
					abortSignal: opts.abortSignal,
					onLog: opts.onLog
				});
				opts.onLog?.(`render su ${sb.name}`);
				await ensureProject(
					sb,
					opts.onLog,
					budgetWithin(lease, Date.now() - startedAt, RENDER_TIMEOUT_MS + 15_000, INSTALL_TIMEOUT_MS)
				);
				// Il sorgente è l'unica cosa che cambia fra un render e l'altro. Root e index sono
				// scritti dall'installazione e non li tocca nessuno.
				await sb.write([{ path: `${PROJECT_DIR}/src/Video.tsx`, content: opts.source }]);
				await sb.run('rm', ['-rf', `${PROJECT_DIR}/out`]);
				await sb.run('mkdir', ['-p', `${PROJECT_DIR}/out`]);

				for (const frame of opts.frames) {
					const frameBudget = budgetWithin(lease, Date.now() - startedAt, 15_000, RENDER_TIMEOUT_MS);
					if (frameBudget < 20_000) {
						// Meglio tornare con i fotogrammi che ci sono che farsi spegnere la macchina a
						// metà e perdere anche quelli.
						failures.push({ frame, error: 'sandbox lease exhausted before this frame' });
						continue;
					}
					const out = `out/f${frame}.png`;
					const res = await sb.run(
						'npx',
						['remotion', 'still', 'src/index.ts', 'MotionVideo', out, `--frame=${frame}`, '--log=error'],
						{ cwd: PROJECT_DIR, timeoutMs: RENDER_TIMEOUT_MS }
					);
					if (res.exitCode !== 0) {
						// Non è sintassi: è il codice che gira. Torna testuale, perché è la cosa da leggere.
						failures.push({ frame, error: `[${sb.name}] ${res.stderr || res.stdout}`.slice(-800) });
						continue;
					}
					rendered.push({ frame, png: await sb.readBuffer(`${PROJECT_DIR}/${out}`) });
				}
				return { rendered, failures };
			} catch (e) {
				throw describeSandboxDeath(e);
			} finally {
				// La macchina resta accesa fino al suo timeout (due turni dello stesso brand la
				// condividono): `release` toglie solo i dati di QUESTA run.
				await sb?.release().catch((error) => { swallow('release failed', error); return undefined; });
			}
		}
	);
}

export type MotionRenderTarget = {
	id?: string;
	title: string;
	source: string;
	fps: number;
	durationInFrames: number;
};

export function createMotionRenderTools(opts: {
	brandId: string;
	userId?: string;
	/**
	 * Senza questi tre, i fotogrammi restano solo nel risultato del modello. Con un thread, ogni
	 * PNG diventa un artefatto della conversazione — la stessa consegna di `motion_stills`.
	 */
	supabase?: SupabaseClient;
	threadId?: string | null;
	/**
	 * La composizione su cui girare, risolta al momento della chiamata (la selezione può cambiare).
	 * Può essere asincrona: in chat non esiste una "selezione corrente" in memoria e il sorgente si
	 * legge dal database a ogni chiamata.
	 */
	resolveTarget: (videoId?: string) => MotionRenderTarget | null | Promise<MotionRenderTarget | null>;
	remainingMs?: () => number;
	onLog?: (line: string) => void;
	abortSignal?: AbortSignal;
}) {
	const pending = new Map<string, ContentPart[]>();
	let renders = 0;
	/**
	 * I fallimenti vengono RIMBORSATI dal budget (una VM che esplode non è un render che il modello
	 * ha "usato"), quindi serve un secondo contatore che non si rimborsa mai: senza, una sandbox
	 * rotta trasformerebbe il rimborso in tentativi infiniti — la stessa guardia di
	 * `reference-tools.ts` (`attempts`).
	 */
	let attempts = 0;

	return {
		render_stills: tool({
			description: [
				'RENDER this composition for real, in a Linux VM with a real browser, and get the frames back attached to this result — look at them yourself.',
				'The same frames are published as chat artifacts so the user sees them in the conversation. Do not re-publish or show_media them.',
				'This is the only way to see what you actually built: the source tools check syntax, they do not run your code. A broken layout, an image that does not load, a scene that is empty at the moment it matters, an element off-canvas — none of that shows up until something renders.',
				`Up to ${MAX_STILLS_PER_RENDER} frames per call, ${MAX_RENDERS_PER_TURN} calls per turn. It does NOT change the source and does not produce the final MP4.`,
				'Use it after the composition is structurally there, and again after a fix you cannot verify by reading. Not after every replace_source — it costs a minute.'
			].join(' '),
			inputSchema: z.object({
				at_seconds: z
					.array(z.number().min(0).max(600))
					.max(MAX_STILLS_PER_RENDER)
					.optional()
					.describe(
						'Timestamps in SECONDS to look at — pick the moments that matter (mid-transition, the beat you just changed). Empty = spread across the clip, skipping the first and last frame.'
					),
				video_id: z
					.string()
					.optional()
					.describe('Which composition, when several are selected. Omit for the only/current one.'),
				looking_for: z
					.string()
					.max(300)
					.optional()
					.describe('What you are checking, one line. Kept with the frames so you remember why you rendered.')
			}),
			execute: async (
				{
					at_seconds,
					video_id,
					looking_for
				}: { at_seconds?: number[]; video_id?: string; looking_for?: string },
				{ toolCallId }: { toolCallId: string }
			) => {
				if (!isSandboxConfigured()) {
					return {
						error: 'sandbox_unavailable',
						hint: 'No VM on this deployment, so nothing can be rendered here. Review the source by reading it, and say plainly that you could not look at the frames.'
					};
				}
				if (renders >= MAX_RENDERS_PER_TURN || attempts >= MAX_RENDERS_PER_TURN * 2) {
					return {
						error: 'render_budget_spent',
						hint: `Already rendered ${MAX_RENDERS_PER_TURN} times this turn. Finish from what you saw.`
					};
				}
				const target = await opts.resolveTarget(video_id);
				if (!target) {
					return { error: 'no_composition', hint: 'Nothing selected to render.' };
				}
				const left = opts.remainingMs?.();
				if (typeof left === 'number' && left < MIN_RENDER_MS) {
					return {
						error: 'not_enough_time',
						hint: 'Not enough time left in this slice to open a VM and render. Keep patching; a continuation turn can render.'
					};
				}

				const frames = at_seconds?.length
					? framesFromSeconds(at_seconds, target.fps, target.durationInFrames)
					: defaultStillFrames(target.durationInFrames, MAX_STILLS_PER_RENDER);

				renders += 1;
				attempts += 1;
				try {
					const { rendered, failures } = await renderMotionStills({
						brandId: opts.brandId,
						userId: opts.userId,
						source: target.source,
						frames,
						remainingMs: opts.remainingMs,
						abortSignal: opts.abortSignal,
						onLog: opts.onLog
					});
					const parts: ContentPart[] = [];
					for (const { frame, png } of rendered) {
						parts.push({
							type: 'text',
							text: `Frame ${frame} (${(frame / target.fps).toFixed(2)}s of ${(target.durationInFrames / target.fps).toFixed(2)}s)`
						});
						parts.push({ type: 'image-data', data: png.toString('base64'), mediaType: 'image/png' });
					}
					if (parts.length) {
						pending.set(toolCallId, [
							{
								type: 'text',
								text: looking_for?.trim()
									? `Frames of "${target.title}" — you rendered these to check: ${looking_for.trim()}`
									: `Frames of "${target.title}", rendered from the current source:`
							},
							...parts
						]);
					}
					let artifacts: Array<{ id: string; url: string | null; title: string }> = [];
					if (opts.supabase && opts.userId && opts.threadId && rendered.length) {
						const { publishMotionStillArtifacts } = await import('./still-artifacts');
						artifacts = (
							await publishMotionStillArtifacts({
								supabase: opts.supabase,
								brandId: opts.brandId,
								userId: opts.userId,
								threadId: opts.threadId,
								toolCallId,
								title: target.title,
								frames: rendered
							})
						).map((a) => ({ id: a.id, url: a.url, title: a.title }));
					}
					return {
						title: target.title,
						rendered_frames: rendered.map((r) => r.frame),
						...(failures.length ? { failed_frames: failures } : {}),
						attached: parts.length ? 'frames' : 'nothing',
						shown_in_chat: artifacts.length > 0,
						...(artifacts.length ? { artifacts } : {}),
						media: artifacts
							.filter((a): a is typeof a & { url: string } => typeof a.url === 'string' && !!a.url)
							.map((a) => ({ url: a.url, caption: a.title })),
						did_not_change_source: true,
						renders_left: Math.max(0, MAX_RENDERS_PER_TURN - renders),
						hint: failures.length
							? 'A frame that fails to render is a real runtime defect in the TSX — read the error, patch with replace_source, render again. It will fail in the user\u2019s browser the same way.'
							: artifacts.length
								? 'The frames are already visible in the chat as artifacts. Look at them yourself, then answer. Do not re-publish or show_media the same frames. Judge what you SEE — layout, overflow, images that loaded, whether the beat reads at that moment — not what the code says it should be.'
								: 'Look at the frames before you answer. Judge what you SEE — layout, overflow, images that loaded, whether the beat reads at that moment — not what the code says it should be.'
					};
				} catch (e) {
					// Un lancio qui è la VM, non il modello: il budget si RIMBORSA (come i watch falliti
					// in reference-tools.ts), o una sandbox rotta a inizio turno brucerebbe tutti e tre
					// i render senza che il modello ne abbia visto uno. `attempts` resta consumato: è
					// lui che ferma i retry infiniti sul rimborso.
					renders = Math.max(0, renders - 1);
					return {
						error: 'render_failed',
						detail: e instanceof Error ? e.message : String(e),
						hint: 'The VM or the render itself failed — this is not a verdict on your composition. Carry on with the source tools and say you could not look at the frames.'
					};
				}
			},
			// DEVE essere idempotente (sonda del 2026-08-21, vedi reference-tools.ts:30-41): con
			// streamText l'SDK chiama toModelOutput PIÙ VOLTE per lo stesso toolCallId — una copia
			// per gli step/callback, una per i messaggi sul filo. Il vecchio `pending.delete` qui
			// consegnava i PNG alla copia che nessuno spedisce e il fallback JSON al modello: ogni
			// render_stills pagava una VM e il modello giudicava alla cieca. La mappa vive nella
			// closure della turn e muore con lei — nessuna perdita di memoria.
			toModelOutput: ({ toolCallId, output }: { toolCallId: string; output: unknown }) => {
				const parts = pending.get(toolCallId);
				if (!parts) return { type: 'json' as const, value: output as never };
				return { type: 'content' as const, value: parts };
			}
		})
	};
}
