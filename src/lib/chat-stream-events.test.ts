import { describe, it, expect } from 'vitest';
import {
  applyChatStreamEvent,
  closeDanglingToolCalls,
  emptyStreamState,
  mergeStreamToolCalls,
  readSseEvents,
  toolsForMirror
} from './chat-stream-events';

const feed = (events: unknown[]) => {
  const state = emptyStreamState();
  for (const e of events) applyChatStreamEvent(state, e);
  return state;
};

describe('applyChatStreamEvent', () => {
  it('folds a turn the same way the browser paints it', () => {
    const state = feed([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', delta: 'penso' },
      { type: 'text-delta', delta: 'Guardo ' },
      { type: 'text-delta', delta: 'i post.' },
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'read_posts' },
      { type: 'tool-output-available', toolCallId: 't1' },
      { type: 'text-delta', delta: ' Fatto.' }
    ]);
    expect(state.text).toBe('Guardo i post. Fatto.');
    expect(state.reasoning).toBe('penso');
    // textLen pins the call between the two text segments — that is the chronology.
    expect(state.tools).toEqual([
      { toolCallId: 't1', toolName: 'read_posts', status: 'done', textLen: 14 }
    ]);
  });

  it('keeps the first textLen when start and available both arrive, and flags failures', () => {
    const state = feed([
      { type: 'text-delta', delta: 'ciao' },
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'x' },
      { type: 'text-delta', delta: ' ancora' },
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'x' }
    ]);
    expect(state.tools[0].textLen).toBe(4);
    expect(feed([{ type: 'error' }]).failed).toBe(true);
    expect(feed([{ type: 'finish', finishReason: 'error' }]).failed).toBe(true);
    expect(feed([{ type: 'finish', finishReason: 'stop' }]).failed).toBe(false);
  });

  it('accepts the legacy `id` field for a tool call', () => {
    expect(feed([{ type: 'tool-input-start', id: 'legacy', toolName: 'y' }]).tools[0].toolCallId).toBe('legacy');
  });

  // What an open chip reads. `tool-input-start` fires before the params are parsed, so the second
  // event is the one that carries them — and it must not blank anything the first already set.
  it('carries the params and the result onto the call, so a live chip can open', () => {
    const state = feed([
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'list_posts' },
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'list_posts', input: { limit: 3 } },
      { type: 'tool-output-available', toolCallId: 't1', output: { posts: ['p1'] } }
    ]);
    expect(state.tools[0]).toMatchObject({
      status: 'done',
      input: { limit: 3 },
      output: { posts: ['p1'] }
    });
  });

  it('keeps the params of a call that then failed, and records why', () => {
    const state = feed([
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'x', input: { a: 1 } },
      { type: 'tool-output-error', toolCallId: 't1', errorText: 'timeout' }
    ]);
    expect(state.tools[0]).toMatchObject({ status: 'error', input: { a: 1 }, errorText: 'timeout' });
  });
});

describe('the resumable snapshot', () => {
  const live = () =>
    feed([
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'x', input: { a: 1 } },
      { type: 'tool-output-available', toolCallId: 't1', output: 'big' }
    ]).tools;

  /**
   * I risultati restavano fuori perché la riga è riscritta di continuo. Ma è la riga da cui si
   * ricostruisce il turno quando la scheda non è attaccata all'SSE: senza risultati una chip
   * aperta lì dentro non dice niente, e dopo un reload non si sa cosa un tool ha risposto. Ci
   * stanno, col tetto — la stessa regola già valida per i parametri.
   */
  it('tiene i RISULTATI, col tetto: una chip che non dice cosa ha risposto non serve', () => {
    const mirrored = toolsForMirror(live());
    expect(mirrored[0].output).toBe('big');
  });

  it('un risultato enorme viene troncato e dichiarato, non fatto sparire', () => {
    const huge = feed([
      { type: 'tool-input-available', toolCallId: 't3', toolName: 'x', input: { a: 1 } },
      { type: 'tool-output-available', toolCallId: 't3', output: 'z'.repeat(9000) }
    ]).tools;
    const got = String(toolsForMirror(huge)[0].output);
    expect(got.length).toBeLessThan(3000);
    expect(got).toContain('…[+');
  });

  /**
   * I parametri restano, ed è il punto: la scheda legge la riga rispecchiata ogni volta che non è
   * attaccata all'SSE — turno nel worker, tab riaperta, riconnessione — cioè proprio i turni lunghi.
   * Toglierli faceva aspettare la fine di un `delegate_task` per sapere con che brief era partito.
   */
  it('tiene i PARAMETRI: su un tool lungo sono l’unica cosa che si vuole sapere mentre gira', () => {
    expect(toolsForMirror(live())[0].input).toEqual({ a: 1 });
  });

  it('un input enorme viene troncato e dichiarato, non fatto sparire', () => {
    const huge = feed([
      { type: 'tool-input-available', toolCallId: 't2', toolName: 'x', input: { brief: 'z'.repeat(9000) } }
    ]).tools;
    const got = String(toolsForMirror(huge)[0].input);
    expect(got.length).toBeLessThan(3000);
    expect(got).toContain('…[+');
  });

  it('does not close chips the tab already had open when a poll folds the snapshot back in', () => {
    const merged = mergeStreamToolCalls(live(), toolsForMirror(live()));
    expect(merged[0]).toMatchObject({ input: { a: 1 }, output: 'big' });
  });

  it('takes the snapshot as truth for a call this tab never saw', () => {
    const merged = mergeStreamToolCalls([], [{ toolCallId: 't9', toolName: 'y', status: 'running' }]);
    expect(merged).toEqual([{ toolCallId: 't9', toolName: 'y', status: 'running' }]);
  });
});

describe('closeDanglingToolCalls', () => {
  /**
   * L'incidente del 27/8 (riga di produzione `7bc0f716`): la sessione è morta a metà di un
   * `delegate_task`, il turno è ripreso con una sessione fresca che non riemetteva il risultato
   * del call precedente, e il partial finale ha mantenuto la chip «running» per sempre — loading
   * perpetuo in UI fino al refresh. Lo stream che avrebbe consegnato la chiusura è finito: una
   * chip ancora aperta a fine stream è una bugia, e va dichiarata come errore onesto.
   */
  it('a fine stream una chip ancora running diventa un errore dichiarato', () => {
    const state = feed([
      { type: 'tool-input-available', toolCallId: 'd1', toolName: 'delegate_task', input: { role: 'sandbox' } },
      { type: 'text-delta', delta: 'continuo oltre' },
      { type: 'finish', finishReason: 'stop' }
    ]);
    expect(state.tools[0].status).toBe('running');

    const changed = closeDanglingToolCalls(state);

    expect(changed).toBe(true);
    expect(state.tools[0].status).toBe('error');
    expect(state.tools[0].errorText).toBeTruthy();
  });

  it('una chip già chiusa non si tocca, e uno stream senza perdite non cambia nulla', () => {
    const state = feed([
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'shell', input: { cmd: 'ls' } },
      { type: 'tool-output-available', toolCallId: 't1', output: 'ok' },
      { type: 'finish', finishReason: 'stop' }
    ]);

    expect(closeDanglingToolCalls(state)).toBe(false);
    expect(state.tools[0]).toMatchObject({ status: 'done', output: 'ok' });
  });
});

describe('readSseEvents', () => {
  it('parses whole data lines and hands back the partial tail for the next chunk', () => {
    const { events, rest } = readSseEvents('data: {"type":"text-delta","delta":"a"}\ndata: {"type":"tex');
    expect(events).toEqual([{ type: 'text-delta', delta: 'a' }]);
    expect(rest).toBe('data: {"type":"tex');
  });

  it('skips [DONE] and malformed lines instead of throwing', () => {
    const { events } = readSseEvents('data: [DONE]\ndata: not-json\nnoise\n');
    expect(events).toEqual([]);
  });

  it('parses CRLF SSE lines (proxies / some runtimes)', () => {
    const { events } = readSseEvents('data: {"type":"text-delta","delta":"ok"}\r\n');
    expect(events).toEqual([{ type: 'text-delta', delta: 'ok' }]);
  });

  // The server and the browser must rebuild the same buffer from the same bytes — that identity is
  // what makes a resumed stream continue instead of restart.
  it('rebuilds an identical state from a stream split at arbitrary boundaries', () => {
    const raw =
      'data: {"type":"text-delta","delta":"Ciao "}\n' +
      'data: {"type":"tool-input-start","toolCallId":"t1","toolName":"read_posts"}\n' +
      'data: {"type":"text-delta","delta":"mondo"}\n';
    const whole = feed(readSseEvents(raw).events);

    const chunked = emptyStreamState();
    let buf = '';
    for (let i = 0; i < raw.length; i += 7) {
      buf += raw.slice(i, i + 7);
      const { events, rest } = readSseEvents(buf);
      buf = rest;
      for (const e of events) applyChatStreamEvent(chunked, e);
    }
    expect(chunked).toEqual(whole);
    expect(chunked.text).toBe('Ciao mondo');
  });
});

describe('reply è IL messaggio, anche in diretta', () => {
	it("il testo di reply entra nel flusso live (thread 3ac9fc4b, 23/8: chip senza bolla)", () => {
		const state = emptyStreamState();
		applyChatStreamEvent(state, { type: 'text-delta', delta: 'Verifico il sito. ' });
		applyChatStreamEvent(state, {
			type: 'tool-input-available',
			toolCallId: 'r1',
			toolName: 'reply',
			input: { message: 'Il sito è raggiungibile: homepage ok.', delivered: [] }
		});
		expect(state.text).toContain('Il sito è raggiungibile: homepage ok.');
		// e il chip resta: il tool è comunque tracciato
		expect(state.tools.some((t) => t.toolName === 'reply')).toBe(true);
	});

	it('nessun doppione se il messaggio è già in coda al testo', () => {
		const state = emptyStreamState();
		applyChatStreamEvent(state, { type: 'text-delta', delta: 'Fatto: post 42.' });
		applyChatStreamEvent(state, {
			type: 'tool-input-available',
			toolCallId: 'r1',
			toolName: 'reply',
			input: { message: 'Fatto: post 42.' }
		});
		expect(state.text).toBe('Fatto: post 42.');
	});
});
