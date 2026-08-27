import { describe, it, expect } from 'vitest';
import { rowContextChars } from './chat-context';

describe('rowContextChars', () => {
  it('counts text and the persisted tool payload', () => {
    expect(rowContextChars({ content: 'ciao' })).toBe(4);
    expect(rowContextChars({ content: 'ciao', tool_calls: 'xx' })).toBe(6);
    expect(rowContextChars({ content: '', tool_calls: [{ toolName: 'a' }] })).toBe(
      JSON.stringify([{ toolName: 'a' }]).length
    );
  });

  it('falls back to the text when tool_calls will not serialize', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(rowContextChars({ content: 'abc', tool_calls: cyclic })).toBe(3);
  });
});
