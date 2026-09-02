import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pendingToNudge } from './lifecycle';
import { createTestSupabase } from '$lib/testkit/supabase';

const NOW = new Date('2026-09-02T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3.6e6).toISOString();

function db(rows: { waitlist: Record<string, unknown>[]; profiles: Record<string, unknown>[] }) {
  return createTestSupabase(rows).client as SupabaseClient;
}

describe('pendingToNudge', () => {
  it("sollecita chi aspetta da abbastanza e non l'ha ancora ricevuto", async () => {
    const admin = db({
      waitlist: [{ user_id: 'u1', created_at: hoursAgo(3), nudged_at: null }],
      profiles: [{ id: 'u1', email: 'a@b.c', approved_at: null }]
    });

    expect(await pendingToNudge(admin, NOW)).toEqual([{ userId: 'u1', email: 'a@b.c' }]);
  });

  it('non scrive due volte alla stessa persona', async () => {
    const admin = db({
      waitlist: [{ user_id: 'u1', created_at: hoursAgo(30), nudged_at: hoursAgo(20) }],
      profiles: [{ id: 'u1', email: 'a@b.c', approved_at: null }]
    });

    expect(await pendingToNudge(admin, NOW)).toEqual([]);
  });

  it('non insegue chi si è appena iscritto: la pagina della call ce l’ha davanti', async () => {
    const admin = db({
      waitlist: [{ user_id: 'u1', created_at: hoursAgo(0.2), nudged_at: null }],
      profiles: [{ id: 'u1', email: 'a@b.c', approved_at: null }]
    });

    expect(await pendingToNudge(admin, NOW)).toEqual([]);
  });

  /** Il difetto che imbarazza: "prenota la call" a un cliente che è già dentro. */
  it('non scrive a chi è già stato approvato', async () => {
    const admin = db({
      waitlist: [{ user_id: 'u1', created_at: hoursAgo(9), nudged_at: null }],
      profiles: [{ id: 'u1', email: 'a@b.c', approved_at: hoursAgo(1) }]
    });

    expect(await pendingToNudge(admin, NOW)).toEqual([]);
  });

  it('salta chi non ha un indirizzo', async () => {
    const admin = db({
      waitlist: [{ user_id: 'u1', created_at: hoursAgo(9), nudged_at: null }],
      profiles: [{ id: 'u1', email: null, approved_at: null }]
    });

    expect(await pendingToNudge(admin, NOW)).toEqual([]);
  });
});
