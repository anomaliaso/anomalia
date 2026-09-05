import { describe, it, expect, vi, beforeEach } from 'vitest';

const { startOnboardingStepJob } = vi.hoisted(() => ({
  startOnboardingStepJob: vi.fn(async () => ({ jobId: 'j1', reused: false }))
}));

vi.mock('$lib/server/onboarding-steps', async (orig) => ({
  ...(await orig<typeof import('$lib/server/onboarding-steps')>()),
  startOnboardingStepJob,
  kickOnboardingStepWork: vi.fn()
}));
vi.mock('$lib/server/access', async (orig) => ({
  ...(await orig<typeof import('$lib/server/access')>()),
  canEnter: vi.fn(async () => true)
}));

import { POST } from './+server';
import { markRlsScoped } from '$lib/server/rls-client';

type Row = Record<string, unknown>;

/** Il client del browser: le policy di `brands` restituiscono solo i brand del chiamante. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function browserClient(visibleBrandIds: string[]): any {
  return markRlsScoped({
    from() {
      const filters: Array<[string, unknown]> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return q;
        },
        maybeSingle: async () => {
          const wanted = filters.find(([c]) => c === 'id')?.[1];
          const hit = visibleBrandIds.includes(wanted as string);
          return { data: hit ? ({ id: wanted } as Row) : null, error: null };
        }
      };
      return q;
    }
  });
}

function post(brandId: string, visibleBrandIds: string[]) {
  return (POST as unknown as (event: unknown) => Promise<Response>)({
    request: new Request('https://example.test/app/onboarding/research', {
      method: 'POST',
      body: JSON.stringify({ brandId, profile: {} })
    }),
    url: new URL('https://example.test/app/onboarding/research'),
    platform: undefined,
    locals: {
      supabase: browserClient(visibleBrandIds),
      safeGetSession: async () => ({ session: { id: 's' }, user: { id: 'u1' } }),
      locale: 'it'
    }
  });
}

beforeEach(() => vi.clearAllMocks());

describe('onboarding research', () => {
  it('non accoda lavoro sul brand di un altro cliente', async () => {
    const res = await post('brand-di-un-altro', ['brand-mio']);

    expect(startOnboardingStepJob).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('accoda sul proprio brand', async () => {
    const res = await post('brand-mio', ['brand-mio']);

    expect(startOnboardingStepJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brandId: 'brand-mio' })
    );
    expect(res.status).toBe(200);
  });
});
