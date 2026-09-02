import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createChatTools } from '$lib/agent/tools/index';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';

export interface AnalystPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
}

const MAP: Record<string, { source: string; description: string; effectful: boolean; consequential: boolean }> = {
	analyst_read_strategy: {
		source: 'read_strategy',
		effectful: false,
		consequential: false,
		description:
			'Read the brand strategy in one call: competitive research report, positioning, the active editorial plan (voice, cadence, platform mix, weeks) and the active GTM plan (horizon, objective, current phase). This is the plan every recommendation must be compared against — read it before proposing a change to it.'
	},
	analyst_list_posts: {
		source: 'read_posts',
		effectful: false,
		consequential: false,
		description:
			'List brand posts as real rows — status, platform, caption, scheduled slot, media_origin, and the media_review verdict (ship/fix/kill) when one exists. This is the grounded source for anything said about what the brand published: never quote a post, a title or a count that did not come back from here.'
	},
	analyst_post_patterns: {
		source: 'analyze_post_people',
		effectful: false,
		consequential: false,
		description:
			'Analyze the synced post history (up to 200 published posts) for recurring people, best posting times, top formats and engagement patterns. Needs synced social history — with none it returns an error naming that, which is the honest answer, not a retry.'
	},
	analyst_read_leads: {
		source: 'read_leads',
		effectful: false,
		consequential: false,
		description:
			'Read leads: real online conversations (Reddit/Threads/X) where the product or category is discussed, with the drafted comment/DM suggestions. Use them for the audience language, questions and objections behind a recommendation.'
	},
	analyst_run_review: {
		source: 'run_analytics_review',
		effectful: true,
		consequential: true,
		description:
			'Run the analytics review: it reads social/blog/SEO performance and proposes GTM + editorial plan revisions for owner approval. Runs in the BACKGROUND — this call returns a job id immediately and the result lands later as a new message. Say one line and end the turn; never report the review as finished from this call.'
	},
	analyst_update_gtm_plan: {
		source: 'update_gtm_plan',
		effectful: true,
		consequential: true,
		description:
			'Update the active GTM plan: objective, a phase name/objective, platform weights, or pillars. Refused when the brand has no active GTM plan. This is the only write in this trade — you do not create posts, you brief the other specialists through the plan.'
	}
};

export function createAnalystPlugin(deps: AnalystPluginDeps): ToolPlugin {
	const { supabase, brandId, userId, threadId, locale } = deps;
	const chatTools = createChatTools(
		supabase,
		brandId,
		'Europe/Rome',
		userId,
		'',
		locale ?? 'en',
		threadId ?? undefined
	) as ChatToolsRecord;

	const tools: ToolSpec[] = Object.entries(MAP).map(([name, m]) => ({
		name,
		description: m.description,
		effectful: m.effectful,
		consequential: m.consequential,
		inputSchema: jsonSchemaOf(chatTools[m.source])
	}));

	return {
		name: 'analyst',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			const m = MAP[call.name];
			if (!m) return { content: [{ type: 'text', text: `analyst plugin: unknown tool '${call.name}'` }], isError: true };
			return execChatTool(chatTools[m.source], call.name, call.args, ctx.runId, ctx.signal);
		}
	};
}
