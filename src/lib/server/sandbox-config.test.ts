/**
 * LA CONFIGURAZIONE CHE NON ARRIVAVA MAI.
 *
 * `Sandbox.getOrCreate` accetta `timeout`, `snapshotExpiration`, `keepLastSnapshots` — e li ignora
 * su ogni sandbox che esiste già («returns it with its existing configuration and ignores the
 * creation parameters you pass»). I nostri nomi sono stabili per brand, quindi *tutte* le sandbox
 * dei brand attivi giravano con la configurazione del giorno in cui erano nate, e nessuno lo
 * vedeva: nessun errore, nessun log, solo un budget che non corrispondeva alla realtà.
 *
 * Questi test tengono in piedi le due metà della riparazione: la regola (`sandboxConfigDrift`, che
 * decide *cosa* riallineare e in che direzione) e il fatto che venga davvero chiamata (`update`
 * sulla VM preesistente, e NON su quella appena creata).
 *
 * Vive in un file suo e non dentro `sandbox.test.ts` perché qui serve un mock di
 * `$env/dynamic/private` e di `@vercel/sandbox` per l'intero modulo: metterlo là dentro cambierebbe
 * l'ambiente sotto ai test degli altri.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { VERCEL_OIDC_TOKEN: 'oidc-di-prova' } }));

/** Il minimo di `Sandbox` che `openBrandSandbox` tocca davvero, più i getter di configurazione. */
function fakeSandbox(config: {
  timeout?: number;
  snapshotExpiration?: number;
  keepLastSnapshots?: { count: number };
}) {
  return {
    ...config,
    update: vi.fn(async (_params: Record<string, unknown>) => {}),
    writeFiles: vi.fn(async () => {}),
    // L'SDK ritorna uno STREAM da `readFile` e un Buffer da `readFileToBuffer`.
    readFile: vi.fn(async () => ({ pipe: () => {} })),
    readFileToBuffer: vi.fn(async () => Buffer.from('{"name":"motion-render"}', 'utf8')),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => '',
      stderr: async () => ''
    }))
  };
}

const getOrCreate = vi.fn();
vi.mock('@vercel/sandbox', () => ({ Sandbox: { getOrCreate: (...a: unknown[]) => getOrCreate(...a) } }));

/** La pubblicazione dello stato passa dal service role: qui si guarda solo CHE succeda. */
const published: Array<{ brandId: string; refName: string; agentId?: string }> = [];
vi.mock('$lib/server/agent-desktop', () => ({
  publishComputerRunning: async (_db: unknown, brandId: string, refName: string, agentId?: string) => {
    published.push({ brandId, refName, agentId });
  }
}));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => ({}) }));

const WEEK = 7 * 24 * 60 * 60_000;

describe('sandboxConfigDrift', () => {
  const wanted = { timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } };

  it('una VM già allineata non merita un round-trip: null', async () => {
    const { sandboxConfigDrift } = await import('./sandbox');
    expect(
      sandboxConfigDrift({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } }, wanted)
    ).toBeNull();
  });

  it('un affitto più corto di quanto serve va alzato — è il render che moriva a metà', async () => {
    const { sandboxConfigDrift } = await import('./sandbox');
    const drift = sandboxConfigDrift(
      { timeout: 120_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } },
      wanted
    );
    expect(drift).toEqual({ timeout: 600_000 });
  });

  /**
   * La direzione è la parte pericolosa. La sandbox è del BRAND: mentre un turno da 40s la apre,
   * un render dello stesso brand può avere una sessione in corso con 900s. `update` documenta solo
   * l'aumento come sicuro sulla sessione viva («the running session's deadline is also extended»);
   * sull'abbassamento tace. Tacere su una sessione altrui vuol dire: non si tocca.
   */
  it('NON abbassa mai: sotto c’è la sessione di un altro turno', async () => {
    const { sandboxConfigDrift } = await import('./sandbox');
    const drift = sandboxConfigDrift(
      { timeout: 900_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } },
      wanted
    );
    expect(drift).toBeNull();
  });

  it('un timeout che la VM non sa dire viene scritto, non indovinato', async () => {
    const { sandboxConfigDrift } = await import('./sandbox');
    expect(sandboxConfigDrift({ snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } }, wanted)).toEqual({
      timeout: 600_000
    });
  });

  it('anche la retention degli snapshot era un no-op: se diverge, si riallinea', async () => {
    const { sandboxConfigDrift } = await import('./sandbox');
    expect(
      sandboxConfigDrift({ timeout: 900_000, snapshotExpiration: 0, keepLastSnapshots: { count: 9 } }, wanted)
    ).toEqual({ snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
  });
});

describe('openBrandSandbox riallinea la VM che esisteva già', () => {
  beforeEach(() => getOrCreate.mockReset());

  it('chiama `update` quando la configurazione della VM non è quella che abbiamo chiesto', async () => {
    const sb = fakeSandbox({ timeout: 120_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    getOrCreate.mockResolvedValue(sb);
    const { openBrandSandbox } = await import('./sandbox');

    await openBrandSandbox({ brandId: 'b1', mode: 'compute', timeoutMs: 600_000, runId: 'r1' });

    expect(sb.update).toHaveBeenCalledTimes(1);
    expect(sb.update.mock.calls[0][0]).toEqual({ timeout: 600_000 });
  });

  it('e NON lo chiama su una VM appena creata, che i parametri li ha già ricevuti', async () => {
    const sb = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    getOrCreate.mockResolvedValue(sb);
    const { openBrandSandbox } = await import('./sandbox');

    await openBrandSandbox({ brandId: 'b1', mode: 'compute', timeoutMs: 600_000, runId: 'r2' });

    expect(sb.update).not.toHaveBeenCalled();
  });

  /**
   * Un update fallito non deve uccidere una run che funzionerebbe lo stesso — ma non può nemmeno
   * sparire: chi ci divide sopra un budget (`render-tools.ts`) deve poter leggere che l'affitto
   * reale non è quello che ha chiesto.
   */
  it('se `update` fallisce, la run continua e il log dice qual è l’affitto vero', async () => {
    const sb = fakeSandbox({ timeout: 120_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    sb.update.mockRejectedValue(new Error('403 forbidden'));
    getOrCreate.mockResolvedValue(sb);
    const { openBrandSandbox } = await import('./sandbox');

    const lines: string[] = [];
    const handle = await openBrandSandbox({
      brandId: 'b1',
      mode: 'compute',
      timeoutMs: 600_000,
      runId: 'r3',
      onLog: (l) => lines.push(l)
    });

    expect(handle.name).toContain('b1');
    const failure = lines.find((l) => l.includes('update FALLITO'));
    expect(failure).toBeTruthy();
    expect(failure).toContain('120000');
    expect(failure).toContain('600000');
  });

  it('una VM failed non si usa: si riapre su un nome fratello', async () => {
    const dead = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (dead as { status: string }).status = 'failed';
    const live = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (live as { status: string }).status = 'running';
    getOrCreate.mockResolvedValueOnce(dead).mockResolvedValueOnce(live);
    const { openBrandSandbox, recycleSandboxName, sandboxName } = await import('./sandbox');

    const lines: string[] = [];
    const handle = await openBrandSandbox({
      brandId: 'b1',
      mode: 'research',
      lane: 'motion',
      timeoutMs: 600_000,
      runId: 'r4',
      onLog: (l) => lines.push(l)
    });

    expect(getOrCreate).toHaveBeenCalledTimes(2);
    const firstName = (getOrCreate.mock.calls[0][0] as { name: string }).name;
    const secondName = (getOrCreate.mock.calls[1][0] as { name: string }).name;
    expect(firstName).toBe(sandboxName('b1'));
    expect(secondName).toBe(recycleSandboxName(firstName));
    expect(handle.name).toBe(secondName);
    expect(lines.some((l) => l.includes('failed'))).toBe(true);
  });

  it('una VM stopped si tiene: withResume la riprende, riciclarla butta la cache', async () => {
    const stopped = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (stopped as { status: string }).status = 'stopped';
    getOrCreate.mockResolvedValue(stopped);
    const { openBrandSandbox, sandboxName } = await import('./sandbox');

    const handle = await openBrandSandbox({
      brandId: 'b1',
      mode: 'research',
      lane: 'motion',
      timeoutMs: 600_000,
      runId: 'r5'
    });

    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect((getOrCreate.mock.calls[0][0] as { name: string }).name).toBe(
      sandboxName('b1')
    );
    expect(handle.name).toBe(sandboxName('b1'));
  });

  it('il fratello stopped si tiene: è riprendibile, non un secondo cadavere', async () => {
    const dead = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (dead as { status: string }).status = 'aborted';
    const stopped = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (stopped as { status: string }).status = 'stopped';
    getOrCreate.mockResolvedValueOnce(dead).mockResolvedValueOnce(stopped);
    const { openBrandSandbox } = await import('./sandbox');

    const handle = await openBrandSandbox({
      brandId: 'b1',
      mode: 'research',
      lane: 'motion',
      timeoutMs: 600_000,
      runId: 'r7'
    });

    expect(getOrCreate).toHaveBeenCalledTimes(2);
    expect(handle.name).toBe((getOrCreate.mock.calls[1][0] as { name: string }).name);
  });

  it('se anche il fratello è failed, si fallisce invece di aprire una famiglia', async () => {
    const dead = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (dead as { status: string }).status = 'failed';
    const alsoDead = fakeSandbox({ timeout: 600_000, snapshotExpiration: WEEK, keepLastSnapshots: { count: 2 } });
    (alsoDead as { status: string }).status = 'aborted';
    getOrCreate.mockResolvedValueOnce(dead).mockResolvedValueOnce(alsoDead);
    const { openBrandSandbox } = await import('./sandbox');

    await expect(
      openBrandSandbox({
        brandId: 'b1',
        mode: 'research',
        lane: 'motion',
        timeoutMs: 600_000,
        runId: 'r6'
      })
    ).rejects.toThrow(/failed VM cannot run commands|aborted/i);
  });
});

/**
 * LA RETE DELLA MACCHINA UNICA.
 *
 * Con tre VM la policy la sceglieva il chiamante: `compute`/`agent` chiusi, `research` aperto.
 * Con una sola macchina non si può: la policy si fissa alla CREAZIONE, quindi «chi arriva primo
 * decide» avrebbe reso la rete del brand una lotteria — chiusa se il turno partiva da un job,
 * aperta se partiva dalla chat.
 *
 * Vince `research`, perché è la macchina dell'harness e perché senza internet il desktop e il
 * render Motion non funzionano. Il prezzo, dichiarato: `shell` gira ora su una VM con internet
 * aperto e con lo snapshot del brand sullo stesso disco — quello che la lane `agent` teneva
 * separato. Le subnet private restano negate.
 */
describe('la rete della VM unica', () => {
  it('qualunque profilo chieda il chiamante, la macchina nasce con la rete dell’harness', async () => {
    const { openBrandSandbox } = await import('./sandbox');
    for (const mode of ['compute', 'agent', 'research'] as const) {
      getOrCreate.mockClear();
      getOrCreate.mockResolvedValue(fakeSandbox());
      await openBrandSandbox({ brandId: 'b1', mode, timeoutMs: 300_000, runId: 'r1' });
      const params = getOrCreate.mock.calls.at(-1)?.[0] as { networkPolicy?: { allow?: string[]; subnets?: { deny?: string[] } } };
      expect(params.networkPolicy?.allow).toContain('*');
      expect(params.networkPolicy?.subnets?.deny).toContain('169.254.0.0/16');
    }
  });
});


/**
 * IL PANNELLO SA CHE LA MACCHINA È ACCESA, chiunque l'abbia accesa.
 *
 * Prima la riga di `agent_computers` la scriveva solo la rotta del desktop: un render Motion
 * apriva la VM per dieci minuti e la card continuava a dire «non è mai stata accesa». Lo stato lo
 * pubblica il PUNTO in cui la macchina si apre — uno solo, così nessun chiamante può scordarselo.
 */
describe('aprire una VM pubblica lo stato del computer', () => {
  it('pubblica per l’agente che l’ha aperta', async () => {
    published.length = 0;
    getOrCreate.mockResolvedValue(fakeSandbox());
    const { openBrandSandbox } = await import('./sandbox');
    await openBrandSandbox({ brandId: 'b1', mode: 'research', agentId: 'motion', timeoutMs: 300_000, runId: 'r1' });
    expect(published).toEqual([{ brandId: 'b1', refName: 'anomalia-b1-motion-g5', agentId: 'motion' }]);
  });

  it('senza agente pubblica la macchina del brand', async () => {
    published.length = 0;
    getOrCreate.mockResolvedValue(fakeSandbox());
    const { openBrandSandbox } = await import('./sandbox');
    await openBrandSandbox({ brandId: 'b1', mode: 'research', timeoutMs: 300_000, runId: 'r1' });
    expect(published[0]?.agentId).toBeUndefined();
  });
});


/**
 * LEGGERE UN FILE DALLA VM, e ottenere il file.
 *
 * `readFile` dell'SDK ritorna uno ReadableStream: l'handle lo passava a `String()`, che dà
 * «[object Object]». Il confronto in `ensureProject` non poteva quindi mai riuscire, e OGNI render
 * reinstallava Remotion — secondi su una macchina calda, minuti su una fredda, e un comando in più
 * da far morire quando il turno è corto.
 */
describe('handle.read', () => {
  it('torna il contenuto del file, non la stringa di un oggetto', async () => {
    getOrCreate.mockResolvedValue(fakeSandbox());
    const { openBrandSandbox } = await import('./sandbox');
    const handle = await openBrandSandbox({ brandId: 'b1', mode: 'research', timeoutMs: 300_000, runId: 'r1' });
    expect(await handle.read('.anomalia/motion-render/package.json')).toBe('{"name":"motion-render"}');
  });
});
