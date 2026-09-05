import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const CLI = fileURLToPath(new URL('../', import.meta.url));
const REPO = join(CLI, '..');

const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const workflow = read('.github/workflows/cli-release.yml');
const installer = read('cli/scripts/install.sh');
const formula = read('cli/Formula/anomalia.rb');
const formulaUpdater = read('cli/scripts/update-homebrew-formula.sh');

const TAG_PREFIX = 'cli-v';

describe('release tag prefix', () => {
  test('the workflow only fires on cli-v* tags', () => {
    expect(workflow).toContain(`tags: ['${TAG_PREFIX}*']`);
  });

  test('the installer downloads from a cli-v tag', () => {
    expect(installer).toContain(`TAG_PREFIX="${TAG_PREFIX}"`);
  });

  test('every formula url points at a cli-v tag', () => {
    const urls = formula.match(/releases\/download\/[^/]+\//g) ?? [];
    expect(urls.length).toBe(4);
    for (const url of urls) {
      expect(url).toBe(`releases/download/${TAG_PREFIX}#{version}/`);
    }
  });

  test('the formula updater rewrites urls back to a cli-v tag', () => {
    expect(formulaUpdater).toContain(`\\g<1>${TAG_PREFIX}#{{version}}\\2`);
  });
});

describe('published binaries are verifiable', () => {
  test('the workflow publishes SHA256SUMS.txt with the binaries', () => {
    expect(workflow).toContain('sha256sum anomalia-* > SHA256SUMS.txt');
    expect(workflow).toContain('cli/dist/SHA256SUMS.txt');
  });

  test('the installer refuses a binary it cannot verify', () => {
    expect(installer).toContain('CHECKSUMS_FILE="SHA256SUMS.txt"');
    expect(installer).toMatch(/Refusing to install a binary that does not match/);
  });
});

describe('nothing irreversible runs before the credentials are checked', () => {
  const stepNames = [...workflow.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);
  const at = (name: string) => stepNames.indexOf(name);

  test('the credential check precedes every publish step', () => {
    const check = at('Verify release credentials');
    expect(check).toBeGreaterThanOrEqual(0);
    for (const step of [
      'Publish to npm',
      'Publish binaries to GitHub Release',
      'Push formula to Homebrew tap',
    ]) {
      expect(at(step)).toBeGreaterThan(check);
    }
  });

  test('npm publishes before the GitHub Release, so a bad token cannot strand a release', () => {
    expect(at('Publish to npm')).toBeLessThan(at('Publish binaries to GitHub Release'));
  });
});

describe('the version the tag carries reaches everything that reports one', () => {
  const declared = [
    ['cli/package.json', /"version": "(\d+\.\d+\.\d+)"/],
    ['cli/cli.ts', /\.version\('(\d+\.\d+\.\d+)'\)/],
    ['cli/mcp/server.ts', /version: '(\d+\.\d+\.\d+)'/],
  ] as const;

  test('every declared version agrees', () => {
    const versions = declared.map(([file, re]) => read(file).match(re)?.[1]);
    expect(versions.every(Boolean)).toBe(true);
    expect(new Set(versions).size).toBe(1);
  });

  test('the workflow rewrites each of them from the tag', () => {
    expect(workflow).toContain("p.version=process.argv[1]");
    expect(workflow).toContain("sed -i.bak \"s/\\.version('[^']*')/.version('${TAG}')/\" cli.ts");
    expect(workflow).toContain("sed -i.bak \"s/version: '[^']*'/version: '${TAG}'/\" mcp/server.ts");
  });
});
