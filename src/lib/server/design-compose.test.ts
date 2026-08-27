import { describe, expect, it } from 'vitest';
import { withBrandKitLogos } from './design-compose';

describe('withBrandKitLogos', () => {
  it('prepends brand logo as ref:0 and keeps other images after', () => {
    const out = withBrandKitLogos(
      [
        { url: 'https://cdn.example.com/shot.jpg', label: 'media library' },
        { url: 'https://cdn.example.com/ai.png', label: 'ai generated' }
      ],
      {
        logos: [{ url: 'https://cdn.example.com/logo.png', type: 'uploaded' }],
        favicon_url: 'https://cdn.example.com/favicon.png'
      }
    );
    expect(out.map((i) => i.label)).toEqual([
      'brand logo',
      'brand favicon',
      'media library',
      'ai generated'
    ]);
    expect(out[0]?.url).toBe('https://cdn.example.com/logo.png');
  });

  it('skips og-image logos and dedupes when the logo was already passed', () => {
    const logo = 'https://cdn.example.com/logo.png';
    const out = withBrandKitLogos([{ url: logo, label: 'attachment' }], {
      logos: [
        { url: 'https://cdn.example.com/og.png', type: 'og-image' },
        { url: logo, type: 'uploaded' }
      ]
    });
    expect(out).toEqual([{ url: logo, label: 'brand logo' }]);
  });

  it('returns images unchanged when the kit has no logo', () => {
    const imgs = [{ url: 'https://cdn.example.com/a.jpg', label: 'media library' }];
    expect(withBrandKitLogos(imgs, { logos: [] })).toEqual(imgs);
    expect(withBrandKitLogos(imgs, null)).toEqual(imgs);
  });
});
