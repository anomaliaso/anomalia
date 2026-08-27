import { describe, expect, it, vi } from 'vitest';

const genMock = vi.fn();
vi.mock('ai', async (orig) => ({ ...(await orig()) as object, generateText: (...a: unknown[]) => genMock(...a) }));
const modelHolder: { current: unknown } = { current: { model: {} } };
vi.mock('$lib/server/chat/model', () => ({ compactionModel: () => modelHolder.current }));

const { closeTurnVerdict, looksLikeAPromise, claimsWithoutFacts, MAX_VERDICT_LAPS } = await import('./verdict');

describe('il filtro deterministico', () => {
	it('riconosce le promesse it/en, non i fatti', () => {
		expect(looksLikeAPromise('Correggo e ricontrollo i fotogrammi prima del render vero.')).toBe(true);
		expect(looksLikeAPromise("I'll now render the video.")).toBe(true);
		expect(looksLikeAPromise('Video renderizzato: https://x/y.mp4 (24s).')).toBe(false);
		expect(looksLikeAPromise('Fatto: post 42 programmato per martedì.')).toBe(false);
	});

	// CAUSA C.1 — la promessa vera sfuggiva: solo presenti indicativi, niente futuri/condizionali.
	it('riconosce anche i futuri e i condizionali italiani, e "ti dico" (la frase reale del fallimento)', () => {
		expect(looksLikeAPromise('Va bene, poi ti dico come farei il parlato.')).toBe(true);
		expect(looksLikeAPromise('Ti farò sapere appena pronto.')).toBe(true);
		expect(looksLikeAPromise('Domani ti mando il link.')).toBe(true);
		expect(looksLikeAPromise('Preparerò il sorgente e poi lo renderizzo.')).toBe(true);
	});

	// CAUSA C.2 — la risposta onesta scattava: un participio negato non è una consegna dichiarata.
	it('non scatta su una risposta onesta con un participio negato (la frase reale del thread)', () => {
		expect(claimsWithoutFacts('Nessun post pubblicato al momento.', [])).toBe(false);
		expect(claimsWithoutFacts('Non ho ancora creato il video.', [])).toBe(false);
		expect(claimsWithoutFacts('Zero articoli programmati questa settimana.', [])).toBe(false);
		// Ma la dichiarazione vera, senza negazione, resta fabbricazione a mani vuote.
		expect(claimsWithoutFacts('Fatto: post pubblicato.', [])).toBe(true);
	});

	// Un guardiano che non riconosce una consegna accusa di fabbricazione chi ha lavorato: ogni
	// tool del catalogo che PRODUCE davvero (motion/content/ugc/web + attach/brand_write) deve
	// disinnescare il controllo. `web_write_planned_article` ne era fuori — un articolo scritto
	// con quello veniva rilanciato come bugia.
	it('non accusa di fabbricazione un turno che ha davvero prodotto', () => {
		for (const tool of [
			'motion_render',
			'motion_write',
			'motion_stills',
			'attach',
			'brand_write',
			'content_create_post',
			'content_design_graphic',
			'content_generate_image',
			'content_schedule',
			'ugc_generate_video',
			'web_update_article',
			'web_schedule_article',
			'web_write_planned_article',
			'web_optimize_article',
			'web_generate_article_cover',
			'web_generate_article_images'
		]) {
			expect(claimsWithoutFacts('Fatto: ecco il post con immagine e articolo.', [tool])).toBe(false);
		}
		// I tool di sola lettura NON sono una consegna: la fabbricazione resta tale.
		for (const tool of ['content_list_posts', 'web_read_article', 'motion_list', 'brand_read', 'query']) {
			expect(claimsWithoutFacts('Fatto: ecco il post con immagine e articolo.', [tool])).toBe(true);
		}
	});
});

describe('closeTurnVerdict', () => {
	const facts = (over: Partial<Parameters<typeof closeTurnVerdict>[0]> = {}) => ({
		userAsk: 'renderizza il video',
		replyText: 'Correggo e poi renderizzo.',
		succeededTools: ['motion_write'],
		laps: 0,
		...over
	});

	it('senza promessa nel testo NON chiama il giudice', async () => {
		genMock.mockClear();
		const v = await closeTurnVerdict(facts({ replyText: 'Video renderizzato: url.mp4' }));
		expect(v.finished).toBe(true);
		expect(genMock).not.toHaveBeenCalled();
	});

	it('promessa + giudice concorde → not finished, con la continuazione', async () => {
		genMock.mockResolvedValue({ text: '{"finished": false, "missing": "il render", "continuation": "Renderizza ora il video salvato."}' });
		const v = await closeTurnVerdict(facts());
		expect(v).toEqual({ finished: false, missing: 'il render', continuation: 'Renderizza ora il video salvato.' });
	});

	it('al tetto dei giri si ferma SENZA chiamare il giudice — mai un loop', async () => {
		genMock.mockClear();
		const v = await closeTurnVerdict(facts({ laps: MAX_VERDICT_LAPS }));
		expect(v.finished).toBe(true);
		expect(genMock).not.toHaveBeenCalled();
	});

	it('fail-open: giudice che esplode o JSON storto → finished', async () => {
		genMock.mockRejectedValueOnce(new Error('kaboom'));
		expect((await closeTurnVerdict(facts())).finished).toBe(true);
		genMock.mockResolvedValueOnce({ text: 'non-json' });
		expect((await closeTurnVerdict(facts())).finished).toBe(true);
	});

	it('senza modello economico configurato → finished, zero chiamate', async () => {
		modelHolder.current = null;
		genMock.mockClear();
		expect((await closeTurnVerdict(facts())).finished).toBe(true);
		expect(genMock).not.toHaveBeenCalled();
		modelHolder.current = { model: {} };
	});
});

describe('la fabbricazione: dichiara e non ha mosso un dito (23/8, due volte in produzione)', () => {
	const facts = (over = {}) => ({
		userAsk: 'rifallo bello',
		replyText: '**Fatto.** Nuovo trailer Apple-style: 1080×1920, 30 fps, 502 frame.',
		succeededTools: [] as string[],
		laps: 0,
		...over
	});

	it('senza NESSUNO strumento produttivo → not finished, senza chiamare il giudice', async () => {
		genMock.mockClear();
		const v = await closeTurnVerdict(facts());
		expect(v.finished).toBe(false);
		expect(genMock).not.toHaveBeenCalled(); // deterministico: zero costo
		if (!v.finished) expect(v.continuation).toContain('Non ripetere quel messaggio');
	});

	it('con il render riuscito la stessa frase passa: i fatti ci sono', async () => {
		genMock.mockClear();
		const v = await closeTurnVerdict(facts({ succeededTools: ['motion_render', 'attach'] }));
		expect(v.finished).toBe(true);
	});

	it('una risposta che non dichiara artefatti non è toccata', async () => {
		const v = await closeTurnVerdict(facts({ replyText: 'Ho letto lo studio: la palette è viola e nero.' }));
		expect(v.finished).toBe(true);
	});

	it('anche in inglese: "Here is your video" a mani vuote non chiude', async () => {
		const v = await closeTurnVerdict(facts({ replyText: "Here's your video, 16:9, ready." }));
		expect(v.finished).toBe(false);
	});
});

describe("un url ripescato dal testo non è un fatto", () => {
	it('«Fatto» con un link e zero tool produttivi resta fabbricazione', async () => {
		const v = await closeTurnVerdict({
			userAsk: 'rifallo meglio',
			replyText: '**Fatto.** Nuovo trailer: https://x.supabase.co/storage/v1/object/public/media/b/motion/vecchio.mp4',
			succeededTools: [],
			laps: 0
		});
		expect(v.finished).toBe(false);
	});
});
