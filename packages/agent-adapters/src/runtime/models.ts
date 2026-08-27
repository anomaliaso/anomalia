/**
 * `ModelAdapter` sopra la risoluzione di `chat/model.ts`, più il registro che il runtime consulta.
 * `model.ts` si avvolge, non si duplica: ogni adapter chiama `resolveChatModel` e VERIFICA che il
 * provider tornato sia il suo, così una chiave mancante esplode nominando il perché invece di
 * restituire un modello gemini sotto la chiave kie.
 *
 * `geminiFast` è l'eccezione: è l'unico costruttore esportato che ignora le altre chiavi, quindi
 * l'unico modo di garantire "questo è Gemini" con KIE_API_KEY impostata.
 *
 * GAP: model.ts non esporta un costruttore xiaomi (vive dentro `legacyFallback()`, privato), e
 * qui sotto se ne ricostruisce il client. La SCELTA del provider resta là; se la baseURL cambia
 * lì, va risincronizzata qui a mano.
 *
 * Deps e non import: `packages/` non può importare `$lib/server/*` né `$env/*` (vedi
 * `packages/no-app-imports.test.ts`). Quale provider vince con quali chiavi resta coperto da
 * `chat/model.test.ts`; qui si prova solo l'incapsulamento.
 */
import { createOpenAI } from '@ai-sdk/openai';
import { Registry } from '@anomalia/agent-kit/registry';
import type { AdapterContext, AdapterDescriptor, ModelRef } from '@anomalia/agent-kit/types';
import type { ModelAdapter } from '@anomalia/agent-kit/interfaces';

type ModelCapabilities = { vision: boolean; reasoning: boolean };

/** Lo stesso `{ provider, model }` che `resolveChatModel` (chat/model.ts) restituisce. */
export interface ResolvedChatModel {
	provider: string;
	model: unknown;
}

export interface ModelResolverDeps {
	resolveChatModel: (tier: string, agentId: string | undefined, opts: Record<string, unknown>) => ResolvedChatModel;
	geminiFast: () => { model: unknown };
	/** `XIAOMI_MODEL` di `$lib/server/xiaomi` — un id di modello, non un costruttore. */
	xiaomiModelId: string;
	/** `env.XIAOMI_MIMO_API_KEY` — un solo valore, non l'intero `$env`. */
	xiaomiApiKey?: string;
}

function descriptor(id: string, capabilities: ModelCapabilities): AdapterDescriptor<ModelCapabilities> {
	return { id, adapterVersion: '1.0.0', capabilities };
}

/** kie: Luna, Grok, Terra/Sol. `ref.id` è il tier, passato pari pari a `resolveChatModel`. */
function kieAdapter(deps: Pick<ModelResolverDeps, 'resolveChatModel'>): ModelAdapter {
	return {
		describe: () => descriptor('kie', { vision: true, reasoning: true }),
		resolve(ref: ModelRef, _context: AdapterContext): unknown {
			// Nessuna eccezione per 'auto': famiglia+thinking per agente sono POLICY, e le legge
			// resolveChatModel via opts.agentId. Qui passano solo i ModelRef espliciti.
			const resolved = deps.resolveChatModel(ref.id, undefined, {});
			if (resolved.provider !== 'kie') {
				throw new Error(
					`models: 'kie:${ref.id}' non risolvibile — resolveChatModel ha scelto '${resolved.provider}' ` +
						`(manca KIE_API_KEY, o '${ref.id}' non è un tier gestito da kie)`
				);
			}
			return resolved.model;
		}
	};
}

/** deepseek: solo 'deepseek-pro'. Niente vision: DeepSeek V4 Pro rifiuta le image parts. */
function deepseekAdapter(deps: Pick<ModelResolverDeps, 'resolveChatModel'>): ModelAdapter {
	return {
		describe: () => descriptor('deepseek', { vision: false, reasoning: true }),
		resolve(ref: ModelRef, _context: AdapterContext): unknown {
			const resolved = deps.resolveChatModel(ref.id, undefined, {});
			if (resolved.provider !== 'deepseek') {
				throw new Error(
					`models: 'deepseek:${ref.id}' non risolvibile — resolveChatModel ha scelto '${resolved.provider}' ` +
						`(manca DEEPSEEK_API_KEY, o '${ref.id}' non è il tier 'deepseek-pro')`
				);
			}
			return resolved.model;
		}
	};
}

/** gemini: il ripiego di model.ts, un solo modello — `ref.id` non seleziona niente. */
function geminiAdapter(deps: Pick<ModelResolverDeps, 'geminiFast'>): ModelAdapter {
	return {
		describe: () => descriptor('gemini', { vision: true, reasoning: true }),
		resolve(_ref: ModelRef, _context: AdapterContext): unknown {
			return deps.geminiFast().model;
		}
	};
}

/** xiaomi: ultimo ripiego, testuale. Vedi il GAP in testa: qui il client, non la scelta. */
function xiaomiAdapter(deps: Pick<ModelResolverDeps, 'xiaomiModelId' | 'xiaomiApiKey'>): ModelAdapter {
	return {
		describe: () => descriptor('xiaomi', { vision: false, reasoning: false }),
		resolve(_ref: ModelRef, _context: AdapterContext): unknown {
			if (!deps.xiaomiApiKey) {
				throw new Error("models: 'xiaomi' non risolvibile — manca XIAOMI_MIMO_API_KEY");
			}
			const xiaomi = createOpenAI({
				baseURL: 'https://api.xiaomimimo.com/v1',
				apiKey: deps.xiaomiApiKey
			});
			return xiaomi.chat(deps.xiaomiModelId);
		}
	};
}

/** Una chiave per provider. Esportato per i test dell'incapsulamento. */
export function createModelAdapters(deps: ModelResolverDeps): Registry<ModelAdapter> {
	const registry = new Registry<ModelAdapter>('model-adapter');
	registry.register('kie', kieAdapter(deps));
	registry.register('deepseek', deepseekAdapter(deps));
	registry.register('gemini', geminiAdapter(deps));
	registry.register('xiaomi', xiaomiAdapter(deps));
	return registry;
}

/** Da `ModelRef` al `LanguageModel` dell'SDK, via il registro sopra. */
export function createModelResolver(deps: ModelResolverDeps): (ref: ModelRef, context: AdapterContext) => unknown {
	const registry = createModelAdapters(deps);
	return (ref, context) => registry.resolve(ref.provider).resolve(ref, context);
}
