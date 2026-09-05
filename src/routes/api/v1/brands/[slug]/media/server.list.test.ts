import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://anomalia.so' } }));

const listBrandMedia = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => undefined),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/brand-media', () => ({
  listBrandMedia: (...args: unknown[]) => listBrandMedia(...args)
}));
vi.mock('$lib/server/media-import', () => ({ importBrandMediaFromUrl: vi.fn() }));

import { GET } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const SIGNED = 'https://kszazivzwievqixcnanp.supabase.co/storage/v1/object/sign/brand-knowledge/x.jpg?token=eyJhbGciOi';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase: {}, apiKey: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'b1' } } as never);
  listBrandMedia.mockResolvedValue([
    {
      id: 'b4583d8d-6774-4bc9-a09f-693ee0fef464',
      kind: 'image',
      mime: 'image/jpeg',
      width: 928,
      height: 1152,
      title: 'Gatto',
      description: null,
      tags: [],
      short_code: 'K7BX2MQ4',
      signed_url: SIGNED,
      created_at: '2026-09-05T00:00:00Z'
    }
  ]);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = () =>
  GET({
    request: new Request('https://anomalia.so/api/v1/brands/demo/media'),
    params: { slug: 'demo' },
    url: new URL('https://anomalia.so/api/v1/brands/demo/media')
  } as any);

describe('GET /api/v1/brands/:slug/media', () => {
  // The whole point of the proxy: an external agent that receives this JSON must not be able to
  // hand out a link that dies in 2h or truncates in its own output.
  it('hands out the short permanent link, never the signed storage URL', async () => {
    const body = await (await call()).json();

    expect(body.media[0].url).toBe('https://anomalia.so/a/K7BX2MQ4');
    expect(JSON.stringify(body)).not.toContain('token=');
    expect(body.media[0].signed_url).toBeUndefined();
  });

  it('returns a null url rather than a broken link when a row has no code yet', async () => {
    listBrandMedia.mockResolvedValue([
      { id: 'm1', kind: 'image', mime: null, width: null, height: null, title: null, description: null, tags: [], short_code: null, created_at: 'x' }
    ]);

    const body = await (await call()).json();

    expect(body.media[0].url).toBeNull();
  });
});
