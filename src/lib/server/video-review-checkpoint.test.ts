import { describe, expect, it } from 'vitest';
import {
  buildReviewCheckpoint,
  isAbortLikeError,
  parseReviewCheckpoint,
  slimReviewMessages
} from './video-review-checkpoint';

describe('slimReviewMessages', () => {
  it('drops user/system turns and binary parts, keeps tool calls', () => {
    const slim = slimReviewMessages([
      { role: 'user', content: [{ type: 'text', text: 'watch' }, { type: 'image', image: Buffer.from('x') }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: '1', toolName: 'read_brand_studio', input: {} }]
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: '1', toolName: 'read_brand_studio', output: { ok: true } }]
      }
    ]);
    expect(slim).toHaveLength(2);
    expect((slim[0] as { role: string }).role).toBe('assistant');
    expect((slim[1] as { role: string }).role).toBe('tool');
  });
});

describe('parseReviewCheckpoint / buildReviewCheckpoint', () => {
  it('round-trips a valid checkpoint', () => {
    const cp = buildReviewCheckpoint({
      steps: 2,
      webLeft: 1,
      adsLeft: 2,
      notes: ['Brand studio'],
      toolsUsed: ['read_brand_studio'],
      messages: [
        { role: 'user', content: 'media' },
        { role: 'assistant', content: 'looking' }
      ]
    });
    expect(cp).toBeTruthy();
    const parsed = parseReviewCheckpoint(cp);
    expect(parsed?.steps).toBe(2);
    expect(parsed?.rest).toEqual([{ role: 'assistant', content: 'looking' }]);
  });

  it('rejects empty / wrong version', () => {
    expect(parseReviewCheckpoint(null)).toBeNull();
    expect(parseReviewCheckpoint({ v: 2, steps: 1, rest: [{}] })).toBeNull();
    expect(parseReviewCheckpoint({ v: 1, steps: 0, rest: [{}] })).toBeNull();
  });
});

describe('isAbortLikeError', () => {
  it('detects AbortError and abort copy', () => {
    const e = new Error('This operation was aborted');
    e.name = 'AbortError';
    expect(isAbortLikeError(e)).toBe(true);
    expect(isAbortLikeError(new Error('aborted'))).toBe(true);
    expect(isAbortLikeError(new Error('model_failed'))).toBe(false);
  });
});
