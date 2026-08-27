import React from 'react';
import { transform } from 'sucrase';
import { GRAPHIC_SOURCE_MAX_CHARS, unwrapGraphicSource, parseGraphicCanvasSize } from './graphic-source';

const ALLOWED_MODULES: Record<string, unknown> = {
	react: React
};

export type CompiledGraphicTsx = {
	element: React.ReactElement;
	width: number;
	height: number;
};

/**
 * Compile a React TSX graphic (import react only) into an element satori can rasterise.
 * Same sandbox idea as motion-video, without remotion — stills have no timeline.
 */
export function compileGraphicTsx(source: string): CompiledGraphicTsx {
	const trimmed = unwrapGraphicSource(source);
	if (!trimmed) throw new Error('Empty source');
	if (trimmed.length > GRAPHIC_SOURCE_MAX_CHARS) {
		throw new Error(`Source exceeds ${GRAPHIC_SOURCE_MAX_CHARS} characters`);
	}

	const importRe =
		/\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	for (const m of trimmed.matchAll(importRe)) {
		const spec = m[1] || m[2];
		if (spec && !(spec in ALLOWED_MODULES)) {
			throw new Error(`Import not allowed: "${spec}" (only react)`);
		}
	}

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
		const mod = ALLOWED_MODULES[name];
		if (!mod) throw new Error(`Import not allowed: "${name}" (only react)`);
		return mod;
	};

	try {
		// eslint-disable-next-line no-new-func
		const run = new Function('require', 'module', 'exports', 'React', code) as (
			req: typeof requireFn,
			mod: typeof module,
			exp: Record<string, unknown>,
			R: typeof React
		) => void;
		run(requireFn, module, module.exports, React);
	} catch (e) {
		throw new Error(`Runtime error: ${e instanceof Error ? e.message : String(e)}`);
	}

	const exports = module.exports;
	const component =
		(typeof exports.default === 'function' ? exports.default : null) ||
		(typeof exports.Graphic === 'function' ? exports.Graphic : null);

	if (!component) {
		throw new Error('Source must export a default React component (or Graphic)');
	}

	const parsed = parseGraphicCanvasSize(trimmed);
	const width =
		asPositiveInt(exports.width, parsed.width, 4096) || parsed.width;
	const height =
		asPositiveInt(exports.height, parsed.height, 4096) || parsed.height;

	let element: React.ReactElement;
	try {
		element = React.createElement(component as React.ComponentType);
	} catch (e) {
		throw new Error(`Graphic component threw: ${e instanceof Error ? e.message : String(e)}`);
	}

	return { element, width, height };
}

function asPositiveInt(v: unknown, fallback: number, max: number): number {
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(max, Math.round(n));
}
