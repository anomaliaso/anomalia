/**
 * The reads every agent needs and only the brand chat had.
 *
 * WHY THIS EXISTS. Motion Video, the Media Generator and the UGC planner are the three agents that
 * actually make the work, and each was assembled by hand from whatever its author needed that day.
 * The result: the Media Generator and the UGC planner could look up what the product does
 * (`read_brand_studio`, `read_knowledge`) and Motion Video could not — so the agent building a
 * LAUNCH video knew the palette and the logo and had no way to find out what was being launched.
 * None of the three could read the weekly market catalog or check a fact on the web, both of which
 * the brand chat has had for months.
 *
 * The other half of the problem is that the two tools two of them DID have were declared twice,
 * separately, with drifting descriptions. `createMediaLibraryTools` already solved that shape for
 * the media library; this is the same move for brand context. One definition, spread wherever it is
 * needed, so a change lands everywhere at once.
 *
 * READS ONLY, ON PURPOSE. Parity here means the CONTEXT surface, not the whole chat. The chat can
 * also approve posts, publish, rewrite the brand kit and read billing — an agent whose job is to
 * assemble a composition has no business holding those, and handing them over would turn a
 * mis-parsed brief into a published post. Anything that writes stays where it is.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

export const BRAND_CONTEXT_TOOL_NAMES = [
	'read_brand_studio',
	'read_knowledge',
	'read_market_references',
	'search_web'
] as const;
export type BrandContextToolName = (typeof BRAND_CONTEXT_TOOL_NAMES)[number];

/** Web searches per turn. Same ceiling the brand chat has always used. */
export const MAX_AGENT_WEB_SEARCHES = 5;

export type BrandContextToolsOptions = {
	supabase: SupabaseClient;
	brandId: string;
	/**
	 * Which of the four to build. Defaults to all.
	 * The brand chat takes only the two it lacks — it already has finer-grained reads for the rest,
	 * and a second, coarser way to ask the same question is a cost, not a capability.
	 */
	include?: readonly BrandContextToolName[];
	/**
	 * Optional per-call wrapper (the UGC planner streams a tool chip for every read). Without it the
	 * execute runs bare.
	 */
	wrap?: <T>(toolName: string, run: () => Promise<T>) => Promise<T>;
};

export function createBrandContextTools(opts: BrandContextToolsOptions): ToolSet {
	const { supabase, brandId } = opts;
	const include = new Set<BrandContextToolName>(opts.include ?? BRAND_CONTEXT_TOOL_NAMES);
	const run = <T>(name: string, fn: () => Promise<T>): Promise<T> =>
		opts.wrap ? opts.wrap(name, fn) : fn();
	let webSearchesUsed = 0;

	const all = {
		read_brand_studio: tool({
			description:
				'Read Studio brand kit + products + people (free). Call before writing copy, spoken scripts or product claims so what you say about the product is true.',
			inputSchema: z.object({}),
			execute: async () =>
				run('read_brand_studio', async () => {
					const { readBrandStudioForAgent } = await import('$lib/server/strategy-agent-reads');
					return readBrandStudioForAgent(supabase, brandId);
				})
		}),

		read_knowledge: tool({
			description:
				'Brand notes and documents (free). Use to clarify a feature, a claim or a launch detail the brief only gestures at.',
			inputSchema: z.object({
				query: z.string().optional(),
				kind: z.enum(['note', 'document', 'image']).optional(),
				limit: z.number().int().min(1).max(40).optional()
			}),
			execute: async (input: { query?: string; kind?: 'note' | 'document' | 'image'; limit?: number }) =>
				run('read_knowledge', async () => {
					const { readKnowledgeForAgent } = await import('$lib/server/strategy-agent-reads');
					return readKnowledgeForAgent(supabase, brandId, input);
				})
		}),

		read_market_references: tool({
			description:
				'Read the weekly market format/hook catalog distilled from competitor social posts (video-first). Includes signed thumbnail_url when archived — use those URLs as image_urls / reference_image_urls for visual inspiration (adapt formats, never copy). Null if not refreshed yet.',
			inputSchema: z.object({}),
			execute: async () =>
				run('read_market_references', async () => {
					const { loadMarketReferences, formatMarketBrief, FRESH_DAYS } = await import(
						'$lib/server/market-references'
					);
					const { signKnowledgePaths } = await import('$lib/server/media-archive');
					const row = await loadMarketReferences(supabase, brandId);
					if (!row) {
						return {
							references: null,
							hint: 'No market references yet — wait for the weekly refresh or refresh from Competitors.'
						};
					}
					const paths = row.references
						.slice(0, 12)
						.map((r) => r.archivedPath ?? '')
						.filter(Boolean);
					const signed = paths.length
						? await signKnowledgePaths(supabase, paths).catch(() => new Map<string, string>())
						: new Map<string, string>();
					return {
						summary: row.summary,
						catalog: row.catalog,
						references: row.references.slice(0, 12).map((r) => ({
							competitor: r.competitor,
							platform: r.platform,
							mediaType: r.mediaType,
							engagement: r.engagement,
							format: r.format,
							hook: r.hook,
							angle: r.angle,
							copyable_pattern: r.copyable_pattern,
							content: r.content ? String(r.content).slice(0, 200) : null,
							thumbnail_url:
								(r.archivedPath ? signed.get(r.archivedPath) : null) ?? r.thumbnailUrl ?? null
						})),
						sources: row.sources,
						updated_at: row.updated_at,
						freshDays: FRESH_DAYS,
						brief: formatMarketBrief(row),
						hint: 'Pass thumbnail_url values as image_urls on design_graphic / create_post(graphic_brief) or reference_image_urls on generate_image for visual reference — inspire, do not clone.'
					};
				})
		}),

		search_web: tool({
			description: `Ricerca web con risposta fondata e citazioni reali. Usare SOLO quando le letture DB non bastano: notizie, dati di mercato, verifiche esterne. Costo per chiamata; max ${MAX_AGENT_WEB_SEARCHES} ricerche per turno.`,
			inputSchema: z.object({
				query: z.string().min(3).describe('Search query')
			}),
			execute: async ({ query }: { query: string }) => {
				if (webSearchesUsed >= MAX_AGENT_WEB_SEARCHES) {
					return { error: `Limite ricerche web per turno raggiunto (max ${MAX_AGENT_WEB_SEARCHES})` };
				}
				return run('search_web', async () => {
					// Full grounding chain: Google grounding FIRST, then DeepSeek/Exa/Tavily. Never gated
					// on one provider's key — that used to refuse the tool outright when only DeepSeek
					// had one.
					const { groundedText } = await import('$lib/server/research');
					webSearchesUsed++;
					const { text, citations } = await groundedText(query, undefined, {
						brandId
					});
					if (!text && !citations.length) return { error: 'Nessun risultato web', query };
					return { text, citations, query };
				});
			}
		})
	};

	const out: ToolSet = {};
	for (const name of BRAND_CONTEXT_TOOL_NAMES) {
		if (include.has(name)) out[name] = all[name];
	}
	return out;
}

/** Prompt block naming the reads, so they are weighted rather than merely available. */
export function brandContextPromptSection(include?: readonly BrandContextToolName[]): string {
	const on = new Set<BrandContextToolName>(include ?? BRAND_CONTEXT_TOOL_NAMES);
	const lines: string[] = ['BRAND CONTEXT (free reads — use them before inventing anything):'];
	if (on.has('read_brand_studio'))
		lines.push(
			'- read_brand_studio: brand kit, products, people. Call it before writing any claim about what the product IS or DOES. Never describe a feature you have not read.'
		);
	if (on.has('read_knowledge'))
		lines.push('- read_knowledge: brand notes and documents — launch details, positioning, specifics the brief only gestures at.');
	if (on.has('read_market_references'))
		lines.push('- read_market_references: the weekly catalog of formats, hooks and angles distilled from competitor posts.');
	if (on.has('search_web'))
		lines.push(`- search_web: grounded web answer with citations. Only when the DB reads are not enough; costs money, max ${MAX_AGENT_WEB_SEARCHES} per turn.`);
	return lines.length > 1 ? lines.join('\n') : '';
}
