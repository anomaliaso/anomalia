import React from 'react';
import * as Remotion from 'remotion';
import * as RemotionShapes from '@remotion/shapes';
import * as RemotionPaths from '@remotion/paths';
import * as RemotionTransitions from '@remotion/transitions';
import * as TransitionSlide from '@remotion/transitions/slide';
import * as TransitionIris from '@remotion/transitions/iris';
import * as TransitionWipe from '@remotion/transitions/wipe';
import * as TransitionClockWipe from '@remotion/transitions/clock-wipe';
import * as TransitionFlip from '@remotion/transitions/flip';
import * as TransitionFade from '@remotion/transitions/fade';
import * as TransitionNone from '@remotion/transitions/none';
import { transform } from 'sucrase';
import type { MotionVideoMeta } from './source';
import { MOTION_SOURCE_MAX_CHARS } from './source';
import {
	MOTION_ALLOWED_MODULES,
	isMotionAllowedModule,
	type MotionAllowedModule
} from './modules';

export type CompiledMotion = MotionVideoMeta & {
	component: React.ComponentType;
};

/**
 * Il `Record<MotionAllowedModule, …>` non è pedanteria: è ciò che fa fallire la BUILD se qualcuno
 * aggiunge un nome in `modules.ts` e si dimentica di importarlo qui. L'alternativa è un modulo
 * ammesso dal gate e assente dal require, cioè un video che passa il controllo e poi esplode a
 * schermo con "Import not allowed" — o peggio, `undefined`.
 */
const ALLOWED_MODULES: Record<MotionAllowedModule, unknown> = {
	react: React,
	remotion: Remotion,
	'@remotion/shapes': RemotionShapes,
	'@remotion/paths': RemotionPaths,
	'@remotion/transitions': RemotionTransitions,
	'@remotion/transitions/slide': TransitionSlide,
	'@remotion/transitions/iris': TransitionIris,
	'@remotion/transitions/wipe': TransitionWipe,
	'@remotion/transitions/clock-wipe': TransitionClockWipe,
	'@remotion/transitions/flip': TransitionFlip,
	'@remotion/transitions/fade': TransitionFade,
	'@remotion/transitions/none': TransitionNone
};

/**
 * IL CONTROLLO CHE COMPILARE NON FACEVA, e che e' costato due render in produzione.
 *
 * `import { slide } from '@remotion/transitions'` — dalla RADICE invece che da
 * '@remotion/transitions/slide' — passava di qui senza un fiato e moriva nella VM con
 * `TypeError: (0, esm_namespaceObject.slide) is not a function`. Non e' sfortuna: col transform
 * `imports` di sucrase un import nominato diventa un accesso PIGRO sul namespace
 * (`_transitions.slide`) valutato al punto di CHIAMATA, e il corpo del modulo — l'unica cosa che
 * `compileMotionSource` esegue — non ci passa mai. Il gate sullo specificatore c'era ed era
 * verde: '@remotion/transitions' e' un modulo ammesso. Il nome, nessuno lo guardava.
 *
 * E il difetto era INSEGNATO: il ricettario nel prompt mostrava quella forma, quindi il modello
 * la copiava. Un controllo che rifiuta e' l'unico modo di spegnere una lezione sbagliata.
 *
 * Qui i nomi si confrontano con il MODULO VERO — gli stessi namespace che il player poi
 * richiede — quindi non c'e' nessuna lista da tenere allineata: se Remotion sposta un export,
 * questo controllo lo sa il giorno dopo l'aggiornamento. E quando il nome esiste altrove, il
 * messaggio dice DOVE: un rifiuto che non porta la correzione e' un rifiuto da rifare.
 *
 * Solo i nomi importati: `import React from 'react'` passa per l'interop di sucrase e non e' la
 * classe di guasto di cui si parla. `import type` non esiste a runtime.
 */
export function findUnexportedNamedImport(source: string): string | null {
	const re = /\bimport\s+(?!type\s)(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
	for (const m of source.matchAll(re)) {
		const spec = m[2];
		if (!isMotionAllowedModule(spec)) continue; // gia' rifiutato dal gate sullo specificatore
		const ns = ALLOWED_MODULES[spec] as Record<string, unknown>;
		for (const raw of m[1].split(',')) {
			const name = raw.trim().split(/\s+as\s+/)[0].trim();
			if (!name || name.startsWith('type ')) continue;
			if (Object.prototype.hasOwnProperty.call(ns, name) || name in ns) continue;
			const home = MOTION_ALLOWED_MODULES.find(
				(other) => other !== spec && name in (ALLOWED_MODULES[other] as object)
			);
			return home
				? `Import not allowed: "${name}" is NOT exported by '${spec}' — it lives in '${home}'. This exact mistake compiles and then dies at render with "(0, esm_namespaceObject.${name}) is not a function". Write: import { ${name} } from '${home}';`
				: `Import not allowed: "${name}" is not exported by '${spec}'.`;
		}
	}
	return null;
}

function asPositiveInt(v: unknown, fallback: number, max: number): number {
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(max, Math.round(n));
}

/**
 * Compile a Remotion TSX source string into a Player-ready component.
 * Only the specifiers in `modules.ts` are allowed — see that file for why the list is what it is.
 */
export function compileMotionSource(source: string): CompiledMotion {
	const trimmed = source.trim();
	if (!trimmed) throw new Error('Empty source');
	if (trimmed.length > MOTION_SOURCE_MAX_CHARS) {
		throw new Error(`Source exceeds ${MOTION_SOURCE_MAX_CHARS} characters`);
	}

	// Static gate before transpile — blocks other packages even if unused / tree-shaken.
	const importRe =
		/\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	for (const m of trimmed.matchAll(importRe)) {
		const spec = m[1] || m[2];
		if (spec && !isMotionAllowedModule(spec)) {
			throw new Error(`Import not allowed: "${spec}" — allowed: ${MOTION_ALLOWED_MODULES.join(', ')}`);
		}
	}

	const badName = findUnexportedNamedImport(trimmed);
	if (badName) throw new Error(badName);

	let code: string;
	try {
		code = transform(trimmed, {
			transforms: ['typescript', 'jsx', 'imports'],
			production: true
		}).code;
	} catch (e) {
		throw new Error(`Compile error: ${e instanceof Error ? e.message : String(e)}`);
	}

	const module = { exports: {} as Record<string, unknown> };
	const requireFn = (name: string) => {
		if (!isMotionAllowedModule(name)) {
			throw new Error(`Import not allowed: "${name}" — allowed: ${MOTION_ALLOWED_MODULES.join(', ')}`);
		}
		return ALLOWED_MODULES[name];
	};

	try {
		// eslint-disable-next-line no-new-func
		const run = new Function('require', 'module', 'exports', code) as (
			req: typeof requireFn,
			mod: typeof module,
			exp: Record<string, unknown>
		) => void;
		run(requireFn, module, module.exports);
	} catch (e) {
		throw new Error(`Runtime error: ${e instanceof Error ? e.message : String(e)}`);
	}

	const exports = module.exports;
	const component =
		(typeof exports.default === 'function' ? exports.default : null) ||
		(typeof exports.MotionVideo === 'function' ? exports.MotionVideo : null) ||
		(typeof exports.MotionAd === 'function' ? exports.MotionAd : null);

	if (!component) {
		throw new Error('Source must export a default React component (or MotionVideo / MotionAd)');
	}

	return {
		component: component as React.ComponentType,
		fps: asPositiveInt(exports.fps, 30, 60),
		durationInFrames: asPositiveInt(exports.durationInFrames, 180, 3600),
		width: asPositiveInt(exports.width, 1080, 4096),
		height: asPositiveInt(exports.height, 1080, 4096)
	};
}

/** Apply a unique search/replace on source. Throws if old_str missing or not unique. */
export function applySourceEdit(source: string, oldStr: string, newStr: string): string {
	if (!oldStr) throw new Error('old_str is required');
	const count = source.split(oldStr).length - 1;
	if (count === 0) throw new Error('old_str not found in source');
	if (count > 1) throw new Error(`old_str matched ${count} times — make it unique`);
	const next = source.replace(oldStr, newStr);
	if (next.length > MOTION_SOURCE_MAX_CHARS) {
		throw new Error(`Source would exceed ${MOTION_SOURCE_MAX_CHARS} characters`);
	}
	// Validate compiles
	compileMotionSource(next);
	return next;
}

export function replaceSource(source: string): string {
	if (source.length > MOTION_SOURCE_MAX_CHARS) {
		throw new Error(`Source exceeds ${MOTION_SOURCE_MAX_CHARS} characters`);
	}
	compileMotionSource(source);
	return source;
}
