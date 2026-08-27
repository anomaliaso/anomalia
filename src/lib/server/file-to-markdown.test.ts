import { describe, it, expect } from 'vitest';
import { convertWithMarkitdown, convertFileToMarkdown } from './file-to-markdown';

function textBuf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

describe('convertWithMarkitdown', () => {
  it('turns HTML into markdown headings and lists', async () => {
    const { markdown, title } = await convertWithMarkitdown(
      textBuf('<html><head><title>Brief</title></head><body><h1>Brand brief</h1><p>30 days.</p></body></html>'),
      'text/html',
      'brief.html'
    );
    expect(markdown).toMatch(/Brand brief/);
    expect(markdown).toMatch(/30 days/);
    expect(title === null || typeof title === 'string').toBe(true);
  });
});

describe('convertFileToMarkdown', () => {
  it('keeps txt pass-through (does not require markitdown)', async () => {
    const { markdown } = await convertFileToMarkdown(textBuf('Hello\r\nWorld'), 'text/plain', 'n.txt');
    expect(markdown).toBe('Hello\nWorld');
  });

  it('rejects images', async () => {
    await expect(
      convertFileToMarkdown(textBuf('not an image'), 'image/png', 'shot.png')
    ).rejects.toThrow(/Unsupported/);
  });
});
