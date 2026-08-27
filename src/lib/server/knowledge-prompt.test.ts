import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  selectChunksForPrompt,
  KNOWLEDGE_CAPTION_TOKEN_BUDGET,
  KNOWLEDGE_PROMPT_HEADER
} from './knowledge-prompt';

describe('estimateTokens', () => {
  it('is empty for blank input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   ')).toBe(0);
  });

  it('uses ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });
});

describe('selectChunksForPrompt', () => {
  const hits = [
    { chunkId: 'c1', title: 'Doc A', headingPath: 'Returns', content: 'A'.repeat(200) },
    { chunkId: 'c2', title: 'Doc B', headingPath: '', content: 'B'.repeat(200) },
    { chunkId: 'c3', title: 'Doc C', headingPath: 'Ship', content: 'C'.repeat(200) }
  ];

  it('returns empty when there are no hits', () => {
    expect(selectChunksForPrompt([])).toEqual({
      selected: [],
      chunkIds: [],
      block: '',
      tokensUsed: 0
    });
  });

  it('keeps all hits under the default budget', () => {
    const sel = selectChunksForPrompt(hits);
    expect(sel.chunkIds).toEqual(['c1', 'c2', 'c3']);
    expect(sel.block.startsWith(KNOWLEDGE_PROMPT_HEADER)).toBe(true);
    expect(sel.tokensUsed).toBeLessThanOrEqual(KNOWLEDGE_CAPTION_TOKEN_BUDGET);
    expect(sel.tokensUsed).toBe(estimateTokens(sel.block));
  });

  it('stops when the hard budget would be exceeded', () => {
    const sel = selectChunksForPrompt(hits, 80);
    expect(sel.chunkIds.length).toBeGreaterThanOrEqual(1);
    expect(sel.chunkIds.length).toBeLessThan(3);
    expect(sel.tokensUsed).toBeLessThanOrEqual(80);
  });

  it('truncates an oversized first hit instead of dropping it', () => {
    const big = [{ chunkId: 'big', title: 'Huge', headingPath: '', content: 'X'.repeat(10_000) }];
    const sel = selectChunksForPrompt(big, 100);
    expect(sel.chunkIds).toEqual(['big']);
    expect(sel.selected[0].content.endsWith('…') || sel.selected[0].content.length < 10_000).toBe(true);
    expect(sel.tokensUsed).toBeLessThanOrEqual(100);
  });
});
