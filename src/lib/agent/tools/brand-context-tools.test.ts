import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BRAND_CONTEXT_TOOL_NAMES,
	brandContextPromptSection,
	createBrandContextTools
} from './brand-context-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = {} as any;

describe('createBrandContextTools', () => {
	it('builds all four reads by default', () => {
		const tools = createBrandContextTools({ supabase, brandId: 'b1' });
		expect(Object.keys(tools).sort()).toEqual([...BRAND_CONTEXT_TOOL_NAMES].sort());
	});

	it('builds only what a caller asks for — the chat already has finer-grained brand reads', () => {
		const tools = createBrandContextTools({
			supabase,
			brandId: 'b1',
			include: ['read_market_references', 'search_web']
		});
		expect(Object.keys(tools).sort()).toEqual(['read_market_references', 'search_web']);
		expect(tools.read_brand_studio).toBeUndefined();
	});
});

describe('brandContextPromptSection', () => {
	it('names every read it built, so they are weighted and not merely available', () => {
		const block = brandContextPromptSection();
		for (const name of BRAND_CONTEXT_TOOL_NAMES) expect(block).toContain(name);
	});

	it('tells the agent not to describe a feature it has not read', () => {
		expect(brandContextPromptSection()).toContain('Never describe a feature you have not read');
	});

	it('lists only the subset, and stays empty when there is none', () => {
		const block = brandContextPromptSection(['read_knowledge']);
		expect(block).toContain('read_knowledge');
		expect(block).not.toContain('search_web');
		expect(brandContextPromptSection([])).toBe('');
	});
});

describe('the maker agents all take the bundle', () => {
	const reads = (file: string) =>
		readFileSync(new URL(file, import.meta.url), 'utf8');

	it('Motion Video, the Media Generator and the UGC planner each spread it once', () => {
		for (const file of [
			'../../server/motion-video/agent.ts',
			'../../server/media-generator/agent.ts',
			'../../server/media-generator/ugc-plan-agent.ts'
		]) {
			expect(reads(file)).toContain('createBrandContextTools(');
		}
	});

	it('nobody redeclares read_brand_studio or read_knowledge by hand any more', () => {
		// Three copies of two tools with drifting descriptions is what this module replaced.
		for (const file of ['../../server/media-generator/agent.ts', '../../server/media-generator/ugc-plan-agent.ts']) {
			const src = reads(file);
			expect(src).not.toContain('read_brand_studio: tool(');
			expect(src).not.toContain('read_knowledge: tool(');
		}
	});

	it('the brand chat keeps one definition of the two it shares', () => {
		const src = reads('./index.ts');
		expect(src).not.toContain('read_market_references: tool(');
		expect(src).not.toContain('search_web: tool(');
		expect(src).toContain('createBrandContextTools({');
	});
});

describe('the chat motion path', () => {
	/**
	 * 23/08/2026 — la regola non e` cambiata, e` cambiata la sua CASA.
	 *
	 * `MOTION_CRAFT_SPECS` stava anche nella testa dell'agente nullo: 24.274 caratteri (6.069
	 * token) ricopiati a ogni passo di ogni turno, anche per una didascalia. Adesso vive in un
	 * posto solo — `how/MAKE-MOTION-VIDEO.md` — e chi scrive il sorgente lo PRETENDE (il cancello
	 * di `REQUIRED_READS`). Quindi il test pinna due cose insieme: che il file usi la costante
	 * vera invece di una parafrasi, e che il prompt non se la ricopi dentro un'altra volta.
	 */
	it('uses the real craft constant instead of a hand-written paraphrase', () => {
		const src = readFileSync(new URL('../../server/chat/agent-files.ts', import.meta.url), 'utf8');
		expect(src).toContain('${MOTION_CRAFT_SPECS}');
		expect(src).toContain("from '$lib/motion-video/craft'");
		// The paraphrase that used to drift away from craft.ts on its own.
		expect(src).not.toContain('extreme ease-in-out with overshoot settle, animations that run');
	});

	it('and the system prompt does not carry a second copy of it', () => {
		const src = readFileSync(new URL('../../server/chat/system-prompt.ts', import.meta.url), 'utf8');
		expect(src).not.toContain('MOTION_CRAFT_SPECS');
		// Ma nomina il file, o l'agente nullo non saprebbe che quel mestiere ha delle regole.
		expect(src).toContain('how/MAKE-MOTION-VIDEO.md');
	});

	it('gets the reference wall too — WITH the pixels', () => {
		const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
		expect(src).toContain('createMotionReferenceTools(');
		// 2026-08-22: attachMedia:false era il buco per cui la chat "studiava" reference che il
		// modello non vedeva mai (solo spec testuale). I frame viaggiano come image-data →
		// input_image sull'OpenAI-compat (Luna/Grok/GPT) e inlineData su Google; il clip resta
		// rifiutato senza modelId. Vedi image-agent.ts per la prova image-data vs file-data.
		expect(src).toContain('attachMedia: true');
	});

	it('refuses a wall hotlink before it can be compiled and saved', () => {
		const src = readFileSync(new URL('./motion-video-tools.ts', import.meta.url), 'utf8');
		const guard = src.indexOf('referenceHotlink(opts.source)');
		const compile = src.indexOf('compileMotionSource(opts.source)');
		expect(guard).toBeGreaterThan(-1);
		expect(compile).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(compile);
	});
});
