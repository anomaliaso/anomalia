import { describe, it, expect } from 'vitest';
import {
  chatRateLimits,
  chatRateLimitMessage,
  resumeAtForWindow,
  type ChatRateUsage
} from './rate-limits';

describe('chatRateLimits', () => {
  it('gives Free a larger % of its small monthly pool (50% / 80%)', () => {
    expect(chatRateLimits(null)).toEqual({ fiveHour: 200, weekly: 320 });
    expect(chatRateLimits(undefined)).toEqual({ fiveHour: 200, weekly: 320 });
  });

  it('uses ~30% / 50% of monthly credits on paid tiers', () => {
    expect(chatRateLimits('go')).toEqual({ fiveHour: 630, weekly: 1050 });
    expect(chatRateLimits('starter')).toEqual({ fiveHour: 1650, weekly: 2750 });
    expect(chatRateLimits('pro')).toEqual({ fiveHour: 3600, weekly: 6000 });
  });

  it('treats legacy scale like Pro windows', () => {
    expect(chatRateLimits('scale')).toEqual(chatRateLimits('pro'));
  });
});

describe('resumeAtForWindow', () => {
  const FIVE_H = 5 * 60 * 60 * 1000;
  const now = new Date('2026-08-08T12:00:00Z');

  it('returns when enough oldest spend ages out to go under the limit', () => {
    // 150 + 80 = 230 over limit 200 → after first 150 ages out, 80 left < 200
    const t0 = Date.parse('2026-08-08T08:00:00Z');
    const t1 = Date.parse('2026-08-08T10:00:00Z');
    const at = resumeAtForWindow(
      [
        { cost_usd: 1.5, created_at: new Date(t0).toISOString() },
        { cost_usd: 0.8, created_at: new Date(t1).toISOString() }
      ],
      200,
      FIVE_H,
      now
    );
    expect(at.getTime()).toBe(t0 + FIVE_H);
  });
});

describe('chatRateLimitMessage', () => {
  const base: ChatRateUsage = {
    used5h: 200,
    usedWeek: 100,
    limits: { fiveHour: 200, weekly: 320 },
    ok: false,
    blocked: '5h',
    resetAt: new Date('2026-08-08T14:30:00Z')
  };
  const now = new Date('2026-08-08T12:00:00Z');

  it('says you can resume at HH:MM (Command Code style)', () => {
    expect(chatRateLimitMessage(base, 'en', now)).toMatch(/You can resume at/);
    expect(chatRateLimitMessage(base, 'it', now)).toMatch(/Puoi riprendere alle/);
  });

  it('mentions the weekly window when that is what blocks', () => {
    const u = { ...base, blocked: 'week' as const, usedWeek: 320 };
    expect(chatRateLimitMessage(u, 'en', now)).toMatch(/weekly/i);
    expect(chatRateLimitMessage(u, 'it', now)).toMatch(/settimanale/i);
  });
});
