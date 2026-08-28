import { describe, expect, test } from 'bun:test';
import { mcpLogAsync } from './observability.ts';
import { routeMcpHttp } from './http-router.ts';

describe('mcp observability', () => {
  test('mcpLogAsync no-ops without Sentry/Supabase env', async () => {
    const prevDsn = process.env.SENTRY_DSN;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SENTRY_DSN;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      await mcpLogAsync({
        level: 'info',
        event: 'test.event',
        message: 'hello',
      });
    } finally {
      if (prevDsn !== undefined) process.env.SENTRY_DSN = prevDsn;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
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
