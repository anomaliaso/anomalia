import { describe, it, expect } from 'vitest';
import { sourcesFromSteps, parseChatSources } from './chat-sources';

describe('sourcesFromSteps', () => {
  it('maps search_web citations to web sources', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'a', toolName: 'search_web', input: { query: 'x' } }],
        toolResults: [
          {
            toolCallId: 'a',
            toolName: 'search_web',
            output: {
              text: '…',
              citations: [
                { uri: 'https://a.example', title: 'A' },
                { uri: 'https://b.example', title: 'B' }
              ]
            }
          }
        ]
      }
    ];
    expect(sourcesFromSteps(steps, 'acme')).toEqual([
      { kind: 'web', label: 'A', url: 'https://a.example' },
      { kind: 'web', label: 'B', url: 'https://b.example' }
    ]);
  });

  it('maps search_knowledge hits and read_competitors brand chip', () => {
    const steps = [
      {
        toolCalls: [
          { toolCallId: 'k', toolName: 'search_knowledge', input: {} },
          { toolCallId: 'c', toolName: 'read_competitors', input: {} }
        ],
        toolResults: [
          {
            toolCallId: 'k',
            output: {
              results: [
                {
                  documentId: 'd1',
                  chunkId: 'c1',
                  title: 'Brand book',
                  headingPath: 'Tone'
                }
              ]
            }
          },
          {
            toolCallId: 'c',
            output: { competitors: [{ id: '1', name: 'Rival' }] }
          }
        ]
      }
    ];
    const src = sourcesFromSteps(steps, 'acme');
    expect(src).toContainEqual({
      kind: 'knowledge',
      label: 'Brand book › Tone',
      documentId: 'd1',
      chunkId: 'c1',
      headingPath: 'Tone'
    });
    expect(src).toContainEqual({
      kind: 'brand',
      entity: 'competitor',
      label: '1 competitor',
      href: '/app/acme/competitors'
    });
  });

  it('does not invent chips for unmapped connector tools', () => {
    const steps = [
      {
        toolCalls: [
          { toolCallId: 'd', toolName: 'search_drive', input: {} },
          { toolCallId: 'n', toolName: 'call_integrations_tools', input: {} }
        ],
        toolResults: [
          {
            toolCallId: 'd',
            output: {
              results: [{ id: 'file1', title: 'Brand kit', url: 'https://drive.google.com/file/d/file1/view' }]
            }
          },
          { toolCallId: 'n', output: { integration: 'google-drive', result: { ok: true } } }
        ]
      }
    ];
    expect(sourcesFromSteps(steps, 'acme')).toEqual([]);
  });

  it('ignores unmapped tools and errors (no invented defaults)', () => {
    const steps = [
      {
        toolCalls: [
          { toolCallId: 'w', toolName: 'create_post', input: {} },
          { toolCallId: 's', toolName: 'search_web', input: {} }
        ],
        toolResults: [
          { toolCallId: 'w', output: { success: true, post_id: 'p1' } },
          { toolCallId: 's', output: { error: 'budget' } }
        ]
      }
    ];
    expect(sourcesFromSteps(steps, 'acme')).toEqual([]);
  });

  it('dedupes and caps at 12', () => {
    const citations = Array.from({ length: 20 }, (_, i) => ({
      uri: `https://ex.ample/${i % 15}`,
      title: `T${i}`
    }));
    const steps = [
      {
        toolCalls: [{ toolCallId: 'a', toolName: 'search_web', input: {} }],
        toolResults: [{ toolCallId: 'a', output: { citations } }]
      }
    ];
    const src = sourcesFromSteps(steps, 'acme');
    expect(src.length).toBeLessThanOrEqual(12);
    expect(new Set(src.map((s) => (s.kind === 'web' ? s.url : ''))).size).toBe(src.length);
  });
  it('maps list_articles to the site (blog) page, not a missing /blog route', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'a', toolName: 'list_articles', input: {} }],
        toolResults: [{
          toolCallId: 'a',
          output: { articles: [{ id: '1' }, { id: '2' }] }
        }]
      }
    ];
    expect(sourcesFromSteps(steps, 'acme')).toEqual([
      {
        kind: 'brand',
        entity: 'article',
        label: 'Blog · 2',
        href: '/app/acme/site'
      }
    ]);
  });
});

describe('parseChatSources', () => {
  it('filters invalid rows from JSONB', () => {
    expect(
      parseChatSources([
        { kind: 'web', label: 'A', url: 'https://a' },
        { kind: 'drive', label: 'Kit', url: 'https://drive.google.com/file/d/x/view' },
        { kind: 'web', label: 'bad' },
        { kind: 'nope', label: 'x' }
      ])
    ).toEqual([
      { kind: 'web', label: 'A', url: 'https://a' },
      { kind: 'drive', label: 'Kit', url: 'https://drive.google.com/file/d/x/view' }
    ]);
  });
});
