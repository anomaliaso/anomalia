import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCampaignStatus = vi.fn(async () => ({ ok: true }));

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));
vi.mock('$lib/server/ads', () => ({
  adsFeatureEnabled: () => true,
  adsAvailable: () => true,
  setCampaignStatus: (...args: unknown[]) => setCampaignStatus(...(args as [])),
  setCreativeStatus: vi.fn(),
  approveCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
  duplicateCampaign: vi.fn(),
  getPaidSummary: vi.fn(),
  proposeBoosts: vi.fn(),
  proposeStandalone: vi.fn(),
  rankBoostCandidates: vi.fn(),
  rejectCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  syncAdAccounts: vi.fn(),
  syncAdMetrics: vi.fn()
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const fakeSupabase = () => ({
  from: () => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: null, error: null })
    };
    return q;
  }
});

const post = (body: Record<string, unknown>) =>
  (POST as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/ads', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase: fakeSupabase(), apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1', plan: 'pro' }, error: null } as never);
});

describe('POST /api/v1/brands/:slug/ads', () => {
  it('legge i campi propri dell’azione anche quando arrivano dentro `extra`', async () => {
    const res = await post({ action: 'toggle', campaignId: 'c1', extra: { next: 'active' } });

    expect(res.status).toBe(200);
    expect(setCampaignStatus.mock.calls[0]?.[3]).toBe('active');
  });

  it('continua a leggerli in cima al corpo, come li manda il CLI', async () => {
    await post({ action: 'toggle', campaignId: 'c1', next: 'active' });

    expect(setCampaignStatus.mock.calls[0]?.[3]).toBe('active');
  });
});
