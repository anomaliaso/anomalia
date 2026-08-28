import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'os';
import { join } from 'path';
import { appUrl as resolveAppUrl } from './config.ts';

const CONFIG_DIR = join(homedir(), '.config', 'anomalia');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');

export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
};

// Reads the stored session. If the access_token is expired, transparently
// refreshes it using the refresh_token (valid for weeks) and saves the new
// tokens — so the user never has to login again unless they explicitly logout
// or Supabase revokes the refresh token.
export async function loadSession(): Promise<StoredSession | null> {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const stored = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as StoredSession;
    if (!stored.refresh_token) return null;

    const stillValid = stored.expires_at && Date.now() / 1000 < stored.expires_at - 30;
    if (stillValid) return stored;

    // access_token expired — use refresh_token to get a new one silently.
    const sb = anonClient();
    const { data, error } = await sb.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token
    });
    if (error || !data.session) {
      // Refresh failed — session is dead, clear it
      clearSession();
      return null;
    }

    const refreshed: StoredSession = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      user: { id: data.session.user.id, email: data.session.user.email! }
    };
    saveSession(refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

/** loadSession, but exits with a helpful message instead of returning null. */
export async function requireSession(): Promise<StoredSession> {
  const s = await loadSession();
  if (!s) {
    console.error('Sessione scaduta o non trovata. Esegui: anomalia login');
    process.exit(1);
  }
  return s;
}

// Email + password against the same Supabase project the app uses — no browser,
// no consent page. For scripts and CI; the browser flow stays the default because
// it is the only one that supports SSO providers and never puts a password on argv.
export async function passwordLogin(email: string, password: string): Promise<StoredSession> {
  const sb = anonClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Credenziali non valide');
  }
  const stored: StoredSession = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user: { id: data.session.user.id, email: data.session.user.email! }
  };
  saveSession(stored);
  return stored;
}

export function saveSession(s: StoredSession) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
}

export function clearSession() {
  try { unlinkSync(SESSION_FILE); } catch {}
}

function anonClient() {
  return createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

// Opens the web app's login page in the browser and waits for the user to
// authenticate and grant consent. The web app's /cli/callback page POSTs
// the tokens directly to our local server (browser → localhost works in
// all environments). A random state token prevents CSRF.
//
// Uses node:http (not Bun.serve) so the same code runs under Bun and the
// Node-targeted npm bundle.
export async function startBrowserLogin(
  onStatus: (msg: string) => void
): Promise<StoredSession> {
  const port = 54320 + Math.floor(Math.random() * 60);
  const state = crypto.randomUUID();
  const appUrl = resolveAppUrl();
  const appOrigin = new URL(appUrl).origin;

  let resolveSession!: (s: StoredSession) => void;
  let rejectSession!: (e: Error) => void;
  const settled = new Promise<StoredSession>((res, rej) => {
    resolveSession = res;
    rejectSession = rej;
  });

  const corsHeaders = {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'OPTIONS') {
      send(res, 204, '', corsHeaders);
      return;
    }
    if (url.pathname === '/session' && req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as {
          access_token: string;
          refresh_token: string;
          expires_at: number;
          state: string;
        };
        if (body.state !== state) {
          send(res, 400, 'Invalid state', corsHeaders);
          return;
        }
        const sb = createClient(
          process.env.PUBLIC_SUPABASE_URL!,
          process.env.PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false } }
        );
        const { data } = await sb.auth.getUser(body.access_token);
        const stored: StoredSession = {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          expires_at: body.expires_at || Math.floor(Date.now() / 1000) + 3600,
          user: { id: data.user!.id, email: data.user!.email! }
        };
        saveSession(stored);
        resolveSession(stored);
        send(res, 200, 'OK', corsHeaders);
      } catch (e) {
        rejectSession(new Error(String(e)));
        send(res, 500, 'Error', corsHeaders);
      }
      return;
    }
    send(res, 404, 'Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const loginUrl = `${appUrl}/login?cli_port=${port}&cli_state=${state}`;
  onStatus('Apertura browser per il login…');
  const { default: open } = await import('open');
  await open(loginUrl);
  onStatus('Browser aperto — accedi e premi "Autorizza" per completare.');

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: nessun login nei 5 minuti')), 5 * 60 * 1000)
  );

  try {
    const session = await Promise.race([settled, timeout]);
    return session;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
