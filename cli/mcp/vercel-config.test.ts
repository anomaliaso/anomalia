import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';
import vercelConfig from './vercel.json';

const MCP_ROOT = dirname(fileURLToPath(import.meta.url));

const functionPatterns = Object.keys(vercelConfig.functions);

describe('vercel.json functions', () => {
  it('names files that exist before the build runs', () => {
    for (const pattern of functionPatterns) {
      expect(existsSync(join(MCP_ROOT, pattern))).toBe(true);
    }
  });

  it('names files git tracks, since Vercel validates the pattern before installing', async () => {
    const tracked = await $`git ls-files --cached ${functionPatterns}`.cwd(MCP_ROOT).text();

    for (const pattern of functionPatterns) {
      expect(tracked).toContain(pattern);
    }
  });

  it('keeps the generated bundle out of the patterns', () => {
    expect(functionPatterns).not.toContain('api/_bundle.js');
  });
});
