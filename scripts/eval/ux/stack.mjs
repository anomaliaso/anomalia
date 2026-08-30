import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const OPEN_BILLING_PROVIDER = 'open';
const JWT_TTL_SECONDS = 24 * 60 * 60;

export const EVAL_SERVICES = ['db', 'kong', 'auth', 'rest', 'storage', 'realtime-dev', 'app', 'cron', 'worker'];

export function evalServices(composeFile, envFile, projectName, action = 'up') {
	const args = ['compose', '--project-name', projectName];
	if (envFile) args.push('--env-file', envFile);
	args.push('-f', composeFile);
	if (action === 'down') {
		args.push('down', '--volumes', '--remove-orphans');
	} else if (action === 'build') {
		args.push('build', ...EVAL_SERVICES);
	} else {
		args.push('up', '-d', '--wait', ...EVAL_SERVICES);
	}
	return { command: 'docker', args };
}

export function createEvalStackEnv({ source = {}, appUrl, appPort, kongPort, postgresPort, agentKit = 'on' }) {
	const jwtSecret = randomSecret(32);
	const postgresPassword = randomSecret(32);
	const anonKey = supabaseKey(jwtSecret, 'anon');
	const serviceRoleKey = supabaseKey(jwtSecret, 'service_role');

	return {
		...source,
		POSTGRES_PASSWORD: postgresPassword,
		POSTGRES_DB: 'postgres',
		POSTGRES_PORT: String(postgresPort),
		JWT_SECRET: jwtSecret,
		JWT_EXPIRY: String(JWT_TTL_SECONDS),
		ANON_KEY: anonKey,
		SERVICE_ROLE_KEY: serviceRoleKey,
		DASHBOARD_PASSWORD: randomSecret(24),
		SECRET_KEY_BASE: randomSecret(64),
		REALTIME_DB_ENC_KEY: 'supabaserealtime',
		SUPABASE_PUBLIC_URL: `http://localhost:${kongPort}`,
		SUPABASE_INTERNAL_URL: 'http://kong:8000',
		API_EXTERNAL_URL: `http://localhost:${kongPort}/auth/v1`,
		KONG_HTTP_PORT: String(kongPort),
		SITE_URL: appUrl,
		ADDITIONAL_REDIRECT_URLS: appUrl,
		APP_PORT: String(appPort),
		PUBLIC_APP_URL: appUrl,
		APP_SECRET: randomSecret(32),
		CRON_SECRET: randomSecret(32),
		AGENT_KIT: agentKit,
		BILLING_PROVIDER: source.BILLING_PROVIDER || OPEN_BILLING_PROVIDER,
		CHAT_PROVIDER: '',
		HIDE_MARKETING: '',
		TENANT_BRAND_ID: '',
		PUBLIC_SUPABASE_URL: `http://localhost:${kongPort}`,
		PUBLIC_SUPABASE_ANON_KEY: anonKey,
		SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
		DATABASE_URL: `postgres://postgres:${postgresPassword}@localhost:${postgresPort}/postgres`
	};
}

export async function freePorts(count) {
	const servers = [];
	try {
		for (let i = 0; i < count; i += 1) {
			const server = createServer();
			await new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', resolve);
			});
			servers.push(server);
		}
		return servers.map((server) => server.address().port);
	} finally {
		await Promise.all(
			servers.map(
			(server) =>
				new Promise((resolve) => {
					server.close(() => resolve());
				})
			)
		);
	}
}

export function envFileContents(env) {
	return Object.entries(env)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}=${quote(String(value))}`)
		.join('\n') + '\n';
}

function randomSecret(bytes) {
	return randomBytes(bytes).toString('base64url');
}

function supabaseKey(secret, role) {
	const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const now = Math.floor(Date.now() / 1000);
	const body = base64url(JSON.stringify({ role, iss: 'supabase', iat: now, exp: now + JWT_TTL_SECONDS }));
	const signed = `${header}.${body}`;
	const signature = createHmac('sha256', secret).update(signed).digest('base64url');
	return `${signed}.${signature}`;
}

function base64url(value) {
	return Buffer.from(value).toString('base64url');
}

function quote(value) {
	return /[\s#"'\\]/.test(value) ? JSON.stringify(value) : value;
}
