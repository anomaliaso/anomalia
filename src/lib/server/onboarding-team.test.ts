import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import {
	buildOnboardingContactBrief,
	igniteOnboardingTeam,
	teamContactsForPlan
} from './onboarding-team';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function harness(seed: { threads?: Row[]; messages?: Row[]; jobs?: Row[] } = {}) {
	const kit = createTestSupabase({
		chat_threads: seed.threads ?? [],
		chat_messages: seed.messages ?? [],
		chat_jobs: seed.jobs ?? [],
		organizations: [{ id: 'org1', owner_id: 'u1' }],
		brands: [{ id: 'b1', org_id: 'org1' }],
		profiles: [{ id: 'u1', locale: 'it' }]
	});
	return kit;
}

const IGNITE_OPTS = {
	brandId: 'b1',
	userId: 'u1',
	brandName: 'Latina Coffee',
	website: 'https://latinacoffee.it',
	locale: 'it',
	origin: 'https://app.example'
};

describe('teamContactsForPlan', () => {
	it('mappa i piani noti e cade sul default per tutto il resto', () => {
		expect(teamContactsForPlan('go')).toEqual(['content', 'web']);
		expect(teamContactsForPlan('starter')).toEqual(['content', 'web', 'ugc']);
		expect(teamContactsForPlan('pro')).toEqual(['content', 'web', 'motion']);
		expect(teamContactsForPlan(null)).toEqual(['content', 'web']);
		expect(teamContactsForPlan('piano inventato')).toEqual(['content', 'web']);
	});
});

describe('igniteOnboardingTeam', () => {
	it('sema apertura firmata + turno di continuazione per ogni contatto del piano', async () => {
		const kit = harness();
		await igniteOnboardingTeam(kit.client, { ...IGNITE_OPTS, plan: 'starter' });

		const jobs = kit.tables.get('chat_jobs')!;
		expect(jobs).toHaveLength(3);

		const web = jobs.find((j) => j.input_params.agent === 'web');
		expect(web).toBeTruthy();
		expect(web!.input_params.continuation).toBe(true);
		expect(web!.input_params.user_message_saved).toBe(true);
		expect(web!.input_params.speaker).toBe('web');
		expect(web!.input_params.brief).toContain('TEAM CONTACT TURN');
		expect(web!.input_params.brief).toContain('run_seo_geo_audit');

		const msgs = kit.tables.get('chat_messages')!;
		const openers = msgs.filter((m) => m.name);
		expect(openers).toHaveLength(3);
		expect(openers.every((m) => m.role === 'assistant')).toBe(true);
		expect(openers.find((m) => m.name === 'content')!.content).toContain('Content Creator');
	});

	it('è idempotente: firma o turno in volo, niente secondo contatto', async () => {
		const kit = harness({
			threads: [{ id: 'team-web', brand_id: 'b1', user_id: 'u1', agent: 'web', surface: 'team', surface_key: 'web' }],
			messages: [{ id: 'm1', thread_id: 'team-web', role: 'assistant', name: 'web', content: 'apertura' }]
		});
		await igniteOnboardingTeam(kit.client, { ...IGNITE_OPTS, plan: null });

		const jobs = kit.tables.get('chat_jobs')!;
		expect(jobs.some((j) => j.thread_id === 'team-web')).toBe(false);
		expect(jobs).toHaveLength(1);
		const only = jobs[0];
		expect(only.input_params.agent).toBe('content');
	});

	it('un turno già in volo basta a bloccare il doppione', async () => {
		const kit = harness({
			threads: [{ id: 'team-web', brand_id: 'b1', user_id: 'u1', agent: 'web', surface: 'team', surface_key: 'web' }],
			jobs: [
				{
					id: 'j1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 'team-web',
					tool_name: 'chat_response',
					status: 'running',
					input_params: {}
				}
			]
		});
		await igniteOnboardingTeam(kit.client, { ...IGNITE_OPTS, plan: null });

		// Il job pre-seedinato (in volo su web) basta: nessun secondo contatto su quel thread.
		const jobs = kit.tables.get('chat_jobs')!;
		expect(jobs.some((j) => j.thread_id === 'team-web' && j.input_params?.agent)).toBe(false);
	});
});

describe('buildOnboardingContactBrief', () => {
	it('porta lingua, brand e la prima azione del mestiere', () => {
		const brief = buildOnboardingContactBrief('content', {
			brandName: 'Latina Coffee',
			website: null,
			plan: 'go',
			locale: 'it'
		});
		expect(brief).toContain('Italian');
		expect(brief).toContain('Latina Coffee');
		expect(brief).toContain('save_disruptive_idea');
		expect(brief).not.toContain('undefined');
	});
});
