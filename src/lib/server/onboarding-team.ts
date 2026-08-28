import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueQueuedChatTurn, kickChatQueueWork } from '$lib/server/chat/queue';
import { getOrCreateTeamThread } from '$lib/server/team-ignition';
import { saveMessages } from '$lib/server/chat/persistence';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { TeamAgentId } from '$lib/agent-owners';

/**
 * IL TEAM SI PRESENTA (2026-08-28).
 *
 * Fino a oggi solo l'Analyst contattava l'utente nuovo: l'eval:ux lo misura come FAIL
 * (criterio team-of-agents). Il contatto degli specialisti ora è una PROMESSA DEL PRODOTTO,
 * non un comportamento sperato del modello: quando il primo turno di setup chiude, il server
 * semina deterministicamente il primo contatto degli agenti mappati sul piano del brand.
 *
 * Meccanica: la ricetta di open_session_with_user — riga di apertura ASSISTANT firmata
 * (chat_messages.name = agente) + turno di continuazione accodato con agente forzato e brief
 * server-side. L'incarico sta nel brief (mai nel thread): l'utente non ha scritto nulla qui,
 * e una riga user mai scritta da lui sarebbe un falso nel transcript.
 */

type PlanKey = 'go' | 'starter' | 'pro';

/** Piano → specialisti che si presentano. Il default copre ogni piano sconosciuto o assente. */
const ONBOARDING_TEAM_CONTACTS: Record<PlanKey | 'default', readonly TeamAgentId[]> = {
	default: ['content', 'web'],
	go: ['content', 'web'],
	starter: ['content', 'web', 'ugc'],
	pro: ['content', 'web', 'motion']
};

export function teamContactsForPlan(plan: string | null | undefined): readonly TeamAgentId[] {
	const key = String(plan ?? '')
		.trim()
		.toLowerCase() as PlanKey;
	return ONBOARDING_TEAM_CONTACTS[key] ?? ONBOARDING_TEAM_CONTACTS.default;
}

// La riga di apertura visibile: dichiara il mestiere e la prima azione che parte SUBITO — mai un
// saluto. it/en completi; gli altri locale cadono sull'inglese (stessa scelta di team-ignition).
const CONTACT_OPENERS: Record<TeamAgentId, Record<'en' | 'it', string> | null> = {
	content: {
		it: 'Sono il tuo Content Creator: i contenuti li faccio io. Parto subito: studio il brand e ti metto davanti le prime idee concrete.',
		en: "I'm your Content Creator: the content is my job. Starting now — I'm studying the brand and putting concrete first ideas in front of you."
	},
	web: {
		it: 'Sono il tuo Web Specialist: SEO, visibilità sulle AI e il sito sono miei. Lancio subito l’audit e ti porto il numero che conta.',
		en: "I'm your Web Specialist: SEO, AI visibility and the site are mine. Kicking off the audit now — you'll get the one number that matters."
	},
	ugc: {
		it: 'Sono la tua UGC Specialist: contenuti che sembrano fatti da persone vere. Preparo due concetti e ti dico di che materiale ho bisogno.',
		en: "I'm your UGC Specialist: content that looks made by real people. Preparing two concepts and telling you exactly what raw material I need."
	},
	motion: {
		it: 'Sono il tuo Motion Specialist: i video del brand sono miei. Preparo due concept e ti dico da dove partiamo.',
		en: "I'm your Motion Specialist: the brand's videos are mine. Preparing two concepts and where we start."
	},
	analyst: null,
	auto: null
};

function contactOpener(agent: TeamAgentId, locale: string): string | null {
	const opener = CONTACT_OPENERS[agent];
	if (!opener) return null;
	return locale === 'it' ? opener.it : opener.en;
}

export type ContactBriefInput = {
	brandName: string;
	website: string | null;
	plan: string | null | undefined;
	locale: string;
};

const FIRST_ACTION: Record<TeamAgentId, string> = {
	content: `Read the brand kit (read_brand_kit) and the editorial plan if one exists (read_plan). Put your first TWO content ideas on the table with save_disruptive_idea — one card each: a real title, a real angle, a real format grounded in what you just read. "Educational posts" is a category, not an idea. Close with ONE line on what you will produce first and when.`,
	web: `Run the SEO/GEO audit of the site (run_seo_geo_audit). Report the SINGLE headline number, what it means for their distribution, and your number one recommendation with its priority — three lines maximum. No website: say in one line what you need instead and stop.`,
	ugc: `Read the brand kit (read_brand_kit). Propose TWO UGC concepts with save_disruptive_idea — real product angle, real format ("founder talking head", "unboxing", "day in the life"). Close with ONE line asking what raw material they can give you (products, faces, workplace).`,
	motion: `Read the brand kit (read_brand_kit). Propose TWO motion video concepts with save_disruptive_idea — hook, format, length. Close with ONE line on which one you would make first and why.`,
	analyst: '',
	auto: ''
};

export function buildOnboardingContactBrief(agent: TeamAgentId, input: ContactBriefInput): string {
	const language = input.locale === 'it' ? 'Italian' : 'English';
	const site = input.website?.trim() || '(no website yet)';
	return `## TEAM CONTACT TURN (server-side brief)
The brand "${input.brandName}" (${site}) was just created. The Analyst is running the onboarding setup in another thread — do NOT redo it and do NOT wait for it. You are starting YOUR job in your own thread: your visible opening line is already there, this brief is your task. Write in ${language}.

## HOW YOU WRITE
1. AT MOST 4 SHORT LINES OF TEXT PER TURN — everything longer belongs in a card.
2. NEVER NARRATE YOUR PROCESS ("I'm checking...", "let me first..."): the action chips tell it already.
3. NEVER CLAIM WORK A TOOL DID NOT CONFIRM: the cards are the proof.
4. NEVER EXPLAIN THE PLUMBING: no tools, servers, threads, agents-internal names in front of the user.

## YOUR FIRST ACTION — DO IT NOW
${FIRST_ACTION[agent]}`;
}

/** Già contattato se un turno è in volo su quel thread o una firma sua esiste. */
async function teamThreadContacted(admin: SupabaseClient, threadId: string, agentKey: string): Promise<boolean> {
	const [{ data: jobs }, { data: msgs }] = await Promise.all([
		admin
			.from('chat_jobs')
			.select('id')
			.eq('thread_id', threadId)
			.eq('tool_name', 'chat_response')
			.in('status', ['pending', 'running'])
			.limit(1),
		admin
			.from('chat_messages')
			.select('id')
			.eq('thread_id', threadId)
			.eq('role', 'assistant')
			.eq('name', agentKey)
			.limit(1)
	]);
	return !!(jobs?.length || msgs?.length);
}

export async function igniteOnboardingTeam(
	admin: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		brandName: string;
		website: string | null;
		plan: string | null | undefined;
		locale: string;
		origin: string;
	}
): Promise<void> {
	try {
		for (const agent of teamContactsForPlan(opts.plan)) {
			const thread = await getOrCreateTeamThread(admin, opts.brandId, agent);
			if (!thread) continue;
			if (await teamThreadContacted(admin, thread.threadId, agent)) continue;

			const opener = contactOpener(agent, thread.locale);
			if (opener) {
				await saveMessages(
					admin,
					opts.brandId,
					thread.userId,
					[{ role: 'assistant', content: opener }],
					thread.threadId,
					{ speaker: agent }
				);
			}
			await enqueueQueuedChatTurn(admin, {
				brandId: opts.brandId,
				userId: thread.userId,
				threadId: thread.threadId,
				userMessage: '',
				locale: bilingualNoticeLocale(opts.locale),
				origin: opts.origin,
				agent,
				speaker: agent,
				continuation: true,
				userMessageSaved: true,
				brief: buildOnboardingContactBrief(agent, {
					brandName: opts.brandName,
					website: opts.website,
					plan: opts.plan,
					locale: opts.locale
				})
			});
		}
		if (opts.origin) void kickChatQueueWork(opts.origin);
	} catch (e) {
		console.warn('[onboarding-team] contact failed:', e instanceof Error ? e.message : e);
	}
}
