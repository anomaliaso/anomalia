import { describe, expect, it } from 'vitest';
import { formatVideoScore, videoScoreTone } from '$lib/video-score';
import {
  compareReviewRows,
  emptyChatMediaReview,
  indexChatMediaReviews,
  lookupChatMediaReview,
  mediaUrlHash,
  normalizeMediaUrl,
  postMediaChanged,
  rowToBadge,
  rowToChatMediaReview,
  rowToLog
} from './video-review-store';

describe('normalizeMediaUrl / mediaUrlHash', () => {
  it('strips query and hash so signed URLs collide with the public one', () => {
    const a = 'https://x.supabase.co/storage/v1/object/public/media/u/g.mp4?token=abc';
    const b = 'https://x.supabase.co/storage/v1/object/public/media/u/g.mp4';
    expect(normalizeMediaUrl(a)).toBe(normalizeMediaUrl(b));
    expect(mediaUrlHash(a)).toBe(mediaUrlHash(b));
  });
  it('is stable and short', () => {
    const h = mediaUrlHash('https://cdn.example/a.mp4');
    expect(h).toHaveLength(32);
    expect(mediaUrlHash('https://cdn.example/a.mp4')).toBe(h);
    expect(mediaUrlHash('https://cdn.example/b.mp4')).not.toBe(h);
  });
});

describe('rowToBadge', () => {
  it('maps a ready row', () => {
    expect(
      rowToBadge({
        media_url: 'https://x.co/a.mp4',
        post_id: 'p1',
        status: 'ready',
        overall: 6.4,
        verdict: 'fix',
        standard: 'organic'
      })
    ).toEqual({
      url: 'https://x.co/a.mp4',
      postId: 'p1',
      status: 'ready',
      overall: 6.4,
      verdict: 'fix',
      standard: 'organic',
      judgment: null,
      nextTest: null,
      issues: []
    });
  });
  it('treats unknown status as pending', () => {
    expect(rowToBadge({ media_url: 'u', status: 'nope', overall: null }).status).toBe('pending');
  });
  it('pulls judgment and next_test from the review JSON', () => {
    expect(
      rowToBadge({
        media_url: 'https://x.co/a.mp4',
        status: 'ready',
        overall: 5,
        verdict: 'kill',
        standard: 'organic',
        judgment: 'Silent first 2s.',
        review: {
          next_test: 'Because hook, speak the pain in the first second; judge on 3s hold.',
          issues: [{ severity: 'high', problem: 'No hook', fix: 'Name the person in 0–1s.' }]
        }
      })
    ).toMatchObject({
      judgment: 'Silent first 2s.',
      nextTest: 'Because hook, speak the pain in the first second; judge on 3s hold.',
      issues: [{ problem: 'No hook', fix: 'Name the person in 0–1s.' }]
    });
  });
});

describe('chat media review index', () => {
  it('maps a ready row to judgment + next_test for the model', () => {
    expect(
      rowToChatMediaReview({
        media_url: 'https://x.co/a.mp4',
        post_id: 'p1',
        status: 'ready',
        overall: 4,
        verdict: 'kill',
        standard: 'organic',
        judgment: 'Hook is silent.',
        review: { next_test: 'Speak in 0–1s.', issues: [{ problem: 'No hook', fix: 'Name the person.' }] }
      })
    ).toMatchObject({
      status: 'ready',
      overall: 4,
      verdict: 'kill',
      judgment: 'Hook is silent.',
      next_test: 'Speak in 0–1s.',
      hint: 'Do not approve as-is. Apply next_test when remaking.'
    });
  });

  it('prefers a ready organic row over ads pending', () => {
    expect(
      compareReviewRows(
        { status: 'pending', standard: 'organic', updated_at: '2026-08-13T12:00:00Z' },
        { status: 'ready', standard: 'ads', updated_at: '2026-08-13T11:00:00Z' }
      )
    ).toBeGreaterThan(0);
  });

  it('indexes by post id and url hash, then looks up either', () => {
    const url = 'https://cdn.example/a.mp4';
    const map = indexChatMediaReviews([
      {
        media_url: url,
        post_id: 'p1',
        url_hash: mediaUrlHash(url),
        status: 'ready',
        overall: 7,
        verdict: 'fix',
        standard: 'organic',
        judgment: 'Hold drops at 3s.',
        review: { next_test: 'Cut the mid pause.' },
        updated_at: '2026-08-13T10:00:00Z'
      }
    ]);
    expect(lookupChatMediaReview(map, { id: 'p1' })?.overall).toBe(7);
    expect(lookupChatMediaReview(map, { media_url: url })?.next_test).toBe('Cut the mid pause.');
    expect(lookupChatMediaReview(map, { id: 'missing' })).toBeNull();
    expect(emptyChatMediaReview().status).toBe('none');
  });
});

describe('rowToLog', () => {
  it('maps a failed review without dumping the full JSON', () => {
    const log = rowToLog({
      id: 'r1',
      media_url: 'https://x.co/a.mp4',
      post_id: 'p1',
      kind: 'video',
      standard: 'ads',
      status: 'failed',
      overall: null,
      verdict: null,
      error: 'gemini_timeout',
      judgment: null,
      script_spoken: 'hello',
      attempts: 3,
      updated_at: '2026-08-13T10:00:00.000Z',
      created_at: '2026-08-13T09:00:00.000Z',
      review: { overall: 1, scores: {} }
    });
    expect(log).toMatchObject({
      id: 'r1',
      postId: 'p1',
      kind: 'video',
      standard: 'ads',
      status: 'failed',
      error: 'gemini_timeout',
      scriptSpoken: 'hello',
      attempts: 3
    });
    expect(log).not.toHaveProperty('review');
  });
});

describe('postMediaChanged', () => {
  it('ignores a save that re-sends the same media_url', () => {
    expect(
      postMediaChanged(
        { media_url: 'https://x.co/a.mp4?token=1' },
        { media_url: 'https://x.co/a.mp4?token=2' }
      )
    ).toBe(false);
  });
  it('detects a new clip and a carousel slide swap', () => {
    expect(
      postMediaChanged({ media_url: 'https://x.co/a.mp4' }, { media_url: 'https://x.co/b.mp4' })
    ).toBe(true);
    expect(
      postMediaChanged(
        { media_url: 'https://x.co/a.jpg', media_urls: ['https://x.co/a.jpg', 'https://x.co/b.jpg'] },
        { media_urls: ['https://x.co/a.jpg', 'https://x.co/c.jpg'] }
      )
    ).toBe(true);
  });
});

describe('formatVideoScore / tone', () => {
  it('prints one decimal when needed', () => {
    expect(formatVideoScore(6)).toBe('6');
    expect(formatVideoScore(6.4)).toBe('6.4');
  });
  it('pending wins over a missing verdict', () => {
    expect(videoScoreTone({ status: 'pending', verdict: 'ship' })).toBe('pending');
    expect(videoScoreTone({ status: 'ready', verdict: 'kill' })).toBe('kill');
  });
});
