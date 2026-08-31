import { untrack } from 'svelte';
import { IDLE_POLL_EVERY, LIVE_POLL_MS, pollOutcome } from './kit-run';

export type LiveRunPollPorts = {
  isBusy: () => boolean;
  currentRun: () => { id: string } | null;
  fetchRun: () => Promise<Response>;
  onRun: (run: unknown) => void;
  onFinished: () => void;
  isHidden: () => boolean;
};

/**
 * Il battito che segue un turno vivo dopo un ricaricamento.
 *
 * Il ciclo legge il run corrente per decidere il ritmo, e lo RISCRIVE con la risposta. Dentro un
 * `$effect` questo è un cappio: la lettura diventa una dipendenza, la scrittura la invalida, e
 * l'effetto si smonta e rimonta a ogni risposta — 840 giri al secondo misurati, non uno ogni
 * 350ms. Il thread principale saturo è ciò che l'utente vede come «ricarico e non si muove più
 * niente». Le letture passano da `untrack`: il ritmo lo detta l'intervallo, non il grafo.
 */
export function startLiveRunPoll(ports: LiveRunPollPorts): () => void {
  if (untrack(ports.isBusy)) {
    return () => {};
  }

  let stopped = false;
  let tick = 0;

  const poll = async () => {
    const run = untrack(ports.currentRun);
    if (!run && ports.isHidden()) return;
    if (!run && tick++ % IDLE_POLL_EVERY !== 0) return;
    try {
      const res = await ports.fetchRun();
      if (stopped) return;
      const esito = pollOutcome(res.status);
      if (esito === 'run') {
        ports.onRun(await res.json());
        return;
      }
      if (esito === 'finished' && untrack(ports.currentRun)) ports.onFinished();
    } catch {
      /* un poll fallito riprova al giro dopo */
    }
  };

  void poll();
  const timer = setInterval(() => void poll(), LIVE_POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
