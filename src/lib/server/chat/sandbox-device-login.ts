/**
 * `sandbox_device_login` — il device flow GitHub per la VM dell'agente.
 *
 * Il modello di riferimento è il "Distributor" di Grok: quando un lavoro nella VM incontra un
 * sito che vuole GitHub, l'agente avvia il device flow SULLA PROPRIA macchina e passa all'utente
 * solo il codice pubblico ("apri github.com/login/device, inserisci 2021-F75B"). L'utente
 * autorizza dal SUO browser, e la sessione dell'agente diventa autenticata — senza che una
 * password o un token passino mai per la chat.
 *
 * Tre confini, tutti deliberati:
 *
 * 1. **Il token non entra MAI nell'output del tool** (quindi né nel transcript del modello né in
 *    `chat_messages`). A polling riuscito viene scritto SOLO dentro la VM del brand, in un env
 *    file nella directory della run (`.github.env`, chmod 600): `sandbox_exec` lo sorgente e da
 *    lì `gh`, `git` e le chiamate API funzionano subito.
 * 2. **Nessuna persistenza fuori dalla VM**: la directory della run viene rimossa alla release e
 *    la VM muore col suo lease (≤15 min). Il token effimero non è un limite, è il design — come
 *    il codice di Grok che scadeva.
 * 3. **Solo l'orchestratore** monta questo tool (flag `deviceLogin` + NEVER_FOR_SUBAGENTS):
 *    chiedere a una persona di autorizzare è un gesto verso di lei, e chi le parla è uno solo.
 *
 * Le chiamate HTTP del device flow partono dal SERVER (questa Function), non dalla VM: la network
 * policy della sandbox non c'entra col flow in sé — c'entra solo con l'uso del token dopo
 * (vedi GITHUB_DOMAINS in sandbox.ts per il profilo compute).
 *
 * Lo STATO del flow (device_code, che non è il token: da solo non autentica niente finché
 * l'utente non approva) vive a livello home della VM (`.anomalia/github-device.json`): così un
 * `check` in un turno successivo ritrova il flow avviato nel turno prima, finché la VM vive.
 */
import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { SECRET_ENV_FILE, SECRET_HOME_DIR, underRoot, type SandboxHandle } from '$lib/server/sandbox';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';
/** Stato del flow in corso: home della VM, sopravvive ai turni ma non al lease. Mai il token. */
export const DEVICE_STATE_PATH = `${SECRET_HOME_DIR}/github-device.json`;
/**
 * Dove finisce il token: nella directory della RUN, che la release cancella.
 *
 * Il nome arriva da sandbox.ts e non è più un letterale locale: è lo stesso valore su cui
 * `rejectReadPath` costruisce il divieto, e due copie della stessa stringa in due file erano il modo
 * più veloce per rimettere in piedi la falla al primo rename.
 */
export const TOKEN_ENV_FILE = SECRET_ENV_FILE;
/** Quanto un singolo `check` può restare ad aspettare l'utente dentro il turno. */
const CHECK_BUDGET_MS = 90_000;

export type DeviceLoginSandbox = Pick<SandboxHandle, 'write' | 'run' | 'read' | 'root'>;

export type DeviceLoginDeps = {
  /** La VM si apre SOLO qui, alla prima chiamata del tool — mai al mount (stesso lazy degli altri cinque). */
  ensure: (abortSignal?: AbortSignal) => Promise<DeviceLoginSandbox>;
  remainingMs?: () => number;
  record?: (kind: string, data?: Record<string, unknown>, meta?: { ms?: number; ok?: boolean }) => void;
  /**
   * Dichiara un valore segreto appena coniato (device_code, token) a chi monta i tool.
   *
   * Serve perché il file col token resta leggibile da dentro la VM — `sandbox_exec` esegue comandi
   * arbitrari e `source .github.env` è l'uso previsto — quindi l'unica difesa che regge su ogni
   * strada è cancellare il valore dall'output che torna al modello. Chi lo conia è l'unico che lo
   * conosce prima che sia su disco.
   */
  onSecret?: (value: string) => void;
  /** Iniettabili nei test: mai usati per altro. `clientId: null` = non configurato. */
  clientId?: string | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type DeviceState = { device_code: string; interval: number; expires_at: number; scopes: string };

const UNCONFIGURED = {
  error: 'github_device_login_unconfigured',
  message:
    'GitHub device login is not configured on this environment. Setup: create a GitHub OAuth App (github.com → Settings → Developer settings → OAuth Apps), tick "Enable Device Flow", and set its Client ID as GITHUB_DEVICE_CLIENT_ID in the environment. No client secret is needed for the device flow. Tell the user this needs a one-time setup by the operator — do not retry.'
};

async function githubPost(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  // GitHub risponde 200 anche agli errori del flow (authorization_pending & co.): il JSON è la verità.
  return (await res.json().catch(() => ({ error: `github_http_${res.status}` }))) as Record<string, unknown>;
}

export function createSandboxDeviceLoginTool(deps: DeviceLoginDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const record = deps.record ?? (() => {});

  async function readState(sandbox: DeviceLoginSandbox): Promise<DeviceState | null> {
    try {
      const raw = JSON.parse(await sandbox.read(DEVICE_STATE_PATH)) as Partial<DeviceState>;
      if (typeof raw?.device_code !== 'string' || !raw.device_code) return null;
      return {
        device_code: raw.device_code,
        interval: typeof raw.interval === 'number' ? raw.interval : 5,
        expires_at: typeof raw.expires_at === 'number' ? raw.expires_at : 0,
        scopes: typeof raw.scopes === 'string' ? raw.scopes : ''
      };
    } catch {
      return null;
    }
  }

  async function clearState(sandbox: DeviceLoginSandbox): Promise<void> {
    await sandbox.run('rm', ['-f', DEVICE_STATE_PATH]).catch(() => {});
  }

  return {
    sandbox_device_login: tool({
      description: [
        'Authenticate YOUR sandbox VM with GitHub via the device flow — for tasks like "submit the product to directories" when a site or tool needs GitHub.',
        'action="start": begins the flow and renders an in-chat card with a public one-time code; the user opens github.com/login/device in THEIR browser, enters it and authorizes. Tell them in ONE short line to use the card — never repeat the code in your text, never ask for a password.',
        'action="check": waits for the authorization (call it after start, and again in a later turn if needed). On success the token is written ONLY inside the VM — you never see it; source .github.env in sandbox_exec and gh/git/API calls work.',
        'The token dies with the VM lease. If a site has no GitHub device flow (e.g. its own email login), say honestly that the user has to do that login themselves — do not improvise.',
        'Like the whole sandbox, this is on-demand only: start a login (and the VM behind it) when the task actually needs it, never as a reflex.'
      ].join(' '),
      inputSchema: z.object({
        // Solo GitHub oggi: l'enum a un valore è il punto di estensione, senza codice speculativo.
        provider: z.enum(['github']).describe('Only "github" is supported today.'),
        action: z
          .enum(['start', 'check'])
          .default('start')
          .describe('"start" begins a new login (renders the code card); "check" polls an in-progress one.'),
        scopes: z
          .string()
          .max(200)
          .optional()
          .describe('OAuth scopes, space-separated. Default "repo". Ask for the minimum the task needs.')
      }),
      execute: async (
        input: { provider: 'github'; action?: 'start' | 'check'; scopes?: string },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        const action = input.action ?? 'start';
        const clientId = deps.clientId !== undefined ? deps.clientId : env.GITHUB_DEVICE_CLIENT_ID || null;
        if (!clientId) {
          record('sandbox_device_login', { action, status: 'unconfigured' }, { ok: false });
          return UNCONFIGURED;
        }

        let sandbox: DeviceLoginSandbox;
        try {
          sandbox = await deps.ensure(toolOpts?.abortSignal);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }

        if (action === 'start') {
          const scopes = input.scopes?.trim() || 'repo';
          const res = await githubPost(fetchImpl, GITHUB_DEVICE_CODE_URL, { client_id: clientId, scope: scopes }).catch(
            (e: unknown): Record<string, unknown> => ({ error: e instanceof Error ? e.message : String(e) })
          );
          if (typeof res.error === 'string' || typeof res.device_code !== 'string' || typeof res.user_code !== 'string') {
            record('sandbox_device_login', { action, status: 'start_failed' }, { ok: false });
            return { error: 'device_flow_start_failed', message: String(res.error ?? 'GitHub returned no device code') };
          }
          // Il device_code, con il client id, basta a ritirare il token: è un segreto anche lui.
          deps.onSecret?.(res.device_code);
          const expiresIn = typeof res.expires_in === 'number' ? res.expires_in : 900;
          const state: DeviceState = {
            device_code: res.device_code,
            interval: typeof res.interval === 'number' ? res.interval : 5,
            expires_at: now() + expiresIn * 1000,
            scopes
          };
          await sandbox.write([{ path: DEVICE_STATE_PATH, content: JSON.stringify(state) }]);
          // Permessi stretti: il device_code non è il token, ma non deve comunque restare leggibile a chiunque.
          await sandbox.run('bash', ['-lc', `chmod 700 .anomalia && chmod 600 ${DEVICE_STATE_PATH}`]).catch(() => {});
          record('sandbox_device_login', { action, status: 'pending' }, { ok: true });
          // user_code e verification_uri sono pubblici per design (l'utente deve vederli): la card li mostra.
          return {
            provider: 'github',
            status: 'pending',
            user_code: res.user_code,
            verification_uri: typeof res.verification_uri === 'string' ? res.verification_uri : 'https://github.com/login/device',
            expires_at: state.expires_at,
            expires_in: expiresIn,
            interval: state.interval,
            hint: 'The code card is now in the chat. Tell the user in ONE short line to authorize from it (do NOT repeat the code in your text), then call this tool with action:"check" to wait for the authorization.'
          };
        }

        // action === 'check'
        const state = await readState(sandbox);
        if (!state) {
          return { provider: 'github', status: 'none', message: 'No GitHub device login in progress. Call with action:"start" first.' };
        }
        if (now() >= state.expires_at) {
          await clearState(sandbox);
          record('sandbox_device_login', { action, status: 'expired' }, { ok: false });
          return { provider: 'github', status: 'expired', message: 'The code expired before the user authorized. Start a new login if still needed.' };
        }

        // Il polling rispetta l'interval di GitHub (e slow_down lo allunga). Budget dentro il
        // turno: se l'utente non ha ancora finito, si torna "pending" e si può richiamare check.
        let interval = Math.max(1, state.interval);
        const deadline = now() + Math.max(5_000, Math.min(CHECK_BUDGET_MS, (deps.remainingMs?.() ?? CHECK_BUDGET_MS) - 10_000));
        for (;;) {
          const res = await githubPost(fetchImpl, GITHUB_DEVICE_TOKEN_URL, {
            client_id: clientId,
            device_code: state.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          }).catch((e: unknown): Record<string, unknown> => ({ error: e instanceof Error ? e.message : String(e) }));

          if (typeof res.access_token === 'string' && res.access_token) {
            // IL TOKEN SI FERMA QUI: file nella run della VM, mai nel valore di ritorno, mai nei log.
            // E da questa riga il suo valore è cancellato anche dall'output dei comandi: il file è
            // sourceable (serve a gh/git), ma `cat` non lo riporta più indietro in chiaro.
            deps.onSecret?.(res.access_token);
            const envFile = underRoot(sandbox.root, TOKEN_ENV_FILE);
            await sandbox.write([
              {
                path: envFile,
                content: `# Scritto da sandbox_device_login: muore con questa run. Mai stampare questi valori.\nexport GH_TOKEN='${res.access_token}'\nexport GITHUB_TOKEN='${res.access_token}'\n`
              }
            ]);
            await sandbox.run('bash', ['-lc', `chmod 600 ${envFile}`]).catch(() => {});
            await clearState(sandbox);
            record('sandbox_device_login', { action, status: 'authorized' }, { ok: true });
            return {
              provider: 'github',
              status: 'authorized',
              note: `GitHub is authorized. The token was written ONLY inside the VM at ${TOKEN_ENV_FILE} (your working directory) — you never see it and it dies with this VM. Use it from sandbox_exec with: bash -lc "source ${TOKEN_ENV_FILE} && gh auth status" (GH_TOKEN and GITHUB_TOKEN are exported; gh, git over https and curl -H "Authorization: Bearer $GH_TOKEN" all work). Never print the token or the env file content.`
            };
          }

          const err = typeof res.error === 'string' ? res.error : '';
          if (err === 'slow_down') {
            interval = typeof res.interval === 'number' ? res.interval : interval + 5;
          } else if (err && err !== 'authorization_pending') {
            await clearState(sandbox);
            const denied = err === 'access_denied';
            record('sandbox_device_login', { action, status: denied ? 'denied' : 'error' }, { ok: false });
            if (denied) {
              return { provider: 'github', status: 'denied', message: 'The user denied the authorization. Do not restart unless they ask.' };
            }
            if (err === 'expired_token') {
              return { provider: 'github', status: 'expired', message: 'The code expired. Start a new login if still needed.' };
            }
            return { error: 'device_flow_failed', message: err };
          }

          if (now() + interval * 1000 > deadline) {
            record('sandbox_device_login', { action, status: 'pending' }, { ok: true });
            return {
              provider: 'github',
              status: 'pending',
              expires_at: state.expires_at,
              note: 'The user has not finished authorizing yet. The card is still valid — you can call action:"check" again (even in a later turn) while the code has not expired.'
            };
          }
          await sleep(interval * 1000);
        }
      }
    })
  };
}
