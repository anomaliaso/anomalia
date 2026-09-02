import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOTION_CRAFT_SPECS } from '$lib/motion-video/craft';

/**
 * The one-shot composition, pinned.
 *
 * Every real create turn went: read the seed, write 30k characters, set the title, finish. That was
 * not the model misbehaving — in CREATE mode the whole file IS "a wholly new structure", so the
 * rule reserving write_source for exactly that made one call the correct move, and nothing ever
 * asked the agent to look at what it had produced.
 */
const AGENT = readFileSync(new URL('./agent.ts', import.meta.url), 'utf8');

describe('finish refuses a composition written once and never revisited', () => {
	it('guards on refinement count AND on having re-read its own source', () => {
		expect(AGENT).toContain('const oneShot =');
		expect(AGENT).toMatch(/patchCount < MIN_REFINEMENT_PATCHES \|\| !readAfterWrite/);
	});

	it('only guards CREATE turns — an edit turn is already refinement', () => {
		const guard = AGENT.slice(AGENT.indexOf('const oneShot ='), AGENT.indexOf('finishRefusals += 1'));
		expect(guard).toContain('createMode');
	});

	it('bounds the refusals, so a model that cannot comply still ships', () => {
		// The turn ends on finish, the step cap or the deadline: refusing forever would burn every
		// step and save nothing.
		expect(AGENT).toContain('finishRefusals < MAX_FINISH_REFUSALS');
		expect(AGENT).toMatch(/const MAX_FINISH_REFUSALS = [1-3];/);
	});

	it('tells the agent exactly what a refinement pass consists of', () => {
		const hint = AGENT.slice(AGENT.indexOf("error: 'not_finished'"), AGENT.indexOf('calledFinish = true'));
		expect(hint).toMatch(/transition mechanism/i);
		expect(hint).toMatch(/easing and overshoot/i);
		expect(hint).toMatch(/through the cut/i);
		expect(hint).toMatch(/hook, tension, demonstration, proof, resolution/i);
	});

	it('resets the re-read flag on every write — a read before a write proves nothing', () => {
		const write = AGENT.slice(AGENT.indexOf('writeCount += 1;'));
		expect(write.slice(0, 260)).toContain('readAfterWrite = false');
	});
});

describe('length comes from the beats', () => {
	it('no longer defaults to six seconds regardless of content', () => {
		expect(AGENT).not.toContain('default ~6s');
		expect(AGENT).toMatch(/2\.5–4s to be read/);
		expect(AGENT).toMatch(/six beats is 18–24s/i);
	});
});

describe('the craft specs ask for an arc', () => {
	it('names the shape of the story, not just the polish', () => {
		expect(MOTION_CRAFT_SPECS).toContain('STORYLINE');
		expect(MOTION_CRAFT_SPECS).toMatch(/hook, tension/);
		// L'arco nomina i mestieri; il CONTO lo decide chi scrive (craft.test.ts).
		expect(MOTION_CRAFT_SPECS).toMatch(/JOBS, not a fixed count/);
	});

	it('gives each beat room, which is what "too fast" actually meant', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/2\.5–4s/);
		expect(MOTION_CRAFT_SPECS).toMatch(/unreadable at any easing/i);
	});
});

describe('the build is staged in the prompt too, not only enforced', () => {
	it('write_source is described as the start of the work', () => {
		expect(AGENT).toMatch(/write_source ONCE: the SKELETON/);
		expect(AGENT).toMatch(/START of the work, not the end/);
	});
});

describe('finish refuses linear motion, because that one can be checked', () => {
	const AGENT = readFileSync(
		new URL('./agent.ts', import.meta.url),
		'utf8'
	);

	it('reads the current source and refuses on a violation', () => {
		expect(AGENT).toContain("error: 'linear_motion'");
		expect(AGENT).toContain('findLinearMotion(r.get().source)');
		// Stesso budget dell'altra guardia: rifiutare all'infinito brucia la slice.
		const guard = AGENT.slice(AGENT.indexOf("const linear = ("), AGENT.indexOf("calledFinish = true"));
		expect(guard).toContain('finishRefusals < MAX_FINISH_REFUSALS');
		expect(guard).toContain('finishRefusals += 1');
	});

	it('tells the agent which curve to use instead', () => {
		expect(AGENT).toContain('MOTION_EXPO_IN_OUT');
		expect(AGENT).toContain('MOTION_OVERSHOOT_OUT');
	});
});
