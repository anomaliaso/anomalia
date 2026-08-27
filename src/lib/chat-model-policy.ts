import { AgentModelPolicy, type AgentModelPolicy as ModelPreference } from '@anomalia/agent-contracts/contracts';
import type { ChatTier } from '$lib/chat-tiers';
import {
	TIER_DEFAULT_FAMILY,
	coerceThinking,
	modelFamily,
	type ModelFamilyId,
	type ThinkingLevel
} from '$lib/models/catalog';

export function turnModelFamily(
	threadModel?: unknown,
	customAgentModel?: unknown
): ModelPreference | null {
	const fromThread = parseModelPolicy(threadModel);
	if (fromThread) return fromThread;
	return parseModelPolicy(customAgentModel);
}

/**
 * La scelta del picker diventa la riga da salvare su chat_threads.model. Auto = null: il thread
 * torna alla risoluzione di default invece di restare incollato all'ultima famiglia scelta.
 */
export function policyForChoice(tier: ChatTier, thinking: unknown): ModelPreference | null {
	if (tier === 'auto') return null;
	const family = modelFamily(TIER_DEFAULT_FAMILY[tier]);
	return { family: family.id, thinking: coerceThinking(thinking, family) };
}

/** Il tier che nel picker rappresenta ogni famiglia; gemini-flash non ha un tier e non si ripristina. */
const TIER_BY_FAMILY: Partial<Record<ModelFamilyId, ChatTier>> = {
	luna: 'fast',
	grok: 'pro',
	'deepseek-pro': 'deepseek-pro',
	'gpt-terra': 'gpt-terra',
	'gpt-sol': 'gpt-sol'
};

function parseModelPolicy(raw: unknown): ModelPreference | null {
	const parsed = AgentModelPolicy.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

export function choiceForPolicy(raw: unknown): { tier: ChatTier; reasoning: ThinkingLevel } | null {
	const policy = parseModelPolicy(raw);
	const tier = policy ? TIER_BY_FAMILY[policy.family] : undefined;
	if (!policy || !tier) return null;
	return { tier, reasoning: coerceThinking(policy.thinking, modelFamily(policy.family)) };
}
