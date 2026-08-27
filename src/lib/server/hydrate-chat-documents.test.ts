import { describe, it, expect } from 'vitest';
import { hydrateChatDocuments } from './hydrate-chat-documents';

function fakeStorage(files: Record<string, string>) {
  return {
    storage: {
      from() {
        return {
          async download(path: string) {
            const text = files[path];
            if (text == null) return { data: null, error: { message: 'missing' } };
            return { data: new Blob([text]), error: null };
          }
        };
      }
    }
  };
}

describe('hydrateChatDocuments', () => {
  it('keeps inline markdown without hitting storage', async () => {
    const docs = await hydrateChatDocuments(fakeStorage({}) as never, 'u1', 'b1', [
      { name: 'a.pdf', markdown: 'inline' }
    ]);
    expect(docs).toEqual([{ name: 'a.pdf', markdown: 'inline' }]);
  });

  it('loads markdown from a chat-convert .md path', async () => {
    const path = 'u1/b1/chat-convert/abc.pdf.md';
    const docs = await hydrateChatDocuments(
      fakeStorage({ [path]: '  hello from storage  ' }) as never,
      'u1',
      'b1',
      [{ name: 'abc.pdf', markdown: '', path }]
    );
    expect(docs).toEqual([{ name: 'abc.pdf', markdown: 'hello from storage', path }]);
  });

  it('ignores paths outside this user/brand chat-convert prefix', async () => {
    const path = 'u2/b1/chat-convert/x.md';
    const docs = await hydrateChatDocuments(
      fakeStorage({ [path]: 'nope' }) as never,
      'u1',
      'b1',
      [{ name: 'x.pdf', markdown: '', path }]
    );
    expect(docs).toEqual([]);
  });

  it('ignores the original binary path (must be .md)', async () => {
    const path = 'u1/b1/chat-convert/abc.pdf';
    const docs = await hydrateChatDocuments(
      fakeStorage({ [path]: '%PDF' }) as never,
      'u1',
      'b1',
      [{ name: 'abc.pdf', markdown: '', path }]
    );
    expect(docs).toEqual([]);
  });
});
