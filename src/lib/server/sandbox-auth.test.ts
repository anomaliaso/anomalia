import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// $env/dynamic/private lo risolve il plugin di SvelteKit; al test serve un oggetto normale.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { isSandboxConfigured } = await import('./sandbox');

const REQ_CONTEXT = Symbol.for('@vercel/request-context');

/** Finge il request context che Vercel installa su globalThis dentro una Function. */
function withRequestContext(headers: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)[REQ_CONTEXT] = { get: () => ({ headers }) };
}

describe('isSandboxConfigured', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any)[REQ_CONTEXT];
  });

  it('senza niente è falso — i tool spariscono invece di esplodere', () => {
    expect(isSandboxConfigured()).toBe(false);
  });

  it('riconosce VERCEL_OIDC_TOKEN dall’ambiente (build, o .env.local in locale)', () => {
    env.VERCEL_OIDC_TOKEN = 'ey.token';
    expect(isSandboxConfigured()).toBe(true);
  });

  /**
   * La regressione che questo gate ha già avuto una volta: in una Vercel Function il token NON è
   * nell'ambiente, arriva come header `x-vercel-oidc-token` sul request context. Guardando solo la
   * env var, in produzione il gate era sempre falso — OIDC acceso, SDK in grado di autenticarsi, e
   * i tool che non comparivano mai senza un errore da nessuna parte.
   */
  it('riconosce l’OIDC quando arriva come header nel request context (Vercel Function)', () => {
    withRequestContext({ 'x-vercel-oidc-token': 'ey.header.token' });
    expect(env.VERCEL_OIDC_TOKEN).toBeUndefined();
    expect(isSandboxConfigured()).toBe(true);
  });

  it('un request context senza quell’header non conta', () => {
    withRequestContext({ 'x-forwarded-for': '1.2.3.4' });
    expect(isSandboxConfigured()).toBe(false);
  });

  it('accetta le credenziali esplicite col nome documentato (VERCEL_TOKEN)', () => {
    env.VERCEL_TOKEN = 'tok';
    env.VERCEL_TEAM_ID = 'team_x';
    env.VERCEL_PROJECT_ID = 'prj_x';
    expect(isSandboxConfigured()).toBe(true);
  });

  it('accetta anche l’alias storico SANDBOX_VERCEL_TOKEN', () => {
    env.SANDBOX_VERCEL_TOKEN = 'tok';
    env.VERCEL_TEAM_ID = 'team_x';
    env.VERCEL_PROJECT_ID = 'prj_x';
    expect(isSandboxConfigured()).toBe(true);
  });

  it('credenziali esplicite a metà non bastano: meglio spento che a metà', () => {
    env.VERCEL_TOKEN = 'tok';
    env.VERCEL_TEAM_ID = 'team_x';
    expect(isSandboxConfigured()).toBe(false);
  });

  it('SANDBOX_DISABLED=1 vince su tutto — è il kill switch', () => {
    env.SANDBOX_DISABLED = '1';
    env.VERCEL_OIDC_TOKEN = 'ey.token';
    withRequestContext({ 'x-vercel-oidc-token': 'ey.header.token' });
    expect(isSandboxConfigured()).toBe(false);
  });
});

describe('sandboxName', () => {
  it('porta la generazione, così il fix raggiunge chi ha già una sandbox provisionata male', async () => {
    const { sandboxName, SANDBOX_GENERATION } = await import('./sandbox');
    const name = sandboxName('b1', 'research');
    expect(name).toContain(SANDBOX_GENERATION);
    // getOrCreate riprende per nome: senza la generazione nel nome, un brand con la sandbox
    // Amazon Linux continuerebbe a riprendere quella e il browser resterebbe rotto per sempre.
    expect(name).not.toBe('anomalia-b1-research');
  });

  // Il nome non porta più il profilo di rete (la policy si fissa alla creazione, ed è una sola):
  // quello che separa le macchine è l'AGENTE.
  it('ogni agente la sua macchina, lo stesso agente sempre la stessa', async () => {
    const { sandboxName } = await import('./sandbox');
    expect(sandboxName('b1', 'motion')).not.toBe(sandboxName('b1', 'web'));
    expect(sandboxName('b1', 'motion')).toBe(sandboxName('b1', 'motion'));
  });
});
