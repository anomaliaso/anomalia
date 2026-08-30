import { mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { Browser } from './eval/ux/browser';
import { walkOnboarding } from './eval/ux/walk';

const appUrl = process.env.TASK85_APP_URL ?? 'http://localhost:5177';
const supabaseUrl = process.env.TASK85_SUPABASE_URL;
const serviceRoleKey = process.env.TASK85_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.TASK85_SUPABASE_ANON_KEY;
const evidenceDir = '/tmp/task85-browser-evidence';
const stamp = Date.now();
const email = `task85-browser-${stamp}@anomalia.so`;
const password = `task85-${stamp}`;
const plainMarker = `TASK85-PLAIN-${stamp}`;
const shellMarker = `TASK85-SHELL-${stamp}`;

if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error('task85 Supabase environment is incomplete');

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function createUser(): Promise<{ id: string; email: string; password: string }> {
	const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (error || !data.user) throw new Error(`browser user creation failed: ${error?.message ?? 'no user returned'}`);
	return { id: data.user.id, email, password };
}

async function deleteUser(userId: string): Promise<void> {
	const { data: files } = await admin.storage.from('media').list(userId, { limit: 1000 });
	if (files?.length) await admin.storage.from('media').remove(files.map((file) => `${userId}/${file.name}`));
	const { error } = await admin.auth.admin.deleteUser(userId);
	if (error) throw new Error(`browser user teardown failed: ${error.message}`);
}

async function messages(threadId: string) {
	const { data, error } = await admin
		.from('chat_messages')
		.select('role,content,tool_calls,created_at')
		.eq('thread_id', threadId)
		.order('created_at', { ascending: true });
	if (error) throw new Error(error.message);
	return data ?? [];
}

async function waitForNewReply(threadId: string, before: number, timeoutMs = 240_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const rows = await messages(threadId);
		const replies = rows.filter((row) => row.role === 'assistant');
		if (replies.length > before) return { rows, reply: replies.at(-1) };
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error(`assistant reply timeout after ${timeoutMs}ms`);
}

async function waitForIdle(threadId: string, timeoutMs = 240_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data, error } = await admin
			.from('agent_kit_runs')
			.select('id')
			.eq('thread_id', threadId)
			.in('state', ['queued', 'running']);
		if (error) throw new Error(error.message);
		if (!data?.length) return;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error(`thread remained active after ${timeoutMs}ms`);
}

async function send(browser: Browser, text: string): Promise<void> {
	await browser.run('fill', 'textarea.ch-input', text);
	await browser.run('click', 'button.ch-send');
}

async function sandboxFacts(brandId: string) {
	const [{ data: holders, error: holderError }, { data: computers, error: computerError }, { data: calls, error: callError }] = await Promise.all([
		admin.from('sandbox_holders').select('sandbox_name,holder_key,kind,expires_at').eq('brand_id', brandId),
		admin.from('agent_computers').select('agent_id,state,provider_ref,last_touch_at').eq('brand_id', brandId),
		admin.from('ai_calls').select('cost_usd,provider,model').eq('brand_id', brandId)
	]);
	if (holderError || computerError || callError) {
		throw new Error(holderError?.message ?? computerError?.message ?? callError?.message);
	}
	const totalCostUsd = (calls ?? []).reduce((sum, call) => sum + Number(call.cost_usd ?? 0), 0);
	return {
		holders: holders ?? [],
		computers: computers ?? [],
		aiCalls: calls?.length ?? 0,
		totalCostUsd
	};
}

async function main(): Promise<void> {
	mkdirSync(evidenceDir, { recursive: true });
	const user = await createUser();
	const browser = new Browser(evidenceDir, (line) => console.log(`[browser] ${line}`));
	try {
		await walkOnboarding(browser, appUrl, user);
		const deadline = Date.now() + 90_000;
		let brand: { id: string; slug: string } | null = null;
		while (!brand && Date.now() < deadline) {
			const { data: orgs } = await admin.from('organizations').select('id').eq('owner_id', user.id);
			const orgIds = (orgs ?? []).map((org) => org.id);
			if (orgIds.length) {
				const { data: brands } = await admin.from('brands').select('id,slug').in('org_id', orgIds);
				brand = brands?.[0] ?? null;
			}
			if (!brand) await new Promise((resolve) => setTimeout(resolve, 2_000));
		}
		if (!brand) throw new Error('eval brand was not created');

		const { data: thread, error: threadError } = await admin
			.from('chat_threads')
			.select('id')
			.eq('brand_id', brand.id)
			.order('created_at', { ascending: false })
			.limit(1)
			.single();
		if (threadError || !thread) throw new Error(`chat thread lookup failed: ${threadError?.message ?? 'no row'}`);
		await waitForIdle(thread.id);
		const initial = await waitForNewReply(thread.id, 0);
		const beforePlain = initial.rows.filter((row) => row.role === 'assistant').length;
		const beforePlainFacts = await sandboxFacts(brand.id);
		await send(browser, `Reply with exactly ${plainMarker}. Do not use any tool.`);
		const plain = await waitForNewReply(thread.id, beforePlain);
		await waitForIdle(thread.id);

		const beforeShell = plain.rows.filter((row) => row.role === 'assistant').length;
		await send(
			browser,
			`Use the shell tool exactly once to run printf ${shellMarker} in the sandbox. Then reply with the exact stdout marker ${shellMarker}.`
		);
		const shell = await waitForNewReply(thread.id, beforeShell);
		await waitForIdle(thread.id);
		const afterShellFacts = await sandboxFacts(brand.id);
		const toolNames = shell.rows
			.filter((row) => row.role === 'assistant' && row.tool_calls)
			.flatMap((row) => (row.tool_calls as Array<{ toolName?: string }>).map((call) => call.toolName ?? 'unknown'));
		const evidence = {
			plainReply: plain.reply?.content,
			shellReply: shell.reply?.content,
			toolNames,
			beforePlainFacts,
			afterShellFacts,
			plainMarker,
			shellMarker
		};
		console.log(JSON.stringify(evidence));
		if (String(plain.reply?.content) !== plainMarker) throw new Error('plain marker was not returned');
		if (String(shell.reply?.content) !== shellMarker || !toolNames.includes('shell')) {
			throw new Error('real shell tool marker/call was not observed');
		}
	} finally {
		await browser.close();
		await deleteUser(user.id);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
