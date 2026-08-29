/**
 * Vercel Sandbox: una microVM per brand (filesystem, terminale, Node, Python, Chromium).
 *
 * Tre profili, mai negoziabili dal modello — uno per LANE, perché il nome della VM li tiene
 * separati (`sandboxName`) e la policy di rete si fissa alla creazione: `compute` è la VM
 * dell'orchestratore classico (deny-all più i soli registry, i dati del brand su disco, il token
 * GitHub del device login), `research` apre internet ma NEGA le subnet private e non riceve dati
 * del brand, `agent` è la macchina degli specialisti kit — rete chiusa come `compute`, ma una VM
 * sua, senza credenziali e senza lo snapshot del brand. In nessuno dei tre passa `process.env`:
 * la VM riceve solo le variabili che le scriviamo una per una.
 *
 * Persistente e per brand perché installare Chromium costa un minuto o due e va pagato una volta
 * sola. Persiste l'AMBIENTE, non i dati: ogni run vive in `runs/<id>/` (vedi `runRootFor`), rimossa
 * alla chiusura — altrimenti due turni dello stesso brand si riscriverebbero i file a vicenda e
 * l'agente leggerebbe lo storico di tre settimane fa credendolo presente.
 *
 * Senza configurazione `isSandboxConfigured()` è falso e i tool spariscono: niente hard-fail.
 */
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { acquireHolder, releaseHolder } from './sandbox-leases';
import { DESKTOP_PORT, DISPLAY, X_SOCKET } from '@anomalia/agent-adapters/graphical-bootstrap';

/** `research` è l'UNICO profilo con internet aperto: `compute` e `agent` vedono solo i registry. */
export type SandboxNetworkMode = 'compute' | 'research' | 'agent';

/**
 * Il profilo con cui nasce l'unica VM del brand. `mode` resta nella firma dei chiamanti perché
 * dice ancora l'INTENZIONE (e la userebbe una macchina per profilo, se un giorno tornassero), ma
 * la rete effettiva è una sola — vedi il commento su `networkPolicy` in `openBrandSandbox`.
 */
const UNIFIED_NETWORK_MODE: SandboxNetworkMode = 'research';

/** Registry dei pacchetti: il minimo per far girare `npm i` / `pip install` in modalità compute. */
export const PACKAGE_DOMAINS = [
  'registry.npmjs.org',
  '*.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  '*.pythonhosted.org'
] as const;

/** CDN da cui Playwright scarica i binari del browser. Servono solo in provisioning. */
export const BROWSER_DOMAINS = ['playwright.azureedge.net', 'cdn.playwright.dev', '*.playwright.dev'] as const;

/**
 * I mirror apt da cui `graphical-bootstrap.ts` installa Xvfb/xdotool/ImageMagick. Verificati con
 * `apt-cache policy` sull'immagine reale: sono gli unici host che `apt-get update` contatta, non
 * una lista a occhio.
 */
export const DESKTOP_DOMAINS = ['archive.ubuntu.com', 'security.ubuntu.com'] as const;

/**
 * GitHub, per il profilo `compute`: il minimo perché il token di `sandbox_device_login` sia usabile
 * dalla VM. Il device flow lo fa il server, non la VM, quindi qui non serve altro.
 */
export const GITHUB_DOMAINS = ['github.com', 'api.github.com'] as const;

/**
 * Mai raggiungibili, nemmeno navigando: link-local (169.254.169.254 è il metadata service AWS),
 * loopback e le tre RFC1918. Una "ricerca web" che finisce su un IP privato non è una ricerca web.
 */
export const DENIED_SUBNETS = [
  '169.254.0.0/16',
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16'
] as const;

/** La forma che `@vercel/sandbox` accetta per `networkPolicy`. */
export type SandboxNetworkPolicy =
  | 'allow-all'
  | 'deny-all'
  | { allow: string[]; subnets?: { allow?: string[]; deny?: string[] } };

/** La policy di rete per un profilo. Pura di proposito: decide cosa la VM può toccare. */
export function buildNetworkPolicy(mode: SandboxNetworkMode, extraDomains: string[] = []): SandboxNetworkPolicy {
  const extra = extraDomains.map((d) => d.trim()).filter(Boolean);
  if (mode === 'research') {
    // I domini da navigare non si conoscono in anticipo: il confine vero è `subnets.deny`.
    return { allow: ['*'], subnets: { deny: [...DENIED_SUBNETS] } };
  }
  return {
    // ponytail: DESKTOP_DOMAINS sempre presenti invece che dietro un flag "graphical" — un
    // `provision()` in più da cablare per due host non vale la complessità.
    allow: [...PACKAGE_DOMAINS, ...BROWSER_DOMAINS, ...GITHUB_DOMAINS, ...DESKTOP_DOMAINS, ...extra],
    subnets: { deny: [...DENIED_SUBNETS] }
  };
}

/** Domini extra concessi dall'operatore (mai dal modello): `SANDBOX_ALLOWED_DOMAINS=a.com,b.org`. */
export function configuredExtraDomains(): string[] {
  return (env.SANDBOX_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * In una Vercel Function l'OIDC NON è una env var: è l'header `x-vercel-oidc-token` sulla request,
 * esposto via il request context globale (`VERCEL_OIDC_TOKEN` esiste solo in build). Un gate che
 * guardasse solo la env sarebbe sempre falso in produzione — tool spariti, zero errori.
 */
const REQ_CONTEXT = Symbol.for('@vercel/request-context');

/**
 * Esportata perché `adapters/vercel-sandbox.ts` risolva le STESSE credenziali con cui
 * `openBrandSandbox` ha aperto la VM, invece di calcolarne di sue.
 */
export function oidcTokenFromRequestContext(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (globalThis as any)[REQ_CONTEXT]?.get?.();
    const token = ctx?.headers?.['x-vercel-oidc-token'];
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Il tetto dell'affitto — **nostro, non della piattaforma**: Vercel consente 24h per sessione, noi
 * stiamo a 15 minuti per la bolletta. Provisioned Memory `iad1` costa $0,0212/GB-ora a orologio
 * anche mentre la VM aspetta un modello: 2 vCPU = 4 GB ≈ $62/mese per VM sempre accesa, e teniamo
 * DUE nomi per brand. Alzarlo è una decisione del proprietario; il confronto da fare non è «15
 * minuti contro 24 ore» ma «$62/mese × quante VM restano accese».
 *
 * Esportato perché chi divide un budget (render-tools.ts) sbatteva contro un numero che non poteva
 * leggere.
 */
export const SANDBOX_MAX_LEASE_MS = 15 * 60_000;

/** Retention degli snapshot. Qui e non inline, perché `sandboxConfigDrift` deve confrontarli. */
export const SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60_000;
export const KEEP_LAST_SNAPSHOTS = { count: 1 } as const;

export function isSandboxConfigured(): boolean {
  if (env.SANDBOX_DISABLED === '1') return false;
  if (env.VERCEL_OIDC_TOKEN) return true;
  if (oidcTokenFromRequestContext()) return true;
  return Boolean(explicitCredentials());
}

/**
 * Credenziali esplicite, per CI esterna e hosting non-Vercel. `VERCEL_TOKEN` è il nome canonico;
 * `SANDBOX_VERCEL_TOKEN` resta come alias storico. Su Vercel vince comunque l'OIDC.
 */
export function explicitCredentials(): { token: string; teamId: string; projectId: string } | null {
  const token = env.VERCEL_TOKEN || env.SANDBOX_VERCEL_TOKEN;
  const teamId = env.VERCEL_TEAM_ID;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !teamId || !projectId) return null;
  return { token, teamId, projectId };
}

/** Un output di comando più lungo di così non è una risposta: è il contesto del turno che brucia. */
export const MAX_OUTPUT_CHARS = 20_000;

export function clampOutput(text: string, max = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  const t = text ?? '';
  if (t.length <= max) return { text: t, truncated: false };
  // Testa e coda: lo stack trace utile sta in fondo, l'errore di compilazione in cima.
  const head = t.slice(0, Math.floor(max * 0.6));
  const tail = t.slice(-Math.floor(max * 0.3));
  return { text: `${head}\n\n…[${t.length - head.length - tail.length} caratteri omessi]…\n\n${tail}`, truncated: true };
}

/**
 * Paraurti contro un modello che ha frainteso dove si trova, non isolamento (quello è la microVM):
 * un errore leggibile invece di un comando che gira per dieci minuti.
 */
const BLOCKED_COMMANDS = new Set(['shutdown', 'reboot', 'halt', 'poweroff', 'mkfs', 'mount', 'umount']);

export function commandRejection(cmd: string): string | null {
  const bare = (cmd ?? '').trim().split(/[\s/]+/).pop() ?? '';
  if (!bare) return 'Empty command';
  if (BLOCKED_COMMANDS.has(bare)) {
    return `\`${bare}\` is not available inside the sandbox — it manages the VM, not your work.`;
  }
  return null;
}

/**
 * Da alzare quando cambia COME la sandbox viene provisionata (immagine, versione di Playwright,
 * boot): `getOrCreate` riprende per nome, quindi senza un nome nuovo un brand continuerebbe a
 * riprendere la VM sbagliata e il fix non lo raggiungerebbe mai.
 *
 * `g4`: da qui c'è UNA macchina per brand (vedi `sandboxName`), con `ports` e immagine desktop —
 * e sono entrambi parametri di CREAZIONE, che `getOrCreate` su un nome esistente ignora. Senza un
 * nome nuovo un brand riprenderebbe la vecchia VM senza porta e senza desktop, per sempre.
 *
 * `g5`: l'immagine ha guadagnato `xclip` (gli appunti fra VM e dispositivo). Vale la regola qui
 * sopra: **ogni volta che si ripubblica l'immagine con contenuti nuovi che il codice USA, questa
 * generazione va alzata**, o le VM già nate restano indietro senza dirlo.
 */
export const SANDBOX_GENERATION = env.SANDBOX_GENERATION || 'g5';

/**
 * UNA MACCHINA PER AGENTE — non per profilo di rete, e nemmeno per brand.
 *
 * Erano tre nomi per brand (`research` per harness e browse, `r-motion` per Remotion, `agent` per
 * il computer): tre affitti, tre Chromium, tre snapshot, e un pannello che mostrava «il computer
 * dell'agente» mentre il `shell` dell'agente girava altrove. Averne una sola per brand ha chiuso
 * quella bugia e ne ha aperta un'altra, peggiore: **lo schermo `:1` è uno solo**, quindi due
 * agenti dello stesso brand che usano `observe`/`act` insieme si muovono il mouse a vicenda, e
 * chi ha preso il controllo del desktop se lo vede scrivere sotto le mani.
 *
 * Quindi la macchina è dell'AGENTE: schermo suo, profilo Chrome suo, disco suo. Si crea alla
 * prima volta che quell'agente ne ha bisogno — chi non tocca mai un computer non ne paga uno.
 *
 * L'id dell'agente entra ACCORCIATO: gli agenti custom sono uuid, e nome brand + uuid sfonderebbe
 * i 63 caratteri che la piattaforma accetta. Un digest breve è stabile e non collide in pratica
 * fra i pochi agenti di un brand.
 */
export function sandboxName(brandId: string, agentId?: string): string {
  const agent = agentId ? `-${shortAgentKey(agentId)}` : '';
  const room = 63 - `anomalia--${SANDBOX_GENERATION}`.length - agent.length;
  return `anomalia-${brandId.slice(0, room)}${agent}-${SANDBOX_GENERATION}`;
}

/** 8 caratteri stabili da un id qualunque: `motion` resta leggibile, un uuid diventa un digest. */
export function shortAgentKey(agentId: string): string {
  const clean = agentId.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean.length <= 8) return clean;
  let hash = 0x811c9dc5;
  for (const ch of agentId) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${clean.slice(0, 2)}${hash.toString(36)}`.slice(0, 8);
}

/**
 * Stati da cui `withResume` NON riparte. `stopped` / `stopping` / `snapshotting` NO: `runCommand`
 * fa resume (410/422). Riciclarli abbandonerebbe i 570 MB di Remotion per una VM fredda.
 * `terminated`/`error` non sono nell'enum SDK attuale; restano per se l'API li usa.
 */
const DEAD_SANDBOX_STATUSES = new Set(['failed', 'aborted', 'terminated', 'error']);

export function sandboxStatusOf(sandbox: { status?: unknown }): string | null {
  return typeof sandbox.status === 'string' && sandbox.status ? sandbox.status.toLowerCase() : null;
}

export function sandboxIsDead(sandbox: { status?: unknown }): boolean {
  const status = sandboxStatusOf(sandbox);
  return status != null && DEAD_SANDBOX_STATUSES.has(status);
}

/**
 * Un nome fratello quando `getOrCreate` restituisce un cadavere non riprendibile (`failed` /
 * `aborted`). Un hop solo per apertura: se anche il fratello è morto si fallisce, non si genera
 * una famiglia. Resta ≤63 caratteri. Non è un toggle verso l'originale.
 */
export function recycleSandboxName(name: string): string {
  const cut = name.slice(0, 62);
  const next = cut.endsWith('b') ? `${cut.slice(0, -1)}c` : `${cut}b`;
  // Nome già a 63 che finisce in `b`: `cut + 'b'` ricostruisce l'originale e `getOrCreate`
  // riprenderebbe lo stesso cadavere. Si cambia l'ultima lettera, non si allunga oltre il tetto.
  if (next === name) return `${name.slice(0, -1)}c`;
  return next;
}

function sandboxErrorText(error: unknown, depth = 0): string {
  if (depth > 5 || error == null) return '';
  if (error instanceof Error) {
    const cause = 'cause' in error ? sandboxErrorText(error.cause, depth + 1) : '';
    return `${error.message} ${cause}`.trim();
  }
  return String(error);
}

export function isSandboxStreamClosed(error: unknown): boolean {
  const msg = sandboxErrorText(error);
  // La frase vera dell'SDK, non un "stream was closed" qualsiasi (upload, fetch, ffmpeg).
  // Si cammina anche `error.cause`: l'SDK spesso avvolge lo stream close in "Command failed".
  return /sandbox stream was closed|sandbox.*(terminated|stopped|aborted)|status 410\b/i.test(msg);
}

/**
 * L'errore che il modello deve leggere: non è un difetto del TSX, e un id nuovo non cambia la VM.
 * Solo la morte della sandbox: un "Connection terminated" di Storage non deve diventare questo.
 */
export function describeSandboxDeath(error: unknown): Error {
  if (!isSandboxStreamClosed(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const detail = sandboxErrorText(error);
  return new Error(
    `The render VM shut down while a command was running (${detail}). In-flight sandbox commands are not resumed. The source is already saved — retry the render on the SAME video id from a fresh turn. Do not create a new composition: a new id still hits this brand's VM and does not overwrite the old gallery MP4 anyway.`
  );
}

/**
 * Lo script di navigazione: vive nella VM e si usa da riga di comando, così l'agente può comporlo
 * in una pipeline sua. Stampa JSON — titolo, testo ripulito, link, screenshot opzionale.
 *
 * A VISTA QUANDO C'È QUALCUNO CHE GUARDA. La VM è dell'agente e il suo schermo è uno solo: se
 * `${X_SOCKET}` esiste, il desktop è acceso e chi lo sta guardando deve vedere le pagine aprirsi.
 * Senza display si resta headless, che è anche il ripiego se il lancio a vista non regge — uno
 * schermo morto che lascia il socket dietro di sé non deve spegnere la navigazione.
 */
export const BROWSE_SCRIPT = `import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const [url, ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.map((a) => { const i = a.indexOf('='); return i < 0 ? [a, 'true'] : [a.slice(0, i), a.slice(i + 1)]; }));
if (!url) { console.error('usage: browse.mjs <url> [wait=selector] [screenshot=path] [maxChars=20000]'); process.exit(2); }

const args = ['--no-sandbox', '--disable-dev-shm-usage'];
const onScreen = existsSync('${X_SOCKET}');
const browser = onScreen
  ? await chromium
      .launch({ headless: false, args, env: { ...process.env, DISPLAY: '${DISPLAY}' } })
      .catch(() => chromium.launch({ headless: true, args }))
  : await chromium.launch({ headless: true, args });
try {
  const ctx = await browser.newContext({ userAgent: opts.ua || undefined, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(opts.timeout || 45000) });
  if (opts.wait) await page.waitForSelector(opts.wait, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(Number(opts.settle || 1200));
  const data = await page.evaluate(() => {
    for (const el of document.querySelectorAll('script,style,noscript,svg,iframe')) el.remove();
    const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => ({ text: (a.textContent || '').trim().slice(0, 120), href: a.href }))
      .filter((l) => l.text && l.href.startsWith('http'))
      .slice(0, 120);
    return { title: document.title, text, links };
  });
  if (opts.screenshot) await page.screenshot({ path: opts.screenshot, fullPage: opts.fullPage === 'true' });
  const max = Number(opts.maxChars || 20000);
  console.log(JSON.stringify({
    url: page.url(), status: res?.status() ?? null, title: data.title,
    text: data.text.slice(0, max), truncated: data.text.length > max,
    chars: data.text.length, links: data.links,
    screenshot: opts.screenshot || null
  }));
} catch (e) {
  console.log(JSON.stringify({ url, error: String(e && e.message ? e.message : e) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
`;

export type SandboxRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
};

export type SandboxFile = { path: string; content: string };

export type SandboxHandle = {
  name: string;
  mode: SandboxNetworkMode;
  /** La directory di lavoro di QUESTA run. Tutto ciò che il modello tocca sta sotto qui. */
  root: string;
  /** True quando Chromium + Playwright sono pronti in questa VM — e si sono avviati davvero. */
  browser: boolean;
  /** Perché il browser non c'è, quando non c'è. Arriva fino al rapporto del sotto-agente. */
  browserError?: string;
  /** `browser: false` non distingue "provato e fallito" da "mai tentato". Questo sì. */
  browserProvisioning: 'not_attempted' | 'cached' | 'ok' | 'failed';
  /** L'immagine con cui la VM è partita: metà delle domande su Chromium sono domande su questa. */
  image: string;
  /** L'istanza SDK grezza, per chi deve condividere la STESSA macchina (es. harness). */
  raw: object;
  /** L'ambiente Playwright risolto per QUESTA macchina: il browse deve usare lo stesso del download. */
  playwrightEnv: Record<string, string>;
  run(
    cmd: string,
    args?: string[],
    opts?: { cwd?: string; timeoutMs?: number; sudo?: boolean; env?: Record<string, string> }
  ): Promise<SandboxRunResult>;
  write(files: SandboxFile[]): Promise<void>;
  read(path: string): Promise<string>;
  readBuffer(path: string): Promise<Buffer>;
  /**
   * Chiude il ciclo di vita del chiamante: via la directory della run e via l'holder.
   *
   * NON chiama `sandbox.stop()` direttamente: la VM è condivisa e un altro holder — un turno
   * simultaneo, chi guarda il desktop — può essere ancora vivo. È `releaseHolder` a decidere:
   * cancellata la riga di questo chiamante, se era l'ultima la macchina si spegne; altrimenti
   * resta accesa per chi la usa. Gli holder scadono da soli (vedi `sandbox-leases.ts`), quindi un
   * processo serverless morto a metà turno non la tiene accesa per sempre.
   *
   * Il lease di `SANDBOX_MAX_LEASE_MS` resta la rete di sicurezza: se lo stop o la contabilità
   * falliscono, la macchina muore comunque alla scadenza.
   */
  release(): Promise<void>;
};

export const WORKSPACE_DIR = 'brand';

/**
 * La cassaforte della VM: `.anomalia/` (stato del device flow GitHub, marcatore del browser,
 * binari di Playwright) e `.github.env` (il token GitHub in chiaro). Senza questo confine un turno
 * può leggerli con `sandbox_read_file` e pubblicarli con `sandbox_save_output`. Sta qui, non nel
 * singolo tool, perché vale per chiunque prenda un path dal modello.
 */
export const SECRET_HOME_DIR = '.anomalia';
/** Il file d'ambiente della run: dentro c'è il token GitHub in chiaro (sandbox-device-login.ts). */
export const SECRET_ENV_FILE = '.github.env';

/**
 * Ogni SEGMENTO, non il prefisso: nessuna composizione furba del percorso gira il divieto. I `..`
 * li rifiuta prima `rejectReadPath`.
 */
export function isSecretPath(path: string): boolean {
  return (path ?? '').split('/').some((seg) => seg === SECRET_HOME_DIR || seg === SECRET_ENV_FILE);
}

/** Lo script di navigazione vive nella home, condiviso: è identico per ogni run. */
export const BROWSE_PATH = `${SECRET_HOME_DIR}/browse.mjs`;
/** Dove stanno le directory di lavoro delle singole run. */
export const RUNS_DIR = 'runs';

/**
 * Una directory per run, non per ordine: la VM è per brand, quindi due turni simultanei stanno
 * nella stessa macchina e senza questo condividerebbero `brand/` e `work/` — il secondo
 * riscriverebbe i dati mentre il primo li conta. È anche come i dati del brand restano fuori dallo
 * snapshot: la directory sparisce alla chiusura.
 */
export function runRootFor(runId: string): string {
  const clean = (runId ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'run';
  return `${RUNS_DIR}/${clean}`;
}

/** Path che il modello scrive (`work/x.py`) → path reale nella VM (`runs/<id>/work/x.py`). */
export function underRoot(root: string, path: string): string {
  return `${root}/${path.replace(/^\.\//, '')}`;
}

/** Da `runs/<id>` alla home: lo script di browse è condiviso fra le run, la cwd no. */
export const BROWSE_FROM_ROOT = `../../${BROWSE_PATH}`;

const PLAYWRIGHT_VERSION = env.SANDBOX_PLAYWRIGHT_VERSION || '1.60.0';

/**
 * Percorso esplicito e non il default `~/.cache/ms-playwright`: qui `install-deps` gira da root e
 * il download no, quindi un percorso che dipende da `HOME` cambia utente a metà strada e il
 * download esce 1 senza scrivere niente su stderr.
 */
const BROWSERS_PATH = env.SANDBOX_BROWSERS_PATH || '.anomalia/browsers';

/**
 * «Chromium è già pronto». Con `SANDBOX_IMAGE` i binari sono cotti nell'immagine e il marcatore sta
 * lì accanto, non nella home: cercarlo nella home reinstallerebbe Chromium a ogni turno dentro
 * un'immagine che ce l'ha già.
 */
const READY_MARKER = env.SANDBOX_BROWSERS_PATH
  ? `${env.SANDBOX_BROWSERS_PATH.replace(/\/browsers\/?$/, '')}/browser-ready`
  : '.anomalia/browser-ready';
/**
 * Le Ubuntu per cui Playwright 1.60 pubblica i binari. `vercel/sandbox/ubuntu` è 26.04, che NON è
 * qui: senza override il download muore con `does not support chromium on ubuntu26.04-x64`.
 */
export const PLAYWRIGHT_KNOWN_UBUNTU = ['20.04', '22.04', '24.04'] as const;
/**
 * La più recente che conosce: i binari 24.04 girano su una Ubuntu più nuova, il contrario no.
 * **Il suffisso di architettura non è opzionale**: Playwright compone `"ubuntu24.04" + archSuffix`,
 * e `ubuntu24.04` liscio è una piattaforma che non esiste.
 */
export const PLAYWRIGHT_FALLBACK_UBUNTU = 'ubuntu24.04';

/**
 * `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` è la via ufficiale, e regge meglio che inseguire l'immagine
 * giusta: le distro nuove escono di continuo. Applicato SOLO su una distro non nota — su una 24.04
 * vera sarebbe una bugia inutile.
 */
export function resolvePlaywrightEnv(distro: string, machine = ''): Record<string, string> {
  const base = { PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH };
  const d = (distro ?? '').toLowerCase();
  if (!d.includes('ubuntu') && !d.includes('debian')) return base;
  const known = PLAYWRIGHT_KNOWN_UBUNTU.some((v) => d.includes(v));
  if (known) return base;
  // `uname -m` dice x86_64 / aarch64; Playwright vuole x64 / arm64.
  const arch = /aarch64|arm64/.test((machine ?? '').toLowerCase()) ? 'arm64' : 'x64';
  return { ...base, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: `${PLAYWRIGHT_FALLBACK_UBUNTU}-${arch}` };
}

/** Default per chi non ha (ancora) rilevato la distro: nessun override, solo il percorso. */
export const PLAYWRIGHT_ENV = { PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH };

/** La configurazione di una VM: quello che i getter di `Sandbox` sanno dire di sé. */
export type SandboxConfig = {
  timeout?: number;
  snapshotExpiration?: number;
  keepLastSnapshots?: { count: number } | undefined;
};

/**
 * `getOrCreate` su un nome che ESISTE GIÀ ignora i parametri di creazione e restituisce la VM con
 * la configurazione del giorno in cui è nata (docs/sandbox/concepts/persistent-sandboxes). I nostri
 * nomi sono stabili per brand, quindi il `timeout` calcolato dal tempo residuo del turno era un
 * no-op — e `render-tools.ts` divide quel lease fra installazione e render credendoci: budget
 * fittizio, render tagliato a metà. `sandbox.update` è l'unica strada.
 *
 * **Il timeout si alza soltanto**: l'aumento è documentato come sicuro su una sessione in corso,
 * l'abbassamento no — e la VM è condivisa fra turni. Quindi cricchetto verso l'alto fino a
 * `SANDBOX_MAX_LEASE_MS`, al costo dichiarato di `(lease − durata del turno)` di memoria per turno.
 *
 * `null` quando non c'è drift: risparmia un round-trip a ogni apertura.
 */
export function sandboxConfigDrift(
  current: SandboxConfig,
  wanted: { timeout: number; snapshotExpiration: number; keepLastSnapshots: { count: number } }
): { timeout?: number; snapshotExpiration?: number; keepLastSnapshots?: { count: number } } | null {
  const drift: { timeout?: number; snapshotExpiration?: number; keepLastSnapshots?: { count: number } } = {};
  // Solo verso l'alto: vedi sopra. `undefined` = non sappiamo cosa ha, quindi lo scriviamo.
  if (typeof current.timeout !== 'number' || current.timeout < wanted.timeout) drift.timeout = wanted.timeout;
  if (current.snapshotExpiration !== wanted.snapshotExpiration) drift.snapshotExpiration = wanted.snapshotExpiration;
  if (current.keepLastSnapshots?.count !== wanted.keepLastSnapshots.count) {
    drift.keepLastSnapshots = { count: wanted.keepLastSnapshots.count };
  }
  return Object.keys(drift).length ? drift : null;
}

/**
 * Scrive «accesa» sulla riga del computer, senza far cadere l'apertura se il database non
 * risponde. Import pigro: `sandbox.ts` è infrastruttura e non deve tirarsi dietro il client
 * amministrativo a ogni avvio di processo.
 */
async function publishComputerState(
  brandId: string,
  refName: string,
  agentId: string | undefined,
  log: (line: string) => void
): Promise<void> {
  try {
    const [{ publishComputerRunning }, { createAdminClient }] = await Promise.all([
      import('$lib/server/agent-desktop'),
      import('$lib/server/supabase-admin')
    ]);
    await publishComputerRunning(createAdminClient(), brandId, refName, agentId);
  } catch (error) {
    log(`sandbox: stato del computer non pubblicato — ${String(error)}`);
  }
}

/**
 * Apre (o riprende) la sandbox del brand. `timeoutMs` viene dal tempo che RESTA al turno, non da
 * una costante: una VM che sopravvive al turno che l'ha creata è solo una fattura.
 */
export async function openBrandSandbox(opts: {
  brandId: string;
  mode: SandboxNetworkMode;
  timeoutMs: number;
  /** Identifica la run: da qui esce la directory in cui lavora, isolata dalle altre. */
  runId: string;
  /**
   * Nome extra sulla VM, stessa policy di `mode`. Il render Motion passa `'motion'` per non
   * condividere la macchina con `sandbox_browse` (stesso `research`, affitto spesso già scaduto).
   */
  lane?: string;
  /**
   * DI CHI è la macchina. Senza, si cade sulla VM del brand: i lavori che non hanno un agente
   * dietro (un cron, uno script) non devono inventarsene uno.
   */
  agentId?: string;
  needsBrowser?: boolean;
  /**
   * Porte raggiungibili da fuori (`sandbox.domain(p)`). Parametro di CREAZIONE: su un nome che
   * esiste già `getOrCreate` lo ignora in silenzio — cambiarlo vuol dire alzare
   * `SANDBOX_GENERATION`, o la porta resta chiusa per sempre su ogni VM già nata.
   */
  ports?: number[];
  abortSignal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<SandboxHandle> {
  if (!isSandboxConfigured()) {
    throw new Error(
      'Vercel Sandbox is not configured: no OIDC token (enable OIDC federation in the project settings) and no VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID'
    );
  }

  const { Sandbox } = await import('@vercel/sandbox');
  // L'OIDC vince quando c'è: l'SDK se lo risolve da solo e ne gestisce la scadenza.
  const hasOidc = Boolean(env.VERCEL_OIDC_TOKEN || oidcTokenFromRequestContext());
  const creds = hasOidc ? null : explicitCredentials();
  let name = sandboxName(opts.brandId, opts.agentId);
  const needsBrowser = Boolean(opts.needsBrowser) && opts.mode === 'research';
  const log = opts.onLog ?? (() => {});

  // Le run col browser partono da Ubuntu: Playwright non ha `install-deps` per Amazon Linux e i
  // binari che scarica sono compilati per Debian. `SANDBOX_IMAGE` con Chromium già dentro azzera
  // tutto il provisioning.
  const browserImage = env.SANDBOX_BROWSER_IMAGE || 'vercel/sandbox/ubuntu';
  // L'immagine col desktop già cotto (`sandbox-desktop/`): XFCE, VNC e noVNC dentro, quindi la VM
  // è pronta in 7 secondi invece dei 280 che apt chiedeva. Vale per TUTTI, perché la macchina è
  // una sola: chi rende un video e chi guarda il desktop stanno sullo stesso disco. Senza la
  // variabile si resta sul percorso che installa a runtime, così un self-hosted senza registry
  // continua a funzionare.
  const image = env.SANDBOX_IMAGE || env.SANDBOX_DESKTOP_IMAGE || (needsBrowser ? browserImage : undefined);

  // Nessuno la ferma a mano (vedi `release`): il timeout è l'unica cosa che la spegne.
  const lease = Math.max(60_000, Math.min(opts.timeoutMs, SANDBOX_MAX_LEASE_MS));

  const createOpts = {
    persistent: true,
    ...(image ? { image } : {}),
    // La porta del desktop è dichiarata SEMPRE, non solo da chi lo apre: è un parametro di
    // creazione, e la VM la crea chi arriva primo — che di solito è un turno di chat, non il
    // pannello. Chiederla dopo non ha effetto: resterebbe chiusa per la vita della macchina.
    ports: [...new Set([DESKTOP_PORT, ...(opts.ports ?? [])])],
    timeout: lease,
    resources: { vcpus: Number(env.SANDBOX_VCPUS || 2) },
    // LA RETE DELLA MACCHINA UNICA, e non è quella che il chiamante chiede.
    //
    // La policy si fissa alla creazione: con una VM sola per brand, onorare `opts.mode` vorrebbe
    // dire che la rete del brand dipende da CHI l'ha aperta per primo — chiusa se è partito un
    // job, aperta se è partita la chat. Vince `research`, la macchina dell'harness: senza
    // internet non funzionano né il desktop né il render Motion.
    //
    // Il prezzo, dichiarato: `shell` degli specialisti gira ora con internet aperto sullo stesso
    // disco dello snapshot del brand — la separazione che la lane `agent` teneva. Restano i guard
    // sui percorsi, `commandRejection`, e le subnet private negate.
    networkPolicy: buildNetworkPolicy(UNIFIED_NETWORK_MODE, configuredExtraDomains()) as never,
    snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
    keepLastSnapshots: { ...KEEP_LAST_SNAPSHOTS },
    tags: { app: 'anomalia', brand: opts.brandId.slice(0, 40) },
    ...(opts.abortSignal ? { signal: opts.abortSignal } : {}),
    ...(creds ?? {})
  } as never;

  let sandbox = await Sandbox.getOrCreate({ name, ...createOpts });
  // Solo cadaveri non riprendibili. `stopped` lo riprende `runCommand`/`withResume`; riciclarlo
  // butta la cache Remotion. Un comando GIÀ in volo che vede «Sandbox stream was closed» non
  // passa di qui: è un errore a metà render, non all'apertura.
  if (sandboxIsDead(sandbox as { status?: unknown })) {
    const dead = sandboxStatusOf(sandbox as { status?: unknown });
    name = recycleSandboxName(name);
    log(`sandbox: la VM nominata è ${dead} — riapertura su '${name}'`);
    sandbox = await Sandbox.getOrCreate({ name, ...createOpts });
    if (sandboxIsDead(sandbox as { status?: unknown })) {
      throw new Error(
        `Sandbox '${name}' is ${sandboxStatusOf(sandbox as { status?: unknown })} — a failed VM cannot run commands, and in-flight streams are not resumed.`
      );
    }
  }

  // I parametri qui sopra valgono SOLO su una sandbox appena nata; su una preesistente serve
  // `update` — il perché sta su `sandboxConfigDrift`.
  const drift = sandboxConfigDrift(sandbox as SandboxConfig, {
    timeout: lease,
    snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
    keepLastSnapshots: { ...KEEP_LAST_SNAPSHOTS }
  });
  if (drift) {
    try {
      await sandbox.update(drift as never, opts.abortSignal ? { signal: opts.abortSignal } : undefined);
      log(`sandbox: configurazione riallineata su una VM preesistente — ${JSON.stringify(drift)}`);
    } catch (e) {
      // Non fatale, ma l'affitto NON è quello che il chiamante crede: chi ci divide un budget
      // (`render-tools.ts`) deve leggerlo qui, non scoprirlo con un render tagliato a metà.
      log(
        `sandbox: update FALLITO — l'affitto resta ${String((sandbox as SandboxConfig).timeout ?? 'ignoto')}ms, non ${lease}ms: ${String(e)}`
      );
    }
  }

  // LO STATO DEL COMPUTER SI PUBBLICA QUI, dove la macchina si apre — e non nella manciata di
  // chiamanti che potrebbero scordarsene. Prima lo scriveva solo la rotta del desktop: un render
  // Motion teneva la VM accesa dieci minuti e il pannello continuava a dire «non è mai stata
  // accesa». Non è fatale: una riga di stato non deve impedire di lavorare.
  void publishComputerState(opts.brandId, name, opts.agentId, log);

  const root = runRootFor(opts.runId);

  // L'holder di QUESTO chiamante. Chiave per run: riaperture della stessa run rinfrescano la riga
  // invece di accumularne. La release dell'handle la cancella e, se era l'ultima, spegne la VM.
  const holderId = await acquireHolder({
    name,
    brandId: opts.brandId,
    key: `turn:${opts.runId}`,
    kind: 'turn',
    ttlMs: SANDBOX_MAX_LEASE_MS
  });

  const handle: SandboxHandle = {
    name,
    mode: opts.mode,
    root,
    raw: sandbox,
    browser: false,
    browserProvisioning: 'not_attempted',
    playwrightEnv: { ...PLAYWRIGHT_ENV },
    image: image ?? 'vercel/sandbox/universal (default)',
    async run(cmd, args = [], runOpts = {}) {
      const rejection = commandRejection(cmd);
      if (rejection) {
        return { exitCode: 126, stdout: '', stderr: rejection, truncated: false, durationMs: 0 };
      }
      const t0 = Date.now();
      const result = await sandbox.runCommand({
        cmd,
        args,
        ...(runOpts.cwd ? { cwd: runOpts.cwd } : {}),
        ...(runOpts.sudo ? { sudo: true } : {}),
        ...(runOpts.env ? { env: runOpts.env } : {}),
        ...(runOpts.timeoutMs ? { timeoutMs: runOpts.timeoutMs } : {}),
        ...(opts.abortSignal ? { signal: opts.abortSignal } : {})
      });
      const [rawOut, rawErr] = await Promise.all([result.stdout(), result.stderr()]);
      const out = clampOutput(rawOut ?? '');
      const err = clampOutput(rawErr ?? '', 6_000);
      return {
        exitCode: result.exitCode ?? -1,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
        durationMs: Date.now() - t0
      };
    },
    async write(files) {
      if (!files.length) return;
      await sandbox.writeFiles(files.map((f) => ({ path: f.path, content: Buffer.from(f.content, 'utf8') })));
    },
    async read(path) {
      // `readFile` dell'SDK ritorna uno ReadableStream, non testo: `String()` su quello dà
      // «[object Object]», e il chiamante confronta felice due stringhe che non lo sono. È così
      // che `ensureProject` reinstallava Remotion a OGNI render, con la cache intatta sul disco.
      const buffer = await sandbox.readFileToBuffer({ path } as never);
      return buffer ? Buffer.from(buffer as Uint8Array).toString('utf8') : '';
    },
    async readBuffer(path) {
      const buf = await sandbox.readFileToBuffer({ path } as never);
      return buf as Buffer;
    },
    async release() {
      // Lo snapshot deve contenere Chromium e i pacchetti, non il workspace di un brand.
      await handle.run('rm', ['-rf', root]).catch(swallow('handle.run failed'));
      if (holderId) await releaseHolder(holderId, sandbox as unknown as { stop: () => Promise<unknown> });
    }
  };

  // Riscritto sempre: la sandbox è persistente e potrebbe avere la versione di un deploy fa.
  await handle.write([{ path: BROWSE_PATH, content: BROWSE_SCRIPT }]);
  await handle.run('mkdir', ['-p', root]);
  // Le run che nessuno ha chiuso (turno morto) non devono restare nello snapshot coi dati dentro.
  await handle
    .run('bash', ['-lc', `find ${RUNS_DIR} -maxdepth 1 -mindepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null || true`])
    .catch(swallow('run failed'));

  if (needsBrowser) {
    const provisioned = await ensureBrowser(handle, log);
    handle.browser = provisioned.ok;
    handle.browserProvisioning = provisioned.ok ? (provisioned.cached ? 'cached' : 'ok') : 'failed';
    if (!provisioned.ok) {
      handle.browserError = provisioned.error;
      log(`sandbox: browser unavailable — ${provisioned.error}`);
    }
  } else {
    // Se questo ramo scatta su una run `research` il bug è qui, non nell'installazione.
    log(`sandbox: browser NOT requested (mode=${opts.mode}, needsBrowser=${String(opts.needsBrowser)})`);
  }

  return handle;
}

/**
 * Guarda **entrambi** i flussi: `playwright install` scrive il suo errore su stdout, non su stderr,
 * e un messaggio che guarda solo stderr butta via l'unico motivo che c'era.
 */
export function formatCommandFailure(step: string, res: SandboxRunResult): string {
  const out = (res.stdout || '').trim();
  const err = (res.stderr || '').trim();
  const detail = [err && `stderr: ${err}`, out && `stdout: ${out}`].filter(Boolean).join(' | ');
  return `${step} failed (exit ${res.exitCode}): ${detail ? detail.slice(0, 700) : 'no output on either stream'}`;
}

/**
 * Tre comandi che chiudono in un colpo le ipotesi che altrimenti si provano a un deploy per volta:
 * distro sbagliato, disco pieno, Node assente.
 */
async function provisioningDiagnostics(sandbox: SandboxHandle): Promise<Record<string, string>> {
  const probe = async (label: string, script: string) => {
    const r = await sandbox.run('sh', ['-c', script]).catch((error) => { swallow('sandbox.run failed', error); return null; });
    return [label, ((r?.stdout || r?.stderr) ?? '').trim().slice(0, 300) || '(no output)'] as const;
  };
  const pairs = await Promise.all([
    probe('disk', 'df -h / | tail -1'),
    probe('node', 'node --version 2>&1; npm --version 2>&1'),
    probe('ca_certs', 'ls /etc/ssl/certs/ca-certificates.crt 2>&1 | head -1')
  ]);
  return Object.fromEntries(pairs);
}

/**
 * Chromium nella VM, una volta sola: il marcatore su file sopravvive nello snapshot, quindi la
 * seconda run salta due minuti di installazione.
 *
 * Tre regole, tutte pagate in produzione: si verifica il distro PRIMA di provarci (`install-deps`
 * non ha strada su Amazon Linux); `browser: true` vuol dire "un browser si è avviato davvero", non
 * "il comando è uscito 0"; e il motivo del fallimento torna al chiamante, o non è diagnosticabile
 * da nessuna parte.
 */
async function ensureBrowser(
  sandbox: SandboxHandle,
  log: (l: string) => void
): Promise<{ ok: true; cached: boolean } | { ok: false; error: string }> {
  const marker = await sandbox.run('test', ['-f', READY_MARKER]).catch((error) => { swallow('sandbox.run failed', error); return null; });
  if (marker?.exitCode === 0) return { ok: true, cached: true };

  // Da qui dipende se `install-deps` ha una strada o no.
  const osRelease = await sandbox.run('sh', [
    '-c',
    '. /etc/os-release 2>/dev/null && echo "$ID $VERSION_ID $(uname -m)"'
  ]);
  const probe = (osRelease.stdout || '').trim().toLowerCase();
  const machine = probe.split(/\s+/).pop() ?? '';
  const distro = probe.replace(machine, '').trim();
  const debianLike = /(ubuntu|debian)/.test(distro);
  sandbox.playwrightEnv = resolvePlaywrightEnv(distro, machine);
  const override = sandbox.playwrightEnv.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
  log(
    `sandbox: distro="${distro || 'unknown'}" arch="${machine}" debian_like=${debianLike}` +
      (override ? ` platform_override=${override}` : '')
  );

  if (!debianLike) {
    // Insistere costerebbe minuti di VM per finire nello stesso punto.
    return {
      ok: false,
      error: `Chromium needs a Debian/Ubuntu image and this sandbox runs "${distro || 'an unknown distro'}". Set SANDBOX_BROWSER_IMAGE (default: vercel/sandbox/ubuntu) or build an image with Chromium preinstalled.`
    };
  }

  const node = await sandbox.run('sh', ['-c', 'command -v node && node --version']);
  if (node.exitCode !== 0) {
    log('sandbox: no node on this image — installing');
    const apt = await sandbox.run('sh', ['-c', 'apt-get update -qq && apt-get install -y -qq nodejs npm'], {
      sudo: true,
      timeoutMs: 300_000
    });
    if (apt.exitCode !== 0) {
      return { ok: false, error: `No Node in the image and apt-get failed: ${apt.stderr.slice(0, 300)}` };
    }
  }

  log('sandbox: installing chromium (first run for this brand)');
  const install = await sandbox.run('npm', ['install', '--no-audit', '--no-fund', `playwright@${PLAYWRIGHT_VERSION}`], {
    timeoutMs: 240_000
  });
  if (install.exitCode !== 0) {
    return { ok: false, error: `${formatCommandFailure('npm install playwright', install)} — ${JSON.stringify(await provisioningDiagnostics(sandbox))}` };
  }

  // Root per le dipendenze di sistema, non per il binario del browser.
  //
  // L'override di piattaforma serve ANCHE qui: `install-deps` sceglie i pacchetti dallo stesso
  // `calculatePlatform()` del download, quindi senza override non installa niente — e poi il
  // browser muore all'avvio con «Target page, context or browser has been closed», che è una
  // shared library mancante travestita da errore di Playwright.
  //
  // Via `sh -c` e non `env`: `sudo` ripulisce l'ambiente per default.
  const depsEnv = Object.entries(sandbox.playwrightEnv)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  const deps = await sandbox.run(
    'sh',
    ['-c', `${depsEnv} ./node_modules/.bin/playwright install-deps chromium`],
    { sudo: true, timeoutMs: 300_000 }
  );
  // Non fatale (giudica il launch test), ma quando l'avvio fallisce la causa è quasi sempre qui.
  if (deps.exitCode !== 0) log(`sandbox: ${formatCommandFailure('install-deps', deps)} — continuing to the launch test`);

  await sandbox.run('mkdir', ['-p', BROWSERS_PATH]);
  const download = await sandbox.run('./node_modules/.bin/playwright', ['install', 'chromium'], {
    timeoutMs: 300_000,
    env: sandbox.playwrightEnv
  });
  if (download.exitCode !== 0) {
    const diag = await provisioningDiagnostics(sandbox);
    return {
      ok: false,
      error: `${formatCommandFailure('chromium download', download)} — ${JSON.stringify(diag)}${
        deps.exitCode !== 0 ? ` — earlier: ${formatCommandFailure('install-deps', deps)}` : ''
      }`
    };
  }

  // La prova che conta: un `install` uscito 0 con una .so mancante dà un browser che non parte.
  const smoke = await sandbox.run(
    'node',
    ['-e', "import('playwright').then(async ({chromium}) => { const b = await chromium.launch({args:['--no-sandbox']}); await b.close(); console.log('LAUNCH_OK'); }).catch(e => { console.error(String(e && e.message || e)); process.exit(1); })"],
    { timeoutMs: 90_000, env: sandbox.playwrightEnv }
  );
  if (smoke.exitCode !== 0 || !smoke.stdout.includes('LAUNCH_OK')) {
    // Playwright non nomina la .so mancante; `ldd` sì, e costa due secondi.
    const missing = await sandbox
      .run('sh', [
        '-c',
        `ldd $(find ${BROWSERS_PATH} -name 'chrome*' -type f -perm -u+x 2>/dev/null | head -1) 2>&1 | grep 'not found' | head -20`
      ])
      .catch((error) => { swallow('$ failed', error); return null; });
    const libs = (missing?.stdout || '').trim();
    return {
      ok: false,
      error: `${formatCommandFailure('chromium launch test', smoke)}${
        libs ? ` — MISSING LIBRARIES: ${libs.slice(0, 600)}` : ' — no missing shared libraries reported by ldd'
      }${deps.exitCode !== 0 ? ` — earlier: ${formatCommandFailure('install-deps', deps)}` : ''}`
    };
  }

  await sandbox.run('mkdir', ['-p', '.anomalia']);
  await sandbox.run('touch', [READY_MARKER]);
  log('sandbox: chromium ready');
  return { ok: true, cached: false };
}
