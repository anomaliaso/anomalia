#!/usr/bin/env node
/**
 * Fail the build on TypeScript errors that map to runtime ReferenceErrors
 * (undefined identifiers / object shorthand without a binding).
 *
 * Full `tsc` / `svelte-check` still has many pre-existing type mismatches;
 * those must not block Vercel deploys. This gate only catches the class of
 * bug that broke generate_strategy (`userId is not defined`).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const result = spawnSync(
  process.execPath,
  [tscBin, '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
);

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const lines = output.split('\n').filter(Boolean);

// TS2304 Cannot find name 'X'
// TS18004 No value exists in scope for the shorthand property 'X'
// TS2552 Cannot find name 'X'. Did you mean 'Y'?
// TS2554 Expected N arguments, but got M
// TS2555 Expected at least N arguments, but got M
//
// The arity codes were added after a signature change (scfetch gained a leading `method`
// parameter) left eight call sites passing only the path. tsc reported all eight; the gate
// ignored them because they were not name errors, and the build shipped. The result was a
// TypeError on the FIRST line of every profile fetch — `path.split` on undefined — which the
// callers caught and recorded as a failure reason, so nothing crashed and nothing alerted:
// every profile history in the app silently returned nothing for a week. A missing required
// argument is exactly as fatal at runtime as an undefined name, and belongs in the same gate.
const RUNTIME_NAME_RE = /error TS(2304|18004|2552|2554|2555):/;

// Test files are typechecked but not shipped: a wrong arity in a spec fails the spec, loudly and
// locally. Gating deploys on them would trade a real signal for a false one.
const isTest = (line) => /\.(test|spec)\.[cm]?tsx?\(/.test(line);

const fatal = lines.filter((l) => RUNTIME_NAME_RE.test(l) && !isTest(l));

if (fatal.length) {
  console.error('typecheck-runtime: failing build — undefined names or wrong arity (would crash at runtime):\n');
  for (const l of fatal) console.error(l);
  process.exit(1);
}

const other = lines.filter((l) => /error TS\d+:/.test(l)).length;
if (other) {
  console.log(`typecheck-runtime: ok (ignored ${other} non-fatal type error(s))`);
} else {
  console.log('typecheck-runtime: ok');
}
process.exit(0);
