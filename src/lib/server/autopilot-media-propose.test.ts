import { describe, expect, it } from 'vitest';
import {
  isMediaQcAttention,
  MEDIA_QC_ATTENTION_PREFIX,
  remakeAttentionReason,
  remakeFlagPatch,
  shouldProposeRemake
} from './autopilot-media-propose';

const weak = {
  status: 'ready' as const,
  overall: 4.2,
  verdict: 'fix' as const,
  judgment: 'Hook is too slow',
  next_test: 'Open on a close-up of the product'
};

describe('shouldProposeRemake', () => {
  it('proposes pending generated stills with a weak ready score', () => {
    expect(
      shouldProposeRemake({
        status: 'pending_user',
        content_type: 'generated_image',
        media_review: weak
      })
    ).toBe(true);
  });

  it('skips ship scores at or above 6', () => {
    expect(
      shouldProposeRemake({
        status: 'pending_user',
        content_type: 'generated_image',
        media_review: { status: 'ready', overall: 7, verdict: 'ship' }
      })
    ).toBe(false);
  });

  it('skips uploaded photos and text posts', () => {
    expect(
      shouldProposeRemake({
        status: 'pending_user',
        content_type: 'uploaded_image',
        media_review: weak
      })
    ).toBe(false);
    expect(
      shouldProposeRemake({
        status: 'pending_user',
        content_type: 'text',
        media_review: weak
      })
    ).toBe(false);
  });

  it('skips non-pending rows', () => {
    expect(
      shouldProposeRemake({
        status: 'scheduled',
        content_type: 'generated_image',
        media_review: weak
      })
    ).toBe(false);
  });
});

describe('remakeFlagPatch', () => {
  it('flags a weak pending post', () => {
    const patch = remakeFlagPatch({
      status: 'pending_user',
      content_type: 'generated_image',
      media_review: weak
    });
    expect(patch?.needs_attention).toBe(true);
    expect(patch?.attention_reason).toContain(MEDIA_QC_ATTENTION_PREFIX);
    expect(patch?.attention_reason).toContain('4.2/10');
    expect(patch?.attention_reason).toContain('Hook is too slow');
    expect(patch?.attention_reason).toContain('Next:');
  });

  it('does not overwrite a Director hold', () => {
    expect(
      remakeFlagPatch({
        status: 'pending_user',
        content_type: 'generated_image',
        needs_attention: true,
        attention_reason: 'Director: off-brand claim',
        media_review: weak
      })
    ).toBeNull();
  });

  it('clears our flag when the score recovers', () => {
    expect(
      remakeFlagPatch({
        status: 'pending_user',
        content_type: 'generated_image',
        needs_attention: true,
        attention_reason: `${MEDIA_QC_ATTENTION_PREFIX} 3/10 (kill) — remake suggested.`,
        media_review: { status: 'ready', overall: 8, verdict: 'ship' }
      })
    ).toEqual({ needs_attention: false, attention_reason: null });
  });

  it('is a no-op when already flagged with the same reason', () => {
    const reason = remakeAttentionReason(weak);
    expect(
      remakeFlagPatch({
        status: 'pending_user',
        content_type: 'generated_image',
        needs_attention: true,
        attention_reason: reason,
        media_review: weak
      })
    ).toBeNull();
  });
});

describe('isMediaQcAttention', () => {
  it('matches only our prefix', () => {
    expect(isMediaQcAttention('Media QC 4/10 (fix) — remake suggested.')).toBe(true);
    expect(isMediaQcAttention('Director: check caption')).toBe(false);
    expect(isMediaQcAttention(null)).toBe(false);
  });
});
