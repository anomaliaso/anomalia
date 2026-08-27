import { describe, expect, it } from 'vitest';
import { computeAutoFitSize, DesignSchema, parseDesign } from './schema';

const validDoc = {
  v: 1 as const,
  aspect: '4:5' as const,
  template: 'quote',
  slides: [
    {
      background: '#111111',
      layers: [
        {
          id: 't1',
          type: 'text' as const,
          x: 0.1,
          y: 0.2,
          w: 0.8,
          h: 0.3,
          text: 'Hello',
          font: 'Inter',
          size: 64,
          color: '#ffffff'
        }
      ]
    }
  ]
};

describe('DesignSchema', () => {
  it('round-trips a valid design doc', () => {
    const parsed = parseDesign(validDoc);
    expect(parsed.v).toBe(1);
    expect(parsed.aspect).toBe('4:5');
    expect(parsed.slides).toHaveLength(1);
    const layer = parsed.slides[0].layers[0];
    expect(layer.type).toBe('text');
    if (layer.type === 'text') {
      expect(layer.autoFit).toBe(true);
      expect(layer.weight).toBe(600);
      expect(layer.align).toBe('left');
    }
    expect(DesignSchema.parse(parsed)).toEqual(parsed);
  });

  it('rejects an invalid doc', () => {
    expect(() => parseDesign({ v: 2, aspect: '4:5', slides: [] })).toThrow();
    expect(() => parseDesign({ v: 1, aspect: '3:2', slides: [{ layers: [] }] })).toThrow();
    expect(() =>
      parseDesign({
        v: 1,
        aspect: '1:1',
        slides: [{ layers: [{ id: 'x', type: 'text', x: 0, y: 0, w: 1, h: 1 }] }]
      })
    ).toThrow();
  });
});

describe('computeAutoFitSize', () => {
  it('decreases size monotonically as text grows at fixed box', () => {
    const boxW = 400;
    const boxH = 200;
    // Synthetic measure: width ∝ textLength × size, height ∝ size × lineHeight
    const measureFor = (textLen: number) => (size: number) => ({
      width: textLen * size * 0.55,
      height: size * 1.15
    });

    const short = computeAutoFitSize({
      initialSize: 72,
      boxW,
      boxH,
      measure: measureFor(20)
    });
    const medium = computeAutoFitSize({
      initialSize: 72,
      boxW,
      boxH,
      measure: measureFor(40)
    });
    const long = computeAutoFitSize({
      initialSize: 72,
      boxW,
      boxH,
      measure: measureFor(80)
    });

    expect(short).toBeGreaterThanOrEqual(medium);
    expect(medium).toBeGreaterThanOrEqual(long);
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(8);
  });
});
