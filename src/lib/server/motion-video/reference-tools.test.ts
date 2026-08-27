import { describe, expect, it } from 'vitest';
import { MOTION_REFERENCE_PROMPT, supportsClipInToolResult } from './reference-tools';

describe('supportsClipInToolResult', () => {
	it('is true for the Gemini 3 models that accept functionResponse parts', () => {
		expect(supportsClipInToolResult('gemini-3.7-flash')).toBe(true);
		expect(supportsClipInToolResult('gemini-3-pro-preview')).toBe(true);
	});

	it('is false for anything older — the provider would stringify the video into prose', () => {
		expect(supportsClipInToolResult('gemini-2.5-flash')).toBe(false);
		expect(supportsClipInToolResult('gemini-2.0-flash')).toBe(false);
	});

	it('is false for nothing at all rather than optimistic', () => {
		expect(supportsClipInToolResult(null)).toBe(false);
		expect(supportsClipInToolResult(undefined)).toBe(false);
		expect(supportsClipInToolResult('')).toBe(false);
	});
});

describe('MOTION_REFERENCE_PROMPT', () => {
	it('tells the agent it will see the reference, not just read about it', () => {
		expect(MOTION_REFERENCE_PROMPT).toContain('stills');
		expect(MOTION_REFERENCE_PROMPT).toContain('watch="clip"');
	});

	it('carries the two rules that stop a reference from making the output worse', () => {
		expect(MOTION_REFERENCE_PROMPT).toContain('OUT OF REACH');
		expect(MOTION_REFERENCE_PROMPT).toContain('DEFAULT CRAFT');
	});
});

// La sonda del 2026-08-21 (header del modulo) ha mostrato che il tool result era un canale rotto:
// su streamText il modello non riceveva MAI i pixel. Questi test fissano il canale di riserva —
// contratto sul system e frame come messaggio — che prepareStep ricostruisce a ogni step.
import {
	MESSAGE_FRAMES_ATTACHED,
	REFERENCE_FRAMES_MESSAGE,
	buildReferenceStepPatch,
	formatReferenceContract,
	type ReferenceStudy
} from './reference-tools';
import type { MotionReferenceSpec } from '$lib/server/motion-references';
import type { ModelMessage } from 'ai';

const spec: MotionReferenceSpec = {
	format: 'announcement card push',
	duration_s: 12,
	aspect: '1:1',
	beats: [
		{ at_s: 0, on_screen: 'logo alone on dark field', motion: 'scale in', buildable: 'tsx', needs: '' },
		{ at_s: 3, on_screen: 'headline over product UI', motion: 'push left', buildable: 'asset', needs: 'one still' },
		{ at_s: 8, on_screen: 'camera flies through a rendered office', motion: 'dolly', buildable: 'out_of_reach', needs: '3D' }
	],
	transitions: ['slide-with-overlap'],
	easing: 'expo in-out',
	type_density: 'one short line at a time, huge',
	palette: 'one dominant dark, one accent doing all the work',
	logo_role: 'opens and closes',
	ui_elements: ['editor window'],
	sound_off: 'fully readable',
	adapt: [],
	summary: 'a push-driven announcement'
};

const study = (id: string, frames: number): ReferenceStudy => ({
	referenceId: id,
	contract: formatReferenceContract({ brand: 'Linear', category: 'launch' }, spec),
	frames: Array.from({ length: frames }, (_, i) => `data:image/jpeg;base64,frame${i}`)
});

const baseMessages: ModelMessage[] = [{ role: 'user', content: 'build me a launch video' }];

describe('formatReferenceContract', () => {
	it('binds structure and keeps the pixels the brand’s', () => {
		const c = formatReferenceContract({ brand: 'Linear', category: 'launch' }, spec);
		expect(c).toContain('REFERENCE CONTRACT');
		expect(c).toContain('slide-with-overlap');
		expect(c).toContain('Palette ROLES');
		expect(c).toContain("stay THIS brand's");
		expect(c).toContain('DEFAULT CRAFT');
	});

	it('marks the out-of-reach beat as one to replace, not to attempt', () => {
		const c = formatReferenceContract({ brand: null, category: null }, spec);
		expect(c).toContain('[REPLACE]');
		expect(c).toContain('2/3 reachable');
	});
});

describe('buildReferenceStepPatch', () => {
	it('touches nothing before a study — no contract, no injected frames', () => {
		expect(buildReferenceStepPatch([], 'SYSTEM', baseMessages)).toEqual({});
	});

	it('after a study: contract on the system, ONE user message with the frames', () => {
		const patch = buildReferenceStepPatch([study('r1', 2)], 'SYSTEM', baseMessages);
		expect(patch.system).toContain('SYSTEM');
		expect(patch.system).toContain('REFERENCE CONTRACT');
		expect(patch.messages).toHaveLength(baseMessages.length + 1);
		const injected = patch.messages![patch.messages!.length - 1];
		expect(injected.role).toBe('user');
		const parts = injected.content as Array<{ type: string; text?: string }>;
		expect(parts[0]).toEqual({ type: 'text', text: REFERENCE_FRAMES_MESSAGE });
		expect(parts.filter((p) => p.type === 'image')).toHaveLength(2);
	});

	it('is once per studied reference, however many steps rebuild it', () => {
		const studies = [study('r1', 2)];
		const step1 = buildReferenceStepPatch(studies, 'SYSTEM', baseMessages);
		const step2 = buildReferenceStepPatch(studies, 'SYSTEM', baseMessages);
		expect(step1.messages).toHaveLength(2);
		expect(step2.messages).toHaveLength(2);
		const both = buildReferenceStepPatch([study('r1', 2), study('r2', 1)], 'SYSTEM', baseMessages);
		expect(both.messages).toHaveLength(3);
	});

	it('ai@7 carries the step-message override forward: re-patching the carried messages stays one injection per reference', () => {
		const studies = [study('r1', 2)];
		const step1 = buildReferenceStepPatch(studies, 'SYSTEM', baseMessages);
		const carriedForward = [...step1.messages!, { role: 'assistant' as const, content: 'writing the TSX' }];
		const step2 = buildReferenceStepPatch(studies, 'SYSTEM', carriedForward);
		const frameMessages = step2.messages!.filter(
			(m) =>
				Array.isArray(m.content) &&
				(m.content as Array<{ type: string; text?: string }>)[0]?.text === REFERENCE_FRAMES_MESSAGE
		);
		expect(frameMessages).toHaveLength(1);
		expect(step2.messages!.at(-1)).toEqual(step1.messages![1]);
		expect(step2.messages!.some((m) => m.role === 'assistant')).toBe(true);
	});

	it('caps the message-level frames at the budget even if handed more', () => {
		const patch = buildReferenceStepPatch([study('r1', 6)], 'SYSTEM', baseMessages);
		const parts = patch.messages![1].content as Array<{ type: string }>;
		expect(parts.filter((p) => p.type === 'image')).toHaveLength(MESSAGE_FRAMES_ATTACHED);
	});

	it('a spec_only study still ships the contract, without an empty frames message', () => {
		const patch = buildReferenceStepPatch([study('r1', 0)], 'SYSTEM', baseMessages);
		expect(patch.system).toContain('REFERENCE CONTRACT');
		expect(patch.messages).toBeUndefined();
	});
});
