import { describe, expect, it } from 'vitest';

import {
  BROWSE_SCRIPT,
  DENIED_SUBNETS,
  GITHUB_DOMAINS,
  PACKAGE_DOMAINS,
  buildNetworkPolicy,
  clampOutput,
  commandRejection,
  describeSandboxDeath,
  isSandboxStreamClosed,
  recycleSandboxName,
  runRootFor,
  sandboxIsDead,
  sandboxName,
  underRoot
} from './sandbox';

describe('buildNetworkPolicy', () => {
  it('compute non apre internet: solo i registry dei pacchetti', () => {
    const p = buildNetworkPolicy('compute');
    expect(typeof p).toBe('object');
    const policy = p as { allow: string[] };
    expect(policy.allow).not.toContain('*');
    for (const d of PACKAGE_DOMAINS) expect(policy.allow).toContain(d);
  });

  it('research apre la navigazione ma non verso l’interno', () => {
    const p = buildNetworkPolicy('research') as { allow: string[]; subnets?: { deny?: string[] } };
    expect(p.allow).toContain('*');
    // Il metadata service è il modo classico di farsi dare le credenziali della macchina.
    expect(p.subnets?.deny).toContain('169.254.0.0/16');
  });

  it('le subnet private sono negate in TUTTI i profili', () => {
    for (const mode of ['compute', 'research', 'agent'] as const) {
      const p = buildNetworkPolicy(mode) as { subnets?: { deny?: string[] } };
      for (const cidr of DENIED_SUBNETS) expect(p.subnets?.deny).toContain(cidr);
    }
  });

  it('agent — la VM degli specialisti kit — non apre internet: `research` resta l’unico profilo che lo fa', () => {
    const p = buildNetworkPolicy('agent') as { allow: string[] };
    expect(p.allow).not.toContain('*');
    for (const d of PACKAGE_DOMAINS) expect(p.allow).toContain(d);
  });

  it('compute raggiunge GitHub: il token del device login deve essere usabile subito', () => {
    const p = buildNetworkPolicy('compute') as { allow: string[] };
    for (const d of GITHUB_DOMAINS) expect(p.allow).toContain(d);
  });

  it('i domini extra li aggiunge solo l’operatore, e solo in compute', () => {
    const p = buildNetworkPolicy('compute', ['api.interno.example']) as { allow: string[] };
    expect(p.allow).toContain('api.interno.example');
  });
});

describe('clampOutput', () => {
  it('lascia stare un output che ci sta', () => {
    expect(clampOutput('ok').text).toBe('ok');
    expect(clampOutput('ok').truncated).toBe(false);
  });

  it('tiene testa E coda: un errore di compilazione sta in cima, uno stack in fondo', () => {
    const long = `INIZIO${'x'.repeat(5000)}FINE`;
    const out = clampOutput(long, 1000);
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith('INIZIO')).toBe(true);
    expect(out.text.endsWith('FINE')).toBe(true);
    expect(out.text.length).toBeLessThan(long.length);
  });
});

describe('commandRejection', () => {
  it('lascia passare il lavoro vero', () => {
    for (const c of ['python3', 'node', 'npm', 'bash', '/usr/bin/ffmpeg']) {
      expect(commandRejection(c)).toBeNull();
    }
  });

  it('ferma i comandi che gestiscono la VM, anche col percorso davanti', () => {
    expect(commandRejection('shutdown')).toBeTruthy();
    expect(commandRejection('/sbin/reboot')).toBeTruthy();
    expect(commandRejection('mkfs')).toBeTruthy();
  });

  it('un comando vuoto è un errore, non un no-op', () => {
    expect(commandRejection('')).toBeTruthy();
    expect(commandRejection('   ')).toBeTruthy();
  });
});

/**
 * UNA MACCHINA SOLA PER BRAND — decisione del proprietario, 26/8.
 *
 * Erano tre: `research` per l'harness e `sandbox_browse`, `research`+`motion` per Remotion,
 * `agent` per il computer (`observe`/`act`, lo schermo del pannello). Tre macchine vuol dire tre
 * affitti, tre installazioni di Chromium, tre snapshot — e soprattutto un utente che guarda «il
 * computer dell'agente» mentre il `shell` dell'agente gira su un'altra macchina.
 *
 * Da qui in poi il nome NON dipende più da mode né da lane: chiunque chieda la sandbox di un
 * brand atterra sulla stessa VM, quella dell'harness.
 */
describe('sandboxName', () => {
  const AGENT_A = 'motion';
  const AGENT_B = '7d1f2c44-8e6a-4b90-9c31-2f5a0d8e1b77';

  /**
   * UNA MACCHINA PER AGENTE, non per brand — decisione del proprietario, 26/8.
   *
   * Per brand era peggio di com'era prima: lo schermo `:1` è uno solo, quindi due agenti dello
   * stesso brand che usano `observe`/`act` insieme si muovono il mouse a vicenda, e chi guarda il
   * desktop vede un altro che gli scrive dentro. Ogni agente ha la sua macchina, il suo schermo,
   * il suo profilo Chrome.
   */
  it('agenti diversi dello stesso brand non condividono la macchina', () => {
    expect(sandboxName(brand, AGENT_A)).not.toBe(sandboxName(brand, AGENT_B));
  });

  it('lo stesso agente torna sempre sulla sua', () => {
    expect(sandboxName(brand, AGENT_A)).toBe(sandboxName(brand, AGENT_A));
  });

  it('un id lungo (agente custom, uuid) non sfonda il limite dei 63 caratteri', () => {
    expect(sandboxName(brand, AGENT_B).length).toBeLessThanOrEqual(63);
    expect(sandboxName('x'.repeat(200), AGENT_B).length).toBeLessThanOrEqual(63);
  });

  it('senza agente resta una macchina sola per brand: i lavori che non hanno un agente', () => {
    expect(sandboxName(brand)).toBe(sandboxName(brand));
    expect(sandboxName(brand)).not.toBe(sandboxName(brand, AGENT_A));
  });

  it('brand diversi restano macchine diverse', () => {
    expect(sandboxName('b1')).not.toBe(sandboxName('b2'));
  });

  const brand = '11111111-2222-3333-4444-555555555555';

  /**
   * Il nome NON porta più il profilo di rete. Portarlo significava una VM per profilo — tre per
   * brand — e la separazione che difendeva (il `shell` del kit lontano da `.github.env` e dallo
   * snapshot del brand) ora non passa più dal nome: passa dalla policy che il chiamante chiede
   * alla creazione e dai guard sui percorsi. È una perdita dichiarata, non un incidente:
   * la decisione del 26/8 è una macchina sola per brand.
   */
  /**
   * Il profilo di rete NON è più un parametro del nome: la policy si fissa alla creazione ed è
   * una sola (`UNIFIED_NETWORK_MODE`). Quello che separa le macchine è l'agente.
   */
  it('sta nel limite dei nomi', () => {
    expect(sandboxName('x'.repeat(200)).length).toBeLessThanOrEqual(63);
  });
});

describe('runRootFor / underRoot', () => {
  it('ogni run ha la sua directory: due turni dello stesso brand stanno nella stessa VM', () => {
    expect(runRootFor('aaa')).not.toBe(runRootFor('bbb'));
    expect(runRootFor('aaa').startsWith('runs/')).toBe(true);
  });

  it('un runId sporco non diventa un path', () => {
    expect(runRootFor('../../etc')).toBe('runs/etc');
    expect(runRootFor('')).toBe('runs/run');
    expect(runRootFor('a/b')).toBe('runs/ab');
  });

  it('i path del modello finiscono sotto la radice della sua run', () => {
    const root = runRootFor('r1');
    expect(underRoot(root, 'work/x.py')).toBe(`${root}/work/x.py`);
    expect(underRoot(root, './out.png')).toBe(`${root}/out.png`);
  });
});

describe('BROWSE_SCRIPT', () => {
  it('stampa JSON e chiude sempre il browser', () => {
    expect(BROWSE_SCRIPT).toContain('JSON.stringify');
    expect(BROWSE_SCRIPT).toContain('finally');
    expect(BROWSE_SCRIPT).toContain('browser.close()');
  });

  it('passa --no-first-run agli avvii effettivi di Chromium', () => {
    expect(BROWSE_SCRIPT).toContain(
      "const args = ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run'];"
    );
  });

  /**
   * SEMPRE HEADLESS. Il desktop grafico non fa più parte del prodotto: non c'è uno schermo da
   * riempire, e un lancio a vista su una VM senza display costava solo un tentativo fallito.
   */
  it('naviga sempre headless, senza display da cercare', () => {
    expect(BROWSE_SCRIPT).toContain('headless: true');
    expect(BROWSE_SCRIPT).not.toContain('headless: false');
    expect(BROWSE_SCRIPT).not.toContain('DISPLAY');
    expect(BROWSE_SCRIPT).not.toContain('X11-unix');
  });
});

describe('commandFailure (via il messaggio di provisioning)', () => {
  /**
   * La regressione da cui nasce: il primo errore utile arrivato dalla produzione era
   * `chromium download failed (exit 1): ` — stderr vuoto, perché `playwright install` scrive su
   * stdout. Il motivo c'era e lo buttava via il messaggio.
   */
  it('un comando che parla solo su stdout non deve produrre un messaggio muto', async () => {
    const { formatCommandFailure } = await import('./sandbox');
    const msg = formatCommandFailure('chromium download', {
      exitCode: 1,
      stdout: 'Error: Download failed: size mismatch',
      stderr: '',
      truncated: false,
      durationMs: 10
    });
    expect(msg).toContain('exit 1');
    expect(msg).toContain('size mismatch');
  });

  it('quando entrambi i flussi tacciono, lo dice invece di lasciare il vuoto', async () => {
    const { formatCommandFailure } = await import('./sandbox');
    const msg = formatCommandFailure('chromium download', {
      exitCode: 1,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: 10
    });
    expect(msg).toContain('no output on either stream');
  });
});

describe('resolvePlaywrightEnv', () => {
  /** L'errore vero dalla produzione: `Playwright does not support chromium on ubuntu26.04-x64`. */
  it('su una Ubuntu che Playwright non conosce forza la piattaforma più recente nota', async () => {
    const { resolvePlaywrightEnv } = await import('./sandbox');
    const env = resolvePlaywrightEnv('ubuntu 26.04', 'x86_64');
    expect(env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE).toBe('ubuntu24.04-x64');
  });

  /**
   * La regressione che è costata un giro intero: l'override senza suffisso di architettura produce
   * una piattaforma che non esiste, e il download muore con lo stesso errore di prima —
   * `does not support chromium on ubuntu24.04`, stavolta senza `-x64`. Playwright compone
   * l'identificativo come `"ubuntu24.04" + archSuffix`, e il suffisso non è opzionale.
   */
  it('l’identificativo porta SEMPRE il suffisso di architettura', async () => {
    const { resolvePlaywrightEnv } = await import('./sandbox');
    for (const machine of ['x86_64', 'aarch64', '']) {
      const v = resolvePlaywrightEnv('ubuntu 26.04', machine).PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
      expect(v).toMatch(/-(x64|arm64)$/);
    }
  });

  it('riconosce arm64 invece di cablare x64', async () => {
    const { resolvePlaywrightEnv } = await import('./sandbox');
    expect(resolvePlaywrightEnv('ubuntu 26.04', 'aarch64').PLAYWRIGHT_HOST_PLATFORM_OVERRIDE).toBe('ubuntu24.04-arm64');
  });

  it('su una distro nota NON mente: nessun override', async () => {
    const { resolvePlaywrightEnv } = await import('./sandbox');
    for (const d of ['ubuntu 24.04', 'ubuntu 22.04', 'ubuntu 20.04']) {
      expect(resolvePlaywrightEnv(d).PLAYWRIGHT_HOST_PLATFORM_OVERRIDE).toBeUndefined();
    }
  });

  it('i binari hanno sempre una destinazione esplicita, non ~/.cache', async () => {
    const { resolvePlaywrightEnv } = await import('./sandbox');
    expect(resolvePlaywrightEnv('ubuntu 26.04').PLAYWRIGHT_BROWSERS_PATH).toBeTruthy();
    expect(resolvePlaywrightEnv('amzn 2023').PLAYWRIGHT_BROWSERS_PATH).toBeTruthy();
  });
});


describe('una VM terminated non è riprendibile in volo', () => {
  it('riconosce i cadaveri SDK, e NON tratta stopped come morto (withResume lo riprende)', () => {
    expect(sandboxIsDead({ status: 'failed' })).toBe(true);
    expect(sandboxIsDead({ status: 'aborted' })).toBe(true);
    expect(sandboxIsDead({ status: 'terminated' })).toBe(true);
    expect(sandboxIsDead({ status: 'stopped' })).toBe(false);
    expect(sandboxIsDead({ status: 'stopping' })).toBe(false);
    expect(sandboxIsDead({ status: 'snapshotting' })).toBe(false);
    expect(sandboxIsDead({ status: 'pending' })).toBe(false);
    expect(sandboxIsDead({ status: 'running' })).toBe(false);
    expect(sandboxIsDead({})).toBe(false);
  });

  it('il nome riciclato resta nel tetto dei 63 caratteri e diverge', () => {
    const name = sandboxName('11111111-2222-3333-4444-555555555555', 'research', 'motion');
    const recycled = recycleSandboxName(name);
    expect(recycled).not.toBe(name);
    expect(recycled.length).toBeLessThanOrEqual(63);
    expect(recycleSandboxName(recycled)).not.toBe(recycled);
    expect(recycleSandboxName(name.repeat(3).slice(0, 63)).length).toBeLessThanOrEqual(63);
  });

  it('un nome già a 63 che finisce in b non è un no-op (stesso cadavere)', () => {
    const name = `${'x'.repeat(62)}b`;
    expect(name.length).toBe(63);
    const recycled = recycleSandboxName(name);
    expect(recycled).not.toBe(name);
    expect(recycled.length).toBeLessThanOrEqual(63);
  });

  it('FAILED in maiuscolo è comunque un cadavere; uno status assente no', () => {
    expect(sandboxIsDead({ status: 'FAILED' })).toBe(true);
    expect(sandboxIsDead({ status: 'Aborted' })).toBe(true);
    expect(sandboxIsDead({ status: 410 })).toBe(false);
  });

  it('«Sandbox stream was closed» non è un errore del TSX: si dice di riprovare lo STESSO id', () => {
    expect(isSandboxStreamClosed(new Error('Sandbox stream was closed'))).toBe(true);
    const wrapped = describeSandboxDeath(new Error('Sandbox stream was closed'));
    expect(wrapped.message).toMatch(/SAME video id/i);
    expect(wrapped.message).toMatch(/Do not create a new composition/i);
  });

  it('un errore di remotion non viene mascherato da un messaggio sulla VM', () => {
    const e = new Error('remotion render failed: TypeError at frame 47');
    expect(describeSandboxDeath(e)).toBe(e);
  });

  it('un upload/fetch “terminated” non diventa un consiglio di cambiare id', () => {
    const e = new Error('MP4 upload failed: Connection terminated');
    expect(isSandboxStreamClosed(e)).toBe(false);
    expect(describeSandboxDeath(e)).toBe(e);
  });

  it('uno stream chiuso generico (non sandbox) resta quello che è', () => {
    const e = new Error('The stream was closed');
    expect(isSandboxStreamClosed(e)).toBe(false);
    expect(describeSandboxDeath(e)).toBe(e);
  });

  it('lo stream close avvolto in cause (Command failed) è comunque morte della VM', () => {
    const e = new Error('Command failed');
    e.cause = new Error('Sandbox stream was closed');
    expect(isSandboxStreamClosed(e)).toBe(true);
    expect(describeSandboxDeath(e).message).toMatch(/SAME video id/i);
  });

  it('status 410 sulla sandbox si riconosce; un 410 di un altro servizio no se non è sandbox', () => {
    expect(isSandboxStreamClosed(new Error('getOrCreate failed: status 410'))).toBe(true);
    expect(isSandboxStreamClosed(new Error('R2 PUT status 404'))).toBe(false);
  });
});

describe('release() spegne la macchina solo quando è l’ultimo holder', () => {
  /**
   * Le docs di Vercel dicono «Call sandbox.stop() when done» e la mediana di un turno è 40,6 s
   * contro un lease fino a 900 s: la differenza si paga. Ma la VM è condivisa: uno `stop()` diretto
   * spegnerebbe la macchina sotto un altro turno o sotto chi guarda il desktop. La decisione sta in
   * `releaseHolder` (sandbox-leases.ts), che conta gli holder vivi e ferma solo l'ultima uscita.
   *
   * Questo test rifiuta l'imitazione: uno `stop()` inline qui torna a pagare lease interi per
   * turni brevi E a spegnere la VM sotto gli altri — fallisce qui, non in produzione.
   */
  it('nessuno `.stop()` diretto nel codice di sandbox.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./sandbox.ts', import.meta.url), 'utf8');
    // Solo il CODICE: nei commenti la citazione dei docs contiene `sandbox.stop()` apposta.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/\.stop\s*\(/);
  });

  it('e la mano alla contabilità c’è: la release passa la VM a chi conta gli holder', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./sandbox.ts', import.meta.url), 'utf8');
    expect(src).toContain('releaseHolder(holderId');
    expect(src).toContain("from './sandbox-leases'");
  });
});
