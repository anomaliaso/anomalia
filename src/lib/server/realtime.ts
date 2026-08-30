/**
 * Server → browser push over the per-brand Realtime channel.
 *
 * Uses Realtime's HTTP broadcast endpoint rather than opening a websocket: a serverless function
 * that lives for one request has no business holding a socket open, and the write is fire-and-forget
 * anyway. The service-role key bypasses RLS on `realtime.messages`, so the server can publish to a
 * private topic without a session — subscribers are still gated by the policies in migration 0137.
 */
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/** Channel every client in a brand's shell joins. Must match the topic shape the RLS policy parses. */
export function brandChannelTopic(brandId: string): string {
  return `brand:${brandId}`;
}

/** Payloads the shell knows how to react to. Keep names stable — clients match on them. */
export type BrandBroadcast =
  /** A message row was written to this thread by anyone (live turn, queue worker, salvage). */
  | { event: 'thread-changed'; payload: { threadId: string } }
  /**
   * One `ai` v6 UI message chunk from a live agent-kit turn (live.ts), mirrored so a client that
   * reloads mid-turn can reattach instead of only seeing "still working". `chunk` is normally the
   * raw parsed chunk; live.ts shrinks it first when it would exceed ~8KB (a fat tool-output).
   */
  | {
      event: 'kit_stream';
      payload: {
        runId: string;
        threadId: string;
        /** Lunghezze di testo e ragionamento PRIMA di questo chunk: la posizione che il client allinea. */
        at?: { text: number; reasoning: number };
        chunk: unknown;
      };
    }
  /** The tee'd mirror reader finished draining — client should stop waiting on this run and reload. */
  | { event: 'kit_stream_done'; payload: { runId: string; threadId: string } }
  /**
   * The thread's durable event log advanced to `seq`. Carries no content on purpose: the client
   * answers it by reading `thread_events` above its own cursor, so a dropped, duplicated or
   * reordered notification costs a read, never a desynchronised transcript.
   */
  | { event: 'thread-seq'; payload: { threadId: string; seq: number } };

/**
 * Never throws and never blocks the caller's real work: a dropped notification costs one client
 * a stale view until its next poll, which is not worth failing a chat turn over.
 */
export async function broadcastToBrand(brandId: string, msg: BrandBroadcast): Promise<void> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !brandId) return;
  const topic = encodeURIComponent(brandChannelTopic(brandId));
  const event = encodeURIComponent(msg.event);
  try {
    await fetch(
      `${PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast/${topic}/events/${event}?private=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify(msg.payload)
      }
    );
  } catch (error) { swallow('send realtime notify', error); }
}
