import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) =>
    host === 'rebound.acme.com'
      ? [{ address: '127.0.0.1', family: 4 }]
      : /^\d+\.\d+\.\d+\.\d+$/.test(host)
        ? [{ address: host, family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
  )
}));

import { attemptDelivery, type BrandWebhookRow, type DeliveryRow } from './brand-webhooks';

const PUBLIC_ORIGIN = 'https://hooks.acme.com';
const REBOUND_ORIGIN = 'https://rebound.acme.com';
const INTERNAL_PATH = '/latest/meta-data/iam/credentials';
const REDIRECTING_PATH = '/hook-moved';
const HOOK_PATH = '/hook';

let server: Server;
let origin: string;
let hits: string[] = [];

const realFetch = globalThis.fetch;

function resolvingPublicHostToLocalServer(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const local = url.origin === PUBLIC_ORIGIN || url.origin === REBOUND_ORIGIN;
    return realFetch(local ? `${origin}${url.pathname}${url.search}` : String(input), init);
  }) as typeof fetch;
}

function supabaseStub() {
  const updates: Array<Record<string, unknown>> = [];
  const chain = {
    update(values: Record<string, unknown>) {
      updates.push(values);
      return chain;
    },
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
  };
  return { updates, client: { from: () => chain } };
}

const webhook = (url: string): BrandWebhookRow => ({
  id: 'wh-1',
  brand_id: 'b-1',
  url,
  secret: 'whsec_test',
  events: ['*'],
  status: 'active',
  failure_count: 0,
  last_delivery_at: null,
  last_error: null,
  created_at: '2026-01-01T00:00:00Z'
});

const delivery: DeliveryRow = {
  id: 'd-1',
  brand_id: 'b-1',
  webhook_id: 'wh-1',
  event_id: 'e-1',
  trigger_slug: 'post.published',
  payload: { hello: 'world' },
  attempts: 0
};

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');

    if (req.url === REDIRECTING_PATH) {
      res.writeHead(302, { location: `${origin}${INTERNAL_PATH}` });
      res.end();
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = resolvingPublicHostToLocalServer();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('attemptDelivery', () => {
  it('non consegna a un host che passa la validazione ma risolve nella rete interna', async () => {
    hits = [];
    const { client } = supabaseStub();

    const ok = await attemptDelivery(client as never, delivery, webhook(`${REBOUND_ORIGIN}${HOOK_PATH}`));

    expect(hits).toEqual([]);
    expect(ok).toBe(false);
  });

  it('non segue un redirect verso la rete interna', async () => {
    hits = [];
    const { client } = supabaseStub();

    const ok = await attemptDelivery(client as never, delivery, webhook(`${PUBLIC_ORIGIN}${REDIRECTING_PATH}`));

    expect(hits).not.toContain(INTERNAL_PATH);
    expect(ok).toBe(false);
  });

  it('consegna ancora a un endpoint pubblico', async () => {
    hits = [];
    const { client } = supabaseStub();

    const ok = await attemptDelivery(client as never, delivery, webhook(`${PUBLIC_ORIGIN}${HOOK_PATH}`));

    expect(hits).toEqual([HOOK_PATH]);
    expect(ok).toBe(true);
  });
});
