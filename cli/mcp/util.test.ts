import { describe, expect, test } from 'bun:test';
import { fail, ok } from './util.ts';

describe('mcp util results', () => {
  test('ok wraps objects as structuredContent', () => {
    const r = ok({ hello: 'world' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.type).toBe('text');
    expect(r.content[0]?.text).toContain('hello');
    expect(r.structuredContent).toEqual({ hello: 'world' });
  });

  test('ok wraps arrays under result', () => {
    const r = ok([1, 2]);
    expect(r.structuredContent).toEqual({ result: [1, 2] });
  });

  test('fail marks isError', () => {
    const r = fail('nope');
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe('nope');
  });
});
