import { describe, expect, it } from 'vitest';
import { renderArticleHtml } from './blog-site';

// renderArticleHtml must ESCAPE raw HTML (not filter it): denylists are bypassable
// (single-quote handlers, entity-encoded schemes, object/embed/svg payloads).
const XSS_PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  "<img src=x onerror='alert(1)'>",
  '<img src=x onerror=&#97;lert(1)>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<svg onload="alert(1)">',
  '<object data="data:text/html,<svg onload=alert(1)>"></object>',
  '<details open ontoggle=alert(1)>',
  '<input autofocus onfocus=alert(1)>'
];

describe('renderArticleHtml — XSS hardening', () => {
  it('never emits executable markup for raw-HTML payloads', () => {
    for (const p of XSS_PAYLOADS) {
      const out = renderArticleHtml(p);
      // The output must be inert text: no REAL opening tag survives (escaped text shows
      // as &lt;img…, which is safe to display). "onerror=…" as escaped text is fine.
      expect(out, `payload should be neutralized: ${p}`).not.toMatch(/<(script|svg|object|embed|iframe|details|input)([\s>])/i);
      // The raw HTML must survive as escaped TEXT (visible, inert)
      expect(out).toContain('&lt;');
    }
  });

  it('still renders markdown normally', () => {
    expect(renderArticleHtml('**bold** and [link](https://example.com)')).toContain('<strong>bold</strong>');
    expect(renderArticleHtml('**bold** and [link](https://example.com)')).toContain('href="https://example.com"');
  });

  it('escapes raw HTML inside a link label', () => {
    // The label used to be emitted as raw source markdown, so the <img> shipped live.
    const out = renderArticleHtml('[<img src=x onerror=alert(1)>](https://a.com)');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });

  it('cannot break out of the title/href attributes', () => {
    // A live handler needs an UNESCAPED quote after `on…=`; escaped (`on…=&quot;`) is inert text.
    const title = renderArticleHtml('[x](https://a.com "a\\" onmouseover=\\"alert(1)")');
    expect(title).not.toMatch(/\son\w+\s*=\s*["']/i);
    const href = renderArticleHtml('[x](#a">|<img src=x onerror=alert(1)>)');
    expect(href).not.toMatch(/<img/i);
    expect(href).not.toMatch(/\son\w+\s*=\s*["']/i);
  });

  it('neutralizes javascript:/data: markdown links', () => {
    expect(renderArticleHtml('[x](javascript:alert(1))')).not.toContain('javascript:');
    expect(renderArticleHtml('[x](java%73cript:alert(1))')).not.toMatch(/href="[^"]*script:/i);
    expect(renderArticleHtml('[x](data:text/html,<script>1</script>)')).not.toMatch(/href="[^"]*data:/i);
  });
});
