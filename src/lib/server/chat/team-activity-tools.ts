import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dmAgents, dmNames } from '$lib/chat-dm';
import { AGENTS, type AgentId } from './agents';

/**
 * GLI OCCHI DELLA SQUADRA.
 *
 * Un team che non si vede non è un team: senza questo tool un agente sa CHI sono i colleghi
 * (teamBlock) ma non COSA HANNO FATTO — e duplica il lavoro, o gli passa sopra. E un DM senza
 * risposta è una palla in corteo che nessuno guarda. Una chiamata restituisce le due metà della
 * coordinazione: l'ultimo report di ogni collega (dal suo diario, surface='team') e i DM dove la
 * palla sta a chi (l'ultima battuta col `speaker` dice chi deve muovere).
 */

const EXCERPT_CHARS = 240;
const MAX_ROWS = 8;

type Teammate = { key: string; name: string; journal_at: string | null; latest_report: string | null };
type Pending = { key: string; name: string; at: string | null; excerpt: string; thread_id: string };

const excerpt = (text: unknown) => String(text ?? '').slice(0, EXCERPT_CHARS);

export function createTeamActivityTools(ctx: {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	locale: string;
	/** Chi risponde, come chiave memoria (`content`, `custom:<uuid>`); null = il generalista. */
	memoryAgent: string | null;
}) {
	const me = ctx.memoryAgent || 'anomalia';

	async function execute() {
		const { supabase, brandId } = ctx;

		const customs = await supabase
			.from('custom_agents')
			.select('id, name')
			.eq('brand_id', brandId)
			.eq('enabled', true);
		const customList = ((customs.data ?? []) as Array<{ id: string; name: string }>).map((c) => ({
			key: `custom:${c.id}`,
			name: c.name
		}));

		const specialistKeys: AgentId[] = ['content', 'ugc', 'motion', 'web', 'analyst'];
		const labelOf = (key: string) =>
			customList.find((c) => c.key === key)?.name ??
			(specialistKeys.includes(key as AgentId)
				? AGENTS[key as AgentId].labels[itLocale() ? 'it' : 'en']
				: key);

		// Un solo giro su chat_threads: diari (surface='team') e DM (marker jsonb) insieme.
		const threadsRes = await supabase
			.from('chat_threads')
			.select('id, surface, surface_key, room_agents, updated_at')
			.eq('brand_id', brandId)
			.or('surface.eq.team,room_agents.neq.null');
		const allThreads = (threadsRes.data ?? []) as Array<Record<string, unknown>>;

		const journalThreads = allThreads.filter(
			(t) => t.surface === 'team' && typeof t.surface_key === 'string'
		);

		const myDms = allThreads.filter((t) => {
			const pair = dmAgents(t.room_agents);
			return pair?.includes(me) ?? false;
		});

		const threadIds = [...journalThreads, ...myDms].map((t) => String(t.id));
		const lastByThread = new Map<string, Record<string, unknown>>();
		if (threadIds.length) {
			const msgs = await supabase
				.from('chat_messages')
				.select('thread_id, role, speaker:name, content, created_at')
				.in('thread_id', threadIds)
				.order('created_at', { ascending: false })
				.limit(threadIds.length * 5);
			for (const m of (msgs.data ?? []) as Array<Record<string, unknown>>) {
				const tid = String(m.thread_id);
				if (!lastByThread.has(tid)) lastByThread.set(tid, m);
			}
		}

		const journalByKey = new Map(journalThreads.map((t) => [String(t.surface_key), t]));
		const teammates: Teammate[] = [
			...specialistKeys.filter((k) => k !== me),
			...customList.map((c) => c.key).filter((k) => k !== me)
		].map((key) => {
			const t = journalByKey.get(key);
			const last = t ? lastByThread.get(String(t.id)) : undefined;
			return {
				key,
				name: labelOf(key),
				journal_at: (t?.updated_at as string) ?? null,
				latest_report: last ? excerpt(last.content) : null
			};
		});
		teammates.sort((a, b) => (b.journal_at ?? '').localeCompare(a.journal_at ?? ''));

		const classify = (want: 'mine' | 'theirs'): Pending[] =>
			myDms
				.map((t): Pending | null => {
					const pair = dmAgents(t.room_agents)!;
					const other = pair[0] === me ? pair[1] : pair[0];
					const last = lastByThread.get(String(t.id));
					if (!last) return null;
					const speaker = typeof last.speaker === 'string' ? last.speaker : null;
					if (!speaker || (want === 'mine' ? speaker === me : speaker !== me)) return null;
					return {
						key: other,
						name: dmNames(t.room_agents)[other] ?? labelOf(other),
						at: (last.created_at as string) ?? null,
						excerpt: excerpt(last.content),
						thread_id: String(t.id)
					};
				})
				.filter((p): p is Pending => p !== null)
				.slice(0, MAX_ROWS);

		return {
			me,
			teammates,
			waiting_on_me: classify('mine'),
			waiting_on_them: classify('theirs'),
			hint:
				'waiting_on_me = a colleague wrote to you or answered you and you have not replied: answer there before starting overlapping work. Check latest_report before delegating or producing something a colleague may already have done.'
		};
	}

	function itLocale() {
		return ctx.locale.toLowerCase().startsWith('it');
	}

	return {
		team_activity: tool({
			description:
				'See your team: each specialist\u2019s latest work report (their journal) and the agent-to-agent conversations where someone is waiting on someone. Call it before starting work a colleague may already have done, before delegating, and when picking a thread back up after time away.',
			inputSchema: z.object({}),
			execute
		})
	};
}
