import { describe, expect, it } from 'vitest';
import { buildMemoryGraph, layoutMemoryGraph } from '$lib/memory-graph';

describe('buildMemoryGraph', () => {
  it('links same-category entries and token overlaps', () => {
    const nodes = [
      {
        id: '1',
        key: 'brand_tone',
        value: 'Warm and playful tone of voice',
        category: 'voice',
        source: 'user',
        confidence: 1,
        times_used: 2,
        times_reinforced: 0
      },
      {
        id: '2',
        key: 'caption_voice',
        value: 'Keep a playful tone in captions',
        category: 'voice',
        source: 'chat',
        confidence: 0.8,
        times_used: 0,
        times_reinforced: 1
      },
      {
        id: '3',
        key: 'no_discount',
        value: 'Never advertise discounts',
        category: 'constraint',
        source: 'user',
        confidence: 1,
        times_used: 5,
        times_reinforced: 0
      }
    ];

    const { edges } = buildMemoryGraph(nodes);
    expect(edges.some((e) => e.reason === 'tokens')).toBe(true);
    expect(edges.some((e) => e.sourceId === '1' && e.targetId === '2')).toBe(true);

    const pos = layoutMemoryGraph(nodes, 640, 420);
    expect(pos.get('1')).toBeTruthy();
    expect(pos.get('3')).toBeTruthy();
  });
});
