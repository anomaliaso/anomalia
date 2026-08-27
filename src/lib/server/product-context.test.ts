import { describe, it, expect } from 'vitest';
import { formatProductsList, type BrandProductLink } from './product-context';

describe('formatProductsList', () => {
  it('returns empty catalog message when no products', () => {
    expect(formatProductsList([])).toContain('no products');
  });

  it('includes exact url, image, and featured marker', () => {
    const products: BrandProductLink[] = [
      {
        id: '1',
        title: 'Widget Pro',
        description: 'A solid widget for pros',
        pricing: '29',
        kind: 'Keyboards',
        featured: true,
        url: 'https://shop.example.com/products/widget-pro',
        imageUrl: 'https://cdn.example.com/widget.jpg'
      },
      {
        id: '2',
        title: 'No Link Item',
        description: null,
        pricing: null,
        kind: 'product',
        featured: false,
        url: null,
        imageUrl: null
      }
    ];
    const out = formatProductsList(products);
    expect(out).toContain('Widget Pro');
    expect(out).toContain('→ https://shop.example.com/products/widget-pro');
    expect(out).toContain('img=https://cdn.example.com/widget.jpg');
    expect(out).toContain('★ featured');
    expect(out).toContain('(no page URL)');
  });
});
