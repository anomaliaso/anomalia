import { describe, it, expect } from 'vitest';
import { chunkMarkdown, detectLang, reciprocalRankFusion, toMarkdown, isSupportedKnowledgeDoc } from './knowledge';

function textBuf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

describe('reciprocalRankFusion', () => {
  it('boosts ids that appear in multiple ranked lists', () => {
    const scores = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['c', 'a', 'd']
    ]);
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!);
    expect(scores.get('a')!).toBeGreaterThan(scores.get('d')!);
    expect(scores.get('c')!).toBeGreaterThan(scores.get('b')!);
  });

  it('uses 1/(k+rank+1) with default k=60', () => {
    const scores = reciprocalRankFusion([['only']]);
    expect(scores.get('only')).toBeCloseTo(1 / 61, 10);
  });
});

describe('chunkMarkdown', () => {
  it('returns nothing for empty input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n  ')).toEqual([]);
  });

  it('tracks nested heading paths per chunk', () => {
    const md = `# Doc\n\n## Returns\n\n${'A'.repeat(250)}\n\n## Shipping\n\n${'B'.repeat(250)}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toBe('Doc > Returns');
    expect(chunks[0].content).toBe('A'.repeat(250));
    expect(chunks[1].headingPath).toBe('Doc > Shipping');
    expect(chunks[1].content).toBe('B'.repeat(250));
    expect(chunks.map((c) => c.idx)).toEqual([0, 1]);
  });

  it('splits a long section into multiple chunks with overlap', () => {
    const para = (ch: string) => ch.repeat(40);
    const body = [para('a'), para('b'), para('c'), para('d'), para('e')].join('\n\n');
    const md = `# Doc\n\n${body}`;
    const chunks = chunkMarkdown(md, { target: 25 }); // targetChars = 25 * 4 = 100

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.headingPath).toBe('Doc');
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));

    // Each chunk after the first repeats the LAST paragraph of the previous piece (overlap=1):
    // pieces batch as [a+b, c+d, e], so chunk[1] carries 'b' (piece[0]'s last paragraph) forward.
    expect(chunks[1].content).toContain(para('b'));
  });

  it('supports disabling overlap', () => {
    const para = (ch: string) => ch.repeat(40);
    const body = [para('a'), para('b'), para('c'), para('d'), para('e')].join('\n\n');
    const md = `# Doc\n\n${body}`;
    const chunks = chunkMarkdown(md, { target: 25, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // Without overlap the second piece carries none of the first piece's paragraphs forward.
    expect(chunks[1].content).not.toContain(para('b'));
  });

  it('merges micro-sections (<200 chars) into the following section', () => {
    const md = '# Doc\n\n## A\n\nShort.\n\n## B\n\nAnother short one.';
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('Doc > B');
    expect(chunks[0].content).toContain('Short.');
    expect(chunks[0].content).toContain('Another short one.');
  });

  it('never merges a lone section regardless of length', () => {
    const md = '# Doc\n\nTiny.';
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('Doc');
    expect(chunks[0].content).toBe('Tiny.');
  });

  it('estimates tokens from content length', () => {
    const md = '# Doc\n\n' + 'x'.repeat(400);
    const [chunk] = chunkMarkdown(md);
    expect(chunk.tokens).toBe(Math.ceil(400 / 4));
  });
});

describe('toMarkdown', () => {
  it('passes .txt files through with normalized newlines', async () => {
    const { markdown } = await toMarkdown(textBuf('Hello\r\nWorld  '), 'text/plain', 'notes.txt');
    expect(markdown).toBe('Hello\nWorld');
  });

  it('passes .md files through unchanged (modulo whitespace trim)', async () => {
    const { markdown } = await toMarkdown(textBuf('# Title\r\n\r\nBody text.\n'), 'text/markdown', 'doc.md');
    expect(markdown).toBe('# Title\n\nBody text.');
  });

  it('converts .csv to a markdown table', async () => {
    const { markdown } = await toMarkdown(textBuf('a,b\n1,2\n3,4'), 'text/csv', 'data.csv');
    expect(markdown).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
  });

  it('truncates large CSVs and notes the truncation', async () => {
    const rows = ['h1,h2', ...Array.from({ length: 250 }, (_, i) => `${i},${i}`)];
    const { markdown } = await toMarkdown(textBuf(rows.join('\n')), 'text/csv', 'big.csv');
    expect(markdown).toContain('Truncated: showing first 50 of 251 rows.');
  });

  it('converts HTML via markitdown-ts (or turndown fallback)', async () => {
    const { markdown } = await toMarkdown(
      textBuf('<html><body><h1>Hello</h1><p>World</p></body></html>'),
      'text/html',
      'page.html'
    );
    expect(markdown).toMatch(/Hello/);
    expect(markdown).toMatch(/World/);
  });
});

describe('detectLang (picks the Postgres FTS config)', () => {
  const it_ = `Il presente manuale descrive le condizioni di reso per i prodotti che sono stati
    acquistati con la garanzia. Non è possibile richiedere il rimborso per gli articoli in saldo,
    anche se il cliente non ha aperto la confezione. Per ogni ordine il termine è di trenta giorni.`;
  const en_ = `This manual describes the return conditions for the products that are covered by the
    warranty. It is not possible to request a refund for the items on sale, even if the customer has
    not opened the package. For every order the deadline is thirty days from delivery.`;
  const es_ = `Este manual describe las condiciones de devolución para los productos que están
    cubiertos por la garantía. No es posible solicitar el reembolso de los artículos en oferta, y por
    cada pedido el plazo es de treinta días desde la entrega, sin más excepciones.`;
  const fr_ = `Ce manuel décrit les conditions de retour pour les produits qui sont couverts par la
    garantie. Il n'est pas possible de demander le remboursement des articles en solde, et pour
    chaque commande le délai est de trente jours à partir de la livraison, sans autres exceptions.`;

  it('detects Italian', () => expect(detectLang(it_)).toBe('it'));
  it('detects English', () => expect(detectLang(en_)).toBe('en'));
  it('detects Spanish', () => expect(detectLang(es_)).toBe('es'));
  it('detects French', () => expect(detectLang(fr_)).toBe('fr'));

  it('falls back to en on text too short to judge', () => {
    expect(detectLang('ciao')).toBe('en');
    expect(detectLang('')).toBe('en');
  });

  it('ignores punctuation, numbers and casing', () => {
    expect(detectLang(it_.toUpperCase().replace(/[aeiou]/g, (c) => c))).toBe('it');
  });
});

describe('isSupportedKnowledgeDoc', () => {
  it('accepts PDF, Word, Excel and text formats', () => {
    expect(isSupportedKnowledgeDoc('application/pdf', 'a.pdf')).toBe(true);
    expect(isSupportedKnowledgeDoc('', 'brief.docx')).toBe(true);
    expect(isSupportedKnowledgeDoc('', 'sheet.xlsx')).toBe(true);
    expect(isSupportedKnowledgeDoc('text/plain', 'notes.txt')).toBe(true);
  });

  it('rejects images, video and zip in the knowledge corpus', () => {
    expect(isSupportedKnowledgeDoc('image/png', 'shot.png')).toBe(false);
    expect(isSupportedKnowledgeDoc('video/mp4', 'clip.mp4')).toBe(false);
    expect(isSupportedKnowledgeDoc('application/zip', 'pack.zip')).toBe(false);
  });
});
