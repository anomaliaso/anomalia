import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestDayWindow, buildDailyDigest, sendDailyDigest } from './publish-digest';
import { digestEmailSubject, digestEmailHtml, digestEmailText } from './email';
// Mock supabase condiviso (src/lib/testkit): tabelle in memoria e filtri VERI, quindi
// il test non asserisce piu' "eq e' stato chiamato con X" ma semina anche righe che i
// filtri devono ESCLUDERE — un filtro dimenticato fa uscire la riga sbagliata.
import { createTestSupabase } from '$lib/testkit/supabase';

const { notifyBrandContacts } = vi.hoisted(() => ({
  notifyBrandContacts: vi.fn(
    async (
      _admin: never,
      _brand: never,
      _opts: { buildEmail: (l: string, to: string) => { subject: string; html: string; text?: string } }
    ) => 0
  )
}));

vi.mock('./brand-notify', () => ({ notifyBrandContacts }));

const BASE = '2026-08-12T10:00:00Z';

describe('digestDayWindow', () => {
  it('returns the previous UTC calendar day for "yesterday"', () => {
    const w = digestDayWindow('yesterday', new Date(BASE));
    expect(w.start).toBe('2026-08-11T00:00:00.000Z');
    expect(w.end).toBe('2026-08-12T00:00:00.000Z');
  });

  it('accepts an explicit YYYY-MM-DD day', () => {
    const w = digestDayWindow('2026-08-11');
    expect(w.start).toBe('2026-08-11T00:00:00.000Z');
    expect(w.end).toBe('2026-08-12T00:00:00.000Z');
  });

  it('rejects malformed days', () => {
    expect(() => digestDayWindow('nope')).toThrow();
    expect(() => digestDayWindow('2026-13-40')).toThrow();
  });
});

describe('buildDailyDigest', () => {
  it('queries only published posts of the brand inside yesterday and truncates captions to 160', async () => {
    const inDay = { brand_id: 'brand-1', status: 'published', published_at: '2026-08-11T09:00:00.000Z' };
    const kit = createTestSupabase({
      posts: [
        { id: 'p1', ...inDay, platform: 'instagram', caption: 'x'.repeat(300), media_url: 'https://cdn.example/a.jpg', published_url: 'https://ig.com/p1', slot: 'Wed · 09:00' },
        { id: 'p2', ...inDay, published_at: '2026-08-11T18:00:00.000Z', platform: 'linkedin', caption: null, media_url: null, published_url: null, slot: null },
        // Righe che i filtri devono lasciare fuori: altro brand, non published, fuori finestra.
        { id: 'x1', ...inDay, brand_id: 'brand-2' },
        { id: 'x2', ...inDay, status: 'scheduled' },
        { id: 'x3', ...inDay, published_at: '2026-08-12T00:00:00.000Z' }
      ]
    });
    // Il giorno è ESPLICITO: senza, la finestra la calcola `new Date()` e questa asserzione
    // passava solo il giorno in cui è stata scritta.
    const digest = await buildDailyDigest(kit.client, 'brand-1', { day: '2026-08-11' });

    expect(kit.calls[0]).toMatchObject({ table: 'posts', op: 'select' });
    expect(digest.count).toBe(2);
    expect(digest.posts.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(digest.posts[0].caption).toHaveLength(160);
    expect(digest.posts[1].caption).toBeNull();
    expect(digest.posts[0].media_url).toBe('https://cdn.example/a.jpg');
  });

  it('returns an empty digest when the query returns no rows', async () => {
    const kit = createTestSupabase();
    const digest = await buildDailyDigest(kit.client, 'brand-1');
    expect(digest).toEqual({ posts: [], count: 0 });
  });

  it('propagates query errors', async () => {
    const kit = createTestSupabase();
    kit.failNext('posts', 'boom');
    await expect(buildDailyDigest(kit.client, 'brand-1')).rejects.toThrow('boom');
  });
});

describe('sendDailyDigest', () => {
  beforeEach(() => {
    notifyBrandContacts.mockClear();
    notifyBrandContacts.mockResolvedValue(2);
  });

  const brand = { id: 'brand-1', name: 'Acme', slug: 'acme', org_id: 'org-1' };
  const contacts = [{ userId: 'u1', email: 'a@x.com', locale: 'en' }];

  it('does not send when count is 0 (no noise on quiet days)', async () => {
    const sent = await sendDailyDigest({} as never, brand, contacts, { posts: [], count: 0 });
    expect(sent).toBe(0);
    expect(notifyBrandContacts).not.toHaveBeenCalled();
  });

  it('does not send when there are no contacts', async () => {
    const sent = await sendDailyDigest({} as never, brand, [], { posts: [{ platform: 'ig', caption: 'hi' }], count: 1 });
    expect(sent).toBe(0);
    expect(notifyBrandContacts).not.toHaveBeenCalled();
  });

  it('builds a per-locale email and returns the emailed count', async () => {
    const posts = [
      { id: 'p1', platform: 'instagram', caption: 'Summer drop', media_url: 'https://cdn.example/a.jpg', published_url: 'https://ig.com/p1', slot: null }
    ];
    const sent = await sendDailyDigest({} as never, brand, contacts, { posts, count: 1 });

    expect(sent).toBe(2);
    expect(notifyBrandContacts).toHaveBeenCalledTimes(1);
    const opts = notifyBrandContacts.mock.calls[0]![2];
    const payload = opts.buildEmail('en', 'a@x.com');
    expect(payload.subject).toBe('Yesterday on Acme: 1 post');
    expect(payload.html).toContain('https://ig.com/p1');
    expect(payload.html).toContain('Summer drop');
  });
});

describe('digest email templates', () => {
  it('subject pluralizes in EN and IT', () => {
    expect(digestEmailSubject('en', 'Acme', 1)).toBe('Yesterday on Acme: 1 post');
    expect(digestEmailSubject('en', 'Acme', 3)).toBe('Yesterday on Acme: 3 posts');
    expect(digestEmailSubject('it', 'Acme', 3)).toContain('Ieri su Acme');
  });

  it('html links to the live post when published_url exists, calendar otherwise', () => {
    const brand = { name: 'Acme', slug: 'acme' };
    const html = digestEmailHtml(
      'en',
      brand,
      [
        { platform: 'instagram', caption: 'Summer drop', media_url: 'https://cdn.example/a.jpg', published_url: 'https://ig.com/p1' },
        { platform: 'linkedin', caption: 'No URL post', media_url: null, published_url: null }
      ],
      'https://app.example'
    );
    expect(html).toContain('Summer drop');
    expect(html).toContain('https://ig.com/p1');
    expect(html).toContain('https://cdn.example/a.jpg');
    expect(html).toContain('No URL post');
    expect(html).toContain('/app/acme/calendar');
  });

  it('text includes caption and link per post', () => {
    const text = digestEmailText('en', { name: 'Acme', slug: 'acme' }, [
      { platform: 'instagram', caption: 'Summer drop', published_url: 'https://ig.com/p1' }
    ]);
    expect(text).toContain('INSTAGRAM');
    expect(text).toContain('Summer drop');
    expect(text).toContain('https://ig.com/p1');
  });
});
