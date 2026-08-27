/**
 * COSTRUISCE E PUBBLICA L'IMMAGINE DEL DESKTOP — da una sandbox, non dalla tua macchina.
 *
 *   node sandbox-desktop/build.mjs
 *
 * Serve un motore container, e su un Mac senza Docker non c'è: quindi il build gira DENTRO una
 * Vercel Sandbox (buildah, `--isolation chroot --network host`, perché netavark nella microVM non
 * ha nftables). La VM si distrugge alla fine, sempre — anche sugli errori.
 *
 * Credenziali: `vercel vcr login buildah` dentro la VM (valide ~12h), col `VERCEL_TOKEN` letto da
 * `.env`. Il token entra nella VM di build e ci resta per la sua vita: è il prezzo di non avere
 * Docker in locale, ed è il motivo per cui la macchina si butta subito dopo.
 *
 * L'immagine finisce in `vcr.vercel.com/teta/anomalia/desktop:latest`, e la si usa da
 * `SANDBOX_DESKTOP_IMAGE=desktop:latest`.
 */
import { Sandbox } from '@vercel/sandbox';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TAG = process.env.DESKTOP_IMAGE_TAG || 'vcr.vercel.com/teta/anomalia/desktop:latest';
const SCOPE = process.env.VERCEL_SCOPE || 'teta';
const PROJECT = process.env.VERCEL_PROJECT || 'anomalia';
/** Il build a freddo (apt XFCE + Chromium di Playwright) sta sotto i 10 minuti; il resto è margine. */
const LEASE_MS = 45 * 60_000;
/** Vedi il commento sul passo `build`: a strati la VM non parte. */
const LAYERS = process.env.BUILD_LAYERS === '1' ? '--layers' : '';

for (const line of fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8').split('\n')) {
	const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
	if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const token = process.env.VERCEL_TOKEN;
if (!token) throw new Error('VERCEL_TOKEN mancante: senza, la VM non può pubblicare nel registry');

const sandbox = await Sandbox.create({
	timeout: LEASE_MS,
	resources: { vcpus: 4 },
	// Il build tira da archive.ubuntu.com, npm, dl.playwright e il registry: qui la rete è aperta
	// perché è una macchina usa e getta che non vede nessun dato di nessun brand.
	networkPolicy: 'allow-all'
});

const run = async (command, timeoutMs = 30 * 60_000) => {
	const started = Date.now();
	const res = await sandbox.runCommand({ cmd: 'sh', args: ['-c', command], timeoutMs, sudo: true });
	const out = `${await res.stdout()}${await res.stderr()}`.trim();
	return { code: res.exitCode ?? -1, seconds: Math.round((Date.now() - started) / 1000), out };
};

const step = async (label, command, timeoutMs) => {
	const res = await run(command, timeoutMs);
	console.log(`${label}: exit=${res.code} ${res.seconds}s`);
	if (res.code !== 0) {
		console.error(res.out.slice(-1500));
		throw new Error(`${label} fallito`);
	}
	return res;
};

try {
	const files = [
		{ path: 'build/Dockerfile', content: fs.readFileSync(path.join(HERE, 'Dockerfile')) },
		{ path: 'build/anomalia-desktop', content: fs.readFileSync(path.join(HERE, 'anomalia-desktop')) }
	];
	for (const name of fs.readdirSync(path.join(HERE, 'xfconf'))) {
		files.push({ path: `build/xfconf/${name}`, content: fs.readFileSync(path.join(HERE, 'xfconf', name)) });
	}
	await sandbox.writeFiles(files);

	await step(
		'buildah',
		"rm -f /etc/apt/sources.list.d/github-cli.list; sed -i 's|http://|https://|g' /etc/apt/sources.list.d/*.sources 2>/dev/null; apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq buildah"
	);
	await step('vercel cli', 'npm i -g vercel@latest --silent');
	await step(
		'registry login',
		`cd /vercel/build && vercel vcr login buildah --token='${token}' --scope ${SCOPE} --project ${PROJECT}`
	);
	// STRATO UNICO, e non è una svista. `--layers` dà un blob per istruzione — comodo per il push
	// (senza, sono 590 MB in un colpo solo e il registry risponde 413) ma la sandbox poi NON parte:
	// l'immagine risulta «ready» nel registry e la VM muore appena nata con un 410 interno.
	// Misurato il 26/8 su tre immagini: le due a strati muoiono, quella a strato unico vive.
	// Il prezzo è che tutto deve stare sotto il tetto per blob: per questo Chromium non è cotto qui.
	await step(
		'build',
		`cd /vercel/build && buildah --storage-driver vfs build ${LAYERS} --isolation chroot --network host --platform linux/amd64 --build-arg WITH_CHROMIUM=${process.env.WITH_CHROMIUM ?? '0'} -t ${TAG} .`
	);
	// GZIP, non zstd. Il 413 che aveva fatto pensare a zstd veniva dal blob unico da 590 MB (era
	// `--layers` a mancare); con gli strati separati gzip passa. E l'immagine spinta in zstd il
	// registry la accetta come «ready», ma la sandbox poi muore all'avvio con un 410 interno:
	// quella conversione, a valle, lo zstd non se lo aspetta.
	await step('push', `buildah --storage-driver vfs push ${TAG}`);
	console.log(`\nPubblicata: ${TAG}`);
} finally {
	await sandbox.stop().catch(() => {});
	console.log('VM di build distrutta.');
}
