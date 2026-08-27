import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// L'host dello storage lo decide il test, non il `.env` di chi lo lancia: senza mock la suite è
// verde solo su una macchina con un progetto Supabase vero (`isOwnMediaUrl` pretende https) e
// rossa in CI, dove non c'è.
vi.mock('$env/static/public', async (originale) => ({
  ...((await originale()) as Record<string, string>),
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));

import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { decorateColorCodes, escapeChatText, renderMd } from './chat-markdown';

describe('decorateColorCodes', () => {
  it('wraps hex codes in a badge with swatch + label', () => {
    const html = decorateColorCodes('Primary #c485fe and short #fff');
    expect(html).toContain('class="chat-color-badge"');
    expect(html).toContain('data-color="#c485fe"');
    expect(html).toContain('chat-color-swatch');
    expect(html).toContain('<span class="chat-color-label">#c485fe</span>');
    expect(html).toContain('data-color="#fff"');
  });

  it('supports rgb and hsl', () => {
    const html = decorateColorCodes('rgb(196, 133, 254) hsl(280 70% 70%)');
    expect(html).toContain('data-color="rgb(196, 133, 254)"');
    expect(html).toContain('data-color="hsl(280 70% 70%)"');
  });

  it('does not rewrite colors inside HTML attributes', () => {
    const html = decorateColorCodes('<a href="/x#c485fe">go</a>');
    expect(html).toBe('<a href="/x#c485fe">go</a>');
  });

  it('decorates text inside tags', () => {
    const html = decorateColorCodes('<p>Use <code>#111111</code> please</p>');
    expect(html).toContain('data-color="#111111"');
    expect(html).toContain('chat-color-badge');
  });
});

describe('escapeChatText / renderMd', () => {
  it('decorates user plain text', () => {
    expect(escapeChatText('Accent #FF2D8F')).toContain('chat-color-badge');
  });

  it('decorates assistant markdown', () => {
    const html = renderMd('Brand color is **#c485fe**');
    expect(html).toContain('chat-color-badge');
    expect(html).toContain('<strong><button type="button" class="chat-color-badge"');
  });
});

describe('renderMd images', () => {
  const OURS = `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/public/media/u/a.png`;

  it('embeds an image that lives in our storage', () => {
    for (const md of [`![shot](${OURS})`, `look ![shot](${OURS}) here`]) {
      const html = renderMd(md);
      expect(html).toContain(`src="${OURS}"`);
      expect(html).toContain('chat-zoomable');
    }
  });

  it('never embeds a third-party URL — it degrades to a link, so nothing is fetched on render', () => {
    for (const md of ['![pixel](https://evil.example.com/p.png)', 'inline ![pixel](https://evil.example.com/p.png) here']) {
      const html = renderMd(md);
      expect(html).not.toContain('<img');
      expect(html).toContain('href="https://evil.example.com/p.png"');
    }
  });
});
