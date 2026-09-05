import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeCaptions = vi.fn();
const brandVoice = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/caption-writer', () => ({
  writeCaptions: (...args: unknown[]) => writeCaptions(...args),
  brandVoice: (...args: unknown[]) => brandVoice(...args)
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

const ALL = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'threads', 'youtube', 'bluesky', 'reddit'];

function call(body: unknown, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/captions/generate`);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

const platformsAskedFor = () => (writeCaptions.mock.calls[0][0] as { platforms: string[] }).platforms;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({
    supabase: {},
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo' },
    error: null
  } as never);
  vi.mocked(gateAiAction).mockResolvedValue(undefined as never);
  brandVoice.mockResolvedValue('');
  writeCaptions.mockResolvedValue([
    { platform: 'x', parts: ['a caption'], limit: 280, publishable: true }
  ]);
});

describe('POST /api/v1/brands/:slug/captions/generate', () => {
  it('a brand out of credits writes nothing: the gate answers and the model never runs', async () => {
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 }) as never
    );

    const { res, body } = await call({ topic: 'a launch' });

    expect(res.status).toBe(402);
    expect(body.error).toBe('credits_exhausted');
    expect(writeCaptions).not.toHaveBeenCalled();
  });

  it('writes for every platform when none is named', async () => {
    await call({ topic: 'a launch' });

    expect(platformsAskedFor()).toEqual(ALL);
  });

  it('one platform asked is one platform written: the other eight are never requested', async () => {
    await call({ topic: 'a launch', platforms: ['x'] });

    expect(writeCaptions).toHaveBeenCalledTimes(1);
    expect(platformsAskedFor()).toEqual(['x']);
  });

  it('defaults to a single post per platform', async () => {
    await call({ topic: 'a launch' });

    expect((writeCaptions.mock.calls[0][0] as { format: string }).format).toBe('single');
  });

  it('refuses an unknown platform instead of writing for it', async () => {
    const { res } = await call({ topic: 'a launch', platforms: ['myspace'] });

    expect(res.status).toBe(400);
    expect(writeCaptions).not.toHaveBeenCalled();
  });

  it('says so when the model came back with nothing', async () => {
    writeCaptions.mockResolvedValue([]);

    const { res, body } = await call({ topic: 'a launch' });

    expect(res.status).toBe(502);
    expect(body.error).toBe('no_captions');
  });

  it('returns the captions it wrote', async () => {
    const { res, body } = await call({ topic: 'a launch', platforms: ['x'] });

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      captions: [{ platform: 'x', parts: ['a caption'], limit: 280, publishable: true }]
    });
  });
});
