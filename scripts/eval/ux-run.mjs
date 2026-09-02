import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEvalStackEnv, envFileContents, evalServices, freePorts } from './ux/stack.mjs';

const root = resolve(import.meta.dirname, '../..');
const stackMode = process.env.EVAL_UX_STACK ?? 'compose';
const appEnvFile = resolve(root, process.env.EVAL_UX_APP_ENV_FILE ?? '.env');
const appUrlForExisting = process.env.EVAL_UX_APP_URL ?? 'http://localhost:4180';
const dockerTimeoutMs = 600_000;
const imageBuildTimeoutMs = 2_400_000;
let activeProcess = null;
let activeEvalChild = null;

function readEnvFile(path) {
	if (!existsSync(path)) return {};
	return Object.fromEntries(
		readFileSync(path, 'utf8')
			.split('\n')
			.map((line) => line.match(/^\s*([A-Z0-9_]+)=(.*)$/))
			.filter(Boolean)
			.map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')])
	);
}

const runtimeKeys = new Set([
	'LLM_API_KEY',
	'LLM_BASE_URL',
	'LLM_DEFAULT_MODEL',
	'LLM_MODELS',
	'LLM_VIDEO_REVIEWER_MODEL',
	'EMBEDDING_MODEL',
	'GEMINI_API_KEY',
	'GOOGLE_API_KEY',
	'KIE_API_KEY',
	'VERCEL_TOKEN',
	'VERCEL_TEAM_ID',
	'VERCEL_PROJECT_ID',
	'SANDBOX_IMAGE',
	'SANDBOX_BROWSER_IMAGE',
	'SANDBOX_BROWSERS_PATH',
	'BROWSERLESS_API_KEY'
]);

function sourceEnv() {
	const source = readEnvFile(appEnvFile);
	for (const key of runtimeKeys) {
		if (process.env[key] !== undefined) source[key] = process.env[key];
	}
	return source;
}

async function command(commandName, args, options = {}) {
	const child = spawn(commandName, args, {
		cwd: root,
		env: options.env ?? process.env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	activeProcess = child;
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => (stdout += chunk));
	child.stderr.on('data', (chunk) => (stderr += chunk));
	const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs ?? dockerTimeoutMs);
	return new Promise((resolveCommand, rejectCommand) => {
		child.once('error', (error) => {
			clearTimeout(timer);
			if (activeProcess === child) activeProcess = null;
			rejectCommand(error);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (activeProcess === child) activeProcess = null;
			if (code === 0) {
				resolveCommand({ stdout, stderr });
				return;
			}
			const detail = `${commandName} ${args.join(' ')} exited ${code ?? signal ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim().slice(-4_000)}` : ''}`;
			const error = new Error(detail);
			error.stdout = stdout;
			error.stderr = stderr;
			rejectCommand(error);
		});
	});
}

async function run() {
	if (stackMode === 'existing') return runEval({ appUrl: appUrlForExisting, env: { ...process.env } });

	const [appPort, kongPort, postgresPort] = await freePorts(3);
	const appUrl = `http://localhost:${appPort}`;
	const projectName = `anomalia-eval-${process.pid}-${Date.now()}`;
	const tempDir = await mkdtemp(join(tmpdir(), 'anomalia-ux-'));
	const envFile = join(tempDir, 'compose.env');
	const env = createEvalStackEnv({
		source: sourceEnv(),
		appUrl,
		appPort,
		kongPort,
		postgresPort,
		agentKit: process.env.AGENT_KIT === 'off' ? 'off' : 'on'
	});
	writeFileSync(envFile, envFileContents(env), { mode: 0o600 });

	let exitCode = 1;
	try {
		const composeFile = resolve(root, 'infra/compose/docker-compose.yml');
		const build = evalServices(composeFile, envFile, projectName, 'build');
		console.log(`[stack] build immagini ${projectName} (fino a ${imageBuildTimeoutMs / 60_000} minuti)`);
		const buildResult = await command(build.command, build.args, { timeoutMs: imageBuildTimeoutMs });
		writeFileSync(join(tempDir, 'compose-build.log'), `${buildResult.stdout}${buildResult.stderr}`);

		const up = evalServices(composeFile, envFile, projectName);
		console.log(`[stack] avvio ${projectName} su app=${appPort} kong=${kongPort} db=${postgresPort}`);
		const upResult = await command(up.command, up.args);
		writeFileSync(join(tempDir, 'compose-up.log'), `${upResult.stdout}${upResult.stderr}`);

		const childEnv = {
			...process.env,
			...env,
			PUBLIC_SUPABASE_URL: env.PUBLIC_SUPABASE_URL,
			PUBLIC_SUPABASE_ANON_KEY: env.PUBLIC_SUPABASE_ANON_KEY,
			SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
			PUBLIC_APP_URL: appUrl,
			ORIGIN: appUrl,
			SITE_URL: appUrl,
			EVAL_UX_STACK: 'existing',
			EVAL_UX_APP_URL: appUrl,
			EVAL_UX_COMPOSE_PROJECT: projectName,
			EVAL_UX_COMPOSE_ENV_FILE: envFile
		};
		await command(process.execPath, ['scripts/db-migrate.mjs'], { env: childEnv });
		exitCode = await runEval({ appUrl, env: childEnv });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.error(`[stack] avvio/eval fallito: ${detail}`);
	} finally {
		const composeFile = resolve(root, 'infra/compose/docker-compose.yml');
		const down = evalServices(composeFile, envFile, projectName, 'down');
		try {
			await command(down.command, down.args);
			console.log(`[stack] rimosso ${projectName}, volume DB incluso`);
		} catch (error) {
			console.error(`[stack] cleanup fallito: ${error instanceof Error ? error.message : String(error)}`);
			exitCode = 1;
		}
		await rm(tempDir, { recursive: true, force: true });
	}
	return exitCode;
}

async function runEval({ appUrl, env }) {
	const child = spawn(
		process.execPath,
		[resolve(root, 'node_modules/vite-node/vite-node.mjs'), '--config', 'scripts/vite-node.config.ts', 'scripts/eval/ux.ts'],
		{ cwd: root, env: { ...env, EVAL_UX_APP_URL: appUrl }, stdio: 'inherit' }
	);
	activeEvalChild = child;
	return new Promise((resolveExit) => {
		child.once('exit', (code, signal) => {
			if (activeEvalChild === child) activeEvalChild = null;
			resolveExit(code ?? (signal ? 1 : 0));
		});
	});
}

async function stopChild(child) {
	if (!child || child.exitCode !== null) return;
	child.kill('SIGTERM');
	await new Promise((resolveExit) => {
		const timer = setTimeout(() => {
			if (child.exitCode === null) child.kill('SIGKILL');
			resolveExit();
		}, 10_000);
		child.once('exit', () => {
			clearTimeout(timer);
			resolveExit();
		});
	});
}

process.on('SIGINT', () => {
	process.exitCode = 130;
	if (activeProcess) activeProcess.kill('SIGTERM');
	if (activeEvalChild) void stopChild(activeEvalChild);
});

run()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
