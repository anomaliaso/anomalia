import { describe, it, expect } from 'vitest';
import {
  attachedDocNamesFromContent,
  chatConvertMarkdownPath,
  chatConvertStoragePrefix,
  chatDocumentRefs,
  formatAttachedDocsBlock,
  formatAttachedDocsForModel,
  attachmentOutline,
  summarizeAttachmentMarkdown,
  isChatConvertMarkdownPath,
  isChatConvertStoragePath,
  isConvertibleDocument,
  isImageOrMediaFile,
  isReadyChatDoc,
  matchTurnDocument,
  packChatChunks,
  parseChatDocuments,
  splitMarkdownIntoChatChunks,
  stripAttachedDocsForDisplay,
  truncateMarkdown
} from './chat-documents';

describe('isConvertibleDocument', () => {
  it('accepts office and text files', () => {
    expect(isConvertibleDocument('application/pdf', 'a.pdf')).toBe(true);
    expect(isConvertibleDocument('', 'brief.docx')).toBe(true);
    expect(isConvertibleDocument('', 'sheet.xlsx')).toBe(true);
    expect(isConvertibleDocument('text/html', 'page.html')).toBe(true);
    expect(isConvertibleDocument('', 'archive.zip')).toBe(true);
  });

  it('rejects images and video', () => {
    expect(isConvertibleDocument('image/jpeg', 'pic.jpg')).toBe(false);
    expect(isConvertibleDocument('video/mp4', 'clip.mp4')).toBe(false);
    expect(isImageOrMediaFile('image/png', 'x.png')).toBe(true);
  });
});

describe('chat convert storage path', () => {
  it('only accepts this user/brand chat-convert prefix', () => {
    expect(chatConvertStoragePrefix('u1', 'b1')).toBe('u1/b1/chat-convert/');
    expect(isChatConvertStoragePath('u1/b1/chat-convert/abc.pdf', 'u1', 'b1')).toBe(true);
    expect(isChatConvertStoragePath('u1/b1/other/abc.pdf', 'u1', 'b1')).toBe(false);
    expect(isChatConvertStoragePath('u2/b1/chat-convert/abc.pdf', 'u1', 'b1')).toBe(false);
    expect(isChatConvertStoragePath('u1/b1/chat-convert/', 'u1', 'b1')).toBe(false);
    expect(isChatConvertStoragePath('u1/b1/chat-convert/../x.pdf', 'u1', 'b1')).toBe(false);
    expect(chatConvertMarkdownPath('u1/b1/chat-convert/abc.pdf')).toBe('u1/b1/chat-convert/abc.pdf.md');
    expect(isChatConvertMarkdownPath('u1/b1/chat-convert/abc.pdf.md', 'u1', 'b1')).toBe(true);
    expect(isChatConvertMarkdownPath('u1/b1/chat-convert/abc.pdf', 'u1', 'b1')).toBe(false);
  });
});

describe('truncateMarkdown', () => {
  it('leaves short text alone', () => {
    expect(truncateMarkdown('hello', 80)).toEqual({
      markdown: 'hello',
      truncated: false,
      originalChars: 5
    });
  });

  it('cuts long text and flags truncation', () => {
    const { markdown, truncated, originalChars } = truncateMarkdown('abcdefghij', 4);
    expect(truncated).toBe(true);
    expect(originalChars).toBe(10);
    expect(markdown.startsWith('abcd')).toBe(true);
  });
});

describe('attached document block', () => {
  it('round-trips names and strips the block for display', () => {
    const block = formatAttachedDocsBlock(
      [{ name: 'brief.pdf', markdown: 'Hello world', title: 'Brief' }],
      80_000
    );
    const content = `Please read this.${block}`;
    expect(stripAttachedDocsForDisplay(content)).toBe('Please read this.');
    expect(attachedDocNamesFromContent(content)).toEqual(['brief.pdf']);
    expect(block).toContain('Hello world');
    expect(block).not.toContain('Chunk 1/1');
  });

  it('parses a documents payload and matches from_attachment', () => {
    const docs = parseChatDocuments([
      { name: 'Q4-brief.pdf', markdown: 'full text', title: 'Q4' },
      { name: '', markdown: 'skip' },
      { markdown: 'no name' }
    ]);
    expect(docs).toHaveLength(1);
    expect(matchTurnDocument(docs, 'Q4-brief.pdf')?.markdown).toBe('full text');
    expect(matchTurnDocument(docs, 'brief.pdf')?.name).toBe('Q4-brief.pdf');
    expect(matchTurnDocument(docs, 'missing.docx')).toBeUndefined();
  });

  it('accepts a Storage path without inline markdown', () => {
    const docs = parseChatDocuments([
      { name: 'huge.pdf', path: 'u1/b1/chat-convert/x.pdf.md', title: 'Huge' }
    ]);
    expect(docs).toEqual([
      { name: 'huge.pdf', markdown: '', title: 'Huge', path: 'u1/b1/chat-convert/x.pdf.md' }
    ]);
    expect(isReadyChatDoc(docs[0])).toBe(true);
    expect(chatDocumentRefs(docs)).toEqual([
      { name: 'huge.pdf', title: 'Huge', path: 'u1/b1/chat-convert/x.pdf.md', markdown: '' }
    ]);
  });
});

describe('splitMarkdownIntoChatChunks', () => {
  it('keeps a short doc as a single chunk', () => {
    expect(splitMarkdownIntoChatChunks('Hello world', 100)).toEqual(['Hello world']);
  });

  it('splits on headings and keeps every section', () => {
    const md = `## One\n\n${'a'.repeat(80)}\n\n## Two\n\n${'b'.repeat(80)}`;
    const chunks = splitMarkdownIntoChatChunks(md, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join('\n')).toContain('## One');
    expect(chunks.join('\n')).toContain('## Two');
    expect(chunks.join('')).toContain('a'.repeat(80));
    expect(chunks.join('')).toContain('b'.repeat(80));
  });
});

describe('packChatChunks', () => {
  it('includes every chunk when they fit', () => {
    const packed = packChatChunks(['AAA', 'BBB', 'CCC'], 10_000);
    expect(packed.chunkCount).toBe(3);
    expect(packed.shortened).toBe(false);
    expect(packed.markdown).toContain('Chunk 1/3');
    expect(packed.markdown).toContain('Chunk 3/3');
    expect(packed.markdown).toContain('AAA');
    expect(packed.markdown).toContain('CCC');
  });

  it('keeps every chunk when over budget (fair share, not head-only)', () => {
    const chunks = ['AAAA'.repeat(50), 'BBBB'.repeat(50), 'CCCC'.repeat(50), 'DDDD'.repeat(50)];
    const packed = packChatChunks(chunks, 400);
    expect(packed.shortened).toBe(true);
    expect(packed.chunkCount).toBe(4);
    expect(packed.markdown.length).toBeLessThanOrEqual(400);
    expect(packed.markdown).toContain('Chunk 1/4');
    expect(packed.markdown).toContain('Chunk 4/4');
    expect(packed.markdown).toContain('AAAA');
    expect(packed.markdown).toContain('DDDD');
  });

  it('formatAttachedDocsBlock labels chunks on a long multi-section doc', () => {
    const md = `## Alpha\n\n${'x'.repeat(4000)}\n\n## Omega\n\n${'y'.repeat(4000)}`;
    const block = formatAttachedDocsBlock([{ name: 'big.pdf', markdown: md }], 80_000);
    expect(block).toContain('Chunk 1/');
    expect(block).toContain('## Alpha');
    expect(block).toContain('## Omega');
    expect(attachedDocNamesFromContent(block)).toEqual(['big.pdf']);
  });

  it('keeps the start and the end of a long file under a tight cap', () => {
    const md = `## Alpha\n\n${'STARTMARKER '.repeat(800)}\n\n## Omega\n\n${'ENDMARKER '.repeat(800)}`;
    const block = formatAttachedDocsBlock([{ name: 'big.pdf', markdown: md }], 2_000);
    expect(block).toContain('Alpha');
    expect(block).toContain('Omega');
    expect(block).toContain('STARTMARKER');
    expect(block).toContain('ENDMARKER');
    expect(attachedDocNamesFromContent(block)).toEqual(['big.pdf']);
  });
});

describe('formatAttachedDocsForModel', () => {
  it('inlines a short file', () => {
    const block = formatAttachedDocsForModel([{ name: 'note.md', markdown: 'Hello world' }]);
    expect(block).toContain('Hello world');
    expect(block).toContain('### note.md');
  });

  it('indexes a large file instead of dumping the body', () => {
    const md = `## Alpha\n\n${'UNIQUEBODY '.repeat(900)}\n\n## Omega\n\nENDMARKER`;
    expect(md.length).toBeGreaterThan(8_000);
    const block = formatAttachedDocsForModel([{ name: 'huge.pdf', markdown: md, title: 'Huge' }]);
    expect(block).toContain('grep_attachment');
    expect(block).toContain('read_attachment');
    expect(block).toContain('## Alpha  @');
    expect(block).toContain('## Omega  @');
    expect(block).not.toContain('UNIQUEBODY UNIQUEBODY UNIQUEBODY');
    expect(block.length).toBeLessThan(md.length);
  });

  it('attachmentOutline records char indexes', () => {
    const md = `## One\n\nAAA\n\n## Two\n\nBBB`;
    const outline = attachmentOutline(md);
    expect(outline.some((h) => h.heading === '## One' && h.index === 0)).toBe(true);
    expect(outline.some((h) => h.heading === '## Two' && h.index > 0)).toBe(true);
    const sum = summarizeAttachmentMarkdown(md);
    expect(sum.chars).toBe(md.length);
    expect(sum.headings.some((h) => h.excerpt.includes('BBB'))).toBe(true);
  });
});
