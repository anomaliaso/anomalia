import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));
vi.mock('$lib/server/brand-context', () => ({ rebuildBrandContext: async () => {} }));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

let inserted: Record<string, unknown>[] = [];

const fakeSupabase = () => ({
  from() {
    const q = {
      insert(row: Record<string, unknown>) {
        inserted.push(row);
        return q;
      },
      select: () => q,
      single: async () => ({ data: { id: 'd1', kind: 'note', title: 'Note' }, error: null })
    };
    return q;
  }
});

const post = (body: Record<string, unknown>) =>
  (POST as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/studio/documents', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  inserted = [];
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase: fakeSupabase(), apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
});

describe('POST /api/v1/brands/:slug/studio/documents', () => {
  it('accetta `text`, il nome che il tool add_note ha sempre esposto', async () => {
    const res = await post({ text: 'Il banco è di faggio.' });

    expect(res.status).toBe(200);
    expect(inserted[0].content_text).toBe('Il banco è di faggio.');
  });

  it('continua ad accettare `content_text`, il nome documentato della rotta', async () => {
    await post({ content_text: 'Il banco è di faggio.' });

    expect(inserted[0].content_text).toBe('Il banco è di faggio.');
  });

  it('senza testo e senza kind document rifiuta', async () => {
    const res = await post({ title: 'Vuota' });

    expect(res.status).toBe(400);
  });
});
