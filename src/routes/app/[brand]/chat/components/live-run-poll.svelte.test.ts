import { describe, it, expect, vi, afterEach } from 'vitest';
import { startLiveRunPoll } from './live-run-poll.svelte';
import { LIVE_POLL_MS } from './kit-run';

afterEach(() => vi.useRealTimers());

/**
 * Il cappio reattivo che ha causato il difetto — l'effetto che legge il run e lo riscrive — QUI
 * non è verificabile: in questo ambiente di test gli effetti Svelte non vengono eseguiti
 * (`$effect.root` + `flushSync` non fa girare il corpo). Un test che passa in entrambi i sensi
 * è peggio di nessun test, quindi non c'è: la garanzia è `untrack` in `live-run-poll.svelte.ts`
 * e la misura dal browser nel changelog. Quello che resta qui è il ritmo, che è testabile.
 */
describe('il battito che segue un turno vivo', () => {
  it('non parte affatto mentre questa scheda sta già streammando il turno', async () => {
    vi.useFakeTimers();
    let fetches = 0;
    const stop = startLiveRunPoll({
      isBusy: () => true,
      currentRun: () => null,
      isHidden: () => false,
      fetchRun: async () => {
        fetches++;
        return new Response(null, { status: 204 });
      },
      onRun: () => {},
      onFinished: () => {}
    });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 4);
    stop();
    expect(fetches).toBe(0);
  });

  it('a vuoto rallenta invece di chiedere a ogni tick', async () => {
    vi.useFakeTimers();
    let fetches = 0;
    const stop = startLiveRunPoll({
      isBusy: () => false,
      currentRun: () => null,
      isHidden: () => false,
      fetchRun: async () => {
        fetches++;
        return new Response(null, { status: 204 });
      },
      onRun: () => {},
      onFinished: () => {}
    });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 10);
    stop();
    expect(fetches).toBe(1);
  });
});
