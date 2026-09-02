import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/feature-flags', () => ({ isGuestPreviewEnabled: vi.fn(() => true) }));
vi.mock('$lib/server/tool-guard', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  guardTool: vi.fn(async () => ({ ok: true }))
}));
// Resolve-then-check is the whole point of the boundary guard, so DNS is the thing to fake:
// an address literal resolves to itself, every other host to a public address unless a test says
// otherwise.
const lookupMock = vi.fn(async (host: string) => {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [{ address: host, family: 4 }];
  return [{ address: '93.184.216.34', family: 4 }];
});
vi.mock('node:dns/promises', () => ({ lookup: (host: string) => lookupMock(host) }));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock('$lib/server/gemini', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  NANO_BANANA_2_LITE: 'gemini-3.1-flash-lite-image'
}));
vi.mock('$lib/server/brand-analysis', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runBrandAnalysis: vi.fn(async () => ({ name: 'Acme', url: 'https://acme.com' }))
}));
vi.mock('$lib/server/content-preview/weekly-planner', () => ({
  planPreviewPosts: vi.fn(async () => [
    { platform: 'instagram', format: 'single_image', caption: 'Fresh beans.', image_prompt: 'espresso on marble' }
  ]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderPreviewImages: vi.fn(async (_profile: any, posts: any[], opts: any) => {
    posts[0].imageUrl = 'https://cdn.example.com/guest/a/b.jpg';
    opts.onPost(posts[0]);
  })
}));

import { POST } from './+server';
import { isGuestPreviewEnabled } from '$lib/server/feature-flags';
import { guardTool } from '$lib/server/tool-guard';
import { planPreviewPosts, renderPreviewImages } from '$lib/server/content-preview/weekly-planner';
import { runBrandAnalysis } from '$lib/server/brand-analysis';

function call(url: unknown, ip = '203.0.113.9') {
  return (POST as (e: unknown) => Promise<Response>)({
    request: new Request('https://anomalia.so/start/preview', {
      method: 'POST',
      body: JSON.stringify({ url })
    }),
    getClientAddress: () => ip,
    locals: { locale: 'en' }
  });
}

async function ndjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

beforeEach(() => vi.clearAllMocks());

describe('POST /start/preview', () => {
  it('is invisible when the kill switch is off, and spends nothing', async () => {
    vi.mocked(isGuestPreviewEnabled).mockReturnValueOnce(false);

    const res = await call('acme.com');

    expect(res.status).toBe(404);
    expect(guardTool).not.toHaveBeenCalled();
    expect(planPreviewPosts).not.toHaveBeenCalled();
  });

  it('returns the IP guard verdict before any spending', async () => {
    vi.mocked(guardTool).mockResolvedValueOnce({
      ok: false,
      response: new Response('rate limited', { status: 429 })
    } as never);

    const res = await call('acme.com');

    expect(res.status).toBe(429);
    expect(planPreviewPosts).not.toHaveBeenCalled();
  });

  it('refuses a private-network target, so an open endpoint is not a request forger', async () => {
    for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/admin', 'http://10.0.0.5/']) {
      const res = await call(target);
      expect(res.status).toBe(400);
    }
    expect(planPreviewPosts).not.toHaveBeenCalled();
  });

  it('refuses a public hostname whose DNS points inside the network', async () => {
    // The attack the hostname-pattern guard cannot see: nothing about "rebind.example.com" looks
    // private until you resolve it.
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    const res = await call('rebind.example.com');

    expect(res.status).toBe(400);
    expect(planPreviewPosts).not.toHaveBeenCalled();
    expect(runBrandAnalysis).not.toHaveBeenCalled();
  });

  it('refuses a host that does not resolve at all', async () => {
    lookupMock.mockResolvedValueOnce([]);

    expect((await call('nowhere.example.com')).status).toBe(400);
    expect(runBrandAnalysis).not.toHaveBeenCalled();
  });

  it('refuses a missing url', async () => {
    expect((await call('')).status).toBe(400);
  });

  it('streams exactly one post, with its image, and never a second', async () => {
    const res = await call('acme.com');

    expect(res.status).toBe(200);
    const lines = await ndjson(res);
    const result = lines.find((l) => l.type === 'result');
    expect(result).toBeTruthy();
    expect(result?.data).toMatchObject({
      post: {
        platform: 'instagram',
        caption: 'Fresh beans.',
        imageUrl: 'https://cdn.example.com/guest/a/b.jpg'
      }
    });
    expect(vi.mocked(planPreviewPosts).mock.calls[0][2]).toBe(1);
  });

  it('renders with the cheapest image model, under a guest storage prefix', async () => {
    await ndjson(await call('acme.com'));

    const opts = vi.mocked(renderPreviewImages).mock.calls[0][2] as unknown as Record<string, string>;
    expect(opts.imageModel).toBe('gemini-3.1-flash-lite-image');
    expect(opts.userId).toMatch(/^guest\//);
  });
});
