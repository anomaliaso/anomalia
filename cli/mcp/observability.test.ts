import { describe, expect, test } from 'bun:test';
import { mcpLog, mcpLogAsync } from './observability.ts';
import { routeMcpHttp } from './http-router.ts';

async function logWithoutEnv(times: number): Promise<string[]> {
  const prevDsn = process.env.SENTRY_DSN;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevUrl = process.env.PUBLIC_SUPABASE_URL;
  delete process.env.SENTRY_DSN;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const written: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void written.push(args.join(' '));

  try {
    for (let i = 0; i < times; i++) {
      await mcpLogAsync({ level: 'info', event: 'test.event', message: 'hello' });
    }
  } finally {
    console.error = realError;
    if (prevDsn !== undefined) process.env.SENTRY_DSN = prevDsn;
    if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    if (prevUrl !== undefined) process.env.PUBLIC_SUPABASE_URL = prevUrl;
  }

  return written;
}

describe('mcp observability', () => {
  /**
   * Al progetto Vercel dell'MCP manca `SUPABASE_SERVICE_ROLE_KEY`, quindi `mcpLog` usciva senza
   * scrivere e senza dire niente: `mcp_logs` vuota, e nessun modo di saperlo se non guardando la
   * tabella. Un sistema di osservabilità che non osserva deve almeno dirlo.
   */
  test('senza chiave lo dice — una volta sola, non a ogni chiamata', async () => {
    const written = await logWithoutEnv(3);
    const warnings = written.filter((line) => line.includes('mcp_logs disabled'));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  /**
   * Questo gira DENTRO il server MCP, ora su ogni chiamata a un tool. Un `void` su una promise
   * respinta è una unhandled rejection, che in Node abbatte il processo: l'osservabilità
   * rovescerebbe la richiesta di un cliente per non essere riuscita a descriverla.
   */
  test('un guasto del log non rovescia la chiamata che stava descrivendo', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const escaped: unknown[] = [];
    const onEscape = (e: unknown) => void escaped.push(e);
    process.on('unhandledRejection', onEscape);

    const realError = console.error;
    console.error = () => {};

    try {
      expect(() => mcpLog({ level: 'info', event: 'test.event', message: 'hi', context: circular })).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      console.error = realError;
      process.off('unhandledRejection', onEscape);
    }

    expect(escaped).toEqual([]);
  });
});

describe('mcp http router', () => {
  test('health via router', async () => {
    const res = await routeMcpHttp(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
