import { describe, expect, it } from 'vitest';
import { parseGraphic, resolveImageRefs } from './blocks';
import { graphicTree } from './graphic-tree';
import { resolveGraphicIcon } from './graphic-icons';

describe('graphic image/shape/icon blocks', () => {
  it('parses image, shape and icon blocks', () => {
    const g = parseGraphic({
      blocks: [
        { type: 'image', src: 'ref:0', size: 'lg' },
        { type: 'icon', name: 'instagram', set: 'simple' },
        { type: 'shape', kind: 'pill', fill: 'accent', label: 'New' },
        { type: 'headline', text: 'Ciao' },
        { type: 'footer', brand: 'Acme' }
      ]
    });
    expect(g.blocks.map((b) => b.type)).toContain('image');
    expect(g.blocks.map((b) => b.type)).toContain('icon');
    expect(g.blocks.map((b) => b.type)).toContain('shape');
  });

  it('resolves ref:N image srcs against the available catalog', () => {
    const g = resolveImageRefs(
      parseGraphic({
        blocks: [
          { type: 'image', src: 'ref:1' },
          { type: 'headline', text: 'Hi' }
        ]
      }),
      [{ url: 'https://example.com/a.jpg' }, { url: 'https://example.com/b.jpg' }]
    );
    const img = g.blocks.find((b) => b.type === 'image');
    expect(img && img.type === 'image' && img.src).toBe('https://example.com/b.jpg');
  });

  it('drops unresolved image refs when no catalog', () => {
    const g = resolveImageRefs(
      parseGraphic({ blocks: [{ type: 'image', src: 'ref:0' }, { type: 'headline', text: 'Hi' }] }),
      []
    );
    expect(g.blocks.every((b) => b.type !== 'image')).toBe(true);
  });

  it('resolves background ref:N like image blocks', () => {
    const g = resolveImageRefs(
      parseGraphic({
        background: { src: 'ref:0', dim: 0.5 },
        blocks: [{ type: 'headline', text: 'Over photo' }, { type: 'footer', brand: 'Acme' }]
      }),
      [{ url: 'https://example.com/bg.jpg' }]
    );
    expect(g.background?.src).toBe('https://example.com/bg.jpg');
  });

  it('renders a background photo node in the tree', () => {
    const g = parseGraphic({
      background: { src: 'data:image/png;base64,AAAA', dim: 0.4 },
      theme: 'dark',
      blocks: [{ type: 'headline', text: 'Hi' }, { type: 'footer', brand: 'Acme' }]
    });
    const tree = graphicTree(g, { fonts: { display: 'Inter', body: 'Inter' } });
    const imgs: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n === 'string') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const el = n as { type: string; props: { src?: string; children?: unknown; style?: { position?: string } } };
      if (el.type === 'img' && el.props.src) imgs.push(el.props.src);
      walk(el.props.children);
    };
    walk(tree);
    expect(imgs.some((s) => s.startsWith('data:image/png'))).toBe(true);
  });
});

describe('resolveGraphicIcon', () => {
  it('resolves Lucide icons', () => {
    const icon = resolveGraphicIcon('check', '#111');
    expect(icon?.source).toBe('lucide');
    expect(icon?.svg).toContain('stroke="#111"');
  });

  it('resolves Simple Icons brand marks', () => {
    const icon = resolveGraphicIcon('instagram', '#fff', { set: 'simple' });
    expect(icon?.source).toBe('simple-icons');
    expect(icon?.brandHex?.toLowerCase()).toBe('#ff0069');
    expect(icon?.svg).toContain('<path');
  });

  it('resolves extra brand marks (openai)', () => {
    const icon = resolveGraphicIcon('openai', '#000', { set: 'simple' });
    expect(icon?.source).toBe('extra');
    expect(icon?.title).toMatch(/OpenAI/i);
  });

  it('returns null for unknown names', () => {
    expect(resolveGraphicIcon('not-a-real-icon-xyz', '#000')).toBeNull();
  });
});
