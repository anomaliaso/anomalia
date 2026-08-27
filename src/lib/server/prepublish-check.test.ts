import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deterministicPrepublishIssues,
  inspectPostForRelease,
  mediaUrlsForCheck,
  requiresVisualMedia,
  runPrepublishTick,
  shouldGatePrepublish,
  type PrepublishPost
} from './prepublish-check';

vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: (_id: string, fn: () => unknown) => fn(),
  loggedGemini: async (_label: string, fn: () => unknown) => fn()
}));

vi.mock('$lib/server/post-editing', () => ({
  requireZernioCancellation: vi.fn(async () => ({ undeleted: [] }))
}));

vi.mock('$lib/server/scheduler', () => ({
  brandContacts: vi.fn(async () => [])
}));

vi.mock('$lib/server/brand-notify', () => ({
  notifyBrandContacts: vi.fn(async () => 0)
}));

const POST = (overrides: Partial<PrepublishPost> = {}): PrepublishPost => ({
  id: 'post-1',
  brand_id: 'brand-1',
  platform: 'instagram',
  caption: 'A real caption about the product launch.',
  media_url: 'https://cdn.example.com/p.jpg',
  content_type: 'generated_image',
  scheduled_for: '2026-08-13T12:00:00.000Z',
  ...overrides
});

describe('shouldGatePrepublish', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');

  it('always gates immediate publishes', () => {
    expect(shouldGatePrepublish('2026-08-14T12:00:00.000Z', { now: true, nowMs: now })).toBe(true);
  });

  it('gates slots inside the 18 minute lead', () => {
    expect(shouldGatePrepublish('2026-08-13T12:10:00.000Z', { nowMs: now })).toBe(true);
  });

  it('skips slots further out so the cron can judge later', () => {
    expect(shouldGatePrepublish('2026-08-13T13:00:00.000Z', { nowMs: now })).toBe(false);
  });
});

describe('deterministicPrepublishIssues', () => {
  it('rejects an empty or placeholder caption', () => {
    expect(deterministicPrepublishIssues(POST({ caption: '   ' }))[0]).toMatch(/empty/i);
    expect(deterministicPrepublishIssues(POST({ caption: 'lorem ipsum dolor' }))[0]).toMatch(/placeholder/i);
    expect(deterministicPrepublishIssues(POST({ caption: '#one #two' }))[0]).toMatch(/placeholder|no real/i);
  });

  it('rejects a visual post with no media', () => {
    expect(deterministicPrepublishIssues(POST({ media_url: null, media_urls: [] }))).toContain(
      'Visual post has no media'
    );
  });

  it('allows a text post with no media', () => {
    expect(
      deterministicPrepublishIssues(POST({ content_type: 'text', media_url: null, media_urls: null }))
    ).toEqual([]);
  });

  it('rejects a carousel with a single slide', () => {
    expect(
      deterministicPrepublishIssues(
        POST({ content_type: 'carousel', media_url: 'https://cdn.example.com/a.jpg', media_urls: ['https://cdn.example.com/a.jpg'] })
      )
    ).toContain('Carousel has fewer than 2 slides');
  });

  it('rejects a link post without a URL', () => {
    expect(deterministicPrepublishIssues(POST({ content_type: 'link', media_url: null, link_url: null }))).toContain(
      'Link post is missing a URL'
    );
  });

  it('rejects a Reddit post without a title', () => {
    expect(deterministicPrepublishIssues(POST({ platform: 'reddit', title: null }))).toContain(
      'Reddit post is missing a title'
    );
  });

  it('rejects a YouTube post without a video file', () => {
    expect(
      deterministicPrepublishIssues(
        POST({ platform: 'youtube', media_url: 'https://cdn.example.com/still.jpg', content_type: 'generated_image' })
      )
    ).toContain('YouTube requires a video file');
    expect(
      deterministicPrepublishIssues(
        POST({ platform: 'youtube', media_url: 'https://cdn.example.com/clip.mp4', content_type: 'generated_video' })
      )
    ).not.toContain('YouTube requires a video file');
  });
});

describe('requiresVisualMedia / mediaUrlsForCheck', () => {
  it('treats generated images as visual and text/link as not', () => {
    expect(requiresVisualMedia('generated_image')).toBe(true);
    expect(requiresVisualMedia('generated_video')).toBe(true);
    expect(requiresVisualMedia('text')).toBe(false);
    expect(requiresVisualMedia('link')).toBe(false);
  });

  it('prefers media_urls over the single cover', () => {
    expect(
      mediaUrlsForCheck(
        POST({
          media_url: 'https://cdn.example.com/cover.jpg',
          media_urls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg']
        })
      )
    ).toEqual(['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg']);
  });
});

describe('inspectPostForRelease', () => {
  it('holds on deterministic issues without calling Gemini', async () => {
    const judge = vi.fn();
    const verdict = await inspectPostForRelease(POST({ caption: '' }), { judge });
    expect(verdict.decision).toBe('hold');
    expect(judge).not.toHaveBeenCalled();
  });

  it('holds when a required media URL is unreachable', async () => {
    const verdict = await inspectPostForRelease(POST(), {
      probeMedia: async () => ({ ok: false, reason: 'Media URL returned HTTP 404' }),
      judge: async () => ({ ok: true, reasons: [] })
    });
    expect(verdict.decision).toBe('hold');
    expect(verdict.reason).toMatch(/404/);
  });

  it('passes when media is reachable and Gemini OKs', async () => {
    const verdict = await inspectPostForRelease(POST(), {
      probeMedia: async () => ({ ok: true, kind: 'other' }),
      judge: async () => ({ ok: true, reasons: [] })
    });
    expect(verdict).toEqual({ decision: 'pass', reason: 'ok', reasons: [] });
  });

  it('holds when Gemini rejects a broken visual', async () => {
    const verdict = await inspectPostForRelease(POST(), {
      probeMedia: async () => ({ ok: true, kind: 'other' }),
      judge: async () => ({ ok: false, reasons: ['Overlay text is garbled'] })
    });
    expect(verdict.decision).toBe('hold');
    expect(verdict.reason).toBe('Overlay text is garbled');
  });

  it('skips (fail-open) when Gemini is down', async () => {
    const verdict = await inspectPostForRelease(POST(), {
      probeMedia: async () => ({ ok: true, kind: 'other' }),
      judge: async () => ({ error: 'model_failed' })
    });
    expect(verdict.decision).toBe('skip');
  });
});

describe('runPrepublishTick', () => {
  it('holds a broken scheduled post and stamps it pending_user', async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const due = POST({
      caption: '',
      scheduled_for: '2026-08-13T12:10:00.000Z',
      prepublish_ok: null,
      prepublish_checked_at: null,
      status: 'scheduled'
    });
    const client = {
      from: (table: string) => {
        if (table === 'brands') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                gte: () => ({
                  lte: () => ({
                    or: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [due], error: null })
                      })
                    })
                  })
                })
              })
            })
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            const chain = {
              eq: () => chain,
              is: () => chain,
              select: () => ({
                maybeSingle: async () => ({ data: { id: due.id }, error: null })
              }),
              then: (resolve: (v: { error: null }) => void) => resolve({ error: null })
            };
            return chain;
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await runPrepublishTick(client, {
      nowMs: Date.parse('2026-08-13T12:00:00.000Z'),
      deps: { judge: async () => ({ ok: true, reasons: [] }) }
    });
    expect(result.held).toBe(1);
    expect(updates.some((u) => u.payload.status === 'pending_user')).toBe(true);
    expect(updates.some((u) => u.payload.prepublish_ok === false)).toBe(true);
  });
});
