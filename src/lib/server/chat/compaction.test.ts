import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  shouldCompact,
  contextWindowFor,
  modelContextWindow,
  summaryBlock,
  rowContextChars,
  rowTranscript,
  chooseKeepCount,
  COMPACT_AT,
  KEEP_TAIL,
  KEEP_TAIL_MIN,
  MIN_COMPACTABLE,
  TAIL_BUDGET,
  TOOL_TRANSCRIPT_CAP
} from './compaction';
import { CHAT_CONTEXT_CAP_TOKENS } from '$lib/plans';

/** Chars needed to sit just over the compaction threshold for a given window. */
const charsOverBudget = (window: number) => Math.ceil(window * COMPACT_AT * 4) + 8;

describe('estimateTokens', () => {
  it('approximates 4 chars per token', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(401)).toBe(101); // rounds up, never under-estimates the budget
  });
});

describe('modelContextWindow', () => {
  it('gives deepseek its million and falls back conservatively for the unknown', () => {
    expect(modelContextWindow('deepseek-v4-flash')).toBe(1_000_000);
    expect(modelContextWindow('deepseek-v4-pro')).toBe(1_000_000);
    expect(modelContextWindow('gpt-5-6-terra')).toBe(1_000_000);
    expect(modelContextWindow('gpt-5-6-sol')).toBe(1_000_000);
    expect(modelContextWindow('grok-4-5')).toBe(256_000);
    expect(modelContextWindow('grok-4-6')).toBe(500_000);
    expect(modelContextWindow('some-model-we-never-heard-of')).toBe(128_000);
  });
});

describe('contextWindowFor', () => {
  it('gives Starter/Pro the model\'s full window', () => {
    expect(contextWindowFor('deepseek-v4-flash', 'starter')).toBe(1_000_000);
    expect(contextWindowFor('deepseek-v4-flash', 'pro')).toBe(1_000_000);
    expect(contextWindowFor('deepseek-v4-flash', 'scale')).toBe(1_000_000);
    expect(contextWindowFor('grok-4-6', 'pro')).toBe(500_000);
  });

  it('caps free and Go at 256k', () => {
    expect(contextWindowFor('deepseek-v4-flash', null)).toBe(CHAT_CONTEXT_CAP_TOKENS);
    expect(contextWindowFor('deepseek-v4-flash', 'go')).toBe(CHAT_CONTEXT_CAP_TOKENS);
    expect(contextWindowFor('gpt-5-6-terra', 'go')).toBe(CHAT_CONTEXT_CAP_TOKENS);
    expect(contextWindowFor('grok-4-6', null)).toBe(CHAT_CONTEXT_CAP_TOKENS);
  });

  it('never raises a model that is smaller than the cap', () => {
    expect(contextWindowFor('some-model-we-never-heard-of', 'go')).toBe(128_000);
    expect(contextWindowFor('some-model-we-never-heard-of', 'pro')).toBe(128_000);
  });

  it('treats a missing plan as free — a forgotten call site shortens threads, never 400s', () => {
    expect(contextWindowFor('deepseek-v4-flash')).toBe(CHAT_CONTEXT_CAP_TOKENS);
  });

  it('paid gets ~4x the free window on a 1M model', () => {
    const free = contextWindowFor('deepseek-v4-flash', 'go');
    const paid = contextWindowFor('deepseek-v4-flash', 'pro');
    expect(paid / free).toBeGreaterThanOrEqual(3.9);
  });
});

describe('compaction thresholds by plan', () => {
  const chars = Math.ceil(CHAT_CONTEXT_CAP_TOKENS * COMPACT_AT * 4) + 8;

  it('compacts a free thread where the same thread on Pro still fits', () => {
    expect(
      shouldCompact({ chars, compactableCount: KEEP_TAIL, modelId: 'deepseek-v4-flash', plan: 'go' })
    ).toBe(true);
    expect(
      shouldCompact({ chars, compactableCount: KEEP_TAIL, modelId: 'deepseek-v4-flash', plan: 'pro' })
    ).toBe(false);
  });

  it('keeps a longer verbatim tail on paid plans', () => {
    // Rows fat enough that the free tail budget (50% of 256k) shrinks the tail, but the
    // Pro budget (50% of 1M) does not.
    const fat = 'z'.repeat(Math.ceil(CHAT_CONTEXT_CAP_TOKENS * TAIL_BUDGET * 4 * 0.2));
    const rows = Array.from({ length: KEEP_TAIL }, () => ({ role: 'user', content: fat }));
    const free = chooseKeepCount(rows, 'deepseek-v4-flash', { plan: 'go' });
    const paid = chooseKeepCount(rows, 'deepseek-v4-flash', { plan: 'pro' });
    expect(free).toBeLessThan(KEEP_TAIL);
    expect(paid).toBe(KEEP_TAIL);
  });
});

describe('shouldCompact', () => {
  const modelId = 'grok-4-5';
  const window = contextWindowFor(modelId);

  it('compacts once past the threshold with enough messages to be worth it', () => {
    expect(
      shouldCompact({ chars: charsOverBudget(window), compactableCount: KEEP_TAIL, modelId })
    ).toBe(true);
  });

  it('stays put below the threshold', () => {
    expect(shouldCompact({ chars: 1_000, compactableCount: KEEP_TAIL, modelId })).toBe(false);
  });

  it('refuses to spend an AI call on a handful of messages, however long they are', () => {
    expect(
      shouldCompact({
        chars: charsOverBudget(window),
        compactableCount: MIN_COMPACTABLE - 1,
        modelId
      })
    ).toBe(false);
  });

  it('still compacts a short peel when KEEP_TAIL was shrunk around fat tool outputs', () => {
    expect(
      shouldCompact({
        chars: charsOverBudget(window),
        compactableCount: 2,
        modelId,
        keepShrunk: true
      })
    ).toBe(true);
  });

  it('follows the window of the model actually running the turn (paid: no plan cap)', () => {
    const chars = charsOverBudget(256_000);
    // Over budget for Grok's 256k…
    expect(
      shouldCompact({ chars, compactableCount: KEEP_TAIL, modelId: 'grok-4-5', plan: 'pro' })
    ).toBe(true);
    // …and nowhere near it for DeepSeek's million.
    expect(
      shouldCompact({ chars, compactableCount: KEEP_TAIL, modelId: 'deepseek-v4-flash', plan: 'pro' })
    ).toBe(false);
  });
});

describe('summaryBlock', () => {
  it('labels the summary with the number of messages it stands in for', () => {
    const block = summaryBlock('- decisione X', 34);
    expect(block).toContain('(34 messaggi)');
    expect(block).toContain('- decisione X');
  });
});

describe('rowContextChars / rowTranscript', () => {
  it('counts persisted tool_calls (the read slice) not just the bubble text', () => {
    const row = {
      role: 'assistant',
      content: 'Ho letto.',
      tool_calls: [
        {
          type: 'tool-call',
          toolName: 'read_attachment',
          output: { text: 'x'.repeat(1000) }
        }
      ]
    };
    expect(rowContextChars(row)).toBeGreaterThan(row.content.length + 900);
    expect(rowContextChars({ content: 'ciao' })).toBe(4);
  });

  it('puts tool outputs in the DeepSeek transcript, capped per call', () => {
    const t = rowTranscript({
      role: 'assistant',
      content: 'ok',
      tool_calls: [
        { type: 'text', text: 'ok' },
        { type: 'tool-call', toolName: 'read_attachment', output: 'y'.repeat(TOOL_TRANSCRIPT_CAP + 50) }
      ]
    });
    expect(t).toContain('AI: ok');
    expect(t).toContain('[tool read_attachment]');
    expect(t).toContain('y'.repeat(TOOL_TRANSCRIPT_CAP));
    expect(t).not.toContain('y'.repeat(TOOL_TRANSCRIPT_CAP + 1));
  });
});

describe('chooseKeepCount', () => {
  it('keeps the default tail when messages are small', () => {
    const rows = Array.from({ length: 20 }, () => ({ content: 'ciao' }));
    expect(chooseKeepCount(rows, 'grok-4-5')).toBe(KEEP_TAIL);
  });

  it('shrinks the tail when tool outputs would eat half the session window', () => {
    const fat = 'z'.repeat(Math.ceil(contextWindowFor('grok-4-5') * TAIL_BUDGET * 4 * 0.15));
    const rows = Array.from({ length: 20 }, () => ({
      content: 'ok',
      tool_calls: [{ type: 'tool-call', toolName: 'read_attachment', output: fat }]
    }));
    const keep = chooseKeepCount(rows, 'grok-4-5');
    expect(keep).toBeGreaterThanOrEqual(KEEP_TAIL_MIN);
    expect(keep).toBeLessThan(KEEP_TAIL);
  });

  it('follows the selected model window — DeepSeek keeps more than Grok of the same fat tail', () => {
    const fat = 'z'.repeat(Math.ceil(contextWindowFor('grok-4-5') * TAIL_BUDGET * 4 * 0.15));
    const rows = Array.from({ length: 20 }, () => ({
      content: 'ok',
      tool_calls: [{ type: 'tool-call', toolName: 'read_attachment', output: fat }]
    }));
    // On a paid plan the model dimension is what's left: DeepSeek's million vs Grok's 256k.
    expect(chooseKeepCount(rows, 'deepseek-v4-flash', { plan: 'pro' })).toBe(KEEP_TAIL);
    expect(chooseKeepCount(rows, 'grok-4-5', { plan: 'pro' })).toBeLessThan(KEEP_TAIL);
  });
});
