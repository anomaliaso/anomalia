import { describe, expect, it, vi } from 'vitest';
import { createModelAdapters, createModelResolver, type ModelResolverDeps, type ResolvedChatModel } from './models';

/**
 * `models.ts` PROVATO CON `resolveChatModel`/`geminiFast` FINTI — il comportamento REALE di
 * `resolveChatModel` (quale provider vince con quali chiavi env, quale modelId per tier) è già
 * coperto da `chat/model.test.ts` nell'app (29 test); qui si prova SOLO l'INCAPSULAMENTO: ogni
 * adapter chiama la dep giusta con gli argomenti giusti, e rifiuta un provider tornato sbagliato.
 */
const ctx = { brandId: 'b1', userId: 'u1', runId: 'run-1', locale: 'it' as const };

function deps(overrides: Partial<ModelResolverDeps> = {}): ModelResolverDeps {
	return {
		resolveChatModel: () => {
			throw new Error('resolveChatModel non doveva essere chiamato in questo scenario');
		},
		geminiFast: () => {
			throw new Error('geminiFast non doveva essere chiamato in questo scenario');
		},
		xiaomiModelId: 'mimo-v2.5-pro',
		xiaomiApiKey: undefined,
		...overrides
	};
}

describe('il registro rifiuta chiavi ignote nominando le disponibili', () => {
	it('resolve su una chiave non registrata elenca kie, deepseek, gemini, xiaomi', () => {
		const registry = createModelAdapters(deps());
		expect(() => registry.resolve('anthropic')).toThrow(
			"model-adapter: 'anthropic' non registrato — disponibili: kie, deepseek, gemini, xiaomi"
		);
	});

	it('ids() elenca esattamente i quattro provider di model.ts', () => {
		const registry = createModelAdapters(deps());
		expect(registry.ids()).toEqual(['kie', 'deepseek', 'gemini', 'xiaomi']);
	});
});

describe('describe() — vision e reasoning per provider, come li documenta model.ts', () => {
	it.each([
		['kie', { vision: true, reasoning: true }],
		['deepseek', { vision: false, reasoning: true }],
		['gemini', { vision: true, reasoning: true }],
		['xiaomi', { vision: false, reasoning: false }]
	] as const)('%s', (key, capabilities) => {
		const registry = createModelAdapters(deps());
		expect(registry.resolve(key).describe().capabilities).toEqual(capabilities);
	});
});

describe('resolve() — wrap di resolveChatModel, non sua reimplementazione', () => {
	function fakeModel(modelId: string): ResolvedChatModel['model'] {
		return { modelId };
	}

	it("kie: passa ref.id come tier e torna il model quando il provider tornato è 'kie'", () => {
		const resolveChatModel = vi.fn(
			(): ResolvedChatModel => ({ provider: 'kie', model: fakeModel('gpt-5-6-luna') })
		);
		const registry = createModelAdapters(deps({ resolveChatModel }));
		const model = registry.resolve('kie').resolve({ provider: 'kie', id: 'fast' }, ctx);
		expect(resolveChatModel).toHaveBeenCalledWith('fast', undefined, {});
		expect((model as { modelId: string }).modelId).toBe('gpt-5-6-luna');
	});

	it("kie: quando resolveChatModel scivola su un altro provider, esplode nominandolo", () => {
		const resolveChatModel = () => ({ provider: 'gemini', model: fakeModel('gemini-fake') }) as ResolvedChatModel;
		const registry = createModelAdapters(deps({ resolveChatModel }));
		expect(() => registry.resolve('kie').resolve({ provider: 'kie', id: 'fast' }, ctx)).toThrow(
			/kie:fast.*resolveChatModel ha scelto 'gemini'/
		);
	});

	it("deepseek: torna il model quando il provider tornato è 'deepseek'", () => {
		const resolveChatModel = () => ({ provider: 'deepseek', model: fakeModel('deepseek-v4-pro') }) as ResolvedChatModel;
		const registry = createModelAdapters(deps({ resolveChatModel }));
		const model = registry.resolve('deepseek').resolve({ provider: 'deepseek', id: 'deepseek-pro' }, ctx);
		expect((model as { modelId: string }).modelId).toBe('deepseek-v4-pro');
	});

	it('deepseek: quando resolveChatModel scivola su un altro provider, esplode nominandolo (mai un modello kie sotto la chiave deepseek)', () => {
		const resolveChatModel = () => ({ provider: 'kie', model: fakeModel('gpt-5-6-luna') }) as ResolvedChatModel;
		const registry = createModelAdapters(deps({ resolveChatModel }));
		expect(() =>
			registry.resolve('deepseek').resolve({ provider: 'deepseek', id: 'deepseek-pro' }, ctx)
		).toThrow(/deepseek:deepseek-pro.*resolveChatModel ha scelto 'kie'/);
	});

	it('gemini: usa sempre geminiFast(), non chiama mai resolveChatModel', () => {
		const geminiFast = vi.fn(() => ({ model: fakeModel('gemini-3-7-flash') }));
		const registry = createModelAdapters(deps({ geminiFast }));
		const model = registry.resolve('gemini').resolve({ provider: 'gemini', id: 'ignorato' }, ctx);
		expect(geminiFast).toHaveBeenCalledTimes(1);
		expect((model as { modelId: string }).modelId).toBe('gemini-3-7-flash');
	});

	it('xiaomi: senza xiaomiApiKey esplode nominando la chiave mancante', () => {
		const registry = createModelAdapters(deps({ xiaomiApiKey: undefined }));
		expect(() => registry.resolve('xiaomi').resolve({ provider: 'xiaomi', id: 'default' }, ctx)).toThrow(
			/manca XIAOMI_MIMO_API_KEY/
		);
	});

	it('xiaomi: con la chiave costruisce il client (senza rete) usando xiaomiModelId', () => {
		const registry = createModelAdapters(deps({ xiaomiApiKey: 'xiaomi-test', xiaomiModelId: 'mimo-v2.5-pro' }));
		const model = registry.resolve('xiaomi').resolve({ provider: 'xiaomi', id: 'default' }, ctx);
		expect((model as { modelId: string }).modelId).toBe('mimo-v2.5-pro');
	});

	it('createModelResolver(deps)(ref, ctx) fa lo stesso giro passando dal provider del ref', () => {
		const resolveChatModel = () => ({ provider: 'kie', model: fakeModel('gpt-5-6-luna') }) as ResolvedChatModel;
		const resolveModel = createModelResolver(deps({ resolveChatModel }));
		const model = resolveModel({ provider: 'kie', id: 'fast' }, ctx);
		expect((model as { modelId: string }).modelId).toBe('gpt-5-6-luna');
	});
});
