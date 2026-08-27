import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolPlugin } from '../kit';
import { createMotionPlugin } from './motion';
import { createContentPlugin } from './content';
import { createUgcPlugin } from './ugc';
import { createWebPlugin } from './web';
import { createAnalystPlugin } from './analyst';
import { createGroundingPlugin } from './grounding';
import { createNotifyPlugin } from './notify';

export type KitPluginDeps = {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId: string;
	locale: 'en' | 'it';
	remainingMs?: () => number;
	/** Serve a chi accoda lavoro in background: il drain si sveglia via HTTP. */
	origin?: string;
};

const TRADE: Record<string, (deps: KitPluginDeps) => ToolPlugin> = {
	motion: (deps) => createMotionPlugin(deps),
	content: (deps) => createContentPlugin(deps),
	ugc: (deps) => createUgcPlugin(deps),
	web: (deps) => createWebPlugin(deps),
	analyst: (deps) => createAnalystPlugin(deps)
};

export function tradePluginFor(specId: string, deps: KitPluginDeps): ToolPlugin | null {
	const make = TRADE[specId];
	return make ? make(deps) : null;
}

export function kitPluginsFor(specId: string, deps: KitPluginDeps): ToolPlugin[] {
	const trade = tradePluginFor(specId, deps);
	// Fondare quello che si dice e avvisare l'utente fuori dalla chat non sono mestieri: chi ha un
	// mestiere ha anche questi due.
	return trade ? [trade, createGroundingPlugin(deps), createNotifyPlugin(deps)] : [];
}
