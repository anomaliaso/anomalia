import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectFields, publishArticle, getCollections } from './webflow';

afterEach(() => vi.restoreAllMocks());

const fields = [
  { slug: 'name', displayName: 'Name', type: 'PlainText' },
  { slug: 'post-body', displayName: 'Post Body', type: 'RichText' },
  { slug: 'post-summary', displayName: 'Summary', type: 'PlainText' },
  { slug: 'color', displayName: 'Color', type: 'PlainText' }
];

describe('detectFields', () => {
  it('picks the first RichText as body and a description-like PlainText as summary', () => {
    expect(detectFields(fields)).toEqual({ bodySlug: 'post-body', summarySlug: 'post-summary' });
  });
  it('returns no body slug when there is no RichText field', () => {
    expect(detectFields([{ slug: 'name', displayName: 'Name', type: 'PlainText' }]).bodySlug).toBeUndefined();
  });
});

function mockFetch(...responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce({ ok: true, json: async () => r });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const conn = { token: 'tok', siteId: 's1', collectionId: 'c1' };

describe('publishArticle', () => {
  it('creates a live item, maps body to the detected RichText field, returns the id', async () => {
    const fetchMock = mockFetch({ fields }, { id: 'item_1', fieldData: {} });
    const id = await publishArticle(conn, { title: 'Hi', bodyMd: '# Hello\n\nBody', handle: 'hi', summary: 'meta', published: true });
    expect(id).toBe('item_1');

    const [fieldsUrl] = fetchMock.mock.calls[0];
    expect(fieldsUrl).toBe('https://api.webflow.com/v2/collections/c1');
    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toBe('https://api.webflow.com/v2/collections/c1/items/live'); // live path
    const body = JSON.parse(createInit.body);
    expect(body.fieldData.name).toBe('Hi');
    expect(body.fieldData.slug).toBe('hi');
    expect(body.fieldData['post-body']).toContain('<h1>Hello</h1>'); // markdown → html into RichText
    expect(body.fieldData['post-summary']).toBe('meta');
    expect(body.isDraft).toBe(false);
  });

  it('updates an existing item via PATCH when given an item id', async () => {
    const fetchMock = mockFetch({ fields }, { id: 'item_1' });
    await publishArticle(conn, { title: 'T', bodyMd: 'b', handle: 't', published: false }, 'item_1');
    const [url, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe('PATCH');
    expect(url).toBe('https://api.webflow.com/v2/collections/c1/items/item_1'); // draft → no /live
  });
});

describe('getCollections', () => {
  it('flattens the collections list', async () => {
    mockFetch({ collections: [{ id: 'c1', displayName: 'Blog Posts' }] });
    expect(await getCollections('tok', 's1')).toEqual([{ id: 'c1', name: 'Blog Posts' }]);
  });
});
