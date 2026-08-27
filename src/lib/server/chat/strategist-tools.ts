import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `propose_next_cycle` — il rinnovo del piano editoriale come TOOL, non come blocco inline dello
 * scheduler.
 *
 * PERCHÉ ESISTE. Lo Stratega promosso a turno pieno deve poter "proporre il prossimo ciclo quando
 * è il momento" — ma nella chat non c'era nessun tool che scrivesse una proposta di piano:
 * `update_editorial_plan` patcha il piano ATTIVO e `generate_editorial_plan` propone e ATTIVA
 * subito (semantica da onboarding, senza finestra di approvazione). Il rollover invece è
 * esattamente una PROPOSTA: status `proposed`, source `rollover`, e l'attivazione resta all'utente
 * — o al fallback deterministico dello scheduler quando la proposta scade (quella è consegna, non
 * ragionamento, e NON sta qui).
 *
 * Montato in coda per i turni schedulati (vedi queue.ts): è lì che lo Stratega gira. Il tool non
 * manda email — il turno ha `notify_user` e decide da sé come avvisare, che è il punto della
 * promozione.
 */
export function withStrategistTools<T extends Record<string, unknown>>(
	tools: T,
	ctx: { supabase: SupabaseClient; brandId: string; locale: string }
): T & Record<string, unknown> {
	const { supabase, brandId } = ctx;
	return {
		...tools,
		propose_next_cycle: tool({
			description:
				'Propose the NEXT 4-week editorial cycle from the ending one (status: proposed — the owner still approves; nothing activates now). Use when the current cycle is in its final week or has lapsed with no proposal. Pass optional guidance to steer the new cycle. Returns the proposal id; then tell the owner (notify_user) with a link to /editorial. Errors if a proposed plan already exists or no active plan is running.',
			inputSchema: z.object({
				guidance: z
					.string()
					.optional()
					.describe('Optional strategic steer for the next cycle (what to double down on / retire).')
			}),
			execute: async ({ guidance }: { guidance?: string }) => {
				const { loadActivePlan, proposeNextCycle, cadenceAllowed } = await import(
					'$lib/server/editorial-plan'
				);
				const current = await loadActivePlan(supabase, brandId);
				if (!current?.id) return { error: 'No active editorial plan — nothing to roll over.' };
				const { data: proposed } = await supabase
					.from('editorial_plans')
					.select('id')
					.eq('brand_id', brandId)
					.eq('status', 'proposed')
					.limit(1);
				if (proposed?.length) {
					return {
						error: 'A proposed plan already exists — the owner has not reviewed it yet. Do not stack another.'
					};
				}

				const { plannerProfile, planEvidence } = await import('$lib/server/chat/async-jobs');
				const { activeGtmBrief } = await import('$lib/server/gtm');
				const { loadApprovedRubrics } = await import('$lib/server/rubrics');
				const { genaiClient } = await import('$lib/server/research');
				const { localeLanguageName } = await import('$lib/i18n/locale');
				const { data: brandRow } = await supabase
					.from('brands')
					.select('target_platforms, plan, timezone')
					.eq('id', brandId)
					.maybeSingle();
				const tz = (brandRow?.timezone as string) || 'Europe/Rome';
				const [profile, evidence, gtmBrief, rubrics] = await Promise.all([
					plannerProfile(supabase, brandId),
					planEvidence(supabase, brandId),
					activeGtmBrief(supabase, brandId, tz).catch(() => ''),
					loadApprovedRubrics(supabase, brandId).catch(() => [])
				]);
				const next = await proposeNextCycle(genaiClient(), current, profile, {
					platforms: Array.isArray(brandRow?.target_platforms)
						? (brandRow!.target_platforms as string[])
						: [],
					allowedCadences: cadenceAllowed((brandRow?.plan as string | null) ?? null),
					outputLanguage: localeLanguageName(ctx.locale),
					strategyBrief: [gtmBrief, guidance?.trim(), evidence.strategyBrief]
						.filter(Boolean)
						.join('\n\n'),
					benchmark: evidence.benchmark,
					topPosts: evidence.topPosts,
					rubrics,
					supabase,
					brandId,
					planTier: (brandRow?.plan as string | null) ?? null,
					timezone: tz
				});
				const { data: inserted, error } = await supabase
					.from('editorial_plans')
					.insert({
						brand_id: brandId,
						status: 'proposed',
						strategy: next.strategy || null,
						voice: next.voice,
						cadence: next.cadence,
						platform_mix: next.platform_mix,
						gtm: next.gtm,
						weeks: next.weeks,
						parent_id: current.id,
						source: 'rollover'
					})
					.select('id')
					.maybeSingle();
				if (error || !inserted?.id) return { error: error?.message ?? 'insert_failed' };
				return {
					success: true,
					proposal_id: inserted.id,
					weeks: (next.weeks ?? []).map((w) => ({ theme: w.theme, focus: w.focus })),
					instruction:
						'Proposal saved (NOT active). Notify the owner with the /editorial link so they can review; if they do not act, the scheduler auto-activates it when the current cycle lapses.'
				};
			}
		})
	};
}
