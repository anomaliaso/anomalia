import { describe, it, expect } from 'vitest';
import { AVATAR_FACE_SPECS } from '$lib/agent-avatars';
import {
	applyMorph,
	createMorphFrame,
	easeInOutExpo,
	morphArcPath,
	planMorph,
	toMorphSpec,
	type MorphArc,
	type MorphBlob,
	type MorphSpec
} from '$lib/avatar-morph';

/**
 * Il morph è aritmetica pura su spec numeriche: qui si inchioda quell'aritmetica, perché il
 * componente ci costruisce sopra un rAF che nessun test guarda frame per frame. Se t=0 e t=1
 * non coincidono ESATTAMENTE con le due spec, il tween "atterra" su una faccia leggermente
 * diversa da quella disegnata da fermi e ogni cambio finisce con uno scatto.
 *
 * reduced-motion non passa di qui: è un ramo del template di AgentAvatar ({#key} + cross-fade,
 * il comportamento precedente al morph) e il tween non parte proprio.
 */

const run = (from: MorphSpec, to: MorphSpec, t: number): MorphSpec => {
	const plan = planMorph(from, to);
	const out = createMorphFrame(plan);
	applyMorph(plan, t, out);
	return out;
};

describe('toMorphSpec', () => {
	it('collassa un dot in un blob quadrato: w = h = 2r, tilt 0', () => {
		const s = toMorphSpec(AVATAR_FACE_SPECS.wide);
		const eye = s.features[0] as MorphBlob;
		expect(eye).toMatchObject({ kind: 'blob', x: -6.4, y: -3.4, w: 8.8, h: 8.8, tilt: 0 });
	});

	it('porta `up` in un bend interpolabile: +1 in su, -1 in giù', () => {
		const happy = toMorphSpec(AVATAR_FACE_SPECS.happy).features[0] as MorphArc;
		const smileMouth = toMorphSpec(AVATAR_FACE_SPECS.smile).features[2] as MorphArc;
		expect(happy.bend).toBe(1);
		expect(smileMouth.bend).toBe(-1);
	});

	it('con bend = ±1 morphArcPath ridà le due forme originali di arcPath', () => {
		// up: M -x y Q 0 -2.2y x y (con y = h/2) — la stessa formula, riscritta col segno.
		expect(morphArcPath({ w: 12, h: 3.4, bend: -1 })).toBe('M -6 -1.7 Q 0 3.74 6 -1.7');
		expect(morphArcPath({ w: 12, h: 3.4, bend: 1 })).toBe('M -6 1.7 Q 0 -3.74 6 1.7');
	});
});

describe('interpolazione', () => {
	const wide = toMorphSpec(AVATAR_FACE_SPECS.wide);
	const dot = toMorphSpec(AVATAR_FACE_SPECS.dot);

	it('t=0 è la partenza, t=1 è l\'arrivo, esattamente', () => {
		expect(run(wide, dot, 0)).toEqual(wide);
		expect(run(wide, dot, 1)).toEqual(dot);
	});

	it('t=0.5 è il punto medio di ogni parametro (yaw, roll, x, y, misure)', () => {
		const mid = run(wide, dot, 0.5);
		expect(mid.yaw).toBeCloseTo((7.8 + 8.2) / 2);
		expect(mid.roll).toBeCloseTo((5 + 4) / 2);
		const eye = mid.features[0] as MorphBlob;
		expect(eye.x).toBeCloseTo((-6.4 + -5.8) / 2);
		expect(eye.y).toBeCloseTo((-3.4 + -2.2) / 2);
		expect(eye.w).toBeCloseTo((8.8 + 5.4) / 2);
	});

	it('applyMorph riscrive lo stesso frame, senza riallocare le feature', () => {
		const plan = planMorph(wide, dot);
		const out = createMorphFrame(plan);
		const refs = [...out.features];
		applyMorph(plan, 0.3, out);
		applyMorph(plan, 0.9, out);
		expect(out.features.map((f, i) => f === refs[i])).toEqual([true, true]);
	});
});

describe('accoppiamento e orfani', () => {
	it('una feature senza gemella cresce da zero al proprio posto (wide → smile: la bocca)', () => {
		const wide = toMorphSpec(AVATAR_FACE_SPECS.wide);
		const smile = toMorphSpec(AVATAR_FACE_SPECS.smile);
		const start = run(wide, smile, 0);
		// 2 occhi accoppiati + la bocca orfana: 3 feature, e a t=0 la bocca è invisibile.
		expect(start.features).toHaveLength(3);
		const mouth = start.features.find((f) => f.kind === 'arc') as MorphArc;
		expect(mouth).toMatchObject({ x: 0, y: 4.2, w: 0, h: 0, weight: 0 });
		const end = run(wide, smile, 1);
		expect(end.features.find((f) => f.kind === 'arc')).toMatchObject({ w: 12, h: 3.4, weight: 3 });
	});

	it('una feature che sparisce si ritira a zero dove sta (smile → wide)', () => {
		const gone = run(toMorphSpec(AVATAR_FACE_SPECS.smile), toMorphSpec(AVATAR_FACE_SPECS.wide), 1);
		const mouth = gone.features.find((f) => f.kind === 'arc') as MorphArc;
		expect(mouth).toMatchObject({ x: 0, y: 4.2, w: 0, h: 0, weight: 0 });
	});

	it('accoppia per vicinanza, non per indice: la bocca nuova non ruba un occhio', () => {
		// smile → surprise: il terzo dot di surprise è la bocca (0.4, 4.6); gli occhi devono
		// restare accoppiati lato per lato e la bocca nascere orfana.
		const plan = planMorph(toMorphSpec(AVATAR_FACE_SPECS.smile), toMorphSpec(AVATAR_FACE_SPECS.surprise));
		const eyeL = plan.pairs.find((p) => p.b.x === -5.6)!;
		const eyeR = plan.pairs.find((p) => p.b.x === 5.6)!;
		const mouth = plan.pairs.find((p) => p.b.x === 0.4)!;
		expect(eyeL.a.x).toBe(-5.8);
		expect(eyeR.a.x).toBe(5.8);
		expect((mouth.a as MorphBlob).w).toBe(0);
	});

	it('specie diverse non si accoppiano mai: blob con blob, arc con arc (happy → wide)', () => {
		// happy ha due archi per occhi, wide due dot: nessuna coppia mista — gli archi si
		// ritirano e i blob crescono, ciascuno al proprio posto.
		const plan = planMorph(toMorphSpec(AVATAR_FACE_SPECS.happy), toMorphSpec(AVATAR_FACE_SPECS.wide));
		expect(plan.pairs).toHaveLength(4);
		for (const { a, b } of plan.pairs) expect(a.kind).toBe(b.kind);
	});

	it('è deterministico: lo stesso piano, due volte', () => {
		const a = planMorph(toMorphSpec(AVATAR_FACE_SPECS.laugh), toMorphSpec(AVATAR_FACE_SPECS.grin));
		const b = planMorph(toMorphSpec(AVATAR_FACE_SPECS.laugh), toMorphSpec(AVATAR_FACE_SPECS.grin));
		expect(a).toEqual(b);
	});
});

describe('easeInOutExpo', () => {
	it('fissa gli estremi e passa dal centro', () => {
		expect(easeInOutExpo(0)).toBe(0);
		expect(easeInOutExpo(0.5)).toBe(0.5);
		expect(easeInOutExpo(1)).toBe(1);
	});

	it('parte e arriva quasi fermo: agli estremi copre meno del 2%', () => {
		expect(easeInOutExpo(0.25)).toBeLessThan(0.02);
		expect(easeInOutExpo(0.75)).toBeGreaterThan(0.98);
	});

	it('è monotona', () => {
		let prev = -1;
		for (let i = 0; i <= 100; i++) {
			const v = easeInOutExpo(i / 100);
			expect(v).toBeGreaterThanOrEqual(prev);
			prev = v;
		}
	});
});
