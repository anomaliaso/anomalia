/**
 * MORPH PARAMETRICO fra due espressioni dell'avatar.
 *
 * Le facce non sono path SVG da interpolare: sono SPEC numeriche proiettate sulla palla da
 * `decalTransform` a ogni render. Il morph interpola i numeri e lascia che la proiezione ricalcoli
 * le path frame per frame — lo stesso meccanismo con cui si muove lo sguardo.
 *
 * La chiave è la forma canonica: un `dot` di raggio r È una `capsule` con w = h = 2r. Ridotti a
 * "blob", occhio tondo e occhio chiuso si morfano come uno schiacciamento, senza casi speciali.
 * Restano due specie: blob (riempito) e arc (tratto). Un arc non diventa mai un blob: quando le
 * specie non combaciano ogni feature resta orfana e cresce o si ritira da dimensione zero.
 *
 * Puro e senza dipendenze Svelte: lo usano il componente e i test.
 */
import type { AvatarFaceSpec } from '$lib/agent-avatars';

export type MorphBlob = {
	kind: 'blob';
	x: number;
	y: number;
	w: number;
	h: number;
	tilt: number;
};
export type MorphArc = {
	kind: 'arc';
	x: number;
	y: number;
	w: number;
	h: number;
	weight: number;
	/** +1 = sorriso (concavo in su), -1 = broncio. Interpolabile: passa per il piatto a 0. */
	bend: number;
};
export type MorphFeature = MorphBlob | MorphArc;

export type MorphSpec = {
	yaw: number;
	roll: number;
	features: MorphFeature[];
};

/** Una coppia da interpolare: `a` e `b` hanno sempre la stessa specie (gli orfani hanno un fantasma). */
type MorphPair = { a: MorphFeature; b: MorphFeature };

export type MorphPlan = {
	from: { yaw: number; roll: number };
	to: { yaw: number; roll: number };
	pairs: MorphPair[];
};

/** Spec autorale → forma canonica interpolabile. dot e capsule collassano entrambi in blob. */
export function toMorphSpec(spec: AvatarFaceSpec): MorphSpec {
	return {
		yaw: spec.yaw,
		roll: spec.roll,
		features: spec.features.map((f): MorphFeature => {
			if (f.kind === 'dot') return { kind: 'blob', x: f.x, y: f.y, w: f.r * 2, h: f.r * 2, tilt: 0 };
			if (f.kind === 'capsule')
				return { kind: 'blob', x: f.x, y: f.y, w: f.w, h: f.h, tilt: f.tilt ?? 0 };
			return {
				kind: 'arc',
				x: f.x,
				y: f.y,
				w: f.w,
				h: f.h,
				weight: f.weight ?? 3,
				bend: f.up ? 1 : -1
			};
		})
	};
}

/**
 * Path per un arc canonico, a curvatura continua: estremi a y = bend·h/2, controllo a
 * y = −bend·1.1·h. Con bend = ±1 le due formule originali; in mezzo la bocca si appiattisce
 * invece di saltare.
 */
export function morphArcPath(f: { w: number; h: number; bend: number }): string {
	const x = f.w / 2;
	const ey = (f.bend * f.h) / 2;
	const cy = -f.bend * 1.1 * f.h;
	const r = (n: number) => Math.round(n * 1000) / 1000;
	return `M ${r(-x)} ${r(ey)} Q 0 ${r(cy)} ${r(x)} ${r(ey)}`;
}

/**
 * Expo in-out: quasi ferma agli estremi, tutta la corsa nel mezzo. È la curva che fa leggere il
 * cambio come una faccia che si RIMODELLA invece che come due pose incrociate — una cubica parte
 * già al 6% a un quarto della durata, e a 420ms quel primo quarto è il momento in cui l'occhio
 * decide se ha visto un morph o un taglio.
 */
export function easeInOutExpo(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
}

/**
 * Durata del morph: dentro la sosta più corta del ciclo (800ms di riposo dello sticker). Più
 * lunga della cubica che c'era prima perché l'expo regala i due estremi alla quiete — a 420ms
 * restavano ~170ms di movimento vero, di nuovo un taglio.
 */
export const MORPH_MS = 620;

/** Il fantasma di un orfano: stesso posto e stessa specie, dimensione zero — da lì cresce o lì si ritira. */
function phantomOf(f: MorphFeature): MorphFeature {
	return f.kind === 'blob'
		? { kind: 'blob', x: f.x, y: f.y, w: 0, h: 0, tilt: f.tilt }
		: { kind: 'arc', x: f.x, y: f.y, w: 0, h: 0, weight: 0, bend: f.bend };
}

/**
 * Accoppia le feature delle due spec e prepara il piano del tween. L'accoppiamento è per specie e
 * per VICINANZA, non per indice: così l'occhio sinistro morfa nell'occhio sinistro anche quando le
 * spec li elencano in ordine diverso, e una bocca che compare non ruba l'occhio destro. Greedy
 * basta (max 3 feature) ed è deterministico: a parità di distanza vince l'indice più basso.
 */
export function planMorph(from: MorphSpec, to: MorphSpec): MorphPlan {
	const pairs: MorphPair[] = [];
	for (const kind of ['blob', 'arc'] as const) {
		const a = from.features.filter((f) => f.kind === kind);
		const b = to.features.filter((f) => f.kind === kind);
		const used = new Array(a.length).fill(false);
		for (const bt of b) {
			let best = -1;
			let bestD = Infinity;
			for (let i = 0; i < a.length; i++) {
				if (used[i]) continue;
				const d = Math.hypot(a[i].x - bt.x, a[i].y - bt.y);
				if (d < bestD - 1e-9) {
					bestD = d;
					best = i;
				}
			}
			if (best >= 0) {
				used[best] = true;
				pairs.push({ a: a[best], b: bt });
			} else {
				// Orfano d'arrivo: cresce da zero al suo posto.
				pairs.push({ a: phantomOf(bt), b: bt });
			}
		}
		// Orfani di partenza: si ritirano a zero dove stanno.
		for (let i = 0; i < a.length; i++) if (!used[i]) pairs.push({ a: a[i], b: phantomOf(a[i]) });
	}
	return { from: { yaw: from.yaw, roll: from.roll }, to: { yaw: to.yaw, roll: to.roll }, pairs };
}

/**
 * Il frame su cui il tween scrive: allocato UNA volta per transizione, poi solo mutato. Le specie
 * sono fissate qui, così `applyMorph` non alloca niente per frame.
 */
export function createMorphFrame(plan: MorphPlan): MorphSpec {
	return {
		yaw: plan.from.yaw,
		roll: plan.from.roll,
		features: plan.pairs.map(({ a }) =>
			a.kind === 'blob'
				? { kind: 'blob', x: a.x, y: a.y, w: a.w, h: a.h, tilt: a.tilt }
				: { kind: 'arc', x: a.x, y: a.y, w: a.w, h: a.h, weight: a.weight, bend: a.bend }
		)
	};
}

// Nella forma (1−t)·a + t·b, non a + (b−a)·t: la seconda a t=1 può mancare `b` di un ulp,
// e il rientro su `target` a fine tween deve coincidere al bit, o ogni cambio finisce a scatto.
const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;

/**
 * Scrive nel frame lo stato a `t` (già passato per l'easing). Ogni parametro è un lerp: la
 * non-linearità visiva la mette la proiezione, che ricalcola foreshortening e shear dal nuovo
 * (x, y). Zero allocazioni.
 */
export function applyMorph(plan: MorphPlan, t: number, out: MorphSpec): void {
	out.yaw = lerp(plan.from.yaw, plan.to.yaw, t);
	out.roll = lerp(plan.from.roll, plan.to.roll, t);
	for (let i = 0; i < plan.pairs.length; i++) {
		const { a, b } = plan.pairs[i];
		const f = out.features[i];
		f.x = lerp(a.x, b.x, t);
		f.y = lerp(a.y, b.y, t);
		f.w = lerp(a.w, b.w, t);
		f.h = lerp(a.h, b.h, t);
		if (f.kind === 'blob') {
			f.tilt = lerp((a as MorphBlob).tilt, (b as MorphBlob).tilt, t);
		} else {
			f.weight = lerp((a as MorphArc).weight, (b as MorphArc).weight, t);
			f.bend = lerp((a as MorphArc).bend, (b as MorphArc).bend, t);
		}
	}
}
