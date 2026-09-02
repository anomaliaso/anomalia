/**
 * Gli scenari di DURABILITÀ: non "l'agente risponde bene", ma "il lavoro non sparisce".
 *
 * Girano contro il database vero e contro il plpgsql vero — la presa del lease, il fence, la
 * chiusura recintata — che è precisamente ciò che nessun test con un finto client può verificare.
 * In questa sessione due difetti sono passati proprio di lì: una firma di funzione cambiata e un
 * reaper il cui contratto era cambiato sotto ai suoi test.
 *
 * Ogni scenario lavora su un brand usa e getta e lo distrugge nel `finally`. Uno scenario che non
 * gira NON è verde: esce con `unrun` e il motivo, stampato prima del giro.
 */
import { createAdminClient } from '$lib/server/supabase-admin';
import { claimRun, closeRunSaving } from '$lib/agent/run-store';
import { reapDeadKitRuns } from '$lib/server/agent-kit-recover';
// Il reaper importa la coda DINAMICAMENTE per non chiudere un ciclo. Sotto vite-node quel primo
// import ricarica il grafo a metà scenario e fa esplodere il giro: importarla qui la mette nel
// grafo prima che il giro cominci. Serve all'harness, non al prodotto.
import '$lib/server/chat/queue';
import { MAX_RUN_ATTEMPTS } from '$lib/server/chat/turn-limits';
import { loadThreadEvents, threadProjectionRows } from '$lib/server/chat/thread-events';
import { createFixture, destroyFixture, type Fixture } from './durability/fixture';

type Fact = { id: string; ok: boolean; detail: string };
type Scenario = { id: string; what: string; run: (fixture: Fixture) => Promise<Fact[]> };

const DEAD_HEARTBEAT_MS = 30 * 60_000;
const PARTIAL_TEXT = 'ho sistemato quattro articoli su dieci';
const REWRITTEN_TEXT = 'il turno intero, come lo vede chi riapre il thread';

const SCENARIOS: Scenario[] = [
	{
		id: 'turno-ucciso-si-riprende',
		what: 'un turno morto col lavoro dentro resta riprendibile e viene riaccodato, non sepolto',
		async run(fixture) {
			const admin = createAdminClient();
			const run = await seedDeadRun(fixture, 1);

			await reapDeadKitRuns(admin, { brandId: fixture.brandId });

			const after = await readRun(run.id);
			const jobs = await readJobs(fixture);
			const messages = await readAssistantMessages(fixture);
			return [
				fact('riga-riprendibile', after?.state === 'running', `stato ${after?.state}`),
				fact(
					'riaccodato-per-id',
					jobs.some((j) => j.input_params?.resume_run_id === run.id),
					`${jobs.length} lavori in coda`
				),
				fact('nessun-mezzo-messaggio', messages.length === 0, `${messages.length} messaggi assistant`)
			];
		}
	},
	{
		id: 'la-porta-chiusa-lascia-entrare-solo-chi-deve',
		what: 'il predicato di accesso, contro il plpgsql vero: approvato, invitato, nessuno dei due',
		async run(fixture) {
			const admin = createAdminClient();
			const { data: profile } = await admin
				.from('profiles')
				.select('email')
				.eq('id', fixture.userId)
				.maybeSingle();
			const email = String(profile?.email ?? '');

			// Si interroga `is_approved(uuid)` e non `can_enter()`: quest'ultima dipende dal flag
			// GLOBALE, e un eval che per girare deve chiudere il prodotto chiude fuori i clienti veri.
			const approved = async () => {
				const { data } = await admin.rpc('is_user_approved', { p_user: fixture.userId });
				return data === true;
			};

			await admin.from('profiles').update({ approved_at: null }).eq('id', fixture.userId);
			const iscrittoEBasta = await approved();

			const { data: invite } = await admin
				.from('brand_invites')
				.insert({
					brand_id: fixture.brandId,
					email,
					brand_name: 'Eval',
					invited_by: fixture.userId
				})
				.select('id')
				.single();
			const invitato = await approved();

			// Un invito scaduto non deve lasciare un limbo: dentro, senza niente da accettare.
			const scaduto = new Date(Date.now() - 8 * 24 * 3.6e6).toISOString();
			await admin.from('brand_invites').update({ created_at: scaduto }).eq('id', invite!.id);
			const invitoScaduto = await approved();

			await admin.from('brand_invites').delete().eq('id', invite!.id);
			await admin.from('profiles').update({ approved_at: new Date().toISOString() }).eq('id', fixture.userId);
			const dopoApprovazione = await approved();

			return [
				fact('iscritto-non-basta', iscrittoEBasta === false, `is_approved=${iscrittoEBasta}`),
				fact('invitato-entra', invitato === true, `is_approved=${invitato}`),
				fact('invito-scaduto-non-entra', invitoScaduto === false, `is_approved=${invitoScaduto}`),
				fact('approvato-entra', dopoApprovazione === true, `is_approved=${dopoApprovazione}`)
			];
		}
	},
	{
		id: 'finiti-i-tentativi-il-lavoro-non-sparisce',
		what: 'alla resa il parziale diventa un messaggio — il difetto che ha perso 25 turni veri',
		async run(fixture) {
			const admin = createAdminClient();
			const run = await seedDeadRun(fixture, MAX_RUN_ATTEMPTS);

			await reapDeadKitRuns(admin, { brandId: fixture.brandId });

			const after = await readRun(run.id);
			const messages = await readAssistantMessages(fixture);
			return [
				fact('run-chiuso', after?.state === 'aborted', `stato ${after?.state}`),
				fact('parziale-salvato', messages.length === 1, `${messages.length} messaggi assistant`),
				fact(
					'il-testo-e-quello-prodotto',
					JSON.stringify(messages[0] ?? {}).includes(PARTIAL_TEXT),
					'il messaggio porta il testo del parziale'
				)
			];
		}
	},
	{
		id: 'lo-zombie-non-deposita-un-doppione',
		what: 'dopo la presa, il worker sfrattato non scrive né messaggio né stato',
		async run(fixture) {
			const admin = createAdminClient();
			const run = await seedDeadRun(fixture, 1, { lease_owner: 'worker-vecchio', lease_fence: 7 });
			const stale = { owner: 'worker-vecchio', fence: 7 };

			const taken = await claimRun(admin, run.id, 'worker-nuovo', { ttlMs: 300_000 });
			const zombie = await closeRunSaving(
				admin,
				run.id,
				{ kind: 'finish', reason: 'reply' },
				{ content: 'risposta dello zombie' },
				stale
			);
			const owner = await closeRunSaving(
				admin,
				run.id,
				{ kind: 'finish', reason: 'reply' },
				{ content: 'risposta di chi tiene il lease' },
				{ owner: 'worker-nuovo', fence: taken?.fence ?? -1 }
			);

			const messages = await readAssistantMessages(fixture);
			return [
				fact('il-fence-cresce', taken?.fence === 8, `fence ${taken?.fence}`),
				fact('lo-zombie-non-chiude', zombie.closed === false, `closed ${zombie.closed}`),
				fact('chi-tiene-il-lease-chiude', owner.closed === true, `closed ${owner.closed}`),
				fact('un-solo-messaggio', messages.length === 1, `${messages.length} messaggi assistant`)
			];
		}
	},
	{
		id: 'il-turno-riscritto-non-sparisce',
		what: 'la riga dell’assistente nasce vuota e viene riscritta: il thread deve mostrare il turno intero',
		async run(fixture) {
			const admin = createAdminClient();
			const { data, error } = await admin
				.from('chat_messages')
				.insert({
					brand_id: fixture.brandId,
					user_id: fixture.userId,
					thread_id: fixture.threadId,
					role: 'assistant',
					content: ''
				})
				.select('id')
				.single();
			if (error) throw new Error(`seed del messaggio fallito — ${error.message}`);
			const messageId = (data as { id: string }).id;

			// Il battito riscrive la STESSA riga a ogni checkpoint: due giri, come in produzione.
			for (const text of ['a metà del lavoro', REWRITTEN_TEXT]) {
				const { error: patch } = await admin
					.from('chat_messages')
					.update({ content: text, reasoning: `${text} — pensiero`, tool_calls: [{ toolName: 'read_posts' }] })
					.eq('id', messageId);
				if (patch) throw new Error(`riscrittura fallita — ${patch.message}`);
			}

			const events = (await loadThreadEvents(admin, fixture.threadId)) ?? [];
			const projection = threadProjectionRows(events);
			const shown = (projection?.messages ?? []).find((m) => m.id === messageId) as
				| { content?: string; reasoning?: string }
				| undefined;

			return [
				fact('una-bolla-sola', (projection?.messages ?? []).filter((m) => m.id === messageId).length === 1, `${(projection?.messages ?? []).length} messaggi proiettati`),
				fact('il-testo-e-l-ultimo', shown?.content === REWRITTEN_TEXT, `contenuto proiettato: ${JSON.stringify(shown?.content ?? null)}`),
				fact('il-pensiero-arriva', Boolean(shown?.reasoning), `reasoning proiettato: ${shown?.reasoning ? 'sì' : 'no'}`),
				fact(
					'una-revisione-sola',
					events.filter((e) => e.source_key.startsWith(`message:${messageId}:r`)).length === 1,
					`${events.filter((e) => e.source_key.startsWith(`message:${messageId}:r`)).length} revisioni in log`
				)
			];
		}
	}
];

async function seedDeadRun(fixture: Fixture, attempt: number, extra: Record<string, unknown> = {}) {
	const admin = createAdminClient();
	const { data, error } = await admin
		.from('agent_kit_runs')
		.insert({
			brand_id: fixture.brandId,
			thread_id: fixture.threadId,
			user_id: fixture.userId,
			agent_id: 'content',
			state: 'running',
			attempt,
			partial: { text: PARTIAL_TEXT, tools: [], updatedAt: new Date().toISOString() },
			heartbeat_at: new Date(Date.now() - DEAD_HEARTBEAT_MS).toISOString(),
			created_at: new Date(Date.now() - 2 * DEAD_HEARTBEAT_MS).toISOString(),
			lease_until: new Date(Date.now() - DEAD_HEARTBEAT_MS).toISOString(),
			...extra
		})
		.select('id')
		.single();
	if (error) throw new Error(`seed del run morto fallito — ${error.message}`);
	return data as { id: string };
}

async function readRun(id: string) {
	const { data } = await createAdminClient().from('agent_kit_runs').select('*').eq('id', id).maybeSingle();
	return data as { state?: string } | null;
}

async function readJobs(fixture: Fixture) {
	const { data } = await createAdminClient()
		.from('chat_jobs')
		.select('id, input_params')
		.eq('thread_id', fixture.threadId);
	return (data ?? []) as { id: string; input_params?: { resume_run_id?: string } }[];
}

async function readAssistantMessages(fixture: Fixture) {
	const { data } = await createAdminClient()
		.from('chat_messages')
		.select('*')
		.eq('thread_id', fixture.threadId)
		.eq('role', 'assistant');
	return (data ?? []) as Record<string, unknown>[];
}

function fact(id: string, ok: boolean, detail: string): Fact {
	return { id, ok, detail };
}

/** Il motivo per cui uno scenario NON è stato eseguito. Un eval che tace è peggio di uno rosso. */
async function unrunReason(): Promise<string | null> {
	const admin = createAdminClient();
	const { error } = await admin.rpc('agent_kit_claim_run', {
		p_run_id: '00000000-0000-0000-0000-000000000000',
		p_owner: 'probe',
		p_now: new Date().toISOString(),
		p_lease_until: new Date().toISOString()
	});
	if (error) return `migration 0229 non applicata su questo database (${error.message})`;
	return null;
}

async function main(): Promise<number> {
	const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
	const chosen = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
	if (!chosen.length) {
		console.error(`nessuno scenario chiamato ${only}. Disponibili: ${SCENARIOS.map((s) => s.id).join(', ')}`);
		return 1;
	}

	const unrun = await unrunReason();
	if (unrun) {
		for (const s of chosen) console.log(`  UNRUN  ${s.id} — ${unrun}`);
		console.error(`\n${chosen.length} scenari NON eseguiti. Un eval che non gira non è verde.`);
		return 1;
	}

	let failed = 0;
	for (const scenario of chosen) {
		let fixture: Fixture | null = null;
		try {
			fixture = await createFixture(scenario.id.slice(0, 20));
			const facts = await scenario.run(fixture);
			const ok = facts.every((f) => f.ok);
			if (!ok) failed += 1;
			console.log(`\n${ok ? '  OK   ' : '  FAIL '} ${scenario.id} — ${scenario.what}`);
			for (const f of facts) console.log(`         ${f.ok ? '✓' : '✗'} ${f.id}: ${f.detail}`);
		} catch (e) {
			failed += 1;
			console.log(`\n  FAIL  ${scenario.id} — esploso: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			await destroyFixture(fixture).catch((e) => console.error('  teardown fallito', e));
		}
	}

	console.log(`\n${chosen.length - failed}/${chosen.length} scenari verdi.`);
	return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
