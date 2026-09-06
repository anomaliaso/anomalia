import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { COMPOSIO_API_KEY: 'ak_test' } }));

// È il resolver a decidere se un nome è interno, quindi il test lo detta invece di dipendere dal
// DNS della macchina: un indirizzo letterale risponde se stesso, un nome risponde pubblico —
// tranne quello che questi casi vogliono interno.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host.endsWith('.internal') || host.endsWith('.local') || host === 'localhost') {
      return [{ address: '127.0.0.1', family: 4 }];
    }
    return /^[\d.]+$/.test(host)
      ? [{ address: host, family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }];
  })
}));
import {
  attemptDelivery,
  backoffMs,
  claimDueDeliveries,
  eventBody,
  MAX_DELIVERY_ATTEMPTS,
  newWebhookSecret,
  signDelivery,
  validateWebhookUrl,
  wantsEvent,
  type BrandWebhookRow,
  type DeliveryRow
} from './brand-webhooks';
import {
  brandIdFromComposioUser,
  parseComposioTriggerEvent,
  verifyComposioWebhook
} from './composio';
import { createHmac } from 'node:crypto';

describe('validateWebhookUrl', () => {
  it('accepts a public https endpoint', async () => {
    expect(await validateWebhookUrl(' https://hooks.acme.com/anomalia ')).toEqual({
      ok: true,
      url: 'https://hooks.acme.com/anomalia'
    });
  });

  it('refuses anything we should not be POSTing to', async () => {
    // http is a plaintext secret on the wire; the rest are our own network.
    for (const bad of [
      'http://hooks.acme.com',
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.4/hook',
      'https://192.168.1.10/hook',
      'https://172.16.0.9/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://db.internal/hook',
      'not a url'
    ]) {
      expect((await validateWebhookUrl(bad)).ok, bad).toBe(false);
    }
  });
});

describe('signDelivery', () => {
  it('signs id.timestamp.body so a replay with another body fails', () => {
    const args = { secret: 'whsec_x', deliveryId: 'd1', timestamp: '2026-01-01T00:00:00Z' };
    const sig = signDelivery({ ...args, body: '{"a":1}' });
    const expected = createHmac('sha256', 'whsec_x')
      .update('d1.2026-01-01T00:00:00Z.{"a":1}')
      .digest('base64');
    expect(sig).toBe(expected);
    expect(signDelivery({ ...args, body: '{"a":2}' })).not.toBe(sig);
  });
});

describe('backoffMs', () => {
  it('grows fast and stops at six hours', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(MAX_DELIVERY_ATTEMPTS)).toBe(6 * 60 * 60 * 1000);
  });
});

describe('wantsEvent', () => {
  it('treats an empty subscription list as "everything"', () => {
    expect(wantsEvent({ events: [] }, 'GITHUB_PULL_REQUEST_EVENT')).toBe(true);
    expect(wantsEvent({ events: ['GITHUB_PULL_REQUEST_EVENT'] }, 'GITHUB_PULL_REQUEST_EVENT')).toBe(true);
    expect(wantsEvent({ events: ['GITHUB_COMMIT_EVENT'] }, 'GITHUB_PULL_REQUEST_EVENT')).toBe(false);
  });
});

describe('newWebhookSecret', () => {
  it('is prefixed and unguessable', () => {
    const a = newWebhookSecret();
    expect(a.startsWith('whsec_')).toBe(true);
    expect(a.length).toBeGreaterThan(30);
    expect(newWebhookSecret()).not.toBe(a);
  });
});

describe('composio ingress', () => {
  const secret = 'whsec_composio';
  const body = JSON.stringify({
    id: 'msg_1',
    type: 'composio.trigger.message',
    metadata: {
      trigger_slug: 'GITHUB_PULL_REQUEST_EVENT',
      trigger_id: 'ti_1',
      connected_account_id: 'ca_1',
      user_id: 'brand_2f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
    },
    data: { number: 7 },
    timestamp: '2026-01-01T00:00:00Z'
  });
  const webhookId = 'wh_1';
  const timestamp = '1767225600';
  const signature = createHmac('sha256', secret)
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest('base64');

  it('accepts a correctly signed payload, in either header form', () => {
    for (const header of [signature, `v1,${signature}`, `v1,other v1,${signature}`]) {
      expect(
        verifyComposioWebhook({
          rawBody: body,
          webhookId,
          webhookTimestamp: timestamp,
          signatureHeader: header,
          secret
        })
      ).toBe(true);
    }
  });

  it('refuses a tampered body, a wrong secret, or missing headers', () => {
    const base = { webhookId, webhookTimestamp: timestamp, signatureHeader: signature, secret };
    expect(verifyComposioWebhook({ ...base, rawBody: body + ' ' })).toBe(false);
    expect(verifyComposioWebhook({ ...base, rawBody: body, secret: 'other' })).toBe(false);
    expect(verifyComposioWebhook({ ...base, rawBody: body, webhookId: null })).toBe(false);
    expect(verifyComposioWebhook({ ...base, rawBody: body, signatureHeader: null })).toBe(false);
  });

  it('reads the brand and the event out of the envelope', () => {
    const event = parseComposioTriggerEvent(JSON.parse(body));
    expect(event).toMatchObject({
      eventId: 'msg_1',
      triggerSlug: 'GITHUB_PULL_REQUEST_EVENT',
      triggerInstanceId: 'ti_1',
      connectedAccountId: 'ca_1'
    });
    expect(brandIdFromComposioUser(event!.userId)).toBe('2f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f');
    expect(brandIdFromComposioUser('someone-else')).toBeNull();
  });

  it('ignores envelopes that are not trigger messages', () => {
    expect(parseComposioTriggerEvent({ type: 'composio.something.else' })).toBeNull();
    expect(parseComposioTriggerEvent({ metadata: {} })).toBeNull();
  });
});

describe('eventBody', () => {
  it('hands the brand a stable envelope, not Composio internals', () => {
    expect(
      eventBody({
        eventId: 'msg_1',
        triggerSlug: 'GITHUB_PULL_REQUEST_EVENT',
        timestamp: '2026-01-01T00:00:00Z',
        data: { number: 7 }
      })
    ).toEqual({
      id: 'msg_1',
      type: 'GITHUB_PULL_REQUEST_EVENT',
      created_at: '2026-01-01T00:00:00Z',
      data: { number: 7 }
    });
  });
});

/**
 * The endpoint is checked where it is saved, and the row it is saved in is writable straight from
 * the browser: anon key + the user's JWT, `for all` on the brand's own rows. So the value the
 * worker POSTs to is not the value a route ever validated — and a name that resolves private is
 * something no check at save time could have seen anyway.
 */
function fakeSupabase(rows: Record<string, unknown[]>) {
  const writes: { table: string; patch: Record<string, unknown> }[] = [];
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lte', 'order', 'limit', 'neq']) {
      q[method] = () => q;
    }
    q.update = (patch: Record<string, unknown>) => {
      writes.push({ table, patch });
      return q;
    };
    q.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null });
    q.then = (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: rows[table] ?? [] });
    return q;
  };
  return { client: { from: (table: string) => chain(table) }, writes };
}

const webhookRow = (over: Partial<BrandWebhookRow> = {}): BrandWebhookRow => ({
  id: 'w1',
  brand_id: 'brand-mio',
  url: 'https://hooks.acme.com/anomalia',
  secret: 'whsec_x',
  events: [],
  status: 'active',
  failure_count: 0,
  last_delivery_at: null,
  last_error: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over
});

const deliveryRow = (over: Partial<DeliveryRow> = {}): DeliveryRow => ({
  id: 'd1',
  brand_id: 'brand-mio',
  webhook_id: 'w1',
  event_id: 'msg_1',
  trigger_slug: 'GITHUB_PULL_REQUEST_EVENT',
  payload: {},
  attempts: 0,
  ...over
});

describe('attemptDelivery', () => {
  it('non spedisce a un endpoint che il guardiano rifiuta', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    assertPublicUrl.mockRejectedValueOnce(new Error('That host is not reachable'));
    const { client, writes } = fakeSupabase({});

    const delivered = await attemptDelivery(client as never, deliveryRow(), webhookRow());

    expect(delivered).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === 'webhook_deliveries')?.patch.error).toBe(
      'That host is not reachable'
    );
    fetchSpy.mockRestore();
  });

  it("chiede la guardia che risolve il nome, non il confronto sul testo dell'host", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const { client } = fakeSupabase({});

    await attemptDelivery(client as never, deliveryRow(), webhookRow());

    expect(assertPublicUrl).toHaveBeenCalledWith(new URL(webhookRow().url), 'https-only');
    fetchSpy.mockRestore();
  });

  it('non segue un redirect: un host consentito che risponde 302 scavalcherebbe il controllo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const { client } = fakeSupabase({});

    await attemptDelivery(client as never, deliveryRow(), webhookRow());

    expect((fetchSpy.mock.calls[0][1] as RequestInit).redirect).toBe('error');
    fetchSpy.mockRestore();
  });

  it('spedisce a un endpoint valido', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const { client } = fakeSupabase({});

    expect(await attemptDelivery(client as never, deliveryRow(), webhookRow())).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});

describe('claimDueDeliveries', () => {
  it('non consegna una riga il cui endpoint è di un altro brand', async () => {
    const { client } = fakeSupabase({
      webhook_deliveries: [deliveryRow({ webhook_id: 'w-altrui' })],
      brand_webhooks: [webhookRow({ id: 'w-altrui', brand_id: 'brand-altrui' })]
    });

    expect(await claimDueDeliveries(client as never)).toEqual([]);
  });

  it('consegna una riga il cui endpoint è dello stesso brand', async () => {
    const { client } = fakeSupabase({
      webhook_deliveries: [deliveryRow()],
      brand_webhooks: [webhookRow()]
    });

    expect(await claimDueDeliveries(client as never)).toHaveLength(1);
  });
});
