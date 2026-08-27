import type { StreamToolCallState } from '$lib/chat-stream-events';

export type KitRun = {
  id: string;
  agent_id: string;
  state: string;
  created_at: string;
  /** Riscritto dal server ogni ~1s mentre il run è vivo. */
  partial?: { text?: string; reasoning?: string; tools?: StreamToolCallState[]; updatedAt?: string } | null;
  /**
   * La riga assistant che il server riscrive a ogni battito col parziale (il checkpoint vivo).
   * Esiste perché ricaricando si veda il lavoro senza dipendere dal riaggancio — e proprio per
   * questo va NASCOSTA finché la bolla viva sta disegnando la stessa risposta, o il turno
   * comparirebbe due volte. Una copia sola in ogni istante, come per il resto del turno.
   */
  partial_saved_msg_id?: string | null;
};

/** Il ritmo con cui si chiede lo stato di un turno VIVO. v1 sta a 350: qui lo stesso. */
export const LIVE_POLL_MS = 350;

/** A vuoto si chiede un giro su questi: ~10 secondi fra due domande, come prima. */
export const IDLE_POLL_EVERY = 28;
