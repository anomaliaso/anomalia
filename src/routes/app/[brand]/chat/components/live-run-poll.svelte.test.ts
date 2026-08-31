import { describe, it, expect, vi, afterEach } from 'vitest';
import { tick } from 'svelte';
import { startLiveRunPoll } from './live-run-poll.svelte';
import { LIVE_POLL_MS } from './kit-run';

afterEach(() => vi.useRealTimers());

describe('il battito che segue un turno vivo', () => {
  it('non si rimonta quando il run cambia', async () => {
    let starts = 0;
    let setRun: (next: { id: string }) => void = () => {};

    const cleanup = $effect.root(() => {
      let run = $state<{ id: string } | null>({ id: 'r1' });
      // La stessa copia non reattiva che tiene la pagina del thread: è questa che il battito
      // legge. Agganciare `currentRun` direttamente a `run` rimette il cappio, e questo test
      // torna rosso.
      let ref: { id: string } | null = null;
      setRun = (next) => (run = next);
      $effect(() => {
        ref = run;
      });
      $effect(() => {
        starts++;
        return startLiveRunPoll({
          isBusy: () => false,
          currentRun: () => ref,
          isHidden: () => false,
          // Non si risolve mai: qui interessa il grafo di reattività, non la rete.
          fetchRun: () => new Promise<Response>(() => {}),
          onRun: () => {},
          onFinished: () => {}
        });
      });
    });

    await tick();
    setRun({ id: 'r2' });
    await tick();
    cleanup();

    // Il difetto: `poll()` leggeva il run in modo TRACCIATO, quindi la risposta che lo riscrive
    // invalidava l'effetto — smontato e rimontato a ogni giro, col poll immediato ogni volta.
    // Misurati ~840 giri al secondo, il thread principale saturo e la pagina ferma.
    expect(starts).toBe(1);
  });

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
