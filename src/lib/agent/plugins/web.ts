/**
 * IL PLUGIN WEB — blog + SEO/GEO, sulla stessa strada della chat: `chat/tools.ts` per gli
 * articoli e l'audit, `dataforseo-tools.ts` per i 7 `dfs_*` (già dentro `createChatTools`, che li
 * spreadava — vedi `...dataForSeoTools` in tools.ts — quindi non serve costruirli una seconda
 * volta). Avvolti da `chat-bridge.ts`: stesso schema Zod, stessa `execute`, stessi gate.
 *
 * Regola di prodotto ereditata, non riscritta: `schedule_article` non mette MAI status
 * 'published' — solo 'approved' auto-pubblica (dal cron del blog), ed è già così nel tool vero;
 * questo plugin non tocca quella scelta, la eredita chiamando lo stesso codice.
 *
 * I `dfs_*` sono esposti come `web_dfs_*` iterando `DATAFORSEO_CHAT_TOOL_KEYS` invece di
 * ridichiararli uno per uno — 7 tool, stessa description del tool vero, mai duplicati a mano
 * (scelta dichiarata dal mandato: "esponili as-is").
 *
 * Namespace `web_*`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createChatTools } from '$lib/server/chat/tools';
import { DATAFORSEO_CHAT_TOOL_KEYS } from '$lib/server/dataforseo-tools';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';

export interface WebPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
}

const BLOG_MAP: Record<string, { source: string; description: string; requiresMode?: ToolSpec['requiresMode']; consequential: boolean }> = {
	web_list_articles: {
		source: 'list_articles',
		consequential: false,
		description:
			'List the brand\'s blog articles with status and schedule. draft = written, awaiting review. planned = title-only placeholder, body not written (write with web_write_planned_article). approved = scheduled, auto-publishes at scheduled_for. published = live.'
	},
	web_read_article: {
		source: 'read_article',
		consequential: false,
		description: 'Read a blog article in full: title, meta title/description, markdown body, status, schedule, cover image. Read before editing or optimizing.'
	},
	web_update_article: {
		source: 'update_article',
		requiresMode: 'agent',
		consequential: true,
		description: 'Edit a blog article: title, meta title, meta description, and/or the full markdown body (a full replacement, not a diff). Never touches status or schedule — use web_schedule_article for that.'
	},
	web_schedule_article: {
		source: 'schedule_article',
		requiresMode: 'agent',
		consequential: true,
		description:
			'Schedule, reschedule, or unschedule a blog article. With a datetime: sets scheduled_for and marks it "approved" — ONLY "approved" ever auto-publishes, this tool never sets status to "published" directly. Without a datetime: clears the schedule back to a plain draft (refused on a "planned" placeholder — those need a slot). Refuses on an already-published article.'
	},
	web_optimize_article: {
		source: 'optimize_article',
		requiresMode: 'agent',
		consequential: true,
		description:
			'Run the quality-optimization pass on a blog article: web-grounds real sources/statistics, weaves in internal links, tightens structure and meta, adds on-brand images. Takes 1-2 min. No-op if the article already scores >= 90.'
	},
	web_generate_article_cover: {
		source: 'generate_article_cover',
		requiresMode: 'agent',
		consequential: true,
		description: "Generate a new on-brand AI cover image for a blog article and set it as the article's cover. ~30s."
	},
	web_generate_article_images: {
		source: 'generate_article_images',
		requiresMode: 'agent',
		consequential: true,
		description: "Generate a few on-brand images and splice them into a blog article's body as in-article illustrations. ~1 min."
	},
	web_write_planned_article: {
		source: 'write_planned_article',
		requiresMode: 'agent',
		consequential: true,
		description: 'Write the full article for a "planned" placeholder (title-only slot from the month plan), keeping its calendar slot. ~1-2 min. Result is a draft — schedule or edit it after.'
	},
	web_seo_audit: {
		source: 'run_seo_geo_audit',
		requiresMode: 'plan',
		consequential: true,
		description:
			'Run a fresh SEO & GEO audit of the brand website (technical crawl + on-page content + AI citation share-of-voice). Runs in the BACKGROUND — this call returns a job id immediately, NOT the audit; the result lands later. Call web_read_seo_audit after to read the numbers, do not assume this call finished the work.'
	},
	web_read_seo_audit: {
		source: 'read_seo_geo_audit',
		consequential: false,
		description: 'Read the latest SEO & GEO audit: technical score, top issues, on-page summary, AI share-of-voice, and category questions where the brand is NOT cited (with which competitors ARE). Call web_seo_audit first if none exists yet.'
	}
};

export function createWebPlugin(deps: WebPluginDeps): ToolPlugin {
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

	const map: Record<string, string> = {};
	const tools: ToolSpec[] = [];

	for (const [name, m] of Object.entries(BLOG_MAP)) {
		if (!chatTools[m.source]) continue; // richiede estrazione? no: assente solo se createChatTools cambia forma
		map[name] = m.source;
		tools.push({ name, description: m.description, requiresMode: m.requiresMode, consequential: m.consequential, inputSchema: jsonSchemaOf(chatTools[m.source]) });
	}

	// I 7 dfs_* diventano web_dfs_* — stesso schema, stessa description, stessa execute.
	for (const key of DATAFORSEO_CHAT_TOOL_KEYS) {
		const t = chatTools[key];
		if (!t) continue; // dataforseoConfigured() false in questo env: createDataForSeoTools torna {}
		const name = `web_${key}`;
		map[name] = key;
		tools.push({ name, description: String(t.description ?? key), consequential: false, inputSchema: jsonSchemaOf(t) });
	}

	return {
		name: 'web',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			const source = map[call.name];
			if (!source) return { content: [{ type: 'text', text: `web plugin: unknown tool '${call.name}'` }], isError: true };
			return execChatTool(chatTools[source], call.name, call.args, ctx.runId, ctx.signal);
		}
	};
}
