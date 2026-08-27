import { describe, expect, it, vi, beforeEach } from 'vitest';

// Solo cutVoiceOver è finto: il resto del modulo audio (voci, costanti, errorMessage) è vero.
vi.mock('$lib/server/gemini-audio', async (importOriginal) => {
	const orig = (await importOriginal()) as Record<string, unknown>;
	return { ...orig, cutVoiceOver: vi.fn() };
});

const { cutVoiceOver } = await import('$lib/server/gemini-audio');
const { createMotionOutputTools, isVoiceoverTakeUrl } = await import('./output-tools');
const cutMock = vi.mocked(cutVoiceOver);

const SUPA = 'https://abc.supabase.co';
const REAL_TAKE = `${SUPA}/storage/v1/object/public/media/b1/voiceover/abc-full.wav`;
// La forma del bug reale: brand id storpiato E segmento /voiceover/ perso.
const INVENTED = `${SUPA}/storage/v1/object/public/media/22bf9fdc-9fcd-44fe-be00-1a3c6ebcc6ad-full.wav`;

function fakeStorageClient(files: Array<{ name: string }>) {
	return {
		storage: {
			from: () => ({
				list: async () => ({ data: files, error: null }),
				getPublicUrl: (path: string) => ({
					data: { publicUrl: `${SUPA}/storage/v1/object/public/media/${path}` }
				})
			})
		}
	} as never;
}

beforeEach(() => {
	cutMock.mockReset();
});

describe('isVoiceoverTakeUrl — la forma prima del fetch', () => {
	it('accetta solo il NOSTRO storage con il segmento /voiceover/', () => {
		expect(isVoiceoverTakeUrl(REAL_TAKE, SUPA)).toBe(true);
		expect(isVoiceoverTakeUrl(INVENTED, SUPA)).toBe(false); // manca /voiceover/
		expect(
			isVoiceoverTakeUrl('https://evil.example/storage/v1/object/public/media/b1/voiceover/x.wav', SUPA)
		).toBe(false); // host altrui
		expect(isVoiceoverTakeUrl('not a url', SUPA)).toBe(false);
	});
});

describe('cut_voiceover con un url inventato dal modello', () => {
	it('url invalido + take vero nello storage → taglia QUELLO e lo dichiara (mai lasciare il modello a indovinare)', async () => {
		cutMock.mockResolvedValue({
			pieces: [{ line: 'riga', url: `${REAL_TAKE}-piece-0.wav`, durationSeconds: 2.5 }],
			dropped: [],
			lineCount: 1,
			matched: true
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		const tools = createMotionOutputTools({
			supabase: fakeStorageClient([{ name: 'abc-full.wav' }]),
			brandId: 'b1',
			fps: () => 30
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (tools.cut_voiceover as any).execute(
			{ at_seconds: [1], url: INVENTED, labels: ['riga'] },
			{ toolCallId: 't', messages: [] }
		);
		expect(res.error).toBeUndefined();
		expect(res.url_warning).toContain(REAL_TAKE);
		expect(cutMock).toHaveBeenCalledWith(expect.objectContaining({ url: REAL_TAKE }));
	});

	it('url invalido e NESSUN take registrato → errore parlante, nessun fetch tentato', async () => {
		const tools = createMotionOutputTools({
			supabase: fakeStorageClient([]),
			brandId: 'b1',
			fps: () => 30
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (tools.cut_voiceover as any).execute(
			{ at_seconds: [1], url: INVENTED },
			{ toolCallId: 't', messages: [] }
		);
		expect(res.error).toBe('invalid_take_url');
		expect(cutMock).not.toHaveBeenCalled();
	});

	it('lettura 400/404 → la risposta allega il take VERO come take_url', async () => {
		// Throw SINCRONO: una promise rifiutata dentro mock.results manda in confusione il
		// tracker di vitest 2.1 (il test fallirebbe con l'errore del mock anche se consumato).
		cutMock.mockImplementation(() => {
			throw new Error('Could not read the recording back (400).');
		});
		const tools = createMotionOutputTools({
			supabase: fakeStorageClient([{ name: 'abc-full.wav' }]),
			brandId: 'b1',
			fps: () => 30
		});
		// Un url dalla forma giusta ma che non esiste più: la validazione passa, il fetch no.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let res: any;
		try {
			res = await (tools.cut_voiceover as any).execute(
				{ at_seconds: [1], url: `${SUPA}/storage/v1/object/public/media/b1/voiceover/gone-full.wav` },
				{ toolCallId: 't', messages: [] }
			);
			console.log('DBG RESULT', JSON.stringify(res));
		} catch (e) {
			console.log('DBG THREW', e);
			throw e;
		}
		expect(res.error).toBe('cut_failed');
		expect(res.take_url).toBe(REAL_TAKE);
		expect(res.hint).toContain('EXACTLY');
	});
});
