#!/usr/bin/env bun
/**
 * Build Node-targeted JS bundles for npm (`npm i -g anomalia-cli`).
 *
 *   bun run scripts/build-npm.ts
 *
 * Output:
 *   dist-npm/cli.js        → bin `anomalia`
 *   dist-npm/mcp-stdio.js  → bin `anomalia-mcp`
 *   dist-npm/package.json  → publishable package root (copied fields)
 */

import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, cpSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'dist-npm');

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const entries = [
  { entry: join(ROOT, 'cli.ts'), outfile: join(OUT, 'cli.js') },
  { entry: join(ROOT, 'mcp/stdio.ts'), outfile: join(OUT, 'mcp-stdio.js') },
];

for (const { entry, outfile } of entries) {
  console.log(`  Bundling ${outfile.replace(ROOT + '/', '')}…`);
  const proc = Bun.spawnSync([
    'bun', 'build',
    entry,
    '--target=node',
    '--outfile', outfile,
    '--minify',
  ], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (proc.exitCode !== 0) {
    console.error(`  ✗ Failed: ${entry}`);
    process.exit(1);
  }

  // Ensure Node shebang (bun build may leave none or a bun shebang).
  let src = readFileSync(outfile, 'utf8');
  if (src.startsWith('#!')) {
    src = src.replace(/^#!.*\n/, '#!/usr/bin/env node\n');
  } else {
    src = `#!/usr/bin/env node\n${src}`;
  }
  writeFileSync(outfile, src, { mode: 0o755 });
  console.log(`  ✓ ${outfile.replace(ROOT + '/', '')}`);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
const publishPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  author: pkg.author,
  repository: pkg.repository,
  homepage: pkg.homepage,
  bugs: pkg.bugs,
  type: 'module',
  bin: {
    anomalia: './cli.js',
    'anomalia-mcp': './mcp-stdio.js',
  },
  engines: {
    node: '>=20',
  },
  keywords: [
    'anomalia',
    'cli',
    'social-media',
    'mcp',
    'content',
    'seo',
  ],
  files: [
    'cli.js',
    'mcp-stdio.js',
    'README.md',
    'LICENSE',
  ],
};

writeFileSync(join(OUT, 'package.json'), JSON.stringify(publishPkg, null, 2) + '\n');
cpSync(join(ROOT, 'README.md'), join(OUT, 'README.md'));
cpSync(join(ROOT, 'LICENSE'), join(OUT, 'LICENSE'));

console.log('\nDone. Publish with:');
console.log('  cd dist-npm && npm publish --access public');
