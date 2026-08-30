/**
 * Bundle the chat worker into a single Node script.
 *
 * The server library is written against SvelteKit-isms and nothing else: the `$lib` alias,
 * `$env/dynamic/private`, `$app/environment` (one `dev` read in `chat/queue.ts`), and Vite's
 * `import.meta.glob` (four calls, all `eager: true`, across `chat/agent-files.ts` and
 * `motion-video/library/index.ts` — Vite inlines these at build time, so the worker inlines them
 * at ITS build time too, in the plugin below). Nothing here needs SvelteKit at runtime, so all of
 * it is resolved at build time and the result is an ordinary Node entrypoint.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/**
 * Every file under `dir`, as POSIX paths relative to `dir` (`a/b/c.tsx`, never backslashes).
 * Never walks `node_modules` — the caller is expected to have already narrowed `dir` to the
 * pattern's literal prefix, but a stray symlink loop under a workspace `node_modules` (this repo
 * checks out several worktrees side by side) turns one glob into a crash, not just slow.
 */
function walkAll(dir) {
	const out = [];
	const go = (d) => {
		for (const name of readdirSync(d)) {
			if (name === 'node_modules') continue;
			const full = resolve(d, name);
			if (statSync(full).isDirectory()) go(full);
			else out.push(relative(dir, full).split(sep).join('/'));
		}
	};
	go(dir);
	return out;
}

/** The path segments before the first one containing a glob character — where the walk can start. */
function literalPrefixDir(patternRel) {
	const segments = patternRel.split('/');
	const wildAt = segments.findIndex((s) => s.includes('*') || s.includes('{'));
	return segments.slice(0, wildAt === -1 ? segments.length : wildAt).join('/');
}

/** `**\/*.{a,b}` / `*\/*\/name.ext` → a RegExp matching the same relative paths Vite's glob would. */
function globToRegex(pattern) {
	const body = pattern
		.replace(/[.+^$()]/g, '\\$&')
		.replace(/\*\*\//g, '@@DS@@')
		.replace(/\*/g, '[^/]*')
		.replace(/@@DS@@/g, '(?:[^/]*/)*')
		.replace(/\{([^}]+)\}/g, (_, g) => `(?:${g.split(',').join('|')})`);
	return new RegExp(`^${body}$`);
}

/**
 * Replaces one `import.meta.glob('<pattern>', {...})` call with the literal object Vite would
 * have inlined, computed by walking the filesystem now instead of at Vite's build time.
 *
 * Two shapes cover every call site in the bundle (verified 24/8 — `grep -rn import.meta.glob
 * src/lib`; the rest are tests/Svelte components, never reached from the worker entrypoint):
 *  - root-relative (`/a/b/**\/*.{ext}`) — Vite keys these `/a/b/…`, absolute from the repo root.
 *  - file-relative (`./*\/*\/name.ext`) — Vite keys these `./…`, relative to the importing file.
 * `query: '?raw'` gives the raw text (what `import: 'default'` then also asks for); its absence
 * (only `meta.json` today) gives the parsed value — `readAgentFile`'s callers already accept
 * either `{default: v}` or `v` for that case, so the parsed object is embedded directly.
 */
function inlineGlob(fileAbsPath, pattern, optsText) {
	const isRoot = pattern.startsWith('/');
	const baseDir = isRoot ? root : dirname(fileAbsPath);
	const patternRel = isRoot ? pattern.slice(1) : pattern.replace(/^\.\//, '');
	const re = globToRegex(patternRel);
	const isRaw = optsText.includes("'?raw'");
	const prefix = literalPrefixDir(patternRel);
	const walkDir = resolve(baseDir, prefix);

	const out = {};
	for (const relToPrefix of walkAll(walkDir)) {
		const rel = prefix ? `${prefix}/${relToPrefix}` : relToPrefix;
		if (!re.test(rel)) continue;
		const key = isRoot ? `/${rel}` : `./${rel}`;
		const text = readFileSync(resolve(walkDir, relToPrefix), 'utf8');
		if (isRaw) {
			out[key] = text;
		} else if (rel.endsWith('.json')) {
			out[key] = JSON.parse(text);
		} else {
			throw new Error(`[build-worker] import.meta.glob without '?raw' on a non-JSON file: ${rel}`);
		}
	}
	return out;
}

/** Scoped to the two files that call the macro — everything else skips the regex pass. */
const importMetaGlobPlugin = {
	name: 'import-meta-glob-eager',
	setup(b) {
		b.onLoad({ filter: /(chat[\/\\]agent-files|motion-video[\/\\]library[\/\\]index)\.ts$/ }, ({ path }) => {
			const contents = readFileSync(path, 'utf8').replace(
				/import\.meta\.glob\(\s*'([^']+)'\s*,\s*(\{[^}]*\})\s*\)/g,
				(whole, pattern, optsText) => JSON.stringify(inlineGlob(path, pattern, optsText))
			);
			return { contents, loader: 'ts' };
		});
	}
};

await build({
	entryPoints: [resolve(root, 'src/worker/index.ts')],
	outfile: resolve(root, 'build-worker/index.js'),
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	sourcemap: true,
	logLevel: 'info',
	// esbuild cannot see `import.meta` polyfills in CJS deps otherwise; ESM output keeps them native.
	banner: {
		js: [
			"import { createRequire as __createRequire } from 'node:module';",
			'const require = __createRequire(import.meta.url);'
		].join('\n')
	},
	alias: {
		$lib: resolve(root, 'src/lib'),
		'$app/environment': resolve(root, 'src/worker/app-environment-shim.ts'),
		'$env/dynamic/private': resolve(root, 'src/worker/env-shim.ts'),
		'$env/dynamic/public': resolve(root, 'src/worker/env-shim.ts')
	},
	loader: {
		// `?raw` text imports (`WRITE-VIDEO-PROMPTS.md?raw`) — esbuild strips the query to resolve the
		// file on disk, then picks a loader by extension alone, so this covers the plain `.md` import too.
		'.md': 'text'
	},
	plugins: [importMetaGlobPlugin],
	// Bundle OUR source AND the `@anomalia/*` workspace packages — resolve real npm dependencies at
	// runtime instead. The image ships node_modules anyway, and inlining every npm dep means
	// fighting every native binary (.node), every optional peer nobody installed (@aws-sdk/client-s3
	// inside unzipper) and every conditional require in the tree.
	//
	// `@anomalia/*` packages CANNOT be external: their `package.json#exports` points straight at
	// `src/*.ts` (no build step, no `dist/`) for consumption by a bundler — Vite for the app, this
	// script for the worker. Left external, plain Node hits the workspace symlink in node_modules
	// and tries to run TypeScript with no loader, which is not a runtime that exists.
	external: Object.keys(pkg.dependencies ?? {})
});

console.log('[build-worker] → build-worker/index.js');
