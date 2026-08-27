import { describe, expect, it } from 'vitest';
import {
  DEVICE_STATE_PATH,
  TOKEN_ENV_FILE,
  createSandboxDeviceLoginTool,
  type DeviceLoginSandbox
} from './sandbox-device-login';

/**
 * Il contratto che questi test inchiodano: il device flow funziona (pending → authorized,
 * scadenza, env mancante) e — soprattutto — IL TOKEN NON COMPARE MAI nell'output del tool.
 * Finisce solo dentro la VM finta, che qui è una Map.
 */

const TOKEN = 'gho_SEGRETISSIMO_test_token_123';

function fakeSandbox() {
  const files = new Map<string, string>();
  const commands: string[] = [];
  const sandbox: DeviceLoginSandbox = {
    root: 'runs/testrun',
    async write(fs) {
      for (const f of fs) files.set(f.path, f.content);
    },
    async read(path) {
      const c = files.get(path);
      if (c === undefined) throw new Error(`ENOENT: ${path}`);
      return c;
    },
    async run(cmd, args = []) {
      commands.push([cmd, ...args].join(' '));
      if (cmd === 'rm') for (const a of args) files.delete(a);
      return { exitCode: 0, stdout: '', stderr: '', truncated: false, durationMs: 1 };
    }
  };
  return { sandbox, files, commands };
}

type FetchStep = Record<string, unknown>;

function makeTool(opts: {
  steps: FetchStep[];
  sandbox: DeviceLoginSandbox;
  clientId?: string | null;
  remainingMs?: () => number;
}) {
  let t = 1_000_000;
  const urls: string[] = [];
  let ensured = 0;
  const tools = createSandboxDeviceLoginTool({
    ensure: async () => {
      ensured++;
      return opts.sandbox;
    },
    clientId: opts.clientId === undefined ? 'client-id-test' : opts.clientId,
    remainingMs: opts.remainingMs,
    fetchImpl: (async (url: string) => {
      urls.push(String(url));
      const body = opts.steps.shift() ?? { error: 'no_more_steps' };
      return { json: async () => body } as Response;
    }) as unknown as typeof fetch,
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = (input: any) => (tools.sandbox_device_login as any).execute(input, { toolCallId: 'tc', messages: [] });
  return { exec, urls, ensuredCount: () => ensured, clock: { advance: (ms: number) => (t += ms) } };
}

describe('sandbox_device_login', () => {
  it('senza GITHUB_DEVICE_CLIENT_ID: errore chiaro con le istruzioni, e la VM non si apre', async () => {
    const { sandbox } = fakeSandbox();
    const { exec, ensuredCount } = makeTool({ steps: [], sandbox, clientId: null });
    const out = await exec({ provider: 'github', action: 'start' });
    expect(out.error).toBe('github_device_login_unconfigured');
    expect(out.message).toContain('GITHUB_DEVICE_CLIENT_ID');
    // Lazy fino in fondo: se non si può nemmeno partire, niente macchina.
    expect(ensuredCount()).toBe(0);
  });

  it('start: la card riceve il codice pubblico, lo stato resta nella VM, il device_code non esce', async () => {
    const { sandbox, files } = fakeSandbox();
    const { exec } = makeTool({
      steps: [
        {
          device_code: 'dc-riservato',
          user_code: '2021-F75B',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        }
      ],
      sandbox
    });
    const out = await exec({ provider: 'github', action: 'start' });
    expect(out.status).toBe('pending');
    expect(out.user_code).toBe('2021-F75B');
    expect(out.verification_uri).toBe('https://github.com/login/device');
    expect(typeof out.expires_at).toBe('number');
    // Il device_code basta (con il client id) per ritirare il token: resta nella VM, non nel transcript.
    expect(JSON.stringify(out)).not.toContain('dc-riservato');
    expect(files.get(DEVICE_STATE_PATH)).toContain('dc-riservato');
  });

  it('check: pending → authorized; il token finisce SOLO nella VM, mai nell’output', async () => {
    const { sandbox, files } = fakeSandbox();
    const start = makeTool({
      steps: [{ device_code: 'dc1', user_code: 'AAAA-BBBB', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }],
      sandbox
    });
    await start.exec({ provider: 'github', action: 'start' });

    const check = makeTool({
      steps: [{ error: 'authorization_pending' }, { access_token: TOKEN, token_type: 'bearer' }],
      sandbox
    });
    const out = await check.exec({ provider: 'github', action: 'check' });
    expect(out.status).toBe('authorized');
    // LA riga per cui questo file esiste: il token non attraversa mai il confine del tool.
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    const envFile = files.get(`runs/testrun/${TOKEN_ENV_FILE}`);
    expect(envFile).toContain(`GH_TOKEN='${TOKEN}'`);
    expect(envFile).toContain(`GITHUB_TOKEN='${TOKEN}'`);
    // Flow concluso: lo stato non deve restare a disposizione di un secondo ritiro.
    expect(files.has(DEVICE_STATE_PATH)).toBe(false);
  });

  it('check: expired_token pulisce lo stato e lo dice', async () => {
    const { sandbox, files } = fakeSandbox();
    const start = makeTool({
      steps: [{ device_code: 'dc2', user_code: 'CCCC-DDDD', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }],
      sandbox
    });
    await start.exec({ provider: 'github', action: 'start' });
    const check = makeTool({ steps: [{ error: 'expired_token' }], sandbox });
    const out = await check.exec({ provider: 'github', action: 'check' });
    expect(out.status).toBe('expired');
    expect(files.has(DEVICE_STATE_PATH)).toBe(false);
  });

  it('check senza flow in corso: lo dice, senza inventare', async () => {
    const { sandbox } = fakeSandbox();
    const { exec, urls } = makeTool({ steps: [], sandbox });
    const out = await exec({ provider: 'github', action: 'check' });
    expect(out.status).toBe('none');
    expect(urls.length).toBe(0);
  });

  it('check: se l’utente non ha ancora autorizzato entro il budget, torna pending (richiamabile)', async () => {
    const { sandbox } = fakeSandbox();
    const start = makeTool({
      steps: [{ device_code: 'dc3', user_code: 'EEEE-FFFF', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }],
      sandbox
    });
    await start.exec({ provider: 'github', action: 'start' });
    const pendingForever = Array.from({ length: 50 }, () => ({ error: 'authorization_pending' }));
    const check = makeTool({ steps: pendingForever, sandbox, remainingMs: () => 20_000 });
    const out = await check.exec({ provider: 'github', action: 'check' });
    expect(out.status).toBe('pending');
    expect(out.note).toContain('check');
  });
});
