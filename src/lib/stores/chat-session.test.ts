import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  __resetChatSessionForTests,
  startChatSession,
  cancelChatSession,
  beginJobPolling,
  primeChatSession,
  hydrateSessionFromStorage,
  readPersistedSession,
  watchToolJobs,
  detachToolJobMessages,
  stopWatchingToolJobs,
  isWatchingToolJobs,
  getSession,
  chatSessions,
  backgroundToolThreads,
  backgroundToolJobs,
  busyThreadIds,
  clearRemoteBusyThreads,
  setThreadRemoteBusy,
  takeLiveHandoff
} from './chat-session';
import { applyChatStreamEvent, emptyStreamState } from '$lib/chat-stream-events';

function mockSessionStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage,
    configurable: true,
    writable: true
  });
  return storage;
}

function sseChunk(events: object[]) {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n`).join('') + 'data: [DONE]\n\n';
  return new TextEncoder().encode(payload);
}

describe('chat-session store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSessionStorage();
    __resetChatSessionForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('unexpected fetch')))
    );
  });

  afterEach(() => {
    __resetChatSessionForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /**
   * CHAT DI GRUPPO — chi sta scrivendo, per la riga di caricamento.
   *
   * La firma arriva con gli HEADER (non con un evento nello stream): la riga di progresso compare
   * prima del primo token, quindi l'identità dev'essere già lì quando l'avatar si accende. E la
   * seconda voce, che è un job accodato, deve poter SOSTITUIRE la prima — non ereditarla, o
   * mostrerebbe il volto di chi ha appena finito.
   */
  it('la firma della voce arriva dagli header e sopravvive al ricaricamento', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            // Con del testo: uno snapshot vuoto non si salva affatto (non c'è niente da riprendere).
            c.enqueue(sseChunk([{ type: 'text-delta', delta: 'Taglio a 12s.' }]));
            c.close();
          }
        }),
        {
          status: 200,
          headers: {
            'X-Chat-Job-Id': 'job-room-1',
            'X-Chat-Speaker': 'motion',
            'Content-Type': 'text/event-stream'
          }
        }
      )
    );

    const p = startChatSession({
      brandSlug: 'acme',
      threadId: 'room-1',
      userText: 'fammi il reel'
    });
    await vi.runAllTimersAsync();
    await p;

    expect(getSession('room-1')?.speaker).toBe('motion');
    expect(readPersistedSession('room-1')?.speaker).toBe('motion');
  });

  it('la seconda voce sostituisce la prima quando si riaggancia il job accodato', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ start: (c) => c.close() }), {
        status: 200,
        headers: { 'X-Chat-Job-Id': 'job-a', 'X-Chat-Speaker': 'motion', 'Content-Type': 'text/event-stream' }
      })
    );
    const p = startChatSession({ brandSlug: 'acme', threadId: 'room-2', userText: 'e i numeri?' });
    await vi.runAllTimersAsync();
    await p;
    expect(getSession('room-2')?.speaker).toBe('motion');

    // Il turno accodato della SECONDA voce: un altro job, un'altra firma.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ job: { id: 'job-b', status: 'running', partial: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    beginJobPolling({ brandSlug: 'acme', threadId: 'room-2', jobId: 'job-b', speaker: 'analyst' });
    expect(getSession('room-2')?.speaker).toBe('analyst');
  });

  it('streams text/tools into the session and persists them', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              sseChunk([
                { type: 'text-delta', delta: 'Ciao ' },
                { type: 'tool-input-start', toolCallId: 't1', toolName: 'produce_week' },
                { type: 'text-delta', delta: 'mondo' }
              ])
            );
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { 'X-Chat-Job-Id': 'job-1', 'Content-Type': 'text/event-stream' }
        }
      )
    );

    const resultPromise = startChatSession({
      brandSlug: 'acme',
      threadId: 'thread-1',
      userText: 'genera settimana'
    });

    // Let the reader process the stream
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBe('ok');

    const snap = getSession('thread-1');
    expect(snap?.jobId).toBe('job-1');
    expect(snap?.streamBuf).toBe('Ciao mondo');
    // textLen = the tool fired after "Ciao " and before "mondo", so the UI can render it there.
    expect(snap?.streamToolCalls).toEqual([
      { toolCallId: 't1', toolName: 'produce_week', status: 'running', textLen: 5 }
    ]);
    expect(snap?.loading).toBe(false);
    expect(snap?.completedAt).toBeTruthy();

    const persisted = readPersistedSession('thread-1');
    expect(persisted?.streamBuf).toBe('Ciao mondo');
    expect(persisted?.streamToolCalls).toHaveLength(1);
  });

  it('pensa → scrive → agisce → pensa → scrive: due blocchi di ragionamento, in ordine', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              sseChunk([
                { type: 'reasoning-start' },
                { type: 'reasoning-delta', delta: 'Guardo i post esistenti.' },
                { type: 'text-delta', delta: 'Controllo prima. ' },
                { type: 'tool-input-start', toolCallId: 't1', toolName: 'list_posts' },
                { type: 'tool-output-available', toolCallId: 't1', output: { ok: true } },
                { type: 'reasoning-start' },
                { type: 'reasoning-delta', delta: 'Ora scrivo la risposta.' },
                { type: 'text-delta', delta: 'Fatto.' }
              ])
            );
            controller.close();
          }
        }),
        { status: 200, headers: { 'X-Chat-Job-Id': 'job-2', 'Content-Type': 'text/event-stream' } }
      )
    );

    const resultPromise = startChatSession({
      brandSlug: 'acme',
      threadId: 'thread-2',
      userText: 'controlla i post'
    });
    await vi.runAllTimersAsync();
    await resultPromise;

    const snap = getSession('thread-2');
    expect(snap?.streamReasoningSegments).toEqual([
      { text: 'Guardo i post esistenti.', textLen: 0, toolsBefore: 0 },
      { text: 'Ora scrivo la risposta.', textLen: 'Controllo prima. '.length, toolsBefore: 1 }
    ]);
  });

  it('accepts legacy tool-input-start.id and marks tools done on tool-output-available', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              sseChunk([
                { type: 'reasoning-start', id: 'r1' },
                { type: 'reasoning-delta', id: 'r1', delta: 'ok' },
                { type: 'tool-input-start', id: 'legacy', toolName: 'discover_competitors' },
                { type: 'tool-output-available', toolCallId: 'legacy', output: { ok: true } }
              ])
            );
            controller.close();
          }
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    );

    const resultPromise = startChatSession({
      brandSlug: 'acme',
      threadId: 'thread-tools',
      userText: 'analizza competitors'
    });
    await vi.runAllTimersAsync();
    expect(await resultPromise).toBe('ok');

    const snap = getSession('thread-tools');
    expect(snap?.streamReasoning).toBe('ok');
    // The result rides along on the call: that is what an opened chip reads back.
    expect(snap?.streamToolCalls).toEqual([
      {
        toolCallId: 'legacy',
        toolName: 'discover_competitors',
        status: 'done',
        textLen: 0,
        output: { ok: true }
      }
    ]);
  });

  it('cancel aborts fetch, keeps buffers, and POSTs cancel action', async () => {
    const fetchMock = vi.mocked(fetch);
    let abortSeen = false;

    fetchMock.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          abortSeen = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    // cancel POST
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));

    const startPromise = startChatSession({
      brandSlug: 'acme',
      threadId: 'thread-2',
      userText: 'stop me'
    });

    // Allow session to register with loading=true
    await Promise.resolve();
    expect(getSession('thread-2')?.loading).toBe(true);

    await cancelChatSession('thread-2');
    await startPromise;

    expect(abortSeen).toBe(true);
    const snap = getSession('thread-2');
    // Session kept so the UI can fold text/tools already shown.
    expect(snap).not.toBeNull();
    expect(snap?.intentionalCancel).toBe(true);
    expect(snap?.loading).toBe(false);
    expect(snap?.completedAt).toBeTruthy();
  });

  it('non-intentional AbortError with jobId keeps loading and polls the job', async () => {
    const fetchMock = vi.mocked(fetch);
    let readerCancel: (() => void) | null = null;

    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          const stream = new ReadableStream({
            start(controller) {
              readerCancel = () => {
                try {
                  controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                } catch {
                  /* already closed */
                }
              };
            }
          });
          resolve(
            new Response(stream, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream', 'X-Chat-Job-Id': 'job-nav' }
            })
          );
        })
    );
    // pollUntilDone status checks
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ job: { status: 'running', partial: { text: 'hi' } } }), {
        status: 200
      })
    );

    const startPromise = startChatSession({
      brandSlug: 'acme',
      threadId: 'thread-abort-poll',
      userText: 'navigate away'
    });
    await Promise.resolve();
    await Promise.resolve();

    // Simulate navigation tearing down the reader after job id is known.
    const snapMid = getSession('thread-abort-poll');
    expect(snapMid?.jobId).toBe('job-nav');
    readerCancel?.();

    expect(await startPromise).toBe('ok');
    const snap = getSession('thread-abort-poll');
    expect(snap?.loading).toBe(true);
    expect(snap?.jobId).toBe('job-nav');

    await vi.advanceTimersByTimeAsync(400);
    expect(getSession('thread-abort-poll')?.streamBuf).toBe('hi');
  });

  it('cancel with jobId notifies the server', async () => {
    const fetchMock = vi.mocked(fetch);
    // Polling fetch for beginJobPolling
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('action') || (u.includes('/chat') && !u.includes('job_id'))) {
        return Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
      }
      // job status still running
      return Promise.resolve(
        new Response(JSON.stringify({ job: { status: 'running' } }), { status: 200 })
      );
    });

    beginJobPolling({ brandSlug: 'acme', threadId: 'thread-3', jobId: 'job-xyz' });
    expect(getSession('thread-3')?.loading).toBe(true);
    expect(get(busyThreadIds).has('thread-3')).toBe(true);

    await cancelChatSession('thread-3');

    const cancelCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/app/acme/chat') &&
        init &&
        typeof init === 'object' &&
        (init as RequestInit).method === 'POST'
    );
    expect(cancelCall).toBeTruthy();
    const body = JSON.parse(String((cancelCall![1] as RequestInit).body));
    expect(body).toMatchObject({ action: 'cancel', thread_id: 'thread-3', job_id: 'job-xyz' });
    expect(getSession('thread-3')).not.toBeNull();
    expect(getSession('thread-3')?.intentionalCancel).toBe(true);
  });

  it('cancel senza jobId avvisa comunque il server: un turno kit non ha una riga chat_jobs', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 }))
    );

    beginJobPolling({ brandSlug: 'acme', threadId: 'thread-kit', jobId: '' });
    await cancelChatSession('thread-kit');

    const cancelCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/app/acme/chat') && (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(cancelCall).toBeTruthy();
    const body = JSON.parse(String((cancelCall![1] as RequestInit).body));
    expect(body).toMatchObject({ action: 'cancel', thread_id: 'thread-kit' });
    expect(body.job_id).toBeUndefined();
  });

  /**
   * Il difetto visto in produzione il 25/8: turno kit lungo, l'utente ricarica la pagina, la
   * pagina si riaggancia al run orfano e mostra Stop — ma `sessions` è una mappa in memoria,
   * quindi dopo il reload è vuota e lo Stop usciva da qui senza toccare il server. Il turno
   * continuava a spendere, i messaggi restavano in coda, e «Send now» rimbalzava in coda perché
   * passa da qui prima di chiedere l'invio.
   */
  it('cancel senza sessione locale (dopo un reload) avvisa comunque il server', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 }))
    );

    await cancelChatSession('thread-orfano', 'acme');

    const cancelCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/app/acme/chat') && (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(cancelCall).toBeTruthy();
    const body = JSON.parse(String((cancelCall![1] as RequestInit).body));
    expect(body).toMatchObject({ action: 'cancel', thread_id: 'thread-orfano' });
  });

  it('cancel retains stream buffers that were already written', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/chat') && !String(url).includes('?')) {
        return Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ job: { status: 'running' } }), { status: 200 })
      );
    });

    beginJobPolling({
      brandSlug: 'acme',
      threadId: 'thread-keep',
      jobId: 'job-keep',
      seed: {
        streamBuf: 'Ciao parziale',
        streamToolCalls: [{ toolCallId: 't1', toolName: 'list_articles', status: 'running', textLen: 4 }],
        streamReasoning: ''
      }
    });

    expect(getSession('thread-keep')?.streamBuf).toBe('Ciao parziale');
    await cancelChatSession('thread-keep');

    const snap = getSession('thread-keep');
    expect(snap?.streamBuf).toBe('Ciao parziale');
    expect(snap?.streamToolCalls.some((t) => t.toolName === 'list_articles')).toBe(true);
    expect(snap?.intentionalCancel).toBe(true);
    expect(snap?.loading).toBe(false);
  });

  it('watchToolJobs keeps sidebar busy after detach and clears when jobs finish', async () => {
    const fetchMock = vi.mocked(fetch);
    let pending = [{ id: 'j1', tool_name: 'produce_week', status: 'running' }];
    const onMessages = vi.fn();
    const onIdle = vi.fn();

    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('pending_tools=1')) {
        return Promise.resolve(new Response(JSON.stringify({ jobs: pending }), { status: 200 }));
      }
      if (u.includes('/chat?thread=')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              messages: [{ role: 'assistant', content: 'ancora in corso…' }]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(u));
    });

    watchToolJobs({
      brandSlug: 'acme',
      threadId: 'thread-4',
      onMessages,
      onIdle
    });

    await vi.runOnlyPendingTimersAsync();
    expect(isWatchingToolJobs('thread-4')).toBe(true);
    expect(get(backgroundToolThreads).has('thread-4')).toBe(true);
    expect(onMessages).toHaveBeenCalled();

    // User leaves the page — detach callbacks but keep watcher
    detachToolJobMessages('thread-4');
    expect(isWatchingToolJobs('thread-4')).toBe(true);
    expect(get(backgroundToolThreads).has('thread-4')).toBe(true);

    // Jobs finish — sidebar pulse must clear even without a mounted page
    pending = [];
    await vi.advanceTimersByTimeAsync(3000);
    await vi.runOnlyPendingTimersAsync();

    expect(isWatchingToolJobs('thread-4')).toBe(false);
    expect(get(backgroundToolThreads).has('thread-4')).toBe(false);
    // Anche la lista, non solo il flag: l'indicatore la legge per dire COSA sta girando, e una
    // riga rimasta lì continuerebbe a nominare un lavoro finito. Vale per done, failed e scaduto —
    // il poll elenca solo pending/running, quindi i tre esiti escono dalla stessa porta.
    expect(get(backgroundToolJobs)['thread-4']).toBeUndefined();
    // onIdle was detached with the page — that's fine; pulse clear is what matters
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('calls onIdle when jobs finish while the page is still attached', async () => {
    const fetchMock = vi.mocked(fetch);
    let pending = [{ id: 'j1', status: 'running' }];
    const onIdle = vi.fn();

    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('pending_tools=1')) {
        return Promise.resolve(new Response(JSON.stringify({ jobs: pending }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    });

    watchToolJobs({ brandSlug: 'acme', threadId: 'thread-4b', onIdle });
    await vi.runOnlyPendingTimersAsync();

    pending = [];
    await vi.advanceTimersByTimeAsync(3000);
    await vi.runOnlyPendingTimersAsync();

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(isWatchingToolJobs('thread-4b')).toBe(false);
  });

  it('stopWatchingToolJobs clears busy state immediately', () => {
    watchToolJobs({ brandSlug: 'acme', threadId: 'thread-5' });
    expect(get(backgroundToolThreads).has('thread-5')).toBe(true);
    stopWatchingToolJobs('thread-5');
    expect(get(backgroundToolThreads).has('thread-5')).toBe(false);
    expect(isWatchingToolJobs('thread-5')).toBe(false);
  });
});

describe('i segmenti del ragionamento, dal reducer condiviso', () => {
  const fold = (events: unknown[]) => {
    const state = emptyStreamState();
    for (const e of events) applyChatStreamEvent(state, e);
    return state;
  };

  it('opens a segment before the first delta (placeholder), then accumulates into it', () => {
    const state = fold([
      { type: 'reasoning-start' },
      { type: 'reasoning-delta', delta: 'sto ' },
      { type: 'reasoning-delta', delta: 'pensando' }
    ]);
    expect(state.reasoningSegments).toEqual([{ text: 'sto pensando', textLen: 0, toolsBefore: 0 }]);
    expect(state.reasoningOpen).toBe(true);
  });

  it('a text delta closes the open segment; the next reasoning delta opens a NEW one', () => {
    const closed = fold([
      { type: 'reasoning-delta', delta: 'uno' },
      { type: 'text-delta', delta: 'Ciao.' }
    ]);
    // still just one segment — text does not touch it, only closes it
    expect(closed.reasoningSegments).toHaveLength(1);
    expect(closed.reasoningOpen).toBe(false);

    applyChatStreamEvent(closed, { type: 'reasoning-delta', delta: 'due' });
    expect(closed.reasoningSegments).toEqual([
      { text: 'uno', textLen: 0, toolsBefore: 0 },
      { text: 'due', textLen: 5, toolsBefore: 0 }
    ]);
  });

  it('a tool call closes the open segment too, and records how many tools existed before it', () => {
    const state = fold([
      { type: 'reasoning-delta', delta: 'decido' },
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'shell' },
      { type: 'reasoning-delta', delta: 'continuo' }
    ]);
    expect(state.reasoningSegments[1]).toEqual({ text: 'continuo', textLen: 0, toolsBefore: 1 });
  });

  it('ignores events unrelated to reasoning/text/tools (finish, error, …)', () => {
    const state = fold([{ type: 'reasoning-delta', delta: 'uno' }, { type: 'finish' }]);
    expect(state.reasoningSegments).toEqual([{ text: 'uno', textLen: 0, toolsBefore: 0 }]);
    expect(state.reasoningOpen).toBe(true);
  });
});

describe('remote busy threads', () => {
	beforeEach(() => clearRemoteBusyThreads());

	it('marks a thread generating in another tab as busy here', () => {
		expect(get(busyThreadIds).has('t-remote')).toBe(false);
		setThreadRemoteBusy('t-remote', true);
		expect(get(busyThreadIds).has('t-remote')).toBe(true);
	});

	it('clears it when that turn ends', () => {
		setThreadRemoteBusy('t-remote', true);
		setThreadRemoteBusy('t-remote', false);
		expect(get(busyThreadIds).has('t-remote')).toBe(false);
	});

	it('drops every remote dot when the channel goes away', () => {
		// A socket that dies mid-turn would otherwise leave the sidebar pulsing forever.
		setThreadRemoteBusy('a', true);
		setThreadRemoteBusy('b', true);
		clearRemoteBusyThreads();
		expect(get(busyThreadIds).size).toBe(0);
	});
});

/**
 * I bug del 23-24/8: turni KIT (che non portano `X-Chat-Job-Id`) e le finestre di race del
 * client. Stesso setup del blocco principale — hook propri perché il describe è top-level.
 */
describe('chat-session — turni kit e race del client (23-24/8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSessionStorage();
    __resetChatSessionForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('unexpected fetch')))
    );
  });

  afterEach(() => {
    __resetChatSessionForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('pre-header: una sessione vera in volo è busy anche senza jobId né buffer', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReturnValueOnce(new Promise(() => {}) as never); // il POST non risponde mai
    void startChatSession({ brandSlug: 'acme', threadId: 'th-race', userText: 'primo' });
    // Il secondo invio arriva PRIMA degli header del primo: senza il flag `primed` passava,
    // apriva un secondo POST e l'abort del gemello orfanava la UI del superstite.
    const second = await startChatSession({ brandSlug: 'acme', threadId: 'th-race', userText: 'secondo' });
    expect(second).toBe('busy');
    expect(getSession('th-race')?.loading).toBe(true); // il primo è ancora vivo
  });

  it('il placeholder di primeChatSession resta upgradabile dal proprio turno', async () => {
    primeChatSession({ brandSlug: 'acme', threadId: 'th-prime', pendingUserText: 'ciao' });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(sseChunk([{ type: 'text-delta', delta: 'ok' }]));
            c.close();
          }
        }),
        { status: 200, headers: { 'X-Chat-Job-Id': 'job-p', 'Content-Type': 'text/event-stream' } }
      )
    );
    const p = startChatSession({ brandSlug: 'acme', threadId: 'th-prime', userText: 'ciao' });
    await vi.runAllTimersAsync();
    expect(await p).toBe('ok');
  });

  it("409 {error:'busy'} dal server → 'busy' (il chiamante accoda), niente barra rossa", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'busy' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const p = startChatSession({ brandSlug: 'acme', threadId: 'th-409', userText: 'reinvio' });
    await vi.runAllTimersAsync();
    expect(await p).toBe('busy');
    expect(getSession('th-409')).toBeNull(); // niente placeholder «sto pensando» orfano
  });

  it('reload di un turno kit: hydrate NON risuscita loading senza un job da pollare', () => {
    sessionStorage.setItem(
      'anomalia:chat-stream:th-kit',
      JSON.stringify({
        brandSlug: 'acme',
        threadId: 'th-kit',
        jobId: null,
        loading: true,
        streamBuf: 'testo già visto',
        streamToolCalls: [],
        streamReasoning: '',
        streamReasoningSegments: [],
        pendingUserText: 'fai il video',
        completedAt: null,
        error: null,
        startedAt: Date.now(),
        savedAt: Date.now()
      })
    );
    const snap = hydrateSessionFromStorage({ brandSlug: 'acme', threadId: 'th-kit' });
    // Mutazione pinnata: `loading: persisted.loading || !!jobId` qui tornava true e spegneva il
    // poll kit-run della pagina — spinner infinito su un parziale congelato (bug del 23/8).
    expect(snap?.loading).toBe(false);
    expect(snap?.streamBuf).toBe('testo già visto'); // i buffer restano per la continuità visiva
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // e nessun poll: non c'è alcun job
  });

  it('reload di un turno legacy (jobId presente): loading resta true e il poll parte', async () => {
    sessionStorage.setItem(
      'anomalia:chat-stream:th-leg',
      JSON.stringify({
        brandSlug: 'acme',
        threadId: 'th-leg',
        jobId: 'job-z',
        loading: true,
        streamBuf: 'metà',
        streamToolCalls: [],
        streamReasoning: '',
        streamReasoningSegments: [],
        pendingUserText: 'vai',
        completedAt: null,
        error: null,
        startedAt: Date.now(),
        savedAt: Date.now()
      })
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ job: { id: 'job-z', status: 'done', partial: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never
    );
    const snap = hydrateSessionFromStorage({ brandSlug: 'acme', threadId: 'th-leg' });
    expect(snap?.loading).toBe(true);
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('job_id=job-z'), expect.anything());
    expect(getSession('th-leg')?.loading).toBe(false);
  });

  it('rete caduta a metà stream kit: dismiss pulito, niente errore né fold del parziale', async () => {
    const fetchMock = vi.mocked(fetch);
    // pull-based: il primo read consegna il chunk, il SECONDO rigetta — un `error()` in start()
    // svuoterebbe la coda e simulerebbe un errore pre-stream, non a metà turno.
    let pulls = 0;
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(c) {
            if (pulls++ === 0) c.enqueue(sseChunk([{ type: 'text-delta', delta: 'metà turno ' }]));
            else c.error(new TypeError('Failed to fetch'));
          }
        }),
        // niente X-Chat-Job-Id: è un turno kit
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const p = startChatSession({ brandSlug: 'acme', threadId: 'th-drop', userText: 'vai' });
    await vi.runAllTimersAsync();
    // 'ok' e sessione DISMESSA: `markSessionError` qui foldava il parziale come bolla e il poll
    // kit-run faceva ricrescere lo STESSO testo accanto — doppione con barra rossa su turno vivo.
    expect(await p).toBe('ok');
    expect(getSession('th-drop')).toBeNull();
    expect(readPersistedSession('th-drop')).toBeNull();
  });

  /**
   * La sessione si dimette, ma quello che sapeva NO. Chi la sostituisce è il riaggancio dal
   * poll, e lo snapshot del server è lossy per costruzione: payload dei tool tagliati a duemila
   * caratteri. La scheda quei payload li ha interi — buttarli e poi rileggerli mozzati è l'unico
   * motivo per cui una chip riagganciata mostrava meno di quella viva un istante prima.
   */
  it('la sessione dimessa lascia i buffer interi a chi riaggancia', async () => {
    const fetchMock = vi.mocked(fetch);
    const whole = 'r'.repeat(9_000);
    let pulls = 0;
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(c) {
            if (pulls++ === 0) {
              c.enqueue(
                sseChunk([
                  { type: 'reasoning-delta', delta: 'valuto' },
                  { type: 'text-delta', delta: 'ci penso ' },
                  { type: 'tool-input-available', toolCallId: 'd1', toolName: 'delegate_task', input: { brief: 'lungo' } },
                  { type: 'tool-output-available', toolCallId: 'd1', output: whole }
                ])
              );
            } else c.error(new TypeError('Failed to fetch'));
          }
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const p = startChatSession({ brandSlug: 'acme', threadId: 'th-hand', userText: 'vai' });
    await vi.runAllTimersAsync();
    await p;

    const handoff = takeLiveHandoff('th-hand');
    expect(handoff?.text).toBe('ci penso ');
    expect(handoff?.tools[0].output).toBe(whole);
    expect(handoff?.reasoningSegments).toEqual([{ text: 'valuto', textLen: 0, toolsBefore: 0 }]);
    // Si consuma una volta sola: il turno dopo non deve ereditare quello di prima.
    expect(takeLiveHandoff('th-hand')).toBeNull();
  });

  it('POST mai atterrato (zero byte ricevuti): resta il percorso errore', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const p = startChatSession({ brandSlug: 'acme', threadId: 'th-nopost', userText: 'vai' });
    await vi.runAllTimersAsync();
    expect(await p).toBe('error');
    expect(getSession('th-nopost')?.error).toBe('chat.error');
  });

  it('socket appeso: il watchdog stacca dopo 90s e il turno kit si dimette (il poll della pagina riaggancia)', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(sseChunk([{ type: 'text-delta', delta: 'inizio' }]));
            // poi il silenzio: il proxy non chiude mai il TCP, reader.read() non rigetta mai
          }
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    );
    const p = startChatSession({ brandSlug: 'acme', threadId: 'th-stall', userText: 'vai' });
    await vi.advanceTimersByTimeAsync(91_000);
    expect(await p).toBe('ok');
    expect(getSession('th-stall')).toBeNull();
  });
});
