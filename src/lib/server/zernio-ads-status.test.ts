import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { ZERNIO_API_KEY: 'test-key' } }));

const { updateAd } = await import('./zernio-ads');

/**
 * Zernio's two status enums differ in case: POST /ads/create takes ACTIVE/PAUSED, but
 * PUT /ads/{adId} takes active/paused and rejects uppercase with
 * `400 Invalid option: expected one of "active"|"paused"` (verified against the live API).
 * Uppercase here means a pause the platform never applied — the user cannot stop the spend.
 */
describe('updateAd status casing', () => {
  it('sends the lowercase enum PUT /ads/{adId} accepts', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ad: { _id: 'a1', status: 'paused' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await updateAd('a1', { status: 'paused' });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.status).toBe('paused');
    expect(body.status).not.toBe('PAUSED');
    vi.unstubAllGlobals();
  });
});
