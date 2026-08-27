import { describe, it, expect } from 'vitest';
import { spliceImageUnderHeading } from './content-preview';

// The batch collector applies images by HEADING TEXT, not by a stored line number: the manifest is
// written when the batch is submitted and read back up to 24h later, by which time the body may have
// been edited. A line index would have silently pasted images into the wrong section.
describe('spliceImageUnderHeading (batch image collector)', () => {
  const body = ['Intro paragraph.', '', '## Primo', 'testo uno', '', '## Secondo', 'testo due'].join('\n');

  it('inserts the image right under the matching H2', () => {
    const out = spliceImageUnderHeading(body, 'Secondo', 'https://cdn/x.jpg');
    expect(out).toContain('## Secondo\n\n![Secondo](https://cdn/x.jpg)\n');
    // The other section is untouched.
    expect(out).toContain('## Primo\ntesto uno');
  });

  it('uses the heading as alt text, satisfying the score alt-text check', () => {
    expect(spliceImageUnderHeading(body, 'Primo', 'u')).toContain('![Primo](u)');
  });

  it('is a no-op when the heading no longer exists (body edited after submit)', () => {
    expect(spliceImageUnderHeading(body, 'Terzo', 'u')).toBe(body);
  });

  it('is a no-op when the section already has an image (never double-illustrates)', () => {
    const already = '## Primo\n\n![Primo](old.jpg)\n\ntesto';
    expect(spliceImageUnderHeading(already, 'Primo', 'new.jpg')).toBe(already);
  });

  it('matches the heading exactly, not by prefix', () => {
    const b = '## Prezzi\ntesto\n\n## Prezzi e sconti\naltro';
    const out = spliceImageUnderHeading(b, 'Prezzi e sconti', 'u');
    expect(out).toContain('## Prezzi e sconti\n\n![Prezzi e sconti](u)\n');
    expect(out).toContain('## Prezzi\ntesto');
  });

  it('survives a heading with trailing whitespace in the body', () => {
    expect(spliceImageUnderHeading('## Primo   \ntesto', 'Primo', 'u')).toContain('![Primo](u)');
  });
});
