import { describe, it, expect } from 'vitest';
import { hasToolDetail, toolCallDetail, toolPayloadView, TOOL_PAYLOAD_MAX } from './chat-tool-detail';

describe('toolPayloadView', () => {
  it('pretty-prints an object and reports its size', () => {
    const v = toolPayloadView({ slug: 'acme', limit: 3 })!;
    expect(v.json).toBe(true);
    expect(v.truncated).toBe(false);
    expect(v.text).toBe('{\n  "slug": "acme",\n  "limit": 3\n}');
    expect(v.length).toBe(v.text.length);
  });

  it('indents a tool that answered with a JSON string, and leaves prose alone', () => {
    expect(toolPayloadView('{"ok":true}')).toMatchObject({ json: true, text: '{\n  "ok": true\n}' });
    expect(toolPayloadView('Ho aggiornato 3 post.')).toMatchObject({
      json: false,
      text: 'Ho aggiornato 3 post.'
    });
  });

  it('has nothing to show for undefined, blank strings or a no-params call', () => {
    expect(toolPayloadView(undefined)).toBeNull();
    expect(toolPayloadView('   ')).toBeNull();
    expect(toolPayloadView({})).toBeNull();
    // An empty array IS a result: "the tool found nothing" is worth reading.
    expect(toolPayloadView([])).toMatchObject({ text: '[]' });
    expect(toolPayloadView(null)).toMatchObject({ text: 'null' });
  });

  it('only offers "show all" for something that actually overflows the box', () => {
    expect(toolPayloadView('breve')!.long).toBe(false);
    expect(toolPayloadView('x'.repeat(600))!.long).toBe(true);
    // Short by character count but tall on screen — 20 one-word lines still need the toggle.
    expect(toolPayloadView(Array.from({ length: 20 }, (_, i) => `r${i}`))!.long).toBe(true);
  });

  it('caps a monster output but still reports the real length', () => {
    const big = 'x'.repeat(TOOL_PAYLOAD_MAX + 500);
    const v = toolPayloadView(big)!;
    expect(v.truncated).toBe(true);
    expect(v.text).toHaveLength(TOOL_PAYLOAD_MAX);
    expect(v.length).toBe(TOOL_PAYLOAD_MAX + 500);
  });

  it('survives a cycle instead of throwing the whole panel away', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(toolPayloadView(a)!.text).toContain('circolare');
  });
});

describe('toolCallDetail', () => {
  it('reads a persisted tool-call part', () => {
    const d = toolCallDetail({
      toolName: 'list_posts',
      input: { status: 'pending_user' },
      output: { posts: [{ id: 'p1' }] }
    })!;
    expect(d.input!.text).toContain('pending_user');
    expect(d.output!.text).toContain('p1');
    expect(d.error).toBeNull();
  });

  it('reads a live call the same way, error text included', () => {
    const d = toolCallDetail({ toolName: 'x', args: { a: 1 }, errorText: '  boom  ' })!;
    expect(d.input!.text).toContain('"a": 1');
    expect(d.output).toBeNull();
    expect(d.error).toBe('boom');
  });

  it('stays shut when the chip only knows its own name', () => {
    expect(toolCallDetail({ toolName: 'read_posts' })).toBeNull();
    expect(hasToolDetail({ toolName: 'read_posts' })).toBe(false);
    expect(hasToolDetail(undefined)).toBe(false);
    // A call still running, params already known: worth opening.
    expect(hasToolDetail({ toolName: 'read_posts', input: { n: 1 } })).toBe(true);
  });
});
