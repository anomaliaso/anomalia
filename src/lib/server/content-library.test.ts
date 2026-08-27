import { describe, it, expect } from 'vitest';
import { parseSitemapLocs, selectLinkableUrls } from './content-library';

describe('parseSitemapLocs', () => {
  it('extracts and trims <loc> URLs, ignoring other tags', () => {
    const xml = `<urlset><url><loc> https://x.com/blog/a </loc><lastmod>2024</lastmod></url><url><loc>https://x.com/guide/b</loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(['https://x.com/blog/a', 'https://x.com/guide/b']);
  });
  it('returns [] on non-sitemap HTML', () => {
    expect(parseSitemapLocs('<html><body>nope</body></html>')).toEqual([]);
  });
});

describe('selectLinkableUrls', () => {
  it('keeps content pages regardless of taxonomy (wiki, root slugs, blog)', () => {
    const urls = [
      'https://x.co', 'https://x.co/en',                          // homepage + locale root → dropped
      'https://x.co/wiki/ddl-zan', 'https://x.co/en/wiki/ddl-zan', // canonical kept, /en dup dropped
      'https://x.co/giovani',                                      // root slug kept
      'https://x.co/blog/how-to',
      'https://x.co/privacy', 'https://x.co/newsletter'           // non-content → dropped
    ];
    expect(selectLinkableUrls(urls)).toEqual([
      'https://x.co/wiki/ddl-zan',
      'https://x.co/giovani',
      'https://x.co/blog/how-to'
    ]);
  });
  it('keeps a localized page when no canonical exists', () => {
    expect(selectLinkableUrls(['https://x.co/en/wiki/a'])).toEqual(['https://x.co/en/wiki/a']);
  });
});
