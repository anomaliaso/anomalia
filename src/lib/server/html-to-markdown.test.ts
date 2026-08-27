import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from './knowledge';

// Guards what the /*.md docs mirror depends on: the docs pages are Tailwind-heavy Svelte, so the
// conversion has to drop the chrome and keep code readable.
describe('htmlToMarkdown', () => {
  it('fences a bare <pre> and drops copy buttons, svg and scripts', async () => {
    const md = await htmlToMarkdown(`
      <h1>API</h1>
      <script>console.log('nope')</script>
      <div class="group">
        <button class="absolute">Copy</button>
        <svg viewBox="0 0 24 24"><path d="M18 13v6"/></svg>
        <pre>curl -H "Authorization: Bearer $TOKEN" \\
  https://anomalia.so/api/v1/brands</pre>
      </div>
      <table><thead><tr><th>Code</th></tr></thead><tbody><tr><td>401</td></tr></tbody></table>
    `);

    expect(md).toContain('# API');
    expect(md).toContain('```\ncurl -H "Authorization: Bearer $TOKEN" \\\n  https://anomalia.so/api/v1/brands\n```');
    expect(md).not.toContain('Copy');
    expect(md).not.toMatch(/nope|viewBox|<path/);
    expect(md).toContain('| Code |'); // gfm tables survive
  });

  it('keeps CSS-gapped inline siblings from colliding', async () => {
    const md = await htmlToMarkdown(
      '<div class="flex gap-2"><span>200</span><span>Array of brand summaries</span></div>'
    );
    expect(md).toBe('200 Array of brand summaries');
  });
});
