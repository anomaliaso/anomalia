import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { tool } from 'ai';
import { isStepCount } from 'ai';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createPi } from '@ai-sdk/harness-pi';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';

const STATE = join(tmpdir(), 'pi-suspend-state.json');
const AGENT_DIR = join(tmpdir(), 'anomalia-pi-agent-susp');
const SESSION_ID = `susp-${Date.now()}`;

function ensureKieAgentDir() {
	mkdirSync(AGENT_DIR, { recursive: true });
	writeFileSync(
		join(AGENT_DIR, 'models.json'),
		JSON.stringify({
			providers: {
				kie: {
					baseUrl: process.env.KIE_BASE_URL ?? 'https://api.kie.ai/codex/v1',
					api: 'openai-responses',
					apiKey: process.env.KIE_API_KEY,
					models: [{ id: 'gpt-5-6-luna' }]
				}
			}
		})
	);
	return AGENT_DIR;
}

function buildAgent(stopWhen = [isStepCount(1)]) {
	return new HarnessAgent({
		harness: createPi({ agentDir: ensureKieAgentDir(), model: 'kie/gpt-5-6-luna' }),
		sandbox: createVercelSandbox({
			runtime: 'node24',
			token: process.env.VERCEL_TOKEN,
			teamId: process.env.VERCEL_TEAM_ID,
			projectId: process.env.VERCEL_PROJECT_ID
		}),
		instructions: 'Sei un agente di prova. Usa SEMPRE il tool ping_tool prima di rispondere.',
		tools: {
			ping_tool: tool({
				description: 'Risponde pong con il messaggio ricevuto',
				inputSchema: z.object({ msg: z.string() }),
				execute: async ({ msg }) => `pong:${msg}`
			})
		},
		stopWhen
	});
}

async function drain(result) {
	let text = '';
	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') text += part.text;
		if (part.type === 'error') console.error('stream error:', part.error);
	}
	return text;
}

const phase = process.argv[2];

if (phase === 'suspend') {
	const agent = buildAgent();
	const session = await agent.createSession({ sessionId: SESSION_ID });
	const result = await agent.stream({
		session,
		messages: [{ role: 'user', content: 'Chiama ping_tool con msg="segreto-42", poi dillo all\'utente.' }]
	});
	const text = await drain(result);
	const unfinished = session.hasUnfinishedTurn();
	console.log('SLICE_TEXT:', JSON.stringify(text.slice(0, 200)));
	console.log('HAS_UNFINISHED:', unfinished);
	if (!unfinished) {
		console.log('VERDICT: FAIL — stopWhen non ha lasciato il turno aperto');
		await session.destroy();
		process.exit(1);
	}
	const cont = await session.suspendTurn();
	writeFileSync(STATE, JSON.stringify({ sessionId: SESSION_ID, continuation: cont }));
	// suspendTurn ha già parcheggiato runtime+sandbox: nessuna stop/destroy qui.
	console.log('SUSPENDED: continuation state scritto su', STATE);
} else if (phase === 'resume') {
	if (!existsSync(STATE)) throw new Error('nessuno stato da riprendere: lancia prima suspend');
	const { sessionId, continuation } = JSON.parse(readFileSync(STATE, 'utf8'));
	const agent = buildAgent([]);
	const session = await agent.createSession({ sessionId, continueFrom: continuation });
	const result = await agent.continueGenerate({ session });
	const text = await drain2(result);
	console.log('RESUME_TEXT:', JSON.stringify(text));
	console.log('STILL_UNFINISHED:', session.hasUnfinishedTurn());
	console.log(
		text.includes('pong:segreto-42') || text.includes('segreto-42')
			? 'VERDICT: PASS — il turno è ricomposto in un secondo processo e vede il risultato del tool'
			: 'VERDICT: FAIL — il testo ripreso non contiene il risultato del tool'
	);
	await session.destroy();
} else {
	console.log('usage: node pi-suspend-resume.mjs [suspend|resume]');
}

async function drain2(result) {
	try {
		return String(await result.text);
	} catch {
		return '';
	}
}
