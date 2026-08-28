#!/usr/bin/env node
/**
 * Bundle MCP HTTP handlers into self-contained ESM under mcp/api/.
 *
 * Vercel project Root Directory is `mcp`, so runtime artifacts must live there.
 * The bundle inlines ../lib so the deploy does not need the repo root on Vercel.
 */
import { mkdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'mcp/api');
mkdirSync(API, { recursive: true });

const bundleName = '_bundle.js';
const bundlePath = join(API, bundleName);

await esbuild.build({
  entryPoints: [join(ROOT, 'mcp/vercel-handler.ts')],
  outfile: bundlePath,
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

const wrappers = [
  { file: 'mcp.js', exportName: 'mcp', maxDuration: 60 },
  { file: 'oauth-protected-resource.js', exportName: 'oauthProtectedResource', maxDuration: 30 },
];

const healthSrc = `/**
 * Ultra-minimal health endpoint (ESM).
 * Kept dependency-free so /health stays up even if the MCP bundle fails to build.
 */
export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version',
    );
    res.end();
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(
    JSON.stringify({
      ok: true,
      name: 'anomalia-mcp',
      transport: 'streamable-http',
      mcp: '/mcp',
    }),
  );
}

export const config = { maxDuration: 10 };
`;

for (const w of wrappers) {
  writeFileSync(
    join(API, w.file),
    `import { ${w.exportName} as handler } from './${bundleName}';
export default handler;
export const config = { api: { bodyParser: false }, maxDuration: ${w.maxDuration} };
`,
  );
}

writeFileSync(join(API, 'health.js'), healthSrc);

// Keep a copy at repo-root api/health.js for local reference / if Root Directory is ever ".".
mkdirSync(join(ROOT, 'api'), { recursive: true });
writeFileSync(join(ROOT, 'api', 'health.js'), healthSrc);

for (const stale of [
  '_vercel.ts',
  '_mcp.bundle.js',
  '_oauth.bundle.js',
  '_bundle.cjs',
  '_bundle.cjs.map',
  'health.ts',
  'health.cjs',
  'mcp.ts',
  'mcp.cjs',
  'mcp.js',
  'oauth-protected-resource.ts',
  'oauth-protected-resource.cjs',
  'oauth-protected-resource.js',
  '_bundle.js',
]) {
  // Only scrub stale generated files from repo-root api/ (not mcp/api live outputs).
  if (stale === 'health.js') continue;
  const p = join(ROOT, 'api', stale);
  if (existsSync(p)) {
    unlinkSync(p);
    console.log('removed', p);
  }
}

console.log('Done. Deploy path: mcp/api/* (Vercel Root Directory = mcp)');
