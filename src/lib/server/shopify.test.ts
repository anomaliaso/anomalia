import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeStore, publishArticle, getBlogs } from './shopify';

afterEach(() => vi.restoreAllMocks());

describe('normalizeStore', () => {
  it('strips protocol, .myshopify.com and paths', () => {
    expect(normalizeStore('na70yq-bn')).toBe('na70yq-bn');
    expect(normalizeStore('NA70YQ-BN.myshopify.com')).toBe('na70yq-bn');
    expect(normalizeStore(' https://na70yq-bn.myshopify.com/admin ')).toBe('na70yq-bn');
  });
});

const conn = { store: 'shop', clientId: 'id', clientSecret: 'secret', blogId: 'gid://shopify/Blog/1', author: 'Anomalia' };

// Mock fetch: token exchange first, then the GraphQL call.
function mockFetch(...responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce({ ok: true, json: async () => r });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('publishArticle', () => {
  it('exchanges the token, posts markdown as html, and returns the article id', async () => {
    const fetchMock = mockFetch(
      { access_token: 'tok' },
      { data: { articleCreate: { article: { id: 'gid://shopify/Article/9', handle: 'my-post' }, userErrors: [] } } }
    );
    const id = await publishArticle(conn, { title: 'Hi', bodyMd: '# Hello\n\nBody', summary: 'meta', published: true });
    expect(id).toBe('gid://shopify/Article/9');

    const [tokenUrl] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://shop.myshopify.com/admin/oauth/access_token');
    const gqlBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(gqlBody.variables.article.body).toContain('<h1>Hello</h1>'); // markdown → html
    expect(gqlBody.variables.article.author).toEqual({ name: 'Anomalia' });
    expect(fetchMock.mock.calls[1][1].headers['X-Shopify-Access-Token']).toBe('tok');
  });

  it('surfaces Shopify userErrors', async () => {
    mockFetch(
      { access_token: 'tok' },
      { data: { articleCreate: { article: null, userErrors: [{ field: 'title', message: 'is blank' }] } } }
    );
    await expect(publishArticle(conn, { title: '', bodyMd: 'x', published: false })).rejects.toThrow('is blank');
  });

  it('reuses a stored access_token without exchanging', async () => {
    const fetchMock = mockFetch({ data: { articleCreate: { article: { id: 'gid://shopify/Article/2' }, userErrors: [] } } });
    await publishArticle({ ...conn, accessToken: 'stored' }, { title: 'T', bodyMd: 'b', published: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no token exchange
    expect(fetchMock.mock.calls[0][1].headers['X-Shopify-Access-Token']).toBe('stored');
  });
});

describe('getBlogs', () => {
  it('flattens the graphql edges', async () => {
    mockFetch(
      { access_token: 'tok' },
      { data: { blogs: { edges: [{ node: { id: 'gid://shopify/Blog/1', title: 'News' } }] } } }
    );
    expect(await getBlogs(conn)).toEqual([{ id: 'gid://shopify/Blog/1', title: 'News' }]);
  });
});
