import { describe, it, expect } from 'vitest';
import { formatChatDuration, formatChatMetaTooltip } from './chat-duration';

describe('formatChatDuration', () => {
  it('formats sub-10s with one decimal', () => {
    expect(formatChatDuration(1200)).toBe('1.2s');
    expect(formatChatDuration(3400)).toBe('3.4s');
  });

  it('formats 10s–59s as whole seconds', () => {
    expect(formatChatDuration(12_000)).toBe('12s');
    expect(formatChatDuration(59_400)).toBe('59s');
  });

  it('formats minutes with zero-padded seconds', () => {
    expect(formatChatDuration(64_000)).toBe('1m 04s');
    expect(formatChatDuration(125_000)).toBe('2m 05s');
  });
});

describe('formatChatMetaTooltip', () => {
  it('joins model, tier, and token counts', () => {
    expect(
      formatChatMetaTooltip({
        model: 'deepseek-v4-flash',
        tier: 'fast',
        inputTokens: 100,
        outputTokens: 40
      })
    ).toBe('deepseek-v4-flash · fast · 100→40');
  });
});
