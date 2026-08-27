import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: {
    COMPOSIO_API_KEY: 'ck_test'
  }
}));

import {
  isDriveIngestible,
  driveExportMime,
  driveFilesByIdsQuery,
  driveFilesInFoldersQuery,
  driveLiveSearchAmongIdsQuery,
  parseDriveFileList,
  parseDriveFolderList
} from './knowledge-connectors/drive';
import { notionBlockToMarkdown, notionBlocksToMarkdown, notionItemInScope, parseNotionPickerResults, parseNotionSearch, selectedNotionIdSet } from './knowledge-connectors/notion';
import {
  decodeGithubFileContent,
  githubFileExternalId,
  githubRepoFromExternalId,
  isGithubDocPath,
  parseGithubInstallation,
  parseGithubInstallationRepos,
  parseGithubRepos
} from './knowledge-connectors/github';
import {
  decodeBase64Url,
  extractGmailText,
  formatGmailMarkdown,
  parseGmailMessageList,
  stripHtml
} from './knowledge-connectors/gmail';
import {
  isKnowledgeProvider,
  providerForToolkit,
  SOURCE_TYPE_BY_PROVIDER,
  toolkitForProvider
} from '$lib/knowledge-providers';
import { claimConnectionAfterConnect } from './knowledge-sources';

describe('provider catalog', () => {
  it('maps providers to corpus source_type and Composio toolkit slugs', () => {
    expect(isKnowledgeProvider('google-drive')).toBe(true);
    expect(isKnowledgeProvider('slack')).toBe(false);
    expect(SOURCE_TYPE_BY_PROVIDER.notion).toBe('notion');
    expect(SOURCE_TYPE_BY_PROVIDER['google-mail']).toBe('gmail');
    expect(toolkitForProvider('github')).toBe('GITHUB');
    expect(toolkitForProvider('google-mail')).toBe('GMAIL');
    expect(providerForToolkit('GOOGLEDRIVE')).toBe('google-drive');
    expect(providerForToolkit('gmail')).toBe('google-mail');
    expect(providerForToolkit('HUBSPOT')).toBeNull();
  });
});

describe('drive helpers', () => {
  it('accepts docs/pdf/text and skips folders', () => {
    expect(isDriveIngestible('application/pdf')).toBe(true);
    expect(isDriveIngestible('application/vnd.google-apps.document')).toBe(true);
    expect(isDriveIngestible('application/vnd.google-apps.folder')).toBe(false);
    expect(driveExportMime('application/vnd.google-apps.spreadsheet')).toBe('text/csv');
    expect(driveExportMime('application/pdf')).toBeNull();
  });

  it('scopes file queries to selected folders', () => {
    const q = driveFilesInFoldersQuery(['abc123XYZ-_9', 'folder_id-1']);
    expect(q).toContain("'abc123XYZ-_9' in parents");
    expect(q).toContain("'folder_id-1' in parents");
    expect(q).toContain('trashed = false');
    expect(driveFilesInFoldersQuery([])).toBe('id = ""');
    const byId = driveFilesByIdsQuery(['abc123XYZ-_9', 'file_id-xyz1']);
    expect(byId).toContain("id = 'abc123XYZ-_9'");
    expect(byId).toContain("id = 'file_id-xyz1'");
    expect(driveFilesByIdsQuery([])).toBe('id = ""');
    const live = driveLiveSearchAmongIdsQuery("O'Reilly", ['abc123XYZ-_9']);
    expect(live).toContain("id = 'abc123XYZ-_9'");
    expect(live).toContain("name contains 'O\\'Reilly'");
    expect(live).toContain('mimeType');
    expect(
      parseDriveFolderList({
        files: [
          { id: 'fld12345678', name: 'Brand', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'file1', name: 'Doc', mimeType: 'application/pdf' }
        ]
      }).folders
    ).toEqual([{ id: 'fld12345678', name: 'Brand', webViewLink: null }]);
  });

  it('parses a Drive file list', () => {
    const { files, nextPageToken } = parseDriveFileList({
      nextPageToken: 'abc',
      files: [
        { id: '1', name: 'Kit.pdf', mimeType: 'application/pdf', size: '12' },
        { id: '2', name: 'Folder', mimeType: 'application/vnd.google-apps.folder' },
        { id: '', name: 'skip' }
      ]
    });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('Kit.pdf');
    expect(nextPageToken).toBe('abc');
  });
});

describe('notion markdown', () => {
  it('renders headings, lists and todos', () => {
    const md = notionBlocksToMarkdown([
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Brand' }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'We ship fast.' }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'One' }] } },
      { type: 'to_do', to_do: { checked: true, rich_text: [{ plain_text: 'Done' }] } }
    ]);
    expect(md).toContain('# Brand');
    expect(md).toContain('We ship fast.');
    expect(md).toContain('- One');
    expect(md).toContain('- [x] Done');
  });

  it('turns a search payload into pages', () => {
    const { pages } = parseNotionSearch({
      results: [
        {
          object: 'page',
          id: 'p1',
          url: 'https://notion.so/p1',
          properties: { Name: { type: 'title', title: [{ plain_text: 'Voice' }] } }
        }
      ],
      has_more: false
    });
    expect(pages).toEqual([{ id: 'p1', title: 'Voice', url: 'https://notion.so/p1' }]);
    expect(notionBlockToMarkdown({ type: 'divider' })).toBe('---');
    const picker = parseNotionPickerResults({
      results: [
        { object: 'database', id: 'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4', title: [{ plain_text: 'CRM' }], url: 'https://notion.so/db' },
        { object: 'page', id: 'p1', properties: { Name: { type: 'title', title: [{ plain_text: 'Voice' }] } }, parent: { type: 'database_id', database_id: 'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4' } }
      ],
      has_more: false
    });
    expect(picker.items.map((i) => i.kind)).toEqual(['database', 'page']);
    const selected = selectedNotionIdSet(['a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4']);
    expect(notionItemInScope('p1', 'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4', selected)).toBe(true);
    expect(notionItemInScope('other', null, selected)).toBe(false);
  });
});

describe('github helpers', () => {
  it('selects README/changelog/docs markdown', () => {
    expect(isGithubDocPath('README.md')).toBe(true);
    expect(isGithubDocPath('docs/guide.md')).toBe(true);
    expect(isGithubDocPath('src/index.ts')).toBe(false);
  });

  it('decodes base64 file content', () => {
    const text = Buffer.from('# Hello\n').toString('base64');
    const file = decodeGithubFileContent({
      encoding: 'base64',
      content: text,
      path: 'README.md',
      html_url: 'https://github.com/acme/app/blob/main/README.md'
    });
    expect(file?.text).toBe('# Hello');
    expect(parseGithubRepos([{ full_name: 'acme/app', html_url: 'https://github.com/acme/app' }])).toEqual([
      { fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', pushedAt: null }
    ]);
    expect(githubFileExternalId('acme/app', 'README.md')).toBe('acme/app:README.md');
    expect(githubRepoFromExternalId('acme/app:README.md')).toBe('acme/app');
    expect(githubRepoFromExternalId('not-a-repo')).toBeNull();
  });

  it('reads GitHub App installation repositories and account label', () => {
    expect(
      parseGithubInstallationRepos({
        total_count: 1,
        repositories: [{ full_name: 'acme/app', html_url: 'https://github.com/acme/app', pushed_at: '2026-01-01' }]
      })
    ).toEqual({
      totalCount: 1,
      repos: [{ fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', pushedAt: '2026-01-01' }]
    });
    expect(parseGithubInstallationRepos(null).repos).toEqual([]);
    expect(parseGithubInstallation({ account: { login: 'acme', type: 'Organization' } })).toBe('acme (org)');
    expect(parseGithubInstallation({ account: { login: 'andrea', type: 'User' } })).toBe('andrea');
  });
});

describe('gmail helpers', () => {
  it('prefers text/plain over html and strips tags as fallback', () => {
    const plain = Buffer.from('Hello from the brand').toString('base64url');
    const html = Buffer.from('<p>Ignored</p>').toString('base64url');
    expect(
      extractGmailText({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: plain } },
          { mimeType: 'text/html', body: { data: html } }
        ]
      })
    ).toBe('Hello from the brand');
    expect(stripHtml('<p>Hi<br/>there</p>')).toContain('Hi');
    expect(formatGmailMarkdown({ subject: 'Hi', from: 'a@b.c', date: 'Tue', body: 'Body' })).toContain('# Hi');
  });

  it('lists message ids', () => {
    expect(parseGmailMessageList({ messages: [{ id: 'm1' }, { id: 'm2' }] }).ids).toEqual(['m1', 'm2']);
    expect(decodeBase64Url(Buffer.from('xyz').toString('base64url'))).toBe('xyz');
  });
});

function chain(result: unknown) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.insert = self;
  api.update = self;
  api.eq = self;
  api.neq = self;
  api.in = self;
  api.order = self;
  api.limit = self;
  api.maybeSingle = async () => result;
  api.single = async () => result;
  return api;
}

describe('claimConnectionAfterConnect', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('inserts a source row for the account the user just authorized', async () => {
    const inserted: unknown[] = [];
    const supabase = {
      from(table: string) {
        if (table === 'brand_knowledge_sources') {
          return {
            ...chain({ data: null, error: null }),
            async maybeSingle() {
              return { data: null, error: null };
            },
            insert(row: unknown) {
              inserted.push(row);
              return chain({
                data: {
                  id: 'src-1',
                  brand_id: 'brand-1',
                  provider: 'notion',
                  connected_account_id: 'ca_9',
                  toolkit_slug: 'NOTION',
                  status: 'pending_sync',
                  display_name: null,
                  last_sync_at: null,
                  last_error: null,
                  docs_ingested: 0,
                  created_at: '2026-01-01'
                },
                error: null
              });
            }
          };
        }
        return chain({ data: null, error: null });
      }
    };

    const row = await claimConnectionAfterConnect({
      supabase: supabase as never,
      brandId: 'brand-1',
      userId: 'user-1',
      provider: 'notion',
      connectedAccountId: 'ca_9'
    });
    expect(row.id).toBe('src-1');
    expect(inserted[0]).toMatchObject({
      brand_id: 'brand-1',
      provider: 'notion',
      connected_account_id: 'ca_9',
      toolkit_slug: 'NOTION',
      // Notion waits on a page selection before the first sync, so it lands active, not queued.
      status: 'active'
    });
  });

  it('connects GitHub as active until the brand picks repositories', async () => {
    const inserted: unknown[] = [];
    const supabase = {
      from(table: string) {
        if (table === 'brand_knowledge_sources') {
          return {
            ...chain({ data: null, error: null }),
            async maybeSingle() {
              return { data: null, error: null };
            },
            insert(row: unknown) {
              inserted.push(row);
              return chain({
                data: {
                  id: 'src-gh',
                  brand_id: 'brand-1',
                  provider: 'github',
                  connected_account_id: 'ca_gh',
                  toolkit_slug: 'GITHUB',
                  status: 'active',
                  display_name: null,
                  last_sync_at: null,
                  last_error: null,
                  docs_ingested: 0,
                  created_at: '2026-01-01',
                  settings: {}
                },
                error: null
              });
            }
          };
        }
        return chain({ data: null, error: null });
      }
    };

    const row = await claimConnectionAfterConnect({
      supabase: supabase as never,
      brandId: 'brand-1',
      userId: 'user-1',
      provider: 'github',
      connectedAccountId: 'ca_gh'
    });
    expect(row.id).toBe('src-gh');
    expect(inserted[0]).toMatchObject({
      brand_id: 'brand-1',
      provider: 'github',
      toolkit_slug: 'GITHUB',
      status: 'active'
    });
  });
});
