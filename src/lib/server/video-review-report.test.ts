import { describe, expect, it } from 'vitest';
import { CreditsExhaustedError } from './credits';
import { isCreditsExhaustedError, mediaReviewNotifyMode } from './video-review-report';

describe('mediaReviewNotifyMode', () => {
  it('skips credits exhaustion — quota, not ops', () => {
    const e = new CreditsExhaustedError({
      used: 1,
      quota: 1,
      bonus: 0,
      remaining: 0,
      percent: 100,
      periodStart: new Date(),
      periodEnd: new Date()
    });
    expect(isCreditsExhaustedError(e)).toBe(true);
    expect(mediaReviewNotifyMode({ stage: 'review', finalFailed: true, error: e })).toBe('none');
    expect(mediaReviewNotifyMode({ stage: 'persist', error: e })).toBe('none');
  });

  it('emails on final review fail and persist errors', () => {
    const e = new Error('gemini_timeout');
    expect(mediaReviewNotifyMode({ stage: 'review', finalFailed: true, error: e })).toBe('all');
    expect(mediaReviewNotifyMode({ stage: 'persist', error: e })).toBe('all');
  });

  it('keeps intermediate review retries Sentry-only', () => {
    expect(
      mediaReviewNotifyMode({ stage: 'review', finalFailed: false, error: new Error('model_failed') })
    ).toBe('sentry');
  });
});
