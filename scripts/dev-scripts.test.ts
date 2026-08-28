import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

type Scripts = Record<string, string>;

async function readScripts(): Promise<Scripts> {
	const raw = await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');
	return JSON.parse(raw).scripts;
}

describe('dev server scripts', () => {
	it('bun run dev never kills a port: every agent gets its own free port', async () => {
		const scripts = await readScripts();
		expect(scripts.dev).not.toContain('kill');
	});

	it('bun run dev:5173 owns port 5173: kills the stale owner then binds strictly', async () => {
		const scripts = await readScripts();
		expect(scripts['dev:5173']).toMatch(/lsof .*5173/);
		expect(scripts['dev:5173']).toContain('--strictPort');
	});

	it('bun run dev:5173 still starts the vite dev server', async () => {
		const scripts = await readScripts();
		expect(scripts['dev:5173']).toContain('vite dev');
	});
});
