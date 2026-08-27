import { describe, expect, it } from 'vitest';
import { applySourceEdit, compileMotionSource } from './compile';
import { defaultMotionSource } from './source';
import { MOTION_ALLOWED_MODULES } from './modules';

describe('motion-video compile', () => {
	it('compiles the default brand source', () => {
		const source = defaultMotionSource({
			brandName: 'Acme',
			accent: '#ff5500',
			displayFont: 'Inter',
			bodyFont: 'Inter'
		});
		const compiled = compileMotionSource(source);
		expect(compiled.fps).toBe(30);
		expect(compiled.durationInFrames).toBe(180);
		expect(compiled.width).toBe(1080);
		expect(typeof compiled.component).toBe('function');
	});

	it('applies a unique source edit and recompiles', () => {
		const source = defaultMotionSource({ brandName: 'Acme' });
		const next = applySourceEdit(
			source,
			"const headline = 'Your marketing team.\\nOn autopilot.';",
			"const headline = 'Ship faster.\\nStart today.';"
		);
		expect(next).toContain('Ship faster');
		expect(compileMotionSource(next).component).toBeTypeOf('function');
	});

	it('compiles a seed that references a logo Img', () => {
		const source = defaultMotionSource({
			brandName: 'Acme',
			logoUrl: 'https://cdn.example/logo.svg',
			colors: ['#111111', '#c485fe'],
			displayFont: 'Satoshi'
		});
		expect(source).toContain('Img');
		expect(source).toContain('https://cdn.example/logo.svg');
		expect(compileMotionSource(source).component).toBeTypeOf('function');
	});

	it('compiles a composition that uses a generated https Img', () => {
		const source = `import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
export const fps = 30;
export const durationInFrames = 90;
export const width = 1080;
export const height = 1080;
export default function MotionVideo() {
  return (
    <AbsoluteFill>
      <Img src="https://cdn.example/hero.png" style={{ width: 1080, height: 1080, objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}
`;
		expect(compileMotionSource(source).durationInFrames).toBe(90);
	});

	it('rejects disallowed imports', () => {
		expect(() =>
			compileMotionSource(`import fs from 'fs';
export const fps = 30;
export const durationInFrames = 30;
export const width = 100;
export const height = 100;
export default function MotionVideo() { return null; }
`)
		).toThrow(/not allowed/i);
	});
});

/**
 * L'allowlist allargata, provata sul compilatore vero e non solo sui tipi.
 *
 * Il rischio che questi test coprono non è "un import ammesso viene rifiutato": è il suo opposto —
 * un nome che passa il gate statico e poi torna `undefined` dal require, perché qualcuno l'ha
 * aggiunto a `modules.ts` senza importarlo in `compile.ts`. Un video così compila e poi esplode
 * a schermo.
 */
describe('allowlist dei moduli', () => {
	it('ogni specificatore ammesso si risolve davvero a un modulo', () => {
		for (const spec of MOTION_ALLOWED_MODULES) {
			const src = `import * as M from '${spec}';
export const fps = 30;
export const durationInFrames = 30;
export const width = 1080;
export const height = 1080;
export default function MotionVideo() { return M ? null : null; }`;
			expect(() => compileMotionSource(src), spec).not.toThrow();
		}
	});

	it('TransitionSeries e le forme si compilano insieme, come in un video vero', () => {
		const src = `import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { TransitionSeries, springTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { Circle } from '@remotion/shapes';

export const fps = 30;
export const durationInFrames = 150;
export const width = 1080;
export const height = 1080;

export default function MotionVideo() {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={2 * fps}>
        <AbsoluteFill><Circle radius={100} fill="#fff" /></AbsoluteFill>
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: 'from-right' })}
        timing={springTiming({ config: { damping: 200 } })}
      />
      <TransitionSeries.Sequence durationInFrames={3 * fps}>
        <AbsoluteFill />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
}`;
		const compiled = compileMotionSource(src);
		expect(compiled.durationInFrames).toBe(150);
		expect(typeof compiled.component).toBe('function');
	});

	it('quello che resta fuori resta fuori', () => {
		for (const spec of ['three', '@react-three/fiber', '@remotion/google-fonts', '@remotion/media-utils', 'next/image', 'https://esm.sh/lodash', '@remotion/transitions/film-burn']) {
			const src = `import X from '${spec}';\nexport default function MotionVideo() { return null; }`;
			expect(() => compileMotionSource(src), spec).toThrow(/Import not allowed/);
		}
	});
});
