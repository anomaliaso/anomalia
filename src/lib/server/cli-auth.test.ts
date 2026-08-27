import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBrandForUser, type ApiKeyInfo, type CliBrand } from './cli-auth';
import { createTestSupabase } from '$lib/testkit/supabase';

const BRAND: CliBrand = {
  id: 'brand-1',
  org_id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  status: 'trial',
  plan: 'pro',
  timezone: 'Europe/Rome',
  target_platforms: ['instagram', 'facebook'],
  launched_at: null,
  content_prefs: null,
  setup_step: null,
  setup_completed_at: null,
  autopilot_enabled: false,
  autopilot_failure_count: 0,
  last_autopilot_run_at: null,
  zernio_profile_id: null,
  ads_settings: null
};

const API_KEY: ApiKeyInfo = {
  id: 'key-1',
  name: 'test key',
  user_id: 'user-1',
  permissions: { brand_ids: ['brand-1'], scopes: ['read'] }
};

/**
 * Mock supabase condiviso (src/lib/testkit) con filtri veri: le righe seminate devono
 * matchare davvero slug/owner_id/user_id, quindi il tenant-check è esercitato sul serio
 * (il vecchio stub ignorava ogni `.eq(...)`). La lookup dei brand resta una LIST query
 * (slug duplicati esistono in prod) e il testkit risolve `await query` in righe.
 */
function mockClient(tables: Record<string, Record<string, unknown>[]>): SupabaseClient {
  return createTestSupabase(tables).client;
}

describe('loadBrandForUser with API key', () => {
  it('returns the brand when the key user owns the brand org', async () => {
    const supabase = mockClient({ brands: [BRAND], organizations: [{ id: 'org-1', owner_id: 'user-1' }] });
    const { brand, error } = await loadBrandForUser(supabase, 'acme', API_KEY);
    expect(error).toBeUndefined();
    expect(brand?.id).toBe('brand-1');
  });

  it('returns 404 when the org is not owned by the key user and no brand membership', async () => {
    const supabase = mockClient({ brands: [BRAND] });
    const { brand, error } = await loadBrandForUser(supabase, 'acme', API_KEY);
    expect(brand).toBeUndefined();
    expect(error?.status).toBe(404);
    expect(await (error as Response).json()).toEqual({ error: 'Brand not found' });
  });

  it('returns the brand when the key user is a brand member', async () => {
    const supabase = mockClient({
      brands: [BRAND],
      brand_members: [{ brand_id: 'brand-1', user_id: 'user-1' }]
    });
    const { brand, error } = await loadBrandForUser(supabase, 'acme', API_KEY);
    expect(error).toBeUndefined();
    expect(brand?.id).toBe('brand-1');
  });

  it('returns 404 (not 403) when the brand is owned but outside the key brand_ids scope', async () => {
    // Anti-probing: an out-of-scope brand is indistinguishable from a non-existent slug.
    const supabase = mockClient({ brands: [BRAND], organizations: [{ id: 'org-1', owner_id: 'user-1' }] });
    const narrowed: ApiKeyInfo = {
      ...API_KEY,
      permissions: { brand_ids: ['brand-other'], scopes: ['read'] }
    };
    const { brand, error } = await loadBrandForUser(supabase, 'acme', narrowed);
    expect(brand).toBeUndefined();
    expect(error?.status).toBe(404);
  });

  it('returns 404 when the brand does not exist', async () => {
    const supabase = mockClient({});
    const { brand, error } = await loadBrandForUser(supabase, 'missing', API_KEY);
    expect(brand).toBeUndefined();
    expect(error?.status).toBe(404);
  });
});
