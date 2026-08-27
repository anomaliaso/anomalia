import { describe, expect, it } from 'vitest';
import {
  MOTION_EXPO_IN_OUT,
  MOTION_EXPO_IN_OUT_POINTS,
  MOTION_OVERSHOOT_OUT,
  findLinearMotion,
  findStaticTails,
  formatEasingViolations,
  formatStasisViolations
} from './easing';

describe('the curves', () => {
  it('expo in-out is flat at the extremities and steep in the middle', () => {
    const [x1, y1, x2, y2] = MOTION_EXPO_IN_OUT_POINTS;
    // Il primo punto di controllo è spinto a destra e tenuto a zero, il secondo è speculare:
    // è ciò che rende la curva quasi orizzontale alle due estremità.
    expect(x1).toBeGreaterThan(0.7);
    expect(y1).toBe(0);
    expect(x2).toBeLessThan(0.3);
    expect(y2).toBe(1);
    expect(MOTION_EXPO_IN_OUT).toBe('Easing.bezier(0.87, 0, 0.13, 1)');
  });

  it('keeps the overshoot as a separate curve — it goes past 1, expo in-out never does', () => {
    expect(MOTION_OVERSHOOT_OUT).toMatch(/1\.\d/);
    expect(MOTION_OVERSHOOT_OUT).not.toBe(MOTION_EXPO_IN_OUT);
  });
});

describe('findLinearMotion', () => {
  it('flags an interpolate with no easing — the default in Remotion is linear', () => {
    const src = `const o = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });`;
    const found = findLinearMotion(src);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('missing_easing');
    expect(found[0]!.line).toBe(1);
  });

  it('flags the bare three-argument form too', () => {
    expect(findLinearMotion('const x = interpolate(frame, [0, 10], [0, 100]);')).toHaveLength(1);
  });

  it('flags an explicit Easing.linear even when the field is present', () => {
    const src = `interpolate(frame, [0, 30], [0, 1], { easing: Easing.linear });`;
    const kinds = findLinearMotion(src).map((v) => v.kind);
    expect(kinds).toContain('explicit_linear');
  });

  it('accepts an interpolate that carries an easing', () => {
    const src = `interpolate(frame, [0, 30], [0, 1], {\n  extrapolateLeft: 'clamp',\n  easing: ${MOTION_EXPO_IN_OUT}\n });`;
    expect(findLinearMotion(src)).toEqual([]);
  });

  it('survives nested parentheses inside the call', () => {
    const src = `interpolate(Math.max(0, frame - 12), [0, fps * 2], [0, 1], { easing: ${MOTION_EXPO_IN_OUT} });`;
    expect(findLinearMotion(src)).toEqual([]);
  });

  it('leaves interpolateColors alone — it takes no easing', () => {
    expect(findLinearMotion(`interpolateColors(frame, [0, 30], ['#000', '#fff'])`)).toEqual([]);
  });

  it('does not read code out of strings or comments', () => {
    const src = [
      `// interpolate(frame, [0, 1], [0, 1])`,
      `const note = "interpolate(frame, [0, 1], [0, 1])";`,
      `/* Easing.linear was here */`
    ].join('\n');
    expect(findLinearMotion(src)).toEqual([]);
  });

  it('reports the right line in a multi-line file', () => {
    const src = ['const a = 1;', '', `const b = interpolate(f, [0, 1], [0, 1]);`].join('\n');
    expect(findLinearMotion(src)[0]!.line).toBe(3);
  });
});

describe('findStaticTails — nessuna scena deve essere statica, mai', () => {
	// La forma del trailer vero del 2026-08-21: beat in TransitionSeries con durate `const bN`,
	// interpolate a numeri di frame grezzi che finiscono molto prima della chiusura.
	const frozenTail = `
export const fps = 30;
const b1 = 5.2 * fps;
function BeatHook() {
	const frame = useCurrentFrame();
	const rise = interpolate(frame, [0, 24], [40, 0], { easing: E });
	const line = interpolate(frame, [38, 60], [0, 1], { easing: E });
	return <div style={{ transform: 'translateY(' + rise + 'px)' }} />;
}
export default function V() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}`;

	it('flags a beat whose interpolations all end long before the beat does', () => {
		const found = findStaticTails(frozenTail);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ component: 'BeatHook', beatFrames: 156, lastActiveFrame: 60 });
		expect(found[0].gapFrames).toBe(96);
	});

	it('accepts a beat kept alive to its last frame (background pan through the cut)', () => {
		const alive = frozenTail.replace(
			'[38, 60], [0, 1]',
			'[38, 5.2 * fps], [0, 1]'
		);
		expect(findStaticTails(alive)).toEqual([]);
	});

	it('credits the motion of a rendered child component to the hosting beat', () => {
		const withCursor = `
export const fps = 30;
function Cursor() {
	const frame = useCurrentFrame();
	const x = interpolate(frame, [0, 150], [100, 800], { easing: E });
	return <div style={{ left: x + 'px' }} />;
}
function Beat() {
	return <div><Cursor /></div>;
}
export default function V() {
	return <Sequence durationInFrames={5 * fps}><Beat /></Sequence>;
}`;
		expect(findStaticTails(withCursor)).toEqual([]);
	});

	it('stays silent when an input range cannot be resolved (conservative, no invented FIX)', () => {
		const propDriven = `
export const fps = 30;
function Beat({ exitAt }) {
	const frame = useCurrentFrame();
	const p = interpolate(frame, [exitAt * fps, (exitAt + 0.5) * fps], [0, 1], { easing: E });
	return <div style={{ opacity: p }} />;
}
export default function V() {
	return <Sequence durationInFrames={6 * fps}><Beat exitAt={3} /></Sequence>;
}`;
		expect(findStaticTails(propDriven)).toEqual([]);
	});

	it('flags a beat with NO interpolation at all — a still with an intro is still a still', () => {
		const still = `
export const fps = 30;
function Card() {
	return <div>frozen</div>;
}
export default function V() {
	return <Sequence durationInFrames={4 * fps}><Card /></Sequence>;
}`;
		const found = findStaticTails(still);
		expect(found).toHaveLength(1);
		expect(found[0].component).toBe('Card');
	});

	it('every cookbook snippet passes its own stasis check', async () => {
		const { TRANSITIONS_COOKBOOK } = await import('./transitions-cookbook');
		for (const e of TRANSITIONS_COOKBOOK) {
			expect(findStaticTails(e.code), e.name).toEqual([]);
		}
	});
});

describe('formatStasisViolations', () => {
	it('is empty with nothing to say, and names the beat with its dead seconds otherwise', () => {
		expect(formatStasisViolations([])).toBe('');
		const msg = formatStasisViolations(
			[{ component: 'BeatCTA', beatFrames: 156, lastActiveFrame: 60, gapFrames: 96 }],
			30
		);
		expect(msg).toContain('BeatCTA');
		expect(msg).toContain('3.2s');
	});
});

describe('formatEasingViolations', () => {
  it('is empty when there is nothing to say', () => {
    expect(formatEasingViolations([])).toBe('');
  });

  it('counts both kinds and caps the list', () => {
    const many = Array.from({ length: 9 }, (_, i) => `const v${i} = interpolate(f, [0, 1], [0, 1]);`).join('\n');
    const text = formatEasingViolations(findLinearMotion(many));
    expect(text).toMatch(/9 interpolate senza easing/);
    expect(text).toMatch(/e altre 3/);
  });
});
