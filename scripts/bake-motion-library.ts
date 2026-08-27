/**
 * COTTURA DELLA LIBRERIA DI ANIMAZIONI — un MP4 e i suoi fotogrammi per ogni voce.
 *
 * PERCHE' UNO SCRIPT E NON UN TEST. Stesso mestiere di `bake:style-reels`: i video si cuociono
 * UNA VOLTA e finiscono accanto al codice; il test unitario poi verifica che ci siano, e resta
 * veloce. Un render dentro i test sarebbe una VM e novanta secondi a voce a ogni `npm test`.
 *
 * PERCHE' NELLA VM E NON IN LOCALE. E' lo stesso percorso di `renderMotionMp4`
 * (src/lib/server/motion-video/render-tools.ts): Vercel Sandbox persistente, progetto Remotion in
 * `.anomalia/motion-render`, le dipendenze di `MOTION_RENDER_PACKAGES`. Se una voce si cuoce qui,
 * quella voce renderizza in produzione — che e' l'unica affermazione che vale.
 *
 * COMPILARE NON E' RENDERIZZARE, ed e' il motivo per cui questo script esiste. I due render
 * esplosi in produzione avevano superato il compilatore: `compileMotionSource` esegue solo il
 * corpo del modulo, e col transform `imports` di sucrase un import sbagliato diventa un accesso
 * pigro che passa il controllo e muore in VM. Una voce senza MP4 e' una voce non verificata.
 *
 *   npm run bake:motion-library                 # le voci senza preview.mp4
 *   FORCE=1 npm run bake:motion-library         # tutte
 *   npm run bake:motion-library -- text/1-typing posts/2-oblique-scroll
 *   npm run bake:motion-library -- --cookbook   # verifica quali voci di TRANSITIONS_COOKBOOK
 *                                               # renderizzano davvero (nessun file scritto)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { TRANSITIONS_COOKBOOK } from '../src/lib/motion-video/transitions-cookbook.ts';
import { MOTION_RENDER_PACKAGES, MOTION_REMOTION_VERSION } from '../src/lib/motion-video/modules.ts';

const REPO = process.cwd();
const LIB = join(REPO, 'src/lib/motion-video/library');
const PROJECT_DIR = '.anomalia/motion-render';

/**
 * IL MANIFESTO — si versiona la PROVA, non il payload.
 *
 * Gli MP4 e i fotogrammi sono in `.gitignore`: 46 MB di binari rigenerabili non stanno in un repo,
 * e su un clone fresco quei file non esistono. Ma il fatto che conta non è il file: è che QUELLA
 * voce, in QUELLA versione del sorgente, è stata cotta e ha prodotto un video. Quel fatto sta in
 * poche centinaia di byte e si versiona benissimo.
 *
 * L'IMPRONTA È IL PEZZO CHE LO TIENE ONESTO. Senza, il manifesto diventa una bugia che invecchia:
 * qualcuno modifica un `source.tsx`, non ricuoce, e il test resta verde su un video che non esiste
 * più. Con l'impronta del sorgente, la modifica senza cottura fa cadere il test e gli dice quale
 * voce ricuocere. È la stessa idea del campo `renders` in `transitions-cookbook.ts` — «il
 * risultato dell'ultima cottura in VM, non della compilazione» — estesa alla libreria invece di
 * inventarne una seconda.
 */
const MANIFEST = join(REPO, 'src/lib/motion-video/library/bake-manifest.json');

export type BakeRecord = {
	renders: true;
	/** Quando è stata cotta. */
	at: string;
	/** sha256 del `source.tsx` cotto, primi 16 caratteri: se il sorgente cambia, non combacia più. */
	sourceHash: string;
	kb: number;
	stills: number;
};

/** L'impronta del sorgente. Una funzione sola, usata dallo script e dal test. */
export const sourceHash = (code: string) => createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 16);

type Job = {
	/** `text/1-typing` per la libreria, `FULL_CANVAS_SCALE` per il ricettario. */
	id: string;
	tsx: string;
	/** Dove scrivere preview.mp4 e stills/. Null = solo verifica, niente file. */
	outDir: string | null;
	stills: number[];
};

/** Le cartelle `<sezione>/<voce>/source.tsx` con il loro meta.json. */
function libraryJobs(only: string[]): Job[] {
	const jobs: Job[] = [];
	for (const section of readdirSync(LIB).sort()) {
		const sectionDir = join(LIB, section);
		if (!statSync(sectionDir).isDirectory()) continue;
		for (const slug of readdirSync(sectionDir).sort()) {
			const dir = join(sectionDir, slug);
			const src = join(dir, 'source.tsx');
			if (!existsSync(src)) continue;
			const id = `${section}/${slug}`;
			if (only.length && !only.includes(id) && !only.includes(slug)) continue;
			if (existsSync(join(dir, 'preview.mp4')) && process.env.FORCE !== '1' && !only.length) continue;
			// Una cartella senza `meta.json` è una voce a metà scrittura, non un errore: una sezione
			// nuova arriva in due tempi, e far esplodere la cottura nel mezzo bloccherebbe chi la
			// sta scrivendo. Si salta e si dice, invece di rompere.
			const metaPath = join(dir, 'meta.json');
			if (!existsSync(metaPath)) {
				console.log(`salto ${id}: manca meta.json`);
				continue;
			}
			const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { stills?: number[] };
			jobs.push({ id, tsx: readFileSync(src, 'utf8'), outDir: dir, stills: meta.stills ?? [] });
		}
	}
	return jobs;
}

const cookbookJobs = (): Job[] =>
	TRANSITIONS_COOKBOOK.map((e) => ({ id: e.name, tsx: e.code, outDir: null, stills: [] }));

const argv = process.argv.slice(2);
const cookbook = argv.includes('--cookbook');
const jobs = cookbook ? cookbookJobs() : libraryJobs(argv.filter((a) => !a.startsWith('--')));

if (!jobs.length) {
	console.log('niente da cuocere (FORCE=1 per rifare tutto)');
	process.exit(0);
}

const env = Object.fromEntries(
	readFileSync(join(REPO, '.env'), 'utf8')
		.split('\n')
		.filter((l) => /^[A-Z0-9_]+=/.test(l))
		.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
for (const k of ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']) {
	if (!env[k]) throw new Error(`${k} mancante in .env`);
}

/** `text/1-typing` -> `C0`. La CLI di Remotion vuole un id di composizione, non un path. */
const compId = (i: number) => `C${i}`;

const packageJson = JSON.stringify(
	{
		name: 'motion-render',
		private: true,
		version: '1.0.0',
		dependencies: { ...MOTION_RENDER_PACKAGES, '@remotion/cli': MOTION_REMOTION_VERSION }
	},
	null,
	2
);

const rootTsx = `import React from 'react';
import { Composition } from 'remotion';
${jobs.map((_, i) => `import V${i}, { fps as f${i}, durationInFrames as d${i}, width as w${i}, height as h${i} } from './V${i}';`).join('\n')}

export const RemotionRoot: React.FC = () => (
  <>
${jobs.map((_, i) => `    <Composition id="${compId(i)}" component={V${i} as React.FC} durationInFrames={d${i}} fps={f${i}} width={w${i}} height={h${i}} />`).join('\n')}
  </>
);
`;

const indexTs = `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
`;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const { Sandbox } = (await import(join(REPO, 'node_modules/@vercel/sandbox/dist/index.js'))) as {
	Sandbox: any;
};

const sandbox = await Sandbox.getOrCreate({
	// LA STESSA MACCHINA DI SEMPRE, e non e' un dettaglio: `node_modules` (~570MB) e le librerie
	// di Chrome restano in cache fra una cottura e l'altra. Sulla macchina fredda la sola
	// installazione supera i quattro minuti.
	name: 'anomalia-motion-library-bake',
	persistent: true,
	timeout: 45 * 60_000,
	resources: { vcpus: 4 },
	networkPolicy: {
		// Rete aperta di proposito: le voci di `posts/` caricano immagini REMOTE, come nei post
		// veri. Una voce che regge solo un segnaposto locale non e' una voce.
		allow: ['*'],
		subnets: { deny: ['169.254.0.0/16', '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] }
	},
	snapshotExpiration: 7 * 24 * 60 * 60_000,
	keepLastSnapshots: { count: 2 },
	tags: { app: 'anomalia', purpose: 'motion-library' },
	token: env.VERCEL_TOKEN,
	teamId: env.VERCEL_TEAM_ID,
	projectId: env.VERCEL_PROJECT_ID
});
log('sandbox aperta —', jobs.length, 'voci');

const run = async (cmd: string, args: string[], opts: Record<string, unknown> = {}) => {
	const t0 = Date.now();
	const r = await sandbox.runCommand({ cmd, args, ...opts });
	const [out, err] = await Promise.all([r.stdout(), r.stderr()]);
	const ms = Date.now() - t0;
	log(`$ ${cmd} ${args.join(' ')} -> exit ${r.exitCode} in ${(ms / 1000).toFixed(1)}s`);
	return { exitCode: r.exitCode as number, stdout: out as string, stderr: err as string, ms };
};

await run('mkdir', ['-p', `${PROJECT_DIR}/src`, `${PROJECT_DIR}/out`]);
await sandbox.writeFiles(
	[
		{ path: `${PROJECT_DIR}/package.json`, content: packageJson },
		{ path: `${PROJECT_DIR}/src/Root.tsx`, content: rootTsx },
		{ path: `${PROJECT_DIR}/src/index.ts`, content: indexTs },
		...jobs.map((j, i) => ({ path: `${PROJECT_DIR}/src/V${i}.tsx`, content: j.tsx }))
	].map((f) => ({ path: f.path, content: Buffer.from(f.content, 'utf8') }))
);

if ((await run('test', ['-d', `${PROJECT_DIR}/node_modules/remotion`])).exitCode !== 0) {
	const inst = await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: PROJECT_DIR, timeoutMs: 900_000 });
	if (inst.exitCode !== 0) throw new Error(`npm install fallito:\n${inst.stderr.slice(-2000)}`);
}

// LE LIBRERIE DI SISTEMA DI CHROME, che l'immagine di default non ha: senza, il binario di
// Remotion muore su `libnspr4.so`. E senza fontconfig piu' un sans installato il testo esce
// VUOTO — che su una libreria di animazioni tipografiche sarebbe il guasto peggiore possibile.
// Un pacchetto alla volta e mai fatale: i nomi cambiano fra distro (Ubuntu 24.04 ha rinominato
// meta' libreria in `…t64`), e a decidere se e' andata bene non e' apt — e' il render.
if ((await run('test', ['-f', '.anomalia/chrome-deps-ok'])).exitCode !== 0) {
	const APT = ['libnspr4','libnss3','libatk1.0-0t64','libatk1.0-0','libatk-bridge2.0-0t64','libatk-bridge2.0-0','libcups2t64','libcups2','libdrm2','libxcomposite1','libxdamage1','libxext6','libxfixes3','libxrandr2','libgbm1','libasound2t64','libasound2','libpango-1.0-0','libxkbcommon0','libcairo2','fontconfig','fonts-dejavu-core','fonts-liberation'];
	const DNF = ['nss','nspr','atk','at-spi2-atk','at-spi2-core','cups-libs','libdrm','libXcomposite','libXdamage','libXext','libXfixes','libXrandr','libXi','libXtst','mesa-libgbm','alsa-lib','pango','libxkbcommon','cairo','fontconfig','dejavu-sans-fonts','liberation-sans-fonts'];
	const script =
		'if command -v apt-get >/dev/null 2>&1; then apt-get update -qq >/dev/null 2>&1; ' +
		APT.map((p) => `apt-get install -y -qq --no-install-recommends ${p} >/dev/null 2>&1 || true;`).join(' ') +
		' elif command -v dnf >/dev/null 2>&1; then ' +
		DNF.map((p) => `dnf install -y -q ${p} >/dev/null 2>&1 || true;`).join(' ') +
		' fi; fc-cache -f >/dev/null 2>&1 || true; echo DEPS_DONE';
	const r = await run('bash', ['-lc', script], { sudo: true, timeoutMs: 600_000 });
	if (r.exitCode !== 0) throw new Error('installazione librerie di Chrome fallita');
	await run('touch', ['.anomalia/chrome-deps-ok']);
}

const entry = 'src/index.ts';
const report: Record<string, { ok: boolean; ms: number; kb?: number; error?: string }> = {};

for (const [i, job] of jobs.entries()) {
	const id = compId(i);
	const r = await run(
		'npx',
		// CRF 23 e non 18: questi MP4 vivono NEL REPO, e a 18 la libreria pesava 56 MB di soli
		// video più altrettanti di fotogrammi. A 23 la differenza non si vede su un video che
		// serve a giudicare un movimento, e il peso si dimezza. Il render di produzione resta
		// dove sta: qui si cuociono anteprime, non consegne.
		['remotion', 'render', entry, id, `out/${id}.mp4`, '--codec=h264', '--crf=23', '--log=error'],
		{ cwd: PROJECT_DIR, timeoutMs: 420_000 }
	);
	if (r.exitCode !== 0) {
		// La riga che serve e' l'errore, non le mille di webpack: si tiene la coda.
		const tail = (r.stderr || r.stdout || '').trim().split('\n').filter(Boolean).slice(-6).join(' | ');
		report[job.id] = { ok: false, ms: r.ms, error: tail.slice(0, 600) };
		console.error(`  FALLITA ${job.id}: ${tail.slice(0, 400)}`);
		continue;
	}
	const buf = (await sandbox.readFileToBuffer({ path: `${PROJECT_DIR}/out/${id}.mp4` })) as Buffer;
	report[job.id] = { ok: true, ms: r.ms, kb: Math.round(buf.byteLength / 1024) };
	if (!job.outDir) continue;
	writeFileSync(join(job.outDir, 'preview.mp4'), buf);
	mkdirSync(join(job.outDir, 'stills'), { recursive: true });
	for (const f of job.stills) {
		// Mezza scala: un fotogramma serve a GUARDARE il momento del movimento, non a essere
		// ritagliato. A piena risoluzione erano PNG da 2-3 MB l'uno, cioè metà del peso della
		// libreria in file che nessuno apre a schermo intero.
		const s = await run('npx', ['remotion', 'still', entry, id, `out/${id}-${f}.png`, `--frame=${f}`, '--scale=0.5', '--log=error'], {
			cwd: PROJECT_DIR,
			timeoutMs: 240_000
		});
		if (s.exitCode !== 0) continue;
		const png = (await sandbox.readFileToBuffer({ path: `${PROJECT_DIR}/out/${id}-${f}.png` })) as Buffer;
		writeFileSync(join(job.outDir, 'stills', `f-${String(f).padStart(4, '0')}.png`), png);
	}
	if (job.outDir) {
		// Si FONDE, non si sovrascrive: una cottura parziale (una voce sola, o una VM che scade a
		// metà) non deve cancellare la prova delle altre.
		const prev = existsSync(MANIFEST)
			? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, BakeRecord>)
			: {};
		prev[job.id] = {
			renders: true,
			at: new Date().toISOString(),
			sourceHash: sourceHash(job.tsx),
			kb: report[job.id].kb!,
			stills: job.stills.length
		};
		const sorted = Object.fromEntries(Object.entries(prev).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
	}
	log(`  ${job.id} cotta (${report[job.id].kb}KB, ${job.stills.length} fotogrammi)`);
}

console.log(JSON.stringify(report, null, 2));
const failed = Object.entries(report).filter(([, v]) => !v.ok);
console.log(`${jobs.length - failed.length}/${jobs.length} renderizzano`);
if (failed.length) process.exit(1);
