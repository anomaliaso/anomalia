import { describe, expect, it } from 'vitest';
import { GraphicSchema, paletteFor, parseGraphic, scale } from './blocks';
import { graphicTree, type El } from './graphic-tree';

const sample = {
  aspect: '4:5' as const,
  theme: 'light' as const,
  blocks: [
    { type: 'kicker' as const, text: 'Chiesto a ChatGPT' },
    { type: 'space' as const },
    { type: 'answer' as const, question: 'Miglior studio?', items: ['Uno', 'Due'], missing: 'il tuo brand' },
    { type: 'space' as const },
    { type: 'headline' as const, text: 'Ti ha escluso\ndalla risposta.' },
    { type: 'space' as const },
    { type: 'footer' as const, brand: 'Anomalia', note: '25€/mese' }
  ]
};

function walk(node: El | El[] | string | undefined, visit: (el: El) => void): void {
  if (!node || typeof node === 'string') return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  visit(node);
  walk(node.props.children, visit);
}

describe('graphic schema', () => {
  it('parses a spec and applies defaults', () => {
    const g = parseGraphic({ blocks: [{ type: 'headline', text: 'Ciao' }] });
    expect(g.aspect).toBe('4:5');
    expect(g.theme).toBe('light');
  });

  it('rejects an unknown block type', () => {
    expect(() => parseGraphic({ blocks: [{ type: 'freeform', x: 10, y: 20 }] })).toThrow();
  });

  it('rejects an empty graphic', () => {
    expect(GraphicSchema.safeParse({ blocks: [] }).success).toBe(false);
  });
});

describe('composition floor', () => {
  const types = (g: { blocks: { type: string }[] }) => g.blocks.map((b) => b.type);

  it('spaces the footer off the bottom and the kicker off the top', () => {
    const g = parseGraphic({
      blocks: [
        { type: 'kicker', text: 'Etichetta' },
        { type: 'headline', text: 'Titolo' },
        { type: 'footer', brand: 'Anomalia' }
      ]
    });
    expect(types(g)).toEqual(['kicker', 'space', 'headline', 'space', 'footer']);
  });

  it('leaves a composition that already breathes alone', () => {
    const blocks = [
      { type: 'kicker' as const, text: 'Etichetta' },
      { type: 'space' as const },
      { type: 'headline' as const, text: 'Titolo' },
      { type: 'space' as const },
      { type: 'footer' as const, brand: 'Anomalia' }
    ];
    expect(types(parseGraphic({ blocks }))).toEqual(types({ blocks }));
  });

  it('does not add a trailing space when there is no footer', () => {
    const g = parseGraphic({ blocks: [{ type: 'headline', text: 'Solo questo' }] });
    expect(types(g)).toEqual(['headline']);
  });
});

describe('palette', () => {
  it('uses the brand first colour as the accent', () => {
    expect(paletteFor('light', ['#ff0000', '#00ff00']).accent).toBe('#ff0000');
  });

  it('picks legible ink for a light accent and for a dark one', () => {
    expect(paletteFor('accent', ['#fbe94b']).ink).toBe('#1d1d1f');
    expect(paletteFor('accent', ['#101020']).ink).toBe('#ffffff');
  });

  it('ignores junk colours and falls back', () => {
    expect(paletteFor('light', ['not-a-colour']).accent).toBe(paletteFor('light', null).accent);
  });
});

describe('graphic tree', () => {
  // The guarantee that makes this schema safe for a model to author: block layout never uses
  // coordinates. A photo BACKGROUND is renderer-owned (absolute under the stack) — that is fine;
  // the model still never picks x/y for blocks.
  it('never emits absolute positioning on a flat (no-background) graphic', () => {
    const tree = graphicTree(parseGraphic(sample), { fonts: { display: 'Inter', body: 'Inter' } });
    walk(tree, (node) => {
      const style = node.props.style;
      expect(style.position).toBeUndefined();
      expect(style.top).toBeUndefined();
      expect(style.left).toBeUndefined();
      expect(style.transform).toBeUndefined();
    });
  });

  it('uses absolute only for the renderer-owned photo background layers', () => {
    const tree = graphicTree(
      parseGraphic({
        ...sample,
        background: { src: 'data:image/png;base64,AAAA', dim: 0.4 },
        theme: 'dark'
      }),
      { fonts: { display: 'Inter', body: 'Inter' } }
    );
    let sawAbsoluteImg = false;
    walk(tree, (node) => {
      if (node.type === 'img' && node.props.style.position === 'absolute') sawAbsoluteImg = true;
    });
    expect(sawAbsoluteImg).toBe(true);
  });

  it('gives every container an explicit display, as satori requires', () => {
    const tree = graphicTree(parseGraphic(sample), { fonts: { display: 'Inter', body: 'Inter' } });
    walk(tree, (node) => expect(node.props.style.display).toBe('flex'));
  });

  it('sizes the canvas from the aspect and scales type with its width', () => {
    const tree = graphicTree(parseGraphic({ ...sample, aspect: '9:16' }), { fonts: { display: 'Inter', body: 'Inter' } });
    expect(tree.props.style.width).toBe(1080);
    expect(tree.props.style.height).toBe(1920);
    expect(scale(1080, 8.4)).toBe(91);
  });

  it('steps the headline down as it gets longer, so long text cannot wrap off-canvas', () => {
    const sizeOf = (text: string) => {
      const tree = graphicTree(parseGraphic({ blocks: [{ type: 'headline', text }] }), { fonts: { display: 'Inter', body: 'Inter' } });
      let found = 0;
      walk(tree, (node) => {
        const fs = node.props.style.fontSize;
        if (typeof fs === 'number' && fs > found) found = fs;
      });
      return found;
    };
    expect(sizeOf('Corto.')).toBeGreaterThan(sizeOf('x'.repeat(50)));
    expect(sizeOf('x'.repeat(50))).toBeGreaterThan(sizeOf('x'.repeat(90)));
  });
});
