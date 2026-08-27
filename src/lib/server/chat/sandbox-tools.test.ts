import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LA FALLA CHE QUESTO FILE INCHIODA.
 *
 * `rejectPath` fermava gli assoluti, i `..` e lo snapshot del brand — e nient'altro. I due tool che
 * leggono (`sandbox_read_file`, `sandbox_save_output`) non passavano nemmeno da lì: avevano una
 * copia in linea ancora più debole. Risultato: `.github.env`, il file in cui `sandbox_device_login`
 * scrive il token GitHub autorizzato dall'utente, stava DENTRO la directory della run — cioè in un
 * percorso perfettamente lecito — e un turno poteva rileggerlo e pubblicarlo in chat o nella
 * conoscenza del brand.
 *
 * Il giro via `sandbox_exec` è la metà che un divieto sui path non chiude: `cat .github.env` è un
 * comando qualunque e il suo stdout torna intero al modello. Per quello c'è il secondo test —
 * il valore del token viene cancellato in uscita, comunque l'agente sia riuscito a leggerlo.
 */

vi.mock('$env/dynamic/private', () => ({ env: { GITHUB_DEVICE_CLIENT_ID: 'client-id-test' } }));

const ROOT = 'runs/testrun';
const files = new Map<string, string>();
const execLog: string[] = [];

function fakeHandle() {
  return {
    name: 'fake',
    mode: 'compute' as const,
    root: ROOT,
    browser: false,
    browserProvisioning: 'not_attempted' as const,
    image: 'fake',
    playwrightEnv: {},
    async run(cmd: string, args: string[] = []) {
      const line = [cmd, ...args].join(' ');
      execLog.push(line);
      // Un finto `cat`: quello che conta non è la shell, è che lo stdout di un comando arbitrario
      // torni al modello — che è esattamente la strada con cui il token usciva.
      const m = line.match(/cat ([^\s"']+)/);
      const stdout = m ? (files.get(`${ROOT}/${m[1]}`) ?? files.get(m[1]) ?? '') : 'ok\n';
      return { exitCode: 0, stdout, stderr: '', truncated: false, durationMs: 1 };
    },
    async write(fs: { path: string; content: string }[]) {
      for (const f of fs) files.set(f.path, f.content);
    },
    async read(path: string) {
      const c = files.get(path);
      if (c === undefined) throw new Error(`ENOENT: ${path}`);
      return c;
    },
    async readBuffer(path: string) {
      return Buffer.from(await this.read(path), 'utf8');
    },
    async release() {}
  };
}

/** Il registro degli addebiti, intercettato: qui interessa CHE si addebiti, non quanto costi. */
const charges = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('$lib/server/sandbox-credits', () => ({
  chargeSandboxCredits: (o: Record<string, unknown>) => {
    charges.push(o);
    return 1;
  }
}));

vi.mock('$lib/server/sandbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/sandbox')>();
  return { ...actual, isSandboxConfigured: () => true, openBrandSandbox: async () => fakeHandle() };
});

const { createSandboxTools } = await import('./sandbox-tools');

const TOKEN = 'gho_SEGRETISSIMO_test_token_123';

function session() {
  return createSandboxTools({
    // Nessuna riga di DB in questi test: `buildBrandWorkspace` fallisce e il chiamante la ingoia
    // (`.catch(() => [])`), che è il comportamento vero quando il brand non ha ancora dati.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    brandId: 'b1',
    userId: 'u1',
    threadId: 'th1',
    agentId: 'motion',
    mode: 'compute',
    deviceLogin: true
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (tools: Record<string, any>, name: string, input: unknown) =>
  tools[name].execute(input, { toolCallId: 'tc', messages: [] });

/** Porta la sessione fino a "token GitHub scritto nella VM", come in produzione. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authorize(tools: Record<string, any>) {
  await call(tools, 'sandbox_device_login', { provider: 'github', action: 'start' });
  const out = await call(tools, 'sandbox_device_login', { provider: 'github', action: 'check' });
  expect(out.status).toBe('authorized');
  expect(files.get(`${ROOT}/.github.env`)).toContain(TOKEN);
}

beforeEach(() => {
  files.clear();
  execLog.length = 0;
  // Lo stub va messo PRIMA di creare i tool: il device login cattura `fetch` alla costruzione.
  const steps: Record<string, unknown>[] = [
    { device_code: 'dc-riservato-1234', user_code: 'AAAA-BBBB', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 },
    { access_token: TOKEN, token_type: 'bearer' }
  ];
  vi.stubGlobal('fetch', async () => ({ json: async () => steps.shift() ?? { error: 'no_more_steps' } }));
});

describe('i segreti della VM non escono dai tool', () => {
  it('sandbox_read_file rifiuta il file col token della run', async () => {
    const { tools } = session();
    await authorize(tools);
    const out = await call(tools, 'sandbox_read_file', { path: '.github.env' });
    expect(out.error).toBeTruthy();
    expect(out.content).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('sandbox_save_output non può renderlo permanente (chat o conoscenza del brand)', async () => {
    const { tools } = session();
    await authorize(tools);
    for (const kind of ['artifact', 'document', 'image'] as const) {
      const out = await call(tools, 'sandbox_save_output', { path: '.github.env', title: 'x', kind });
      // Il messaggio del guardrail, non un errore qualunque: senza questo il test passerebbe anche
      // solo perché il salvataggio è fallito più a valle, e la falla resterebbe scoperta.
      expect(out.error).toContain('.github.env');
      expect(out.success).toBeUndefined();
    }
  });

  it('la directory di servizio .anomalia/ è fuori portata in lettura e scrittura', async () => {
    const { tools } = session();
    for (const path of ['.anomalia/github-device.json', 'work/.anomalia/x', '.anomalia']) {
      expect((await call(tools, 'sandbox_read_file', { path })).error).toBeTruthy();
      expect((await call(tools, 'sandbox_write_file', { path, content: 'x' })).error).toBeTruthy();
    }
  });

  it('sandbox_exec: `cat` legge il file, ma il token non torna indietro in chiaro', async () => {
    const { tools } = session();
    await authorize(tools);
    const out = await call(tools, 'sandbox_exec', { cmd: 'bash', args: ['-lc', 'cat .github.env'] });
    // Il comando gira davvero — vietare l'argv spegnerebbe `source .github.env && gh auth status`,
    // che è l'uso legittimo del token.
    expect(execLog.some((l) => l.includes('cat .github.env'))).toBe(true);
    expect(out.stdout).not.toContain(TOKEN);
    expect(out.stdout).toContain('redacted');
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('sandbox_exec: nemmeno il cwd esce dalla directory della run', async () => {
    const { tools } = session();
    const out = await call(tools, 'sandbox_exec', { cmd: 'ls', cwd: '../..' });
    expect(out.error).toBeTruthy();
    expect(execLog).toHaveLength(0);
  });

  it('anche il device_code è un segreto: non torna nell’output di un comando', async () => {
    const { tools } = session();
    await authorize(tools);
    files.set('.anomalia/github-device.json', JSON.stringify({ device_code: 'dc-riservato-1234' }));
    const out = await call(tools, 'sandbox_exec', { cmd: 'bash', args: ['-lc', 'cat .anomalia/github-device.json'] });
    expect(out.stdout).not.toContain('dc-riservato-1234');
  });
});

describe('il lavoro legittimo continua a funzionare', () => {
  it('scrive in work/, rilegge lo snapshot del brand, esegue comandi', async () => {
    const { tools } = session();
    const written = await call(tools, 'sandbox_write_file', { path: 'work/analysis.py', content: 'print(1)' });
    expect(written.success).toBe(true);
    expect(files.get(`${ROOT}/work/analysis.py`)).toBe('print(1)');

    files.set(`${ROOT}/brand/history.csv`, 'a,b\n1,2');
    const read = await call(tools, 'sandbox_read_file', { path: 'brand/history.csv' });
    expect(read.content).toBe('a,b\n1,2');

    const run = await call(tools, 'sandbox_exec', { cmd: 'python3', args: ['work/analysis.py'], cwd: 'work' });
    expect(run.exit_code ?? run.exitCode).toBe(0);
    expect(run.stdout).toBe('ok\n');
  });
});


describe('i secondi di VM dell’agente finiscono addebitati al brand', () => {
  /**
   * `SandboxUse = 'agent'` esisteva nel tipo e non aveva UN SOLO chiamante: ogni `sandbox_exec`
   * accendeva una macchina che fatturiamo noi ed era gratis per il brand e invisibile in bolletta.
   * Il conto si chiude su `close()`, che è l'unico punto per cui passano tutti e tre i chiamanti
   * (subagents, queue, agent-base).
   */
  it('close() addebita i secondi come use=agent', async () => {
    charges.length = 0;
    vi.useFakeTimers();
    try {
      const s = session();
      await call(s.tools, 'sandbox_exec', { cmd: 'echo', args: ['ciao'] });
      vi.advanceTimersByTime(45_000);
      await s.close();
    } finally {
      vi.useRealTimers();
    }
    expect(charges).toHaveLength(1);
    expect(charges[0].use).toBe('agent');
    expect(charges[0].brandId).toBe('b1');
    expect(charges[0].userId).toBe('u1');
    // 45 secondi accesi, 45 secondi addebitati: se qui torna 0 l'addebito non esiste.
    expect(Number(charges[0].seconds)).toBeCloseTo(45, 1);
  });

  it('una sessione che non ha mai aperto la VM non addebita niente', async () => {
    charges.length = 0;
    const s = session();
    await s.close();
    expect(charges).toHaveLength(0);
  });
});
