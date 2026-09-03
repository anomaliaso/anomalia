/**
 * I TOOL DELLA SANDBOX.
 *
 * Cinque, e sono pochi apposta. La tentazione è avvolgere ogni cosa in un tool dedicato
 * (`sandbox_pandas`, `sandbox_ffmpeg`, `sandbox_screenshot`…) e si finisce per riscrivere una shell
 * peggiore di quella che c'è già dentro la VM. Qui il tool è il **canale**, non il verbo: scrivere
 * un file, eseguire un comando, rileggere un file, guardare una pagina, salvare il risultato dove
 * sopravvive alla VM. Cosa farci in mezzo lo decide l'agente scrivendo codice, che è il motivo per
 * cui gli stiamo dando una macchina.
 *
 * Una nota su `sandbox_browse`: esiste come tool separato da `sandbox_exec` non perché sia più
 * potente — è lo stesso script, l'agente potrebbe lanciarlo a mano — ma perché la navigazione è la
 * cosa che vogliamo **contare** (ha un tetto per run) e che vogliamo restituire già in JSON pulito.
 * La ricerca autonoma nasce dalla coppia: `search_web` (Exa) trova gli url, `sandbox_browse` li
 * apre davvero, con JavaScript eseguito, che è dove i due si distinguono.
 *
 * E una su `sandbox_save_output`: senza, tutto ciò che l'agente produce muore con la sessione. Con,
 * un grafico o un report finiscono nella libreria / nella conoscenza del brand, cioè in posti che
 * il resto del prodotto sa già leggere. È la differenza fra una macchina e un giocattolo.
 */
import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BROWSE_FROM_ROOT,
  SECRET_ENV_FILE,
  SECRET_HOME_DIR,
  WORKSPACE_DIR,
  isSandboxConfigured,
  isSecretPath,
  openBrandSandbox,
  underRoot,
  type SandboxHandle,
  type SandboxNetworkMode
} from '$lib/server/sandbox';
import { randomUUID } from 'node:crypto';
import { buildBrandWorkspace } from '$lib/server/chat/sandbox-workspace';
import { createSandboxDeviceLoginTool } from '$lib/server/chat/sandbox-device-login';
import { noteCredentialInVm, noteSecret, redactFor } from '$lib/server/redact';
import { chargeSandboxCredits } from '$lib/server/sandbox-credits';

/** Comandi per run. Oltre, quasi sempre è un loop, non un lavoro. */
export const MAX_SANDBOX_COMMANDS = 40;
/** Pagine aperte col browser per run: ognuna costa secondi e byte di contesto. */
export const MAX_SANDBOX_BROWSES = 12;
/** File salvati fuori dalla VM per run. */
export const MAX_SANDBOX_SAVES = 6;

export const SANDBOX_TOOL_KEYS = [
  'sandbox_exec',
  'sandbox_write_file',
  'sandbox_read_file',
  'sandbox_browse',
  'sandbox_save_output'
] as const;

/**
 * Attacca la macchina all'ORCHESTRATORE, non solo al sotto-agente `sandbox`.
 *
 * Fino a qui `createSandboxTools` aveva un solo chiamante — il ruolo `sandbox` in subagents.ts — e
 * quindi due comandi al volo costavano una delega intera: un modello in più, un contesto in più, e
 * un rapporto scritto per far tornare indietro un numero. La delega resta la strada giusta per un
 * lavoro lungo o per la ricerca; per il resto adesso la shell ce l'ha in mano chi sta parlando.
 *
 * Resta `compute` di proposito, e non è una svista: la modalità `research` apre internet, e la
 * combinazione "internet aperto + i dati del brand su disco" è esattamente quella che il
 * sotto-agente tiene separata con `brand_data`. Chi deve leggere il web continua a delegare.
 *
 * Torna anche `close`, e va chiamata: la VM è del brand e la spegne il suo timeout, ma i file di
 * QUESTA run restano lì finché non li rilascia qualcuno. Il sotto-agente lo faceva in un `finally`;
 * chi monta i tool su un turno lungo deve farlo alla fine del turno.
 */
export function withSandboxTools<T extends Record<string, unknown>>(
  scoped: T,
  opts: Omit<SandboxToolsOptions, 'mode'>
): { tools: T; close: () => Promise<void> } {
  if (!isSandboxConfigured()) return { tools: scoped, close: async () => {} };
  // `deviceLogin` solo qui: questo è il mount dell'ORCHESTRATORE. I sotto-agenti chiamano
  // createSandboxTools direttamente (subagents.ts) e il tool di login non gli arriva mai —
  // chiedere a una persona di autorizzare è un gesto verso di lei, e chi le parla è uno solo.
  const session = createSandboxTools({ ...opts, mode: 'compute', deviceLogin: true });
  return { tools: { ...scoped, ...session.tools } as unknown as T, close: session.close };
}

/**
 * IL GUARDRAIL COMUNE a ogni path che arriva dal modello, lettura compresa.
 *
 * Prima esisteva solo per la scrittura, e i due tool che leggono si erano copiati in linea una
 * versione più debole (assoluti + `..`, niente altro). È esattamente per questo che
 * `sandbox_read_file` e `sandbox_save_output` arrivavano a `.github.env`: quel file sta DENTRO la
 * directory della run, cioè dentro il perimetro consentito, e nessuno dei due passava da qui. Un
 * guardrail solo, usato da tutti i tool che prendono un percorso — compreso il `cwd` di
 * `sandbox_exec`, che senza controllo poteva valere `../..` e piantare la shell nella home.
 */
export function rejectReadPath(path: string): string | null {
  const p = (path ?? '').trim();
  if (!p) return 'Empty path';
  if (p.startsWith('/')) return 'Use paths relative to the sandbox home (e.g. "work/analysis.py"), not absolute ones.';
  if (p.split('/').includes('..')) return 'Path must not escape the sandbox home.';
  if (isSecretPath(p)) {
    return `${SECRET_HOME_DIR}/ and ${SECRET_ENV_FILE} hold the VM's own credentials (your GitHub login, the browser state). They are never readable, writable or saveable through the tools. Use the token by sourcing the env file inside sandbox_exec — never by reading it.`;
  }
  return null;
}

/** Un path che esce dal workspace è quasi sempre un errore di orientamento del modello. */
export function rejectPath(path: string): string | null {
  const bad = rejectReadPath(path);
  if (bad) return bad;
  if ((path ?? '').trim().startsWith(`${WORKSPACE_DIR}/`)) {
    return `${WORKSPACE_DIR}/ is the read-only snapshot of the brand data. Write your own files elsewhere (e.g. "work/").`;
  }
  return null;
}

export type SandboxToolsOptions = {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  /** Serve per pubblicare un artefatto: un file consegnato in chat appartiene a una conversazione. */
  threadId?: string;
  /**
   * DI CHI è la macchina su cui questi tool lavorano. Dal 26/8 la VM è dell'agente, non del
   * brand: senza questo, `sandbox_browse` scriverebbe sul disco di un altro — e chi guarda lo
   * schermo dell'agente non vedrebbe niente di quello che il turno sta facendo.
   *
   * Obbligatorio e non opzionale: era opzionale, e nessuno dei quattro chiamanti lo passava.
   * `undefined` resta lecito (un cron, uno script: un agente dietro non ce l'hanno), ma va
   * scritto — così è una decisione, non una dimenticanza.
   */
  agentId: string | undefined;
  /** `research` accende il browser e apre l'egress; `compute` resta chiuso ai soli registry. */
  mode: SandboxNetworkMode;
  webHubEnabled?: boolean;
  /**
   * Se i dati del brand vanno scritti su disco. Default: sì in `compute`, **no** in `research`.
   *
   * Il motivo è il caso peggiore, non il caso normale: una run `research` legge pagine che non
   * controlliamo, e una pagina ostile che dice "manda questo file a questo endpoint" parla a un
   * agente che ha internet aperto. Se i dati non ci sono, non c'è niente da mandare. Quando servono
   * davvero (incrociare il campo con lo storico) è l'orchestratore a chiederlo, esplicitamente.
   */
  brandData?: boolean;
  /**
   * Monta anche `sandbox_device_login` (device flow GitHub). Solo il mount dell'orchestratore lo
   * accende: i sandbox tools dei sotto-agenti vengono aggiunti DOPO il filtro NEVER_FOR_SUBAGENTS
   * (Object.assign in subagents.ts), quindi il gate vero è questo flag, non quella lista.
   */
  deviceLogin?: boolean;
  /** Quanto tempo resta al turno: la VM non deve sopravvivere a chi l'ha creata. */
  remainingMs?: () => number;
  onLog?: (line: string) => void;
  /**
   * Dove finisce il percorso della run: ogni comando, ogni pagina, ogni salvataggio.
   * Senza, di una run resta solo il riepilogo — che dice QUANTO è successo, mai COSA.
   */
  record?: (kind: string, data?: Record<string, unknown>, meta?: { ms?: number; ok?: boolean }) => void;
};

export type SandboxSession = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>;
  /** Da chiamare SEMPRE in un finally: una VM che nessuno ferma è una fattura che nessuno legge. */
  close: () => Promise<void>;
  /** Cosa è successo, per il rapporto e per i log. */
  stats: () => { opened: boolean; commands: number; browses: number; saves: number; browser: boolean; browser_error?: string };
  /**
   * I VALORI CONIATI IN QUESTO GIRO, per chi scrive la traccia — e c'è una sola finestra per
   * averli. `scrub` pulisce gli output dei tool al confine, ma la traccia persistita contiene anche
   * gli INPUT, e chi la legge (`runs/<id>.md`) arriva quando questo set non esiste più: vive in una
   * closure per-run che muore col turno. Alla scrittura esiste; dopo, no. Quindi si passa di qui.
   */
  secrets: () => string[];
};

/**
 * UN FILE BINARIO NON PASSA DA `scrub`, ed è la strada di uscita che resta aperta più a lungo.
 *
 * `cp ../unaltra-run/.github.env work/grafico.png` pubblica una credenziale come card permanente
 * nella Media library o come artefatto del thread: i due rami binari di `sandbox_save_output`
 * leggono i byte e li caricano senza che nessuno strato di testo li guardi.
 *
 * Due controlli, entrambi sui BYTE: la firma dev'essere davvero quella di un'immagine, e dentro
 * non ci dev'essere un valore del registro. Non copre il segreto spezzato — niente lo copre — ma
 * chiude la copia-e-rinomina, che è il gesto in un passo solo.
 */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const webp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const gif = buf.subarray(0, 3).toString('ascii') === 'GIF';
  return png || jpeg || webp || gif;
}

/** True quando i byte contengono un valore che sappiamo essere un segreto. */
function carriesKnownSecret(buf: Buffer, brandId: string): boolean {
  const text = buf.subarray(0, 512_000).toString('utf8');
  return redactFor(text, brandId) !== text;
}

export function createSandboxTools(opts: SandboxToolsOptions): SandboxSession {
  const { supabase, brandId, userId, threadId, mode } = opts;
  const log = opts.onLog ?? (() => {});
  const record = opts.record ?? (() => {});

  let handle: SandboxHandle | null = null;
  let opening: Promise<SandboxHandle> | null = null;
  /**
   * Da quando la VM di QUESTA run è accesa. È tutto ciò che serve per l'addebito: `close()` lo
   * legge una volta e chiude il conto. Vedi il commento su `chargeSandboxCredits` più sotto.
   */
  let openedAt = 0;
  /**
   * L'identità di QUESTA run dentro una VM che è del brand. Tutto ciò che il modello scrive finisce
   * sotto `runs/<runId>/`, così due turni paralleli dello stesso brand non si toccano i file.
   */
  const runId = randomUUID().slice(0, 12);
  let commands = 0;
  let browses = 0;
  let saves = 0;

  /**
   * I VALORI segreti coniati dentro questa run: il device_code e il token del device login GitHub.
   *
   * Il divieto sui path non basta, e non può bastare: `sandbox_exec` esegue comandi arbitrari,
   * quindi `cat .github.env`, `env`, o un symlink piazzato con `ln -s` riportano il token nello
   * stdout — che torna intero al modello e finisce nella traccia della run. E il comando non si può
   * rifiutare guardando l'argv, perché `source .github.env && gh auth status` è l'uso LEGITTIMO e
   * documentato del token: vietare quel nome vorrebbe dire spegnere la feature. L'unica cosa che
   * resta, ed è quella che regge su ogni strada, è cancellare il VALORE su tutto ciò che riattraversa
   * il confine della VM.
   *
   * ponytail: sostituzione letterale di una stringa che abbiamo scritto noi — non un pattern, non
   * un'euristica sui token GitHub. Il tetto è dichiarato: un `base64 .github.env` passa. Toglierlo
   * davvero richiederebbe che i comandi dell'agente girassero come un altro utente, e in questa
   * microVM `sudo` è senza password: nessuna separazione di permessi regge.
   */
  const secrets = new Set<string>();
  const scrub = (text: string): string => {
    let out = text ?? '';
    // Sotto gli 8 caratteri non è un segreto, è un modo di cancellare mezzo output per sbaglio.
    for (const s of secrets) if (s.length >= 8) out = out.split(s).join('«redacted: sandbox secret»');
    return out;
  };

  /**
   * La VM si apre alla prima chiamata, non all'inizio del turno: un sotto-agente che finisce senza
   * toccare la sandbox non deve averne pagata una.
   */
  async function ensure(abortSignal?: AbortSignal): Promise<SandboxHandle> {
    if (handle) return handle;
    if (opening) return opening;
    opening = (async () => {
      const left = opts.remainingMs?.() ?? 15 * 60_000;
      const sandbox = await openBrandSandbox({
        brandId,
        runId,
        mode,
        agentId: opts.agentId,
        needsBrowser: mode === 'research',
        timeoutMs: Math.max(120_000, left),
        abortSignal,
        onLog: log
      });
      record(
        'sandbox_open',
        {
          mode,
          image: sandbox.image,
          browser: sandbox.browser,
          browser_provisioning: sandbox.browserProvisioning,
          ...(sandbox.browserError ? { browser_error: sandbox.browserError } : {})
        },
        { ok: true }
      );
      // C'È UNA CREDENZIALE VIVA IN QUESTA VM? Una domanda sola, all'apertura.
      //
      // La VM è del BRAND e persiste fra i turni: un device login fatto ieri lascia il token su
      // disco, e da lì un delegato può leggerlo e stamparlo SPEZZATO — `fold -w8`, `rev`,
      // `${TOK:0:18}` — che nessun filtro sul testo sa riconoscere. Quando la risposta è sì, la
      // traccia persistita smette di conservare stdout/stderr dei comandi (agent-sessions.ts).
      // Il modello continua a vederli nel turno: è la copia scritta per sempre a non tenerli.
      await sandbox
        .run('bash', ['-lc', 'ls .anomalia/github-device.json .github.env runs/*/.github.env 2>/dev/null | head -1'], {
          timeoutMs: 5_000
        })
        .then((r) => {
          if (String(r?.stdout ?? '').trim()) noteCredentialInVm(brandId);
        })
        .catch(() => {});

      // I dati del brand si riscrivono a ogni apertura: la VM è persistente, lo snapshot dei dati no.
      const wantsBrandData = opts.brandData ?? mode === 'compute';
      const files = wantsBrandData
        ? await buildBrandWorkspace(supabase, brandId, { webHubEnabled: opts.webHubEnabled }).catch(() => [])
        : [
            // Dirlo è meglio che lasciare una directory assente: un modello che non trova i file
            // che si aspetta li inventa, oppure va a cercarli con dieci comandi.
            {
              path: `${WORKSPACE_DIR}/README.md`,
              content:
                '# Nessun dato del brand in questa run\n\nQuesta è una run di ricerca con internet aperto, quindi i dati del brand NON sono stati scritti su disco: una pagina ostile che chiedesse di mandarli fuori non troverebbe niente da mandare.\n\nSe ti servono davvero, usa i tool di lettura (read_posts, read_strategy, …) per il singolo dato che ti manca, oppure fai richiedere all\u2019orchestratore una run con i dati.\n'
            }
          ];
      if (files.length) {
        await sandbox
          .write(files.map((f) => ({ ...f, path: underRoot(sandbox.root, f.path) })))
          .catch(() => {});
      }
      handle = sandbox;
      openedAt = Date.now();
      return sandbox;
    })();
    try {
      return await opening;
    } finally {
      opening = null;
    }
  }

  function budget(kind: 'cmd' | 'browse' | 'save'): { error: string } | null {
    if (kind === 'cmd' && commands >= MAX_SANDBOX_COMMANDS) {
      return { error: `Command budget spent for this run (max ${MAX_SANDBOX_COMMANDS}). Write the report with what you have.` };
    }
    if (kind === 'browse' && browses >= MAX_SANDBOX_BROWSES) {
      return { error: `Page budget spent for this run (max ${MAX_SANDBOX_BROWSES}). Conclude from the pages you already read.` };
    }
    if (kind === 'save' && saves >= MAX_SANDBOX_SAVES) {
      return { error: `Save budget spent for this run (max ${MAX_SANDBOX_SAVES}).` };
    }
    return null;
  }

  const tools = {
    sandbox_exec: tool({
      description: [
        'Run a command inside your sandbox VM (Linux, Node and Python available, own filesystem, real terminal).',
        `The brand's own data is already there as files under \`${WORKSPACE_DIR}/\` — read \`${WORKSPACE_DIR}/README.md\` first.`,
        'Install what you need (npm / pip) and write real scripts: this is for the work no tool covers — counting, cross-referencing, compiling, converting.',
        'Nothing here changes the brand: the VM is isolated and disappears. To persist a result use sandbox_save_output.'
      ].join(' '),
      inputSchema: z.object({
        cmd: z.string().min(1).max(200).describe('Executable, e.g. "python3", "node", "npm", "bash"'),
        args: z.array(z.string().max(4000)).max(50).optional().describe('Arguments. Prefer bash -lc "…" for pipelines.'),
        cwd: z.string().max(200).optional().describe('Working directory, relative to the sandbox home'),
        timeout_ms: z.number().min(1000).max(600_000).optional().describe('Kill the command after this long. Default 120s.')
      }),
      execute: async (
        input: { cmd: string; args?: string[]; cwd?: string; timeout_ms?: number },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        const blocked = budget('cmd');
        if (blocked) return blocked;
        // La cwd è un path come gli altri: senza questo, `cwd: "../.."` portava la shell nella home
        // della VM, dove vivono `.anomalia/` e i segreti.
        if (input.cwd) {
          const badCwd = rejectReadPath(input.cwd);
          if (badCwd) return { error: badCwd };
        }
        try {
          const sandbox = await ensure(toolOpts?.abortSignal);
          commands++;
          const res = await sandbox.run(input.cmd, input.args ?? [], {
            // La cwd del modello è sempre dentro la sua directory di run: `cd /` non esiste come
            // opzione, e i path relativi che scrive combaciano con quelli che rilegge.
            cwd: input.cwd ? underRoot(sandbox.root, input.cwd) : sandbox.root,
            timeoutMs: input.timeout_ms ?? 120_000
          });
          // Qui, prima del `record` e prima del return: le due strade con cui l'output di un
          // comando esce dalla VM sono queste, e nessuna delle due deve portarsi dietro il token.
          const stdout = scrub(res.stdout);
          const stderr = scrub(res.stderr);
          record(
            'sandbox_exec',
            {
              cmd: input.cmd,
              args: input.args ?? [],
              cwd: input.cwd ?? '.',
              exit_code: res.exitCode,
              stdout,
              stderr
            },
            { ms: res.durationMs, ok: res.exitCode === 0 }
          );
          return { ...res, stdout, stderr, commands_left: Math.max(0, MAX_SANDBOX_COMMANDS - commands) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          record('sandbox_exec', { cmd: input.cmd, args: input.args ?? [], error: msg }, { ok: false });
          return { error: msg };
        }
      }
    }),

    sandbox_write_file: tool({
      description:
        'Write a text file into the sandbox (a script, a config, a dataset you assembled). Paths are relative to the sandbox home; the brand data snapshot is read-only.',
      inputSchema: z.object({
        path: z.string().min(1).max(200).describe('Relative path, e.g. "work/analysis.py"'),
        content: z.string().max(400_000).describe('Full file content')
      }),
      execute: async (input: { path: string; content: string }, toolOpts: ToolExecutionOptions<unknown>) => {
        const bad = rejectPath(input.path);
        if (bad) return { error: bad };
        try {
          const sandbox = await ensure(toolOpts?.abortSignal);
          await sandbox.write([{ path: underRoot(sandbox.root, input.path), content: input.content }]);
          return { success: true, path: input.path, bytes: Buffer.byteLength(input.content, 'utf8') };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    sandbox_read_file: tool({
      description:
        'Read a text file back from the sandbox — the output of your own script, or one of the brand data files.',
      inputSchema: z.object({
        path: z.string().min(1).max(200).describe('Relative path'),
        max_chars: z.number().min(200).max(40_000).optional().describe('Truncate after this many characters (default 12000)')
      }),
      execute: async (input: { path: string; max_chars?: number }, toolOpts: ToolExecutionOptions<unknown>) => {
        const p = (input.path ?? '').trim();
        // Era un controllo in linea, più debole di `rejectPath`: `.github.env` ci passava.
        const bad = rejectReadPath(p);
        if (bad) return { error: bad };
        try {
          const sandbox = await ensure(toolOpts?.abortSignal);
          // Scrub anche qui: il nome è vietato, ma un symlink creato con `sandbox_exec` punta a un
          // segreto da un path che sembra innocuo.
          const raw = scrub(await sandbox.read(underRoot(sandbox.root, p)));
          const max = input.max_chars ?? 12_000;
          return {
            path: p,
            chars: raw.length,
            truncated: raw.length > max,
            content: raw.slice(0, max)
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    sandbox_browse: tool({
      description: [
        'Open a URL in a real Chromium inside your sandbox and get back the rendered text, the title and the outgoing links.',
        'Use it when the page needs JavaScript, or when a fetch would only return an empty shell — and pair it with search_web: that finds the URLs, this actually reads them.',
        'It can also take a screenshot to a file, which you can then save with sandbox_save_output.',
        `Max ${MAX_SANDBOX_BROWSES} pages per run.`
      ].join(' '),
      inputSchema: z.object({
        url: z.string().url().describe('Absolute http(s) URL'),
        wait_for: z.string().max(200).optional().describe('CSS selector to wait for before reading'),
        screenshot: z.string().max(200).optional().describe('Relative path to save a PNG, e.g. "work/page.png"'),
        full_page: z.boolean().optional().describe('Full-page screenshot instead of the viewport'),
        max_chars: z.number().min(500).max(30_000).optional().describe('Cap the extracted text (default 12000)')
      }),
      execute: async (
        input: { url: string; wait_for?: string; screenshot?: string; full_page?: boolean; max_chars?: number },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        if (mode !== 'research') {
          return { error: 'This sandbox has no internet access (compute profile). Browsing is only available to a research run.' };
        }
        const blocked = budget('browse');
        if (blocked) return blocked;
        if (input.screenshot) {
          const bad = rejectPath(input.screenshot);
          if (bad) return { error: bad };
        }
        try {
          const sandbox = await ensure(toolOpts?.abortSignal);
          if (!sandbox.browser) {
            // Il motivo, non solo il fatto: senza, il sotto-agente prova a girarci intorno finché
            // finisce gli step e chiude senza rapporto — che è come è andata la prima volta.
            record(
              'sandbox_browse_refused',
              { url: input.url, reason: sandbox.browserError ?? 'unknown', provisioning: sandbox.browserProvisioning, image: sandbox.image },
              { ok: false }
            );
            return {
              error: 'Chromium is not available in this sandbox. Do NOT retry browsing and do not work around it with shell commands.',
              reason: sandbox.browserError ?? 'unknown (provisioning returned no reason)',
              what_to_do:
                'Stop here. Report to the orchestrator that the page could not be read with a browser, quoting the reason. If a partial answer is possible from search_web or the read tools, say explicitly that it comes from search snippets and NOT from the rendered page.'
            };
          }
          browses++;
          const args = [BROWSE_FROM_ROOT, input.url, `maxChars=${input.max_chars ?? 12_000}`];
          if (input.wait_for) args.push(`wait=${input.wait_for}`);
          if (input.screenshot) args.push(`screenshot=${input.screenshot}`);
          if (input.full_page) args.push('fullPage=true');
          // Stessa destinazione del provisioning: il browser va cercato dove è stato scritto.
          const res = await sandbox.run('node', args, {
            cwd: sandbox.root,
            timeoutMs: 90_000,
            env: sandbox.playwrightEnv
          });
          try {
            const parsed = JSON.parse(res.stdout.trim().split('\n').pop() ?? '{}');
            record(
              'sandbox_browse',
              { url: input.url, status: parsed.status, title: parsed.title, chars: parsed.chars, error: parsed.error },
              { ms: res.durationMs, ok: !parsed.error }
            );
            return { ...parsed, pages_left: Math.max(0, MAX_SANDBOX_BROWSES - browses) };
          } catch {
            return {
              error: 'Browser returned no readable output',
              exit_code: res.exitCode,
              stderr: res.stderr.slice(0, 1000)
            };
          }
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    sandbox_save_output: tool({
      description: [
        'Save a file you produced in the sandbox so it survives the VM. Three destinations, pick by what the file IS:',
        'kind="artifact" — the result of this conversation (a chart, a report, a cleaned dataset): it becomes a permanent card in the chat that the user can open and download. This is the default for anything you made for THEM.',
        'kind="image" — a visual asset the brand will reuse in its posts: goes into the Media library.',
        'kind="document" — reference material that belongs to the brand’s knowledge base, not to this chat.',
        'Everything else in the sandbox is thrown away when the run ends — if a result matters, save it here and name it in your report.'
      ].join(' '),
      inputSchema: z.object({
        path: z.string().min(1).max(200).describe('Relative path of the file in the sandbox'),
        title: z.string().min(2).max(200).describe('How this should be named for the user'),
        kind: z
          .enum(['artifact', 'image', 'document'])
          .describe('artifact = permanent card in this chat; image = brand Media library; document = brand knowledge'),
        description: z.string().max(500).optional().describe('kind="artifact": one line on what it contains')
      }),
      execute: async (
        input: { path: string; title: string; kind: 'artifact' | 'image' | 'document'; description?: string },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        const blocked = budget('save');
        if (blocked) return blocked;
        const p = (input.path ?? '').trim();
        // Il tool più pericoloso dei tre: quello che rende PERMANENTE quello che legge, in chat o
        // nella conoscenza del brand. Stesso guardrail degli altri, niente versione in linea.
        const bad = rejectReadPath(p);
        if (bad) return { error: bad };
        try {
          const sandbox = await ensure(toolOpts?.abortSignal);
          saves++;

          if (input.kind === 'artifact') {
            if (!threadId) return { error: 'No thread — an artifact must belong to a conversation. Use kind="image" or "document".' };
            const { publishArtifact, inferArtifactKind, mimeForFile, safeFileName } = await import(
              '$lib/server/chat/artifacts'
            );
            const fileName = safeFileName(p.split('/').pop() ?? 'artifact.txt');
            const mime = mimeForFile(fileName);
            // Il testo porta con sé l'anteprima della card; il binario no, e va letto come byte.
            const textual = inferArtifactKind(fileName, mime) !== 'image' && !mime.startsWith('application/zip');
            let payload: { text: string } | { bytes: Buffer };
            if (textual) {
              payload = { text: scrub(await sandbox.read(underRoot(sandbox.root, p))) };
            } else {
              const bytes = await sandbox.readBuffer(underRoot(sandbox.root, p));
              // Il ramo binario non passa da `scrub`: qui si guarda dentro i byte.
              if (carriesKnownSecret(bytes, brandId)) {
                return { error: 'Refused: this file contains a credential. Save the result, not the environment.' };
              }
              payload = { bytes };
            }
            const { artifact, error } = await publishArtifact(supabase, {
              brandId,
              userId,
              threadId,
              title: input.title,
              description: input.description,
              fileName,
              mime,
              toolCallId: toolOpts?.toolCallId ?? null,
              createdBy: 'agent',
              source: 'sandbox',
              ...payload
            });
            if (error || !artifact) return { success: false, error: error ?? 'Could not publish the artifact' };
            return {
              success: true,
              artifact,
              instruction: 'The card is visible in the chat. Name it in your report; do not paste its content.'
            };
          }

          if (input.kind === 'document') {
            const text = scrub(await sandbox.read(underRoot(sandbox.root, p)));
            if (!text.trim()) return { error: 'File is empty — nothing to save.' };
            const { ingestDocument } = await import('$lib/server/knowledge');
            const { id, deduped } = await ingestDocument(supabase, brandId, userId, {
              text: text.slice(0, 400_000),
              title: input.title,
              fileName: p.split('/').pop() ?? 'sandbox-output.txt',
              kind: 'note',
              sourceType: 'sandbox'
            });
            return { success: true, document_id: id, deduped, title: input.title };
          }

          const buf = await sandbox.readBuffer(underRoot(sandbox.root, p));
          if (!buf?.length) return { error: 'File is empty — nothing to save.' };
          // `kind:'image'` si fida oggi dell'ESTENSIONE. Un `.env` rinominato `.png` finirebbe
          // pubblicato nella Media library come immagine, per sempre. La firma è nei byte.
          if (!looksLikeImage(buf)) {
            return { error: 'Refused: these bytes are not a PNG/JPEG/WebP/GIF. Use kind="artifact" or kind="document" for anything else.' };
          }
          if (carriesKnownSecret(buf, brandId)) {
            return { error: 'Refused: this file contains a credential. Save the result, not the environment.' };
          }
          if (buf.length > 12_000_000) return { error: 'File is over 12 MB — too large for the Media library.' };
          const ext = p.toLowerCase().endsWith('.jpg') || p.toLowerCase().endsWith('.jpeg') ? 'jpg' : 'png';
          const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
          const storagePath = `${userId}/${brandId}/media/sandbox-${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from('brand-knowledge').upload(storagePath, buf, {
            contentType: mime,
            upsert: false
          });
          if (upErr) return { error: upErr.message };

          const { insertBrandMedia, catalogBrandMedia } = await import('$lib/server/brand-media');
          const { row, error: insErr } = await insertBrandMedia(supabase, {
            brandId,
            userId,
            storagePath,
            mime,
            bytes: buf.length,
            fileName: p.split('/').pop() ?? `sandbox.${ext}`,
            title: input.title,
            source: 'agent'
          });
          if (insErr || !row) return { error: insErr ?? 'Could not register the asset' };
          void catalogBrandMedia(supabase, row.id, brandId).catch(() => {});

          const { signKnowledgePaths } = await import('$lib/server/media-archive');
          const signed = await signKnowledgePaths(supabase, [storagePath]).catch(() => new Map());
          return {
            success: true,
            media_id: row.id,
            image_url: signed.get(storagePath) ?? null,
            title: input.title,
            bytes: buf.length
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    // Il login GitHub via device flow: solo sul mount dell'orchestratore (vedi `deviceLogin` in
    // SandboxToolsOptions). Passa dallo stesso `ensure` degli altri: la VM si apre alla prima
    // chiamata del tool, mai al mount — il login (e la sandbox) si tira fuori su richiesta.
    ...(opts.deviceLogin
      ? createSandboxDeviceLoginTool({
          ensure,
          remainingMs: opts.remainingMs,
          record,
          // Chi conia un segreto lo dichiara: da qui in poi quel valore viene cancellato da ogni
          // output che torna al modello, comunque l'agente sia riuscito a leggerlo.
          onSecret: (value) => {
            secrets.add(value);
            // …e nel registro PER BRAND (redact.ts), che è l'unico che arriva fino a chi scrive
            // la traccia. Il `Set` qui sopra vive in questa closure e non lo vede nessun altro:
            // il sotto-agente costruisce un `createSandboxTools` nuovo, quindi il suo Set è
            // sempre vuoto. Era il difetto per cui la redazione «alla scrittura» girava a vuoto.
            noteSecret(brandId, value);
          }
        })
      : {})
  };

  return {
    tools,
    // Copia, non il Set vivo: chi scrive la traccia non deve poter modificare ciò che `scrub` usa.
    secrets: () => [...secrets],
    stats: () => ({
      opened: Boolean(handle),
      commands,
      browses,
      saves,
      browser: handle?.browser ?? false,
      // Nel riepilogo della delega, così tutto questo è leggibile nella traccia della chat senza
      // andare a pescare nei log della Function — che per il worker non sono nemmeno indicizzati.
      // `browser_provisioning` distingue "mai tentato" da "tentato e fallito": senza, un browser
      // assente ha due diagnosi opposte e nessun modo di sceglierne una.
      ...(handle ? { browser_provisioning: handle.browserProvisioning, image: handle.image } : {}),
      ...(handle?.browserError ? { browser_error: handle.browserError } : {})
    }),
    close: async () => {
      const open = handle;
      const since = openedAt;
      handle = null;
      openedAt = 0;
      // Rilascia la RUN: cancella i suoi file. La VM è del brand e la spegne il suo timeout —
      // fermarla qui staccherebbe la corrente a un turno parallelo dello stesso brand.
      if (open) await open.release().catch(() => {});
      if (!since) return;
      /**
       * I SECONDI DI SANDBOX DELL'AGENTE, ADDEBITATI AL BRAND.
       *
       * `SandboxUse = 'agent'` esisteva nel tipo e non aveva un solo chiamante: ogni `sandbox_exec`
       * era gratis per il brand e invisibile in bolletta, mentre accendeva una macchina che
       * fatturiamo noi. Qui il conto si chiude, nello stesso registro di tutto il resto
       * (`ai_calls` con `flatCostUsd`), senza un secondo sistema di contabilità.
       *
       * ponytail: si misura APERTURA → `close()`, non il lease. Il tetto è dichiarato e va letto:
       * la VM resta accesa fino al suo `timeout` (fino a 900 s) perché nessuno la spegne di
       * proposito — due turni dello stesso brand vivono in due processi e uno `stop()` staccherebbe
       * la corrente all'altro (sandbox.ts). Quindi questo addebito è un **limite inferiore**: è il
       * tempo che questa run ha davvero usato, non tutto quello che la macchina è costata. Il
       * numero esatto sarebbe `sandbox.activeCpuUsageMs`, che l'SDK popola solo dopo lo `stop()`
       * che non facciamo. Meglio un pavimento dichiarato che uno zero.
       */
      chargeSandboxCredits({
        brandId,
        userId,
        seconds: (Date.now() - since) / 1000,
        use: 'agent',
        ok: true,
        detail: `${commands}cmd_${browses}web_${mode}`
      });
    }
  };
}
