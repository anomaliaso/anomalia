import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));

vi.mock('$env/dynamic/private', () => ({ env: state.env }));

function setEnv(values: Record<string, string | undefined>) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, values);
}

import { manualPublisher, NO_PROVIDER_NOTICE } from './manual';

afterEach(() => {
  setEnv({});
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('resolvePublisher', () => {
  it('defaults to zernio when ZERNIO_API_KEY is present', async () => {
    const { resolvePublisher } = await import('./index');
    expect(resolvePublisher(undefined, 'test-key').kind).toBe('zernio');
  });

  it('defaults to manual when no key is present', async () => {
    const { resolvePublisher } = await import('./index');
    expect(resolvePublisher(undefined, undefined).kind).toBe('manual');
    expect(resolvePublisher('', '').kind).toBe('manual');
  });

  it('lets SOCIAL_PUBLISHER override the default in both directions', async () => {
    const { resolvePublisher } = await import('./index');
    expect(resolvePublisher('manual', 'test-key').kind).toBe('manual');
    expect(resolvePublisher('zernio', undefined).kind).toBe('zernio');
  });

  it('treats an unknown SOCIAL_PUBLISHER as absent and falls back by key', async () => {
    const { resolvePublisher } = await import('./index');
    expect(resolvePublisher('carrier-pigeon', 'test-key').kind).toBe('zernio');
    expect(resolvePublisher('carrier-pigeon', undefined).kind).toBe('manual');
  });
});

describe('module default selection', () => {
  it('picks zernio from env at import time', async () => {
    setEnv({ ZERNIO_API_KEY: 'test-key' });
    const { publisher } = await import('./index');
    expect(publisher.kind).toBe('zernio');
  });

  it('picks manual when the instance has no key', async () => {
    setEnv({});
    const { publisher } = await import('./index');
    expect(publisher.kind).toBe('manual');
  });
});

describe('zernio base URL override', () => {
  it('honors ZERNIO_BASE_URL for remote calls', async () => {
    setEnv({ ZERNIO_API_KEY: 'test-key', ZERNIO_BASE_URL: 'https://z.example.com/api/v1' });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ accounts: [] }) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { zernioPublisher } = await import('./zernio');
    await zernioPublisher.accounts('p1');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://z.example.com/api/v1/accounts?profileId=p1');
  });

  it('keeps the hosted default when ZERNIO_BASE_URL is absent', async () => {
    setEnv({ ZERNIO_API_KEY: 'test-key' });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ accounts: [] }) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { zernioPublisher } = await import('./zernio');
    await zernioPublisher.accounts('p1');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://zernio.com/api/v1/accounts?profileId=p1');
  });
});

describe('manual provider graceful results', () => {
  it('refuses publishing with an explicit reason instead of throwing', async () => {
    const receipt = await manualPublisher.publish({ accountId: 'a1', platform: 'x', content: 'hi' });
    expect(receipt).toEqual({ ok: false, reason: 'no_provider' });
  });

  it('reports zero connected accounts and empty analytics', async () => {
    await expect(manualPublisher.accounts('p1')).resolves.toEqual([]);
    await expect(manualPublisher.analyticsPosts('p1')).resolves.toEqual([]);
  });

  it('answers postStatus as gone so cancellation flows treat nothing as live', async () => {
    await expect(manualPublisher.postStatus('p1')).resolves.toEqual({
      status: 'not_found',
      url: null,
      error: null,
      scheduledFor: null
    });
  });

  it('resolves deletes and disconnects as no-ops', async () => {
    await expect(manualPublisher.deletePost('p1')).resolves.toBeUndefined();
    await expect(manualPublisher.disconnectAccount('a1')).resolves.toBeUndefined();
  });

  it('makes connect flows fail loudly with the self-host notice', async () => {
    await expect(manualPublisher.connectUrl('p1', 'x')).rejects.toThrow(NO_PROVIDER_NOTICE);
    await expect(manualPublisher.createProfile({ name: 'n', description: 'd' })).rejects.toThrow(NO_PROVIDER_NOTICE);
  });
});
