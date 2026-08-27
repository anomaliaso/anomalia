import { describe, it, expect, vi, afterEach } from 'vitest';
import { markdownToRicos, publishArticle } from './wix';

afterEach(() => vi.restoreAllMocks());

describe('markdownToRicos', () => {
  it('maps headings, paragraphs, links and lists to Ricos nodes', () => {
    const { nodes } = markdownToRicos(`## Section one\n\nIntro with a [link](https://x.com) and **bold**.\n\n- first\n- second`);
    expect(nodes[0]).toMatchObject({ type: 'HEADING', headingData: { level: 2 } });

    const para = nodes[1] as { type: string; nodes: { type: string; textData: { text: string; decorations: unknown[] } }[] };
    expect(para.type).toBe('PARAGRAPH');
    const link = para.nodes.find((t) => t.textData.text === 'link');
    expect(link?.textData.decorations[0]).toMatchObject({ type: 'LINK', linkData: { link: { url: 'https://x.com' } } });
    expect(para.nodes.find((t) => t.textData.text === 'bold')?.textData.decorations[0]).toMatchObject({ type: 'BOLD' });

    const list = nodes[2] as { type: string; nodes: unknown[] };
    expect(list.type).toBe('BULLETED_LIST');
    expect(list.nodes).toHaveLength(2);
  });

  it('drops image lines and code fences, keeps unique block ids', () => {
    const { nodes } = markdownToRicos('![alt](https://img/x.png)\n\nReal paragraph.\n\n```\ncode\n```');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'PARAGRAPH', id: 'n1' });
  });
});

function mockFetch(...responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => r });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const conn = { apiKey: 'key', siteId: 'site1' };

describe('publishArticle', () => {
  it('creates a draft then publishes it, returning the id, with auth + site headers', async () => {
    const fetchMock = mockFetch({ draftPost: { id: 'draft_1' } }, {});
    const id = await publishArticle(conn, { title: 'Hi', bodyMd: '## H\n\nBody', published: true });
    expect(id).toBe('draft_1');

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('https://www.wixapis.com/blog/v3/draft-posts');
    expect(createInit.headers.Authorization).toBe('key');
    expect(createInit.headers['wix-site-id']).toBe('site1');
    expect(JSON.parse(createInit.body).draftPost.richContent.nodes[0].type).toBe('HEADING');

    const [publishUrl] = fetchMock.mock.calls[1];
    expect(publishUrl).toBe('https://www.wixapis.com/blog/v3/draft-posts/draft_1/publish');
  });

  it('does not call publish when saving as draft', async () => {
    const fetchMock = mockFetch({ draftPost: { id: 'draft_2' } });
    await publishArticle(conn, { title: 'T', bodyMd: 'b', published: false });
    expect(fetchMock).toHaveBeenCalledTimes(1); // create only
  });
});
