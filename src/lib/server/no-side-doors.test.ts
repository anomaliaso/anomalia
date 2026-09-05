import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../..');

/**
 * Gli SDK che parlano a UN fornitore preciso. `@ai-sdk/openai` non è qui: è la FORMA
 * OpenAI-compatibile, e la usano entrambi gli endpoint vivi (`llm.ts` per OpenRouter,
 * `director.ts` e `produce-agent.ts` per kie). Il vincolo è il fornitore, non il protocollo.
 */
const VENDOR_SDKS = [
	'@google/genai',
	'@ai-sdk/google',
	'@ai-sdk/anthropic',
	'@anthropic-ai/sdk',
	'@ai-sdk/mistral',
	'@ai-sdk/deepseek',
	'@ai-sdk/xai',
	'@ai-sdk/cohere'
];

function tsFiles(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			tsFiles(p, acc);
			continue;
		}
		if (name.endsWith('.ts') && !name.endsWith('.test.ts')) acc.push(p);
	}
	return acc;
}

/**
 * `import type { X } from '@google/genai'` sparisce alla compilazione: non costruisce niente e non
 * apre nessuna porta. `import { X }` invece porta dentro il costruttore.
 *
 * Ritagliare la riga giusta È la guardia: una versione che cercava il nome del pacchetto ovunque
 * nel file passava a vuoto sui commenti che lo nominano, e una che leggeva solo la prima riga non
 * vedeva l'import numero dodici. Questa legge gli import uno per uno e guarda la forma di ognuno.
 */
const VALUE_IMPORT = (pkg: string) =>
	new RegExp(`^\\s*import\\s+(?!type\\s)[^;]*?from\\s*['"]${pkg.replace('/', '\\/')}['"]`, 'm');

function vendorSdkImports(file: string): string[] {
	const src = readFileSync(file, 'utf8');
	return VENDOR_SDKS.filter((pkg) => VALUE_IMPORT(pkg).test(src));
}

describe('nessuna porta laterale verso un fornitore', () => {
	/**
	 * TUTTO passa da OpenRouter, e le foto/voce/video da kie. Nessuna lista bianca, nemmeno per
	 * `gemini.ts`: una guardia con un'eccezione è una guardia che si allarga di un file alla volta,
	 * ed è così che questo confine si era già svuotato.
	 */
	it('nessun file di src importa lo SDK di un fornitore come valore', () => {
		const open: string[] = [];
		for (const file of [...tsFiles(join(SRC, 'lib')), ...tsFiles(join(SRC, 'routes')), ...tsFiles(join(SRC, 'worker'))]) {
			for (const pkg of vendorSdkImports(file)) {
				open.push(`${file.replace(SRC + '/', '')} → ${pkg}`);
			}
		}
		expect(open, `porta laterale aperta:\n${open.join('\n')}`).toEqual([]);
	});

	/**
	 * La guardia sopra è una regex su del testo: se smettesse di riconoscere un import, non
	 * fallirebbe — passerebbe, che è il modo in cui un confine muore senza rumore. Qui le si dà da
	 * leggere un file che l'import ce l'ha DAVVERO, e uno che ha solo il tipo.
	 */
	it('riconosce un import di valore e lascia passare quello di solo tipo', () => {
		const probe = join(SRC, 'lib/server/model-routing.ts');
		expect(vendorSdkImports(probe)).toEqual([]);

		const valueImport = `import { GoogleGenAI } from '@google/genai';\n`;
		const typeImport = `import type { GoogleGenAI } from '@google/genai';\n`;
		expect(VALUE_IMPORT('@google/genai').test(valueImport)).toBe(true);
		expect(VALUE_IMPORT('@google/genai').test(typeImport)).toBe(false);
	});
});

describe('il registro conosce due endpoint, e basta', () => {
	it('Endpoint resta kie | openrouter', async () => {
		const src = readFileSync(join(SRC, 'lib/server/model-routing.ts'), 'utf8');
		const declared = src.match(/export type Endpoint =([^;]+);/)?.[1] ?? '';
		const endpoints = [...declared.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
		expect(endpoints).toEqual(['kie', 'openrouter']);
	});
});
