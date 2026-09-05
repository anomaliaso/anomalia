/**
 * I test che parlano con kie DAVVERO. Costano soldi, quindi non girano mai per sbaglio:
 * senza `KIE_LIVE=1` l'intero file è skippato e `npm test` non spende nulla.
 *
 *   KIE_LIVE=1 npx vitest run src/lib/server/video.kie-live.test.ts
 *
 * Perché esistono: la suite normale gira su payload costruiti da noi e confrontati con quello che
 * i docs DICONO. Il 2026-09-03 questi tre casi hanno trovato tre cose che i docs sbagliavano, e
 * ognuna era un fallimento al 100% in produzione:
 *
 *   · `kling-3.0/video` rifiuta senza `multi_shots`, poi senza `sound` — entrambi documentati
 *     opzionali;
 *   · `kling-3.0/motion-control` rifiuta `mode` con QUALUNQUE valore, mentre i docs documentano
 *     std|pro;
 *   · motion control pretende una PERSONA nel video guida, o rifiuta a job già accettato.
 *
 * Un test che non chiama il provider non poteva vedere nessuna delle tre.
 */
import { describe, expect, it } from 'vitest';
import { buildJobInput, buildTransformInput } from './video';
import { KLING_3_VIDEO_MODEL, ALEPH_REFINE_MODEL } from '$lib/video-models';

const LIVE = process.env.KIE_LIVE === '1' && !!process.env.KIE_API_KEY;
const BASE = 'https://api.kie.ai/api/v1';
const auth = () => ({ Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' });

/**
 * Manda la richiesta e torna l'esito della SUBMIT, senza aspettare il render.
 *
 * È la metà che conta e la metà che costa nulla quando è sbagliata: kie rifiuta un payload
 * malformato prima di generare, e un rifiuto non è fatturato. Aspettare il video misurerebbe la
 * qualità del modello, che non è quello che questi test difendono.
 */
async function submit(model: string, input: Record<string, unknown>) {
	const res = await fetch(`${BASE}/jobs/createTask`, {
		method: 'POST',
		headers: auth(),
		body: JSON.stringify({ model, input })
	});
	const body = await res.json().catch(() => ({}));
	return { accepted: !!body?.data?.taskId, code: body?.code, msg: String(body?.msg ?? '') };
}

describe.skipIf(!LIVE)('kie accetta i payload che costruiamo (rete vera, chiave vera)', () => {
	it('kling-3.0/video: la clip da testo parte', async () => {
		const out = await submit(
			KLING_3_VIDEO_MODEL,
			buildJobInput(KLING_3_VIDEO_MODEL, {
				prompt: 'a plain red cube rotating slowly on a white background',
				durationSeconds: 3,
				resolution: '480p',
				aspectRatio: '9:16'
			})
		);
		// Se questo torna "multi_shots cannot be empty" o "sound cannot be empty", qualcuno ha
		// tolto dal builder i due campi che i docs chiamano opzionali e kie pretende.
		expect(out.msg).not.toMatch(/cannot be empty/);
		expect(out.accepted, out.msg).toBe(true);
	}, 60_000);

	it('motion-control: il payload passa la validazione dei campi', async () => {
		const out = await submit(
			KLING_3_VIDEO_MODEL,
			buildTransformInput(KLING_3_VIDEO_MODEL, 'motion', {
				videoUrl: 'https://file.kie.ai/nonexistent-on-purpose.mp4',
				imageUrl: 'https://file.kie.ai/nonexistent-on-purpose.png',
				mode: 'pro'
			})
		);
		// Gli url non esistono di proposito: qui si difende la FORMA. Un rifiuto che parla di
		// `mode` vuol dire che qualcuno l'ha rimesso nel payload, e ogni motion control fallisce.
		expect(out.msg).not.toMatch(/mode is not within the range/);
	}, 60_000);

	it('aleph: un suo task si interroga su jobs/recordInfo, NON su runway/record-detail', async () => {
		// Il difetto che questo test esiste per non far tornare: `runway/record-detail` risponde 200
		// con `data: null` per un task Aleph. Non un errore — un vuoto. Chi lo interroga li' aspetta
		// fino al timeout e poi dichiara "non ha restituito niente" un render che e' stato eseguito
		// e fatturato. Lo stesso task su `jobs/recordInfo` torna completo.
		const input = buildTransformInput(ALEPH_REFINE_MODEL, 'refine', {
			prompt: 'make it night time',
			videoUrl: 'https://file.kie.ai/nonexistent-on-purpose.mp4',
			aspectRatio: '9:16'
		});
		const created = await (
			await fetch(`${BASE}/aleph/generate`, { method: 'POST', headers: auth(), body: JSON.stringify(input) })
		).json();
		const taskId = created?.data?.taskId;
		expect(taskId, JSON.stringify(created)).toBeTruthy();

		const viaJobs = await (
			await fetch(`${BASE}/jobs/recordInfo?taskId=${taskId}`, { headers: auth() })
		).json();
		expect(viaJobs?.data?.taskId, 'jobs/recordInfo deve conoscere il task').toBe(taskId);

		const viaRunway = await (
			await fetch(`${BASE}/runway/record-detail?taskId=${taskId}`, { headers: auth() })
		).json();
		expect(viaRunway?.data, 'runway/record-detail non lo conosce: non e\' la strada').toBeNull();
	}, 60_000);

	it('aleph: il suo endpoint di invio esiste e accetta i nostri nomi di campo', async () => {
		const input = buildTransformInput(ALEPH_REFINE_MODEL, 'refine', {
			prompt: 'make it night time',
			videoUrl: 'https://file.kie.ai/nonexistent-on-purpose.mp4',
			aspectRatio: '9:16'
		});
		const res = await fetch(`${BASE}/aleph/generate`, { method: 'POST', headers: auth(), body: JSON.stringify(input) });
		const body = await res.json().catch(() => ({}));
		// Aleph vive fuori dall'API a job e vuole camelCase. Un 404 qui vuol dire che il percorso
		// è cambiato; un errore su un nome di campo vuol dire che il dialetto è tornato snake_case.
		expect(res.status, JSON.stringify(body)).toBe(200);
		expect(String(body?.msg ?? '')).not.toMatch(/videoUrl|aspectRatio|required/i);
	}, 60_000);
});
