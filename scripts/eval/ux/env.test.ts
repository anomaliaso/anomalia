import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEvalStackEnv, evalServerEnv, evalServices } from './env';

const UX_RUNNER = readFileSync('scripts/eval/ux-run.mjs', 'utf8');

function payload(token: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('evalServerEnv', () => {
	it('loads the stack helper from the runner directory', () => {
		expect(UX_RUNNER).toContain("from './ux/stack.mjs'");
	});

	it('uses the open billing provider when the harness starts without one', () => {
		expect(evalServerEnv({ PATH: '/bin' }, 'on')).toMatchObject({
			AGENT_KIT: 'on',
			BILLING_PROVIDER: 'open',
			NO_HMR: '1'
		});
	});

	it('preserves an explicit billing provider', () => {
		expect(evalServerEnv({ BILLING_PROVIDER: 'anomalia' }, 'off').BILLING_PROVIDER).toBe('anomalia');
	});

	it('starts app, queue worker, and realtime together', () => {
		expect(evalServices('/repo/infra/compose/docker-compose.yml', '/tmp/eval.env', 'anomalia-eval-1')).toEqual({
		command: 'docker',
		args: [
			'compose',
			'--project-name',
			'anomalia-eval-1',
			'--env-file',
			'/tmp/eval.env',
			'-f',
			'/repo/infra/compose/docker-compose.yml',
			'up',
			'-d',
			'--wait',
			'db',
			'kong',
			'auth',
			'rest',
			'storage',
			'realtime-dev',
			'app',
			'cron',
			'worker'
		]
		});
	});

	it('le chiavi dello stack sopravvivono a una sessione E2E: scadono in ore, non in un’ora', () => {
		const env = createEvalStackEnv({
			source: {},
			appUrl: 'http://localhost:49300',
			appPort: 49300,
			kongPort: 49301,
			postgresPort: 49302,
			agentKit: 'on'
		});
		const life = (token: string) => {
			const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
			return body.exp - body.iat;
		};
		const ONE_HOUR = 3_600;

		expect(life(env.ANON_KEY)).toBeGreaterThan(ONE_HOUR);
		expect(life(env.SERVICE_ROLE_KEY)).toBeGreaterThan(ONE_HOUR);
		expect(Number(env.JWT_EXPIRY)).toBeGreaterThan(ONE_HOUR);
	});

	it('builds the images as its own step, so a cold build is not charged to the startup budget', () => {
		const build = evalServices('/repo/infra/compose/docker-compose.yml', '/tmp/eval.env', 'anomalia-eval-1', 'build');

		expect(build.args).toContain('build');
		expect(build.args).not.toContain('up');
		expect(build.args.slice(-3)).toEqual(['app', 'cron', 'worker']);
	});

	it('gives the image build a budget the startup timeout never caps', () => {
		expect(UX_RUNNER).toMatch(/imageBuildTimeoutMs/);
		expect(UX_RUNNER).toMatch(/'build'/);
	});

	it('tears down only its project and its database volume', () => {
		expect(evalServices('/repo/infra/compose/docker-compose.yml', '/tmp/eval.env', 'anomalia-eval-1', 'down')).toEqual({
			command: 'docker',
			args: [
				'compose',
				'--project-name',
				'anomalia-eval-1',
				'--env-file',
				'/tmp/eval.env',
				'-f',
				'/repo/infra/compose/docker-compose.yml',
				'down',
				'--volumes',
				'--remove-orphans'
			]
		});
	});

	it('generates one matched local JWT/API key set and app secrets', () => {
		const env = createEvalStackEnv({
			source: { LLM_API_KEY: 'llm-test' },
			appUrl: 'http://localhost:49100',
			appPort: 49100,
			kongPort: 49101,
			postgresPort: 49102,
			agentKit: 'on'
		});

		expect(env.PUBLIC_SUPABASE_URL).toBe('http://localhost:49101');
		expect(env.DATABASE_URL).toBe(`postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:49102/postgres`);
		expect(payload(env.ANON_KEY).role).toBe('anon');
		expect(payload(env.SERVICE_ROLE_KEY).role).toBe('service_role');
		expect(env.JWT_SECRET).not.toBe(env.ANON_KEY);
		expect(env.APP_SECRET).toBeTruthy();
		expect(env.CRON_SECRET).toBeTruthy();
		expect(env.SECRET_KEY_BASE).toBeTruthy();
		expect(env.LLM_API_KEY).toBe('llm-test');
		expect(env.AGENT_KIT).toBe('on');
		expect(env.BILLING_PROVIDER).toBe('open');
	});

	it('does not inherit a hosted database or marketing-only app flags', () => {
		const env = createEvalStackEnv({
			source: {
				PUBLIC_SUPABASE_URL: 'https://hosted.example',
				SUPABASE_SERVICE_ROLE_KEY: 'hosted-service-key',
				HIDE_MARKETING: '1'
			},
			appUrl: 'http://localhost:49200',
			appPort: 49200,
			kongPort: 49201,
			postgresPort: 49202,
			agentKit: 'on'
		});

		expect(env.PUBLIC_SUPABASE_URL).toBe('http://localhost:49201');
		expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(env.SERVICE_ROLE_KEY);
		expect(env.HIDE_MARKETING).toBe('');
		expect(env.CHAT_PROVIDER).toBe('');
		expect(env.TENANT_BRAND_ID).toBe('');
	});
});
