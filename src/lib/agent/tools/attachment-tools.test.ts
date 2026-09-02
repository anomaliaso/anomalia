import { describe, it, expect } from 'vitest';
import { createAttachmentTools } from './attachment-tools';

const longMd = `## Alpha\n\n${'UNIQUEBODY '.repeat(900)}\n\n## Omega\n\nENDMARKER here`;

describe('createAttachmentTools', () => {
  const tools = createAttachmentTools([{ name: 'huge.pdf', markdown: longMd, title: 'Huge' }]);

  it('summarize_attachment returns heading indexes without the full body', async () => {
    const out = (await tools.summarize_attachment.execute({})) as {
      file: string;
      chars: number;
      headings: Array<{ heading: string; index: number; excerpt: string }>;
    };
    expect(out.file).toBe('huge.pdf');
    expect(out.chars).toBe(longMd.length);
    expect(out.headings.some((h) => h.heading.includes('Omega'))).toBe(true);
    expect(out.headings.every((h) => h.excerpt.length <= 180)).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(longMd.length / 2);
  });

  it('grep_attachment returns a char index for read_attachment', async () => {
    const g = (await tools.grep_attachment.execute({ query: 'ENDMARKER' })) as {
      files: Array<{ file: string; total: number; matches: Array<{ index: number }> }>;
    };
    expect(g.files[0].total).toBe(1);
    const start = g.files[0].matches[0].index;
    const page = (await tools.read_attachment.execute({ start_from: start, max_chars: 40 })) as {
      source: string;
      start: number;
      next_start: number | null;
    };
    expect(page.source).toContain('ENDMARKER');
    expect(page.source.length).toBeLessThanOrEqual(40);
  });

  it('read_attachment pages with next_start', async () => {
    const page = (await tools.read_attachment.execute({ start_from: 0, max_chars: 80 })) as {
      source: string;
      next_start: number | null;
      total: number;
    };
    expect(page.source.length).toBe(80);
    expect(page.next_start).toBe(80);
    expect(page.total).toBe(longMd.length);
  });

  it('errors when no files are attached', async () => {
    const empty = createAttachmentTools([]);
    const out = await empty.grep_attachment.execute({ query: 'x' });
    expect(out).toEqual({ error: 'No files attached this turn.' });
  });
});
