import { describe, expect, it } from 'vitest';
import { analyticsReviewAgentEnabled } from '$lib/server/analytics-review-agent';

describe('analyticsReviewAgentEnabled', () => {
  it('is enabled by default (opt-out via ANALYTICS_REVIEW_AGENT_ENABLED=false)', () => {
    expect(analyticsReviewAgentEnabled()).toBe(true);
  });
});
