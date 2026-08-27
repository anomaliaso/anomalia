import { describe, it, expect } from 'vitest';
import { failedCallCount, messageBlocks, streamBlocks, previewsByCall, textBubbleRange, toolCallsOf } from './chat-parts';

const label = (b: ReturnType<typeof messageBlocks>[number]) =>
  b.type === 'text' || b.type === 'reasoning' ? b.text : b.calls.map((c) => c.toolName).join('+');

describe('messageBlocks', () => {
  it('replays a turn in the stored order, grouping consecutive tool calls into one bar', () => {
    const parts = [
      { type: 'text', text: 'Guardo i post.' },
      { type: 'tool-call', toolCallId: 'a', toolName: 'list_posts' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'read_post' },
      { type: 'text', text: 'Ne pubblico uno.' },
      { type: 'tool-call', toolCallId: 'c', toolName: 'publish_post' },
      { type: 'text', text: 'Fatto.' }
    ];
    expect(messageBlocks('Guardo i post.\n\nNe pubblico uno.\n\nFatto.', parts).map(label)).toEqual([
      'Guardo i post.',
      'list_posts+read_post',
      'Ne pubblico uno.',
      'publish_post',
      'Fatto.'
    ]);
  });

  it('replays a saved reasoning part where it happened, as its own block', () => {
    const parts = [
      { type: 'reasoning', text: 'Guardo i post.' },
      { type: 'text', text: 'Ne trovo tre.' },
      { type: 'tool-call', toolCallId: 'a', toolName: 'list_posts' },
      { type: 'reasoning', text: 'Ne pubblico uno.' },
      { type: 'text', text: 'Fatto.' }
    ];
    expect(messageBlocks('Ne trovo tre.\n\nFatto.', parts).map((b) => b.type)).toEqual([
      'reasoning',
      'text',
      'tools',
      'reasoning',
      'text'
    ]);
  });

  it('falls back to tools-then-text for legacy rows that stored no text parts', () => {
    const parts = [{ type: 'tool-call', toolCallId: 'a', toolName: 'list_posts' }];
    expect(messageBlocks('Ecco i post.', parts).map(label)).toEqual(['list_posts', 'Ecco i post.']);
  });

  it('accepts the JSON-string form and ignores empty text', () => {
    expect(messageBlocks('', JSON.stringify([{ type: 'text', text: '  ' }]))).toEqual([]);
    expect(toolCallsOf('[{"type":"tool-call","toolName":"x"},{"type":"text","text":"hi"}]')).toHaveLength(1);
  });

  it('does not dump a persisted tool output into the bubble — chips stay chips', () => {
    const parts = [
      {
        type: 'tool-call',
        toolCallId: 'r',
        toolName: 'read_attachment',
        output: { text: '## p. 1\n' + 'x'.repeat(4000) }
      },
      { type: 'text', text: 'Ho letto la sezione.' }
    ];
    expect(messageBlocks('Ho letto la sezione.', parts).map(label)).toEqual([
      'read_attachment',
      'Ho letto la sezione.'
    ]);
  });
});

describe('streamBlocks', () => {
  it('slots each live tool call back into the text stream at the point it fired', () => {
    const buf = 'Guardo i post.Ne pubblico uno.Fatto.';
    const tools = [
      { toolName: 'list_posts', textLen: 14, status: 'done' as const },
      { toolName: 'read_post', textLen: 14, status: 'done' as const },
      { toolName: 'publish_post', textLen: 30, status: 'running' as const }
    ];
    expect(streamBlocks(buf, tools).map(label)).toEqual([
      'Guardo i post.',
      'list_posts+read_post',
      'Ne pubblico uno.',
      'publish_post',
      'Fatto.'
    ]);
  });

  it('keeps the old tools-first layout when the snapshot has no textLen', () => {
    expect(streamBlocks('Ecco.', [{ toolName: 'list_posts' }]).map(label)).toEqual(['list_posts', 'Ecco.']);
  });

  it('slots reasoning segments in chronologically, before the tool call each one preceded (pensa → scrive → agisce → pensa → scrive)', () => {
    const buf = 'Controllo prima.Fatto.';
    const tools = [{ toolName: 'list_posts', textLen: 'Controllo prima.'.length, status: 'done' as const }];
    const reasoning = [
      { text: 'Guardo i post esistenti.', textLen: 0, toolsBefore: 0 },
      { text: 'Ora scrivo la risposta.', textLen: 'Controllo prima.'.length, toolsBefore: 1 }
    ];
    expect(streamBlocks(buf, tools, reasoning).map((b) => b.type)).toEqual([
      'reasoning',
      'text',
      'tools',
      'reasoning',
      'text'
    ]);
  });

  it('a reasoning segment opened before a tool sits ahead of it even at the very same textLen', () => {
    const buf = '';
    const tools = [{ toolName: 'list_posts', textLen: 0, status: 'done' as const }];
    const reasoning = [{ text: 'Decido cosa guardare.', textLen: 0, toolsBefore: 0 }];
    expect(streamBlocks(buf, tools, reasoning).map((b) => b.type)).toEqual(['reasoning', 'tools']);
  });

  it('places each tool after the status line that was written before it started', () => {
    const buf = 'Read studio…\nRead media…\nRendering clip 1…\n';
    const tools = [
      { toolName: 'read_brand_studio', textLen: 'Read studio…\n'.length },
      { toolName: 'read_media', textLen: 'Read studio…\nRead media…\n'.length },
      { toolName: 'generate_video', textLen: buf.length }
    ];
    expect(streamBlocks(buf, tools).map(label)).toEqual([
      'Read studio…\n',
      'read_brand_studio',
      'Read media…\n',
      'read_media',
      'Rendering clip 1…\n',
      'generate_video'
    ]);
  });
});

describe('previewsByCall', () => {
  it('attaches previews to their own call and shows a post only once per turn', () => {
    const parts = [
      { type: 'tool-call', toolCallId: 'a', toolName: 'produce', preview: [{ post_id: '1', caption: 'ciao', platform: 'x', media_url: null, status: 'pending_user' }] },
      { type: 'tool-call', toolCallId: 'b', toolName: 'read_back', preview: [{ post_id: '1', caption: 'ciao', platform: 'x', media_url: null, status: 'pending_user' }] },
      // No caption and no media → nothing worth rendering.
      { type: 'tool-call', toolCallId: 'c', toolName: 'empty', preview: [{ post_id: '2', caption: '  ', platform: 'x', media_url: null, status: 'pending_user' }] }
    ];
    const blocks = messageBlocks('', parts);
    const map = previewsByCall(blocks);
    const calls = toolCallsOf(parts);
    expect(map.get(calls[0])?.map((p) => p.post_id)).toEqual(['1']);
    expect(map.has(calls[1])).toBe(false);
    expect(map.has(calls[2])).toBe(false);
  });
});

describe('textBubbleRange', () => {
  const tool = (name: string, id: string) => ({ type: 'tool-call', toolCallId: id, toolName: name });

  it('salta le righe di servizio: il volto scende alla prima bolla, le azioni salgono all\'ultima', () => {
    // tool → testo → tool → testo → tool: il turno comincia e finisce con qualcosa che NON è
    // una bolla, ed è il caso che spostava avatar e azioni fuori dalla risposta.
    const blocks = messageBlocks(null, [
      tool('list_posts', 'a'),
      { type: 'text', text: 'Prima bolla' },
      tool('get_brand_context', 'b'),
      { type: 'text', text: 'Ultima bolla' },
      tool('set_expression', 'c')
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'text', 'tools', 'text', 'tools']);
    expect(textBubbleRange(blocks)).toEqual({ first: 1, last: 3 });
  });

  it('un blocco di solo notice `_Goal …_` non è una bolla: diventa una card', () => {
    const blocks = messageBlocks(null, [
      { type: 'text', text: 'Fatto.' },
      { type: 'text', text: '_Goal reached — 3/3: tutti i post approvati_' }
    ]);
    const range = textBubbleRange(blocks);
    expect(range.first).toBe(0);
    expect(range.last).toBe(0);
  });

  it('turno di soli tool: nessuna bolla, quindi né volto né azioni', () => {
    const blocks = messageBlocks(null, [tool('list_posts', 'a'), tool('show_team', 'b')]);
    expect(textBubbleRange(blocks)).toEqual({ first: -1, last: -1 });
  });
});


/**
 * «12 actions taken» era vero e taceva l'unica cosa che contava: il 22/08 due di quelle dodici
 * non avevano consegnato niente, e il proprietario l'ha scoperto aprendo un link vuoto.
 */
describe('failedCallCount', () => {
  it('conta gli errori e i rifiuti ripetibili, non solo lo status live', () => {
    const calls = [
      { toolName: 'list_motion_videos', output: { videos: [] } },
      { toolName: 'render_motion_video', output: { retry: 'storyboard_first', scenes: 2 } },
      { toolName: 'review_video', output: { error: 'media_not_found' } },
      { toolName: 'update_goal', output: { success: true } }
    ];
    expect(failedCallCount(calls)).toBe(2);
  });

  it('legge anche lo status quando il turno è ancora in streaming', () => {
    expect(failedCallCount([{ toolName: 'x', status: 'error' }, { toolName: 'y', status: 'done' }])).toBe(1);
  });

  it('un turno tutto riuscito non conta niente', () => {
    expect(failedCallCount([{ toolName: 'x', output: { ok: 1 } }])).toBe(0);
  });
});

describe('reply e ask_user sono IL messaggio, non un attrezzo', () => {
	it('non compaiono fra le chip dei tool nel transcript', () => {
		const blocks = messageBlocks('Ecco il video.', [
			{ type: 'tool-call', toolName: 'motion_render', input: {} },
			{ type: 'tool-call', toolName: 'reply', input: { message: 'Ecco il video.' } }
		]);
		const chips = blocks.filter((b) => b.type === 'tools').flatMap((b) => (b as { calls: Array<{ toolName?: string }> }).calls);
		expect(chips.map((c) => c.toolName)).toEqual(['motion_render']);
	});

	it('nemmeno in diretta', () => {
		const blocks = streamBlocks('Ecco il video.', [
			{ toolCallId: 'a', toolName: 'motion_render', textLen: 0 },
			{ toolCallId: 'b', toolName: 'reply', textLen: 14 }
		] as never);
		const chips = blocks.filter((b) => b.type === 'tools').flatMap((b) => (b as { calls: Array<{ toolName?: string }> }).calls);
		expect(chips.map((c) => c.toolName)).toEqual(['motion_render']);
	});
});
