import { describe, expect, it } from 'vitest';
import { CONTENT_SCORER_VERSION } from './content-quality';
import { parseRelease } from '$lib/release';
import { releaseTag } from './release-tag';
import { repetitionPeers, sampleRowFor, SAMPLED_STATUSES, type PostRow } from './benchmark-store';

const post = (over: Partial<PostRow> = {}): PostRow => ({
  id: 'p1',
  brand_id: 'b1',
  platform: 'instagram',
  caption: 'Hai perso 3 clienti questo mese? Scrivici in DM per il template.',
  status: 'published',
  revisions_count: 0,
  created_at: '2026-08-10T10:00:00Z',
  ...over
});

describe('repetitionPeers', () => {
  it('only compares against posts created BEFORE the one being scored', () => {
    const target = post({ id: 'p2', created_at: '2026-08-10T10:00:00Z' });
    const peers = repetitionPeers(target, [
      target,
      post({ id: 'earlier', caption: 'vecchio', created_at: '2026-08-01T10:00:00Z' }),
      post({ id: 'later', caption: 'futuro', created_at: '2026-08-20T10:00:00Z' })
    ]);
    // Including the future would make the score depend on when the tick ran.
    expect(peers).toEqual(['vecchio']);
  });

  it('excludes the post itself even when timestamps collide', () => {
    const target = post({ id: 'self' });
    expect(repetitionPeers(target, [target])).toEqual([]);
  });

  it('takes the most recent peers up to the window', () => {
    const target = post({ id: 'target', created_at: '2026-08-30T00:00:00Z' });
    const history = Array.from({ length: 10 }, (_, i) =>
      post({ id: `h${i}`, caption: `post ${i}`, created_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z` })
    );
    const peers = repetitionPeers(target, history, 3);
    expect(peers).toEqual(['post 9', 'post 8', 'post 7']);
  });

  it('drops peers with a blank caption', () => {
    const target = post({ id: 'target', created_at: '2026-08-30T00:00:00Z' });
    const peers = repetitionPeers(target, [
      post({ id: 'a', caption: '   ', created_at: '2026-08-01T00:00:00Z' }),
      post({ id: 'b', caption: null, created_at: '2026-08-02T00:00:00Z' })
    ]);
    expect(peers).toEqual([]);
  });
});

describe('sampleRowFor', () => {
  it('stamps provenance so the sample is attributable to a build and a rulebook', () => {
    const row = sampleRowFor(post(), [], { release: 'abc123', runId: null });
    expect(row.release).toBe('abc123');
    expect(row.scorer_version).toBe(CONTENT_SCORER_VERSION);
    expect(row.post_id).toBe('p1');
    expect(row.brand_id).toBe('b1');
  });

  it('captures the human ground truth at sample time', () => {
    const row = sampleRowFor(post({ revisions_count: 2, status: 'approved' }), [], { release: 'r' });
    expect(row.revisions_count).toBe(2);
    expect(row.post_status).toBe('approved');
  });

  it('defaults a null revisions_count to 0 so the correlation has a usable value', () => {
    expect(sampleRowFor(post({ revisions_count: null }), [], { release: 'r' }).revisions_count).toBe(0);
  });

  it('scores lower when the caption repeats a peer', () => {
    const caption = 'Hai perso 3 clienti questo mese? Scrivici in DM per il template.';
    const alone = sampleRowFor(post({ caption }), [], { release: 'r' });
    const repeated = sampleRowFor(post({ caption }), [caption], { release: 'r' });
    expect(repeated.quality_index).toBeLessThan(alone.quality_index);
  });

  it('stores the per-check breakdown, which is what explains a moved index', () => {
    const row = sampleRowFor(post(), [], { release: 'r' });
    expect(Object.keys(row.checks)).toContain('hook_strength');
    expect(row.metrics).toHaveProperty('words');
  });
});

describe('releaseTag', () => {
  // The seam between the two definitions of "release": svelte.config.js composes the same
  // <semver>+<build> shape for $app/environment. If this stops parsing, the benchmark's x-axis and
  // the app's version have silently drifted apart.
  it('produces a tag that parses back into a version and a build', () => {
    const parsed = parseRelease(releaseTag());
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.build).toBeTruthy();
  });

  it('falls back to a loud build marker rather than an empty one', () => {
    // No VERCEL_GIT_COMMIT_SHA in the test environment: the tag must still be attributable.
    expect(parseRelease(releaseTag()).build).toBe('dev');
  });
});

describe('SAMPLED_STATUSES', () => {
  it('excludes drafts — a discarded draft was never our output', () => {
    expect(SAMPLED_STATUSES).not.toContain('pending_user');
    expect(SAMPLED_STATUSES).toContain('published');
  });
});
