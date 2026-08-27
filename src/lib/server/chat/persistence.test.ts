import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// L'host dello storage lo decide il test, non il `.env` di chi lo lancia: senza mock la suite è
// verde solo su una macchina con un progetto Supabase vero (`isOwnMediaUrl` pretende https) e
// rossa in CI, dove non c'è.
vi.mock('$env/static/public', async (originale) => ({
  ...((await originale()) as Record<string, string>),
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));

import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { assistantContentFromSteps, chronologicalTail, dropLeadingAssistant, messagesFromRow, snippetText } from './persistence';

describe('chronologicalTail', () => {
  it('keeps the newest N rows and returns them oldest-first (the loadHistory ORDER BY bug)', () => {
    const newestFirst = [
      { id: '80', n: 80 },
      { id: '79', n: 79 },
      { id: '51', n: 51 },
      { id: '50', n: 50 },
      { id: '1', n: 1 }
    ];
    // limit 3 of newest-first → ids 80,79,51 → chronological 51,79,80
    expect(chronologicalTail(newestFirst, 3).map((r) => r.id)).toEqual(['51', '79', '80']);
  });

  it('returns empty for empty input', () => {
    expect(chronologicalTail([], 50)).toEqual([]);
  });
});

describe('dropLeadingAssistant', () => {
  it('cuts assistant turns the window opened on (Gemini rejects a non-user first turn)', () => {
    const window = [
      { role: 'assistant', content: 'tail of an older reply' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ];
    expect(dropLeadingAssistant(window).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('leaves a window that already opens on a user turn alone', () => {
    const window = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' }
    ];
    expect(dropLeadingAssistant(window)).toEqual(window);
  });

  it('returns empty when the window holds no user turn at all', () => {
    expect(dropLeadingAssistant([{ role: 'assistant', content: 'a' }])).toEqual([]);
  });

  it('drops a leading assistant+tool pair so the window still opens on a user turn', () => {
    const window = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'read_attachment' }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: '1', toolName: 'read_attachment' }] },
      { role: 'user', content: 'e il resto?' }
    ];
    expect(dropLeadingAssistant(window).map((m) => m.role)).toEqual(['user']);
  });
});

describe('assistantContentFromSteps', () => {
  it('collects tool calls from EVERY step, not just the last (the "tool calls vanish on reload" bug)', () => {
    const steps = [
      { text: '', reasoningText: undefined, toolCalls: [{ toolCallId: 'a', toolName: 'list_articles', input: { status: 'draft' } }] },
      { text: 'Recap intermedio.', reasoningText: undefined, toolCalls: [{ toolCallId: 'b', toolName: 'schedule_article', input: { article_id: 'x' } }] },
      { text: 'Fatto!', reasoningText: undefined, toolCalls: [] } // final step: text only
    ];
    const content = assistantContentFromSteps(steps, 'Fatto!');
    expect(content.filter((p) => p.type === 'tool-call').map((p) => p.toolName)).toEqual(['list_articles', 'schedule_article']);
    // Chronological: each text segment sits where the model wrote it, not merged at the end.
    expect(content.map((p) => p.toolName ?? p.text)).toEqual([
      'list_articles',
      'Recap intermedio.',
      'schedule_article',
      'Fatto!'
    ]);
  });

  it('keeps the order of a step that interleaves text and tool calls', () => {
    const steps = [
      {
        content: [
          { type: 'text', text: 'Guardo i post.' },
          { type: 'tool-call', toolCallId: 'a', toolName: 'list_posts' },
          { type: 'text', text: 'Ne pubblico uno.' },
          { type: 'tool-call', toolCallId: 'b', toolName: 'publish_post' }
        ],
        toolCalls: [
          { toolCallId: 'a', toolName: 'list_posts' },
          { toolCallId: 'b', toolName: 'publish_post' }
        ]
      },
      { content: [{ type: 'text', text: 'Fatto.' }], text: 'Fatto.' }
    ];
    expect(assistantContentFromSteps(steps, 'Fatto.').map((p) => p.toolName ?? p.text)).toEqual([
      'Guardo i post.',
      'list_posts',
      'Ne pubblico uno.',
      'publish_post',
      'Fatto.'
    ]);
  });

  it('attaches a plan pointer to propose_plan, and nothing when the insert failed', () => {
    const steps = [
      {
        toolCalls: [
          { toolCallId: 'ok', toolName: 'propose_plan', input: { title: 'Lancio' } },
          { toolCallId: 'ko', toolName: 'propose_plan', input: { title: 'Rotto' } }
        ],
        toolResults: [
          {
            toolCallId: 'ok',
            output: { success: true, plan_id: 'p-1', title: 'Lancio', summary: 'Q4' }
          },
          { toolCallId: 'ko', output: { error: 'insert failed' } }
        ]
      }
    ];
    const calls = assistantContentFromSteps(steps, '').filter((p) => p.type === 'tool-call');
    expect(calls[0].plan).toEqual({ id: 'p-1', title: 'Lancio', summary: 'Q4' });
    // The markdown never rides in the message JSON — only the pointer does.
    expect(calls[0].plan.markdown).toBeUndefined();
    expect(calls[1].plan).toBeUndefined();
  });

  it('never emits a reasoning part for empty reasoning (the "Thinking {}" bug)', () => {
    const content = assistantContentFromSteps([{ text: 'Ciao', reasoningText: '', toolCalls: [] }], 'Ciao');
    expect(content.some((p) => p.type === 'reasoning')).toBe(false);
  });

  it('keeps real reasoning text and falls back to the payload text when steps carry none', () => {
    const content = assistantContentFromSteps([{ reasoningText: 'sto pensando', toolCalls: [] }], 'risposta');
    expect(content).toEqual([
      { type: 'reasoning', text: 'sto pensando' },
      { type: 'text', text: 'risposta' }
    ]);
  });

  it('positions reasoning where it happened instead of gluing every step\'s reasoning in front (pensa → scrive → agisce → pensa → scrive)', () => {
    const steps = [
      {
        content: [
          { type: 'reasoning', text: 'Guardo i post esistenti.' },
          { type: 'text', text: 'Controllo prima.' },
          { type: 'tool-call', toolCallId: 'a', toolName: 'list_posts' }
        ]
      },
      {
        content: [
          { type: 'reasoning', text: 'Ora scrivo la risposta.' },
          { type: 'text', text: 'Fatto.' }
        ]
      }
    ];
    const content = assistantContentFromSteps(steps, 'Fatto.');
    // 'Controllo prima.' è un appunto (non è l'ultimo testo): si unisce al reasoning che lo precede.
    expect(content.map((p) => p.type)).toEqual(['reasoning', 'tool-call', 'reasoning', 'text']);
    expect(content[0].text).toBe('Guardo i post esistenti.\nControllo prima.');
    expect(content[2].text).toBe('Ora scrivo la risposta.');
  });

  it('merges adjacent reasoning content into one segment (nothing else landed between them)', () => {
    const steps = [
      {
        content: [
          { type: 'reasoning', text: 'Parte uno.' },
          { type: 'reasoning', text: 'Parte due.' },
          { type: 'text', text: 'Ok.' }
        ]
      }
    ];
    expect(assistantContentFromSteps(steps, 'Ok.')).toEqual([
      { type: 'reasoning', text: 'Parte uno.\nParte due.' },
      { type: 'text', text: 'Ok.' }
    ]);
  });

  // CAUSA B — il balbettio: un turno che chiude con `reply`/`ask_user` non mostra MAI il testo di
  // uno step come bolla propria — quel testo vive negli appunti (reasoning), il messaggio vero è
  // SEMPRE quello degli argomenti del tool di chiusura (fallbackText).
  it('demotes every step announcement to reasoning when the turn closes on reply, and always appends the real reply (not as fallback)', () => {
    // Il caso reale osservato: tre annunci quasi identici in fila prima di chiamare `reply`.
    const steps = [
      { text: 'Controllo se è già collegato…', toolCalls: [{ toolCallId: 'a', toolName: 'list_integrations_tools', input: {} }] },
      { text: 'Non è ancora collegato.', toolCalls: [{ toolCallId: 'b', toolName: 'list_integrations_tools', input: {} }] },
      {
        text: 'Al momento non risulta collegato.',
        toolCalls: [{ toolCallId: 'c', toolName: 'reply', input: { message: 'Non risulta ancora collegato: vuoi che ti mandi il link?' } }]
      }
    ];
    const content = assistantContentFromSteps(steps, 'Non risulta ancora collegato: vuoi che ti mandi il link?');
    // Nessuna delle tre bolle di testo intermedie sopravvive come 'text' — sono tutte appunti.
    expect(content.filter((p) => p.type === 'text')).toEqual([
      { type: 'text', text: 'Non risulta ancora collegato: vuoi che ti mandi il link?' }
    ]);
    expect(content.filter((p) => p.type === 'reasoning').map((p) => p.text).join('\n')).toContain(
      'Controllo se è già collegato…'
    );
    // Il tool `reply` stesso resta nel content (la UI lo nasconde via MESSAGE_TOOLS), la sua
    // risposta è sempre l'ultima cosa in ordine.
    expect(content.at(-1)).toEqual({ type: 'text', text: 'Non risulta ancora collegato: vuoi che ti mandi il link?' });
  });

  it('never drops the reply behind an earlier working note (the "official answer thrown away" bug)', () => {
    const steps = [
      {
        text: 'poi ti dico come farei il parlato',
        toolCalls: [{ toolCallId: 'a', toolName: 'reply', input: { message: 'Il parlato è pronto: eccolo.' } }]
      }
    ];
    // Prima: `if (!sawText)` — lo step aveva già scritto testo, quindi il vero reply veniva
    // BUTTATO e la UI (che nasconde la chip di `reply`) non mostrava niente.
    const content = assistantContentFromSteps(steps, 'Il parlato è pronto: eccolo.');
    expect(content.filter((p) => p.type === 'text')).toEqual([{ type: 'text', text: 'Il parlato è pronto: eccolo.' }]);
  });

  // Il balbettio residuo: un turno che finisce per esaurimento passi (reason=completed, nessun
  // `reply`) non ha un tool di chiusura da cui leggere la risposta — l'ULTIMO testo lo è, e tutto
  // quello prima resta appunto. Prima restavano due bolle visibili in fila.
  it('shows ONE bubble when the turn ends by running out of steps: the last text is the answer, the rest are notes', () => {
    const steps = [
      { text: 'Guardo i post.', toolCalls: [{ toolCallId: 'a', toolName: 'list_posts', input: {} }] },
      { text: 'Fatto.', toolCalls: [] }
    ];
    const content = assistantContentFromSteps(steps, 'Fatto.');
    expect(content.filter((p) => p.type === 'text')).toEqual([{ type: 'text', text: 'Fatto.' }]);
    expect(content.map((p) => p.type)).toEqual(['reasoning', 'tool-call', 'text']);
    expect(content[0].text).toBe('Guardo i post.');
  });

  it('never loses the text when there is no reply tool and no fallback (the last block IS the answer)', () => {
    const steps = [
      { text: 'Primo appunto.', toolCalls: [{ toolCallId: 'a', toolName: 'list_posts', input: {} }] },
      { text: 'La risposta vera.', toolCalls: [] }
    ];
    const content = assistantContentFromSteps(steps);
    expect(content.filter((p) => p.type === 'text')).toEqual([{ type: 'text', text: 'La risposta vera.' }]);
  });

  it('attaches a post preview to a successful create_post carousel, and nothing on error', () => {
    const steps = [
      {
        toolCalls: [
          { toolCallId: 'ok', toolName: 'create_post', input: { brief: 'x' } },
          { toolCallId: 'ko', toolName: 'create_post', input: { brief: 'y' } }
        ],
        toolResults: [
          { toolCallId: 'ok', toolName: 'create_post', output: { success: true, post_id: 'p1', platform: 'instagram', caption: 'Ciao', media_url: 'https://a/1.png', media_urls: ['https://a/1.png', 'https://a/2.png'], format: 'carousel' } },
          { toolCallId: 'ko', toolName: 'create_post', output: { error: 'boom' } }
        ]
      }
    ];
    const calls = assistantContentFromSteps(steps).filter((p) => p.type === 'tool-call');
    expect(calls[0].preview).toEqual([
      { post_id: 'p1', platform: 'instagram', caption: 'Ciao', media_url: 'https://a/1.png', media_urls: ['https://a/1.png', 'https://a/2.png'], format: 'carousel', status: 'pending_user' }
    ]);
    expect(calls[1].preview).toBeUndefined();
  });

  it('show_media rides in the part, and only the media that are ours', () => {
    const ours = `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/public/media/u/clip.mp4`;
    const img = `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/public/media/u/frame.png`;
    const steps = [
      {
        toolCalls: [{ toolCallId: 'm', toolName: 'show_media', input: {} }],
        toolResults: [
          {
            toolCallId: 'm',
            toolName: 'show_media',
            output: {
              media: [
                { url: ours, caption: 'La clip' },
                { url: img },
                { url: 'https://evil.example.com/pixel.png', caption: 'nope' }
              ]
            }
          }
        ]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.media).toEqual([
      { url: ours, kind: 'video', caption: 'La clip' },
      { url: img, kind: 'image' }
    ]);
    // Non è un post: nessuna anteprima di post da questa chiamata.
    expect(call.preview).toBeUndefined();
  });

  it('motion_stills copies the frames onto the part even when the SDK wrapped the kit ToolResult', () => {
    const frame = `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/sign/brand-knowledge/u/b/artifacts/still-f30.png?token=abc`;
    const payload = {
      shown_in_chat: true,
      artifacts: [{ id: 'a1', url: frame, title: 'Existing · frame 30' }],
      media: [{ url: frame, caption: 'Existing · frame 30' }]
    };
    const steps = [
      {
        toolCalls: [{ toolCallId: 's', toolName: 'motion_stills', input: { id: 'v1' } }],
        toolResults: [
          {
            toolCallId: 's',
            toolName: 'motion_stills',
            output: {
              type: 'content',
              value: [{ type: 'text', text: JSON.stringify(payload) }]
            }
          }
        ]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.media).toEqual([{ url: frame, kind: 'image', caption: 'Existing · frame 30' }]);
  });

  it('message_agent rides as dmSends, even when the kit wrapped the output as ToolResult', () => {
    const payload = {
      success: true,
      dm_thread_id: 'dm-1',
      to: 'analyst',
      to_name: 'Analyst',
      sends: [{ dm_thread_id: 'dm-1', to: 'analyst', to_name: 'Analyst' }]
    };
    const steps = [
      {
        toolCalls: [{ toolCallId: 'd', toolName: 'message_agent', input: { to: 'analyst', message: 'ciao' } }],
        toolResults: [
          {
            toolCallId: 'd',
            toolName: 'message_agent',
            output: { content: [{ type: 'text', text: JSON.stringify(payload) }] }
          }
        ]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.dmSends).toEqual([{ threadId: 'dm-1', to: 'analyst', name: 'Analyst' }]);
  });

  it('read_posts is silent by default: no previews unless show_to_user is set', () => {
    const posts = [{ id: 'a', platform: 'x', caption: 'one', media_url: 'https://a/1.png', status: 'approved' }];
    const stepsFor = (input: unknown) => [
      {
        toolCalls: [{ toolCallId: 'r', toolName: 'read_posts', input }],
        toolResults: [{ toolCallId: 'r', toolName: 'read_posts', output: { posts } }]
      }
    ];
    const previewOf = (input: unknown) =>
      assistantContentFromSteps(stepsFor(input)).find((p) => p.type === 'tool-call').preview;
    expect(previewOf({})).toBeUndefined();
    expect(previewOf({ status: 'pending_user' })).toBeUndefined();
    expect(previewOf(undefined)).toBeUndefined();
    expect(previewOf({ show_to_user: false })).toBeUndefined();
    expect(previewOf({ show_to_user: true })).toHaveLength(1);

    // create_post never needs the flag — there the card IS the work that was just done.
    const created = assistantContentFromSteps([
      {
        toolCalls: [{ toolCallId: 'c', toolName: 'create_post', input: { caption: 'Ciao' } }],
        toolResults: [
          {
            toolCallId: 'c',
            toolName: 'create_post',
            output: { success: true, post_id: 'p1', platform: 'instagram', caption: 'Ciao', media_url: 'https://a/1.png' }
          }
        ]
      }
    ]).find((p) => p.type === 'tool-call');
    expect(created.preview).toHaveLength(1);
  });

  it('maps read_posts rows to previews when the call asked to show them (drops rows without an id)', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'r', toolName: 'read_posts', input: { show_to_user: true } }],
        toolResults: [{ toolCallId: 'r', toolName: 'read_posts', output: { posts: [
          { id: 'a', platform: 'x', caption: 'one', media_url: null, status: 'approved' },
          { platform: 'x', caption: 'no-id' }
        ] } }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.preview).toEqual([
      { post_id: 'a', platform: 'x', caption: 'one', media_url: null, media_urls: undefined, format: undefined, status: 'approved' }
    ]);
  });

  it('drops blank read_posts rows and uses media_urls[0] when media_url is null', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'r', toolName: 'read_posts', input: { show_to_user: true } }],
        toolResults: [{
          toolCallId: 'r',
          toolName: 'read_posts',
          output: {
            posts: [
              { id: 'empty', platform: 'instagram', caption: '', media_url: null, status: 'pending_user' },
              { id: 'carousel', platform: 'instagram', caption: 'Hi', media_url: null, media_urls: ['https://a/1.png', 'https://a/2.png'], status: 'pending_user' },
              { id: 'single', platform: 'x', caption: '', media_url: null, media_urls: ['https://a/only.png'], status: 'pending_user' }
            ]
          }
        }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.preview).toEqual([
      {
        post_id: 'carousel',
        platform: 'instagram',
        caption: 'Hi',
        media_url: 'https://a/1.png',
        media_urls: ['https://a/1.png', 'https://a/2.png'],
        format: undefined,
        status: 'pending_user'
      },
      {
        post_id: 'single',
        platform: 'x',
        caption: '',
        media_url: 'https://a/only.png',
        media_urls: undefined,
        format: undefined,
        status: 'pending_user'
      }
    ]);
  });

  it('attaches a preview when generate_image updates a post', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'g', toolName: 'generate_image', input: { prompt: 'x', post_id: 'p9' } }],
        toolResults: [{
          toolCallId: 'g',
          toolName: 'generate_image',
          output: {
            success: true,
            post_id: 'p9',
            platform: 'instagram',
            caption: 'Hi',
            media_url: 'https://cdn/x.png',
            status: 'pending_user'
          }
        }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.preview).toEqual([
      {
        post_id: 'p9',
        platform: 'instagram',
        caption: 'Hi',
        media_url: 'https://cdn/x.png',
        media_urls: undefined,
        format: undefined,
        status: 'pending_user'
      }
    ]);
  });

  it('does not attach a post preview when generate_image only minted an asset', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'g', toolName: 'generate_image', input: { prompt: 'x' } }],
        toolResults: [{
          toolCallId: 'g',
          toolName: 'generate_image',
          output: {
            success: true,
            image_url: 'https://cdn/asset.png',
            did_not_change_post: true
          }
        }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.preview).toBeUndefined();
  });

  it('attaches openTab payload from propose_open_tab', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 't', toolName: 'propose_open_tab', input: { path: '/gtm' } }],
        toolResults: [{
          toolCallId: 't',
          toolName: 'propose_open_tab',
          output: { path: '/gtm', href: '/app/acme/gtm', reason: 'Rivedi la roadmap' }
        }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.openTab).toEqual({ path: '/gtm', href: '/app/acme/gtm', reason: 'Rivedi la roadmap' });
  });

  it('attaches questions payload from ask_user_questions', () => {
    const steps = [
      {
        toolCalls: [{
          toolCallId: 'q',
          toolName: 'ask_user_questions',
          input: {
            questions: [{
              id: 'priority',
              prompt: 'Priorità?',
              options: [
                { id: 'leads', label: 'Più lead' },
                { id: 'brand', label: 'Brand awareness' }
              ]
            }]
          }
        }],
        toolResults: [{
          toolCallId: 'q',
          toolName: 'ask_user_questions',
          output: {
            questions: [{
              id: 'priority',
              prompt: 'Priorità?',
              options: [
                { id: 'leads', label: 'Più lead' },
                { id: 'brand', label: 'Brand awareness' }
              ]
            }]
          }
        }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.questions).toEqual([{
      id: 'priority',
      prompt: 'Priorità?',
      options: [
        { id: 'leads', label: 'Più lead' },
        { id: 'brand', label: 'Brand awareness' }
      ]
    }]);
  });

  it('attaches the agent proposal from propose_custom_agent, and only when it is complete', () => {
    const proposal = {
      name: 'Lettura performance',
      prompt: 'Leggi la performance degli ultimi 7 giorni e di cosa cambiare la settimana prossima.',
      agent: 'grow',
      days: [1],
      times: ['09:00'],
      because: 'Ci sono dati da leggere ogni lunedì.',
      outputs: ['recap']
    };
    const stepsFor = (output: unknown) => [
      {
        toolCalls: [{ toolCallId: 'p', toolName: 'propose_custom_agent', input: proposal }],
        toolResults: [{ toolCallId: 'p', toolName: 'propose_custom_agent', output }]
      }
    ];

    const ok = assistantContentFromSteps(stepsFor({ success: true, proposal })).find((p) => p.type === 'tool-call');
    expect(ok.agentProposal).toEqual(proposal);

    // A refused proposal (duplicate name, brand at its cap) carries no card — the chat says it in
    // words instead of showing a button that cannot work.
    const refused = assistantContentFromSteps(stepsFor({ success: false, error: 'duplicate' })).find(
      (p) => p.type === 'tool-call'
    );
    expect(refused.agentProposal).toBeUndefined();
  });

  it('persists the tool execute() output on each call (so loadHistory can replay the read slice)', () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: 'r', toolName: 'read_attachment', input: { start_from: 0 } }],
        toolResults: [{
          toolCallId: 'r',
          toolName: 'read_attachment',
          output: { file: 'huge.pdf', text: '## p. 12\nHello', next_start: 6000 }
        }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.output).toEqual({ file: 'huge.pdf', text: '## p. 12\nHello', next_start: 6000 });
  });

  it('unwraps SDK {type,value} wrappers before persisting output', () => {
    const steps = [
      {
        content: [
          { type: 'tool-call', toolCallId: 'g', toolName: 'grep_attachment', input: { query: 'foo' } },
          {
            type: 'tool-result',
            toolCallId: 'g',
            toolName: 'grep_attachment',
            output: { type: 'json', value: { query: 'foo', files: [{ file: 'a.md', hits: [] }] } }
          }
        ],
        toolCalls: [{ toolCallId: 'g', toolName: 'grep_attachment', input: { query: 'foo' } }]
      }
    ];
    const call = assistantContentFromSteps(steps).find((p) => p.type === 'tool-call');
    expect(call.output).toEqual({ query: 'foo', files: [{ file: 'a.md', hits: [] }] });
  });
});

describe('messagesFromRow', () => {
  it('replays a read_attachment call as assistant tool-call + tool result for the SDK', () => {
    const msgs = messagesFromRow({
      role: 'assistant',
      content: 'Ho letto la sezione.',
      tool_calls: [
        { type: 'text', text: 'Guardo il PDF.' },
        {
          type: 'tool-call',
          toolCallId: 'r1',
          toolName: 'read_attachment',
          input: { start_from: 0, max_chars: 6000 },
          preview: [{ post_id: 'should-not-reach-model' }],
          output: { file: 'huge.pdf', text: '## p. 1\nLorem', next_start: 6000 }
        },
        { type: 'text', text: 'Ho letto la sezione.' }
      ]
    });
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    const callMsg = msgs[0] as { role: string; content: Array<{ type: string; toolName?: string; input?: unknown; preview?: unknown }> };
    expect(callMsg.content).toEqual([
      { type: 'text', text: 'Guardo il PDF.' },
      {
        type: 'tool-call',
        toolCallId: 'r1',
        toolName: 'read_attachment',
        input: { start_from: 0, max_chars: 6000 }
      }
    ]);
    expect(callMsg.content[1]).not.toHaveProperty('preview');
    expect(callMsg.content[1]).not.toHaveProperty('output');
    const toolMsg = msgs[1] as { role: string; content: Array<{ type: string; output: unknown }> };
    expect(toolMsg.content).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'r1',
        toolName: 'read_attachment',
        output: { type: 'json', value: { file: 'huge.pdf', text: '## p. 1\nLorem', next_start: 6000 } }
      }
    ]);
    expect(msgs[2]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Ho letto la sezione.' }] });
  });

  it('keeps an interrupted read-only call as a pair whose synthetic result says it is safe to re-run', () => {
    const msgs = messagesFromRow({
      role: 'assistant',
      content: 'Ecco i post.',
      tool_calls: [{ type: 'tool-call', toolCallId: 'a', toolName: 'list_posts', input: {} }]
    });
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    const result = (msgs[1] as { content: Array<{ toolCallId: string; output: { type: string; value: string } }> }).content[0];
    expect(result.toolCallId).toBe('a');
    expect(result.output.type).toBe('text');
    expect(result.output.value).toContain('only reads');
  });

  it('keeps an interrupted effectful call as a pair whose synthetic result says outcome unknown, verify before redoing', () => {
    const msgs = messagesFromRow({
      role: 'assistant',
      content: '',
      tool_calls: [{ type: 'tool-call', toolCallId: 'g1', toolName: 'generate_image', input: { prompt: 'a cat' } }]
    });
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'tool']);
    const call = (msgs[0] as { content: Array<{ type: string; toolCallId?: string; input?: unknown }> }).content[0];
    expect(call).toEqual({ type: 'tool-call', toolCallId: 'g1', toolName: 'generate_image', input: { prompt: 'a cat' } });
    const result = (msgs[1] as { content: Array<{ output: { type: string; value: string } }> }).content[0];
    expect(result.output.value).toContain('outcome unknown');
    expect(result.output.value.toLowerCase()).toContain('verify');
  });

  it('a call that finished but whose result was lost says completed, not unknown', () => {
    const msgs = messagesFromRow({
      role: 'assistant',
      content: '',
      tool_calls: [{ type: 'tool-call', toolCallId: 'r1', toolName: 'motion_render', input: {}, status: 'done' }]
    });
    const result = (msgs[1] as { content: Array<{ output: { value: string } }> }).content[0];
    expect(result.output.value).toContain('completed');
    expect(result.output.value).not.toContain('outcome unknown');
  });

  it('keeps history text-only by default — a model that cannot see must not be handed parts', () => {
    expect(messagesFromRow({ role: 'user', content: 'guarda', attachments: ['https://cdn/a.png'] })).toEqual([
      { role: 'user', content: 'guarda\n[attached urls: https://cdn/a.png]' }
    ]);
  });

  it('hands attached images over as real image parts when the model can see them', () => {
    expect(
      messagesFromRow({ role: 'user', content: 'guarda', attachments: ['https://cdn/a.png'] }, 'images')
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'guarda\n[attached: https://cdn/a.png]' },
          { type: 'image', image: new URL('https://cdn/a.png') }
        ]
      }
    ]);
  });

  it('keeps a device upload (a data: URL, so no file extension) as an image part', () => {
    const dataUrl = 'data:image/jpeg;base64,AAAA';
    expect(messagesFromRow({ role: 'user', content: 'this', attachments: [dataUrl] }, 'images')).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `this\n[attached: ${dataUrl}]` },
          { type: 'image', image: dataUrl }
        ]
      }
    ]);
  });

  it('strips video for an images-only model — a file part makes those providers throw', () => {
    expect(messagesFromRow({ role: 'user', content: 'replica https://cdn/clip.mp4' }, 'images')).toEqual([
      { role: 'user', content: 'replica https://cdn/clip.mp4' }
    ]);
  });

  it('attaches a pasted video URL as a file part only when video is supported', () => {
    expect(
      messagesFromRow({ role: 'user', content: 'replica https://cdn/clip.mp4' }, 'images+video')
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'replica https://cdn/clip.mp4' },
          { type: 'file', mediaType: 'video/mp4', data: new URL('https://cdn/clip.mp4') }
        ]
      }
    ]);
  });

  it('leaves a text-only turn as a plain string', () => {
    expect(messagesFromRow({ role: 'user', content: 'ciao' }, 'images+video')).toEqual([
      { role: 'user', content: 'ciao' }
    ]);
  });

  it('groups consecutive tool calls with outputs into one assistant + one tool message', () => {
    const msgs = messagesFromRow({
      role: 'assistant',
      content: 'ok',
      tool_calls: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'grep_attachment', input: { query: 'x' }, output: { hits: 2 } },
        { type: 'tool-call', toolCallId: 'b', toolName: 'read_attachment', input: { start_from: 10 }, output: { text: 'slice' } }
      ]
    });
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    const calls = (msgs[0] as { content: Array<{ toolName?: string }> }).content;
    expect(calls.map((c) => c.toolName)).toEqual(['grep_attachment', 'read_attachment']);
    const results = (msgs[1] as { content: Array<{ toolCallId: string }> }).content;
    expect(results.map((r) => r.toolCallId)).toEqual(['a', 'b']);
  });
});

describe('snippetText', () => {
  it('butta i documenti allegati, spiana il markdown e taglia corto', () => {
    const raw =
      'Ecco il **piano**: [vedi qui](https://x.y) `subito`\n\n```js\nconst a = 1;\n```\n' +
      '<!--anomalia-attached-docs-->\nTUTTO il PDF allegato…';
    expect(snippetText(raw)).toBe('Ecco il piano: vedi qui subito');
    const long = 'a'.repeat(500);
    expect(snippetText(long).length).toBeLessThanOrEqual(140);
    expect(snippetText(long).endsWith('…')).toBe(true);
    expect(snippetText('   \n  ')).toBe('');
  });
});
