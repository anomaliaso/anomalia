import { describe, expect, it } from 'vitest';
import { GET_STUDIO, STUDIO_DOCUMENT_MODES } from './reads';

describe('il contratto dello studio', () => {
  it('dichiara i due modi, e nessun altro', () => {
    expect([...STUDIO_DOCUMENT_MODES]).toEqual(['index', 'full']);
    for (const documents of STUDIO_DOCUMENT_MODES) {
      expect(GET_STUDIO.input.safeParse({ documents }).success, documents).toBe(true);
    }
    expect(GET_STUDIO.input.safeParse({ documents: 'tutto' }).success).toBe(false);
  });

  it('si chiama ancora senza argomenti: il difetto è `index`', () => {
    expect(GET_STUDIO.input.safeParse({}).success).toBe(true);
  });

  /** `content_text` non è più garantito, `textBytes` sì: è quello che dice che il testo esiste. */
  it('il testo è opzionale, il suo peso no', () => {
    const withoutText = GET_STUDIO.output.shape.documents.element.safeParse({
      id: 'd1',
      kind: 'document',
      title: 'Contratto',
      file_url: null,
      file_name: 'c.pdf',
      mime_type: 'application/pdf',
      created_at: '2026-08-01T00:00:00Z',
      status: 'ready',
      chunkCount: 9,
      textBytes: 2600
    });
    expect(withoutText.success).toBe(true);

    const withoutBytes = GET_STUDIO.output.shape.documents.element.safeParse({
      id: 'd1',
      kind: 'document',
      title: 'Contratto',
      file_url: null,
      file_name: null,
      mime_type: null,
      created_at: '2026-08-01T00:00:00Z',
      status: 'ready',
      chunkCount: 9
    });
    expect(withoutBytes.success).toBe(false);
  });

  it('manda a `search_knowledge` invece che al corpus intero', () => {
    expect(GET_STUDIO.description).toContain('search_knowledge');
    expect(GET_STUDIO.description).toContain('NOT included');
  });
});
