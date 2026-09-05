import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://anomalia.so' } }));

const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: 'https://storage.test/object/sign/brand-knowledge/x.jpg?token=abc' },
  error: null
}));
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({ from, storage: { from: () => ({ createSignedUrl }) } })
}));

import { GET } from './+server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (id: string) => GET({ params: { id } } as any);

const CODE = 'K7BX2MQ4';
const UUID = 'b4583d8d-6774-4bc9-a09f-693ee0fef464';

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({
    data: { storage_path: 'brand/x.jpg', link_revoked_at: null },
    error: null
  });
});

describe('/a/[id]', () => {
  it('redirects a known short code to a freshly signed storage URL', async () => {
    const res = await call(CODE);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('storage.test');
    expect(eq).toHaveBeenCalledWith('short_code', CODE);
  });

  it('404s an id that matches nothing, instead of throwing', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await call(CODE);

    expect(res.status).toBe(404);
  });

  it('404s a malformed id without ever hitting the database', async () => {
    const res = await call('not a code!!');

    expect(res.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  // The uuid is what the media tools have always handed to external agents, so an agent may well
  // build /a/<uuid> by hand. Refusing it would break a link for no gain.
  it('also accepts the raw uuid, distinguished by shape', async () => {
    const res = await call(UUID);

    expect(res.status).toBe(302);
    expect(eq).toHaveBeenCalledWith('id', UUID);
  });

  // The signed URL behind the redirect expires in 2h; the redirect itself must not outlive it in
  // any cache, or the link starts pointing at a dead token.
  it('never lets the redirect be cached', async () => {
    const res = await call(CODE);

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  // The code is the only credential and it never expires, so revocation is the only way to take a
  // handed-out link back — from a departed member, from the wrong group chat, from a leaked output.
  it('404s a revoked link without signing anything', async () => {
    maybeSingle.mockResolvedValue({
      data: { storage_path: 'brand/x.jpg', link_revoked_at: '2026-09-04T10:00:00Z' },
      error: null
    });

    const res = await call(CODE);

    expect(res.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('404s when signing fails, rather than redirecting to nothing', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'gone' } } as never);

    const res = await call(CODE);

    expect(res.status).toBe(404);
  });
});
