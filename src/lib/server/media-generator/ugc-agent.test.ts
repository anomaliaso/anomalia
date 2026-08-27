import { describe, expect, it } from 'vitest';
import {
	UGC_AGENT_RENDER_HEADROOM,
	clipView,
	renderOutcome,
	ugcAgentSystemPrompt
} from './ugc-agent';
import type { UgcClipPlan } from './ugc-batch';

function plan(index: number): UgcClipPlan {
	return {
		index,
		product: { id: 'p1', name: 'Cuffie X', urls: ['https://x/1.png'] } as never,
		model: { id: 'm1', name: 'Sara', urls: ['https://x/2.png'] } as never,
		script: { hook: `hook ${index}`, body: `body ${index}`, cta: `cta ${index}` },
		setting: `cucina ${index}`,
		format: 'unboxing' as never,
		hookVisual: `visual ${index}`
	};
}

describe('clipView', () => {
	it('dice lo stato reale della clip, non quello che il modello ricorda', () => {
		const finished = new Set([0]);
		const failed = new Map([[1, 'render exploded']]);
		expect(clipView(plan(0), finished, failed).status).toBe('rendered');
		expect(clipView(plan(1), finished, failed).status).toBe('failed');
		expect(clipView(plan(2), finished, failed).status).toBe('pending');
	});

	it('una clip fallita porta il PERCHÉ — senza, "failed" chiede un retry alla cieca', () => {
		const v = clipView(plan(1), new Set(), new Map([[1, 'the model refused the brief']]));
		expect(v.failure).toBe('the model refused the brief');
	});

	it('porta il copione per intero: è su quello che l’agente decide se patchare', () => {
		const v = clipView(plan(3), new Set(), new Map());
		expect(v).toMatchObject({
			index: 3,
			hook: 'hook 3',
			body: 'body 3',
			cta: 'cta 3',
			setting: 'cucina 3',
			hook_visual: 'visual 3',
			product: 'Cuffie X',
			model: 'Sara'
		});
	});

	it('resa batte fallita: una clip rifatta con successo non resta marcata rotta', () => {
		// `render()` toglie da `failed` quando la ripresa riesce, ma la vista non deve dipendere
		// dall'ordine in cui i due insiemi vengono aggiornati.
		expect(clipView(plan(4), new Set([4]), new Map([[4, 'old failure']])).status).toBe('rendered');
	});
});

describe('renderOutcome', () => {
	// La correzione del batch UGC: prima una clip fallita finiva in `finished` e l'esito letto era
	// 'rendered' — read_plan la mostrava uscita, finish la contava, already_rendered bloccava il
	// retry per sempre. E un rinvio per deadline era 'failed' senza perché.
	it('fallita è fallita, non resa', () => {
		expect(renderOutcome(3, new Set(), new Map([[3, 'boom']]))).toBe('failed');
	});
	it('resa è resa', () => {
		expect(renderOutcome(3, new Set([3]), new Map())).toBe('rendered');
	});
	it('né resa né fallita = rinviata (deadline): non è un fallimento', () => {
		expect(renderOutcome(3, new Set(), new Map())).toBe('deferred');
	});
	it('su una ri-resa fallita di una clip già uscita vince l’esito di QUESTO tentativo', () => {
		expect(renderOutcome(3, new Set([3]), new Map([[3, 'remake died']]))).toBe('failed');
	});
});

describe('il brief del produttore', () => {
	const base = { brandName: 'Anomalia', videoCount: 6, sharedBlock: '' };

	it('mette il costo di una resa davanti a tutto', () => {
		// È l'unico fatto che cambia il comportamento: leggere e patchare sono gratis, rendere no.
		const p = ugcAgentSystemPrompt(base);
		expect(p).toMatch(/WHAT A RENDER COSTS/);
		expect(p).toMatch(/patch_clip is free/);
	});

	it('chiede di guardare i copioni come insieme, non uno per uno', () => {
		// Sei clip che aprono sullo stesso beat sono il modo più comune in cui questa funzione delude.
		expect(ugcAgentSystemPrompt(base)).toMatch(/as a SET/);
	});

	it('dice come si spezza un batch, non come si delega in generale', () => {
		// La disciplina della delega la scrive `agent-base.ts` per tutte e quattro le superfici:
		// qui resta solo la forma che quel lavoro prende quando l'oggetto è un batch di clip.
		const p = ugcAgentSystemPrompt(base);
		expect(p).toMatch(/SPLITTING A BATCH/);
		expect(p).toMatch(/ONE TASK PER CLIP/);
	});

	it('non riscrive le regole condivise: quelle arrivano dal blocco della base', () => {
		// Se un giorno qualcuno le ricopiasse qui, divergerebbero al primo cambio.
		const p = ugcAgentSystemPrompt(base);
		expect(p).not.toMatch(/GOAL — YOU SET IT YOURSELF/);
		expect(p).not.toMatch(/MACHINE —/);
	});

	it('non dice "6 clips" quando la clip è una', () => {
		expect(ugcAgentSystemPrompt({ ...base, videoCount: 1 })).toMatch(/1 UGC clip\b/);
		expect(ugcAgentSystemPrompt({ ...base, videoCount: 1 })).not.toMatch(/1 UGC clips/);
	});

	it('il blocco condiviso entra nel brief così com’è', () => {
		const p = ugcAgentSystemPrompt({ ...base, sharedBlock: 'SHARED — SOMETHING\n' });
		expect(p).toMatch(/SHARED — SOMETHING/);
	});
});

describe('budget di rese', () => {
	it('lascia margine per correggere, non per ricominciare', () => {
		// Il margine è per patch + ri-resa di qualche clip. Se fosse grande quanto il batch,
		// l'agente potrebbe rendere tutto due volte senza accorgersene.
		expect(UGC_AGENT_RENDER_HEADROOM).toBeGreaterThan(0);
		expect(UGC_AGENT_RENDER_HEADROOM).toBeLessThanOrEqual(6);
	});
});
