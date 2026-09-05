#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'mcp/api');

mkdirSync(API, { recursive: true });

await esbuild.build({
  entryPoints: [join(ROOT, 'mcp/vercel-handler.ts')],
  outfile: join(API, '_bundle.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: `import { createRequire as __anomaCreateRequire } from 'module'; const require = __anomaCreateRequire(import.meta.url);`,
  },
});
