/**
 * All'apertura dell'app la sidebar chiede "chi sta lavorando adesso" (`running=1`).
 * La risposta deve vedere OGNI conversazione al lavoro — turni di chat, tool job
 * asincroni (render, piani, grafica) e run kit — non solo i `chat_response`.
 */
import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { loadThreadState } from './thread-load';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const NOW = iso(0);

const session = () => async () => ({ user: { id: 'user-1' } });

const seed = {
  brands: [{ id: 'brand-1', slug: 'acme', plan: 'starter' }],
  chat_jobs: [
    {
      id: 'j-chat',
      brand_id: 'brand-1',
      user_id: 'user-1',
      thread_id: 'thread-chat',
      tool_name: 'chat_response',
      status: 'running',
      created_at: NOW
    },
    {
      id: 'j-tool',
      brand_id: 'brand-1',
      user_id: 'user-1',
      thread_id: 'thread-tool',
      tool_name: 'design_graphic',
      status: 'running',
      created_at: NOW
    }
  ],
  agent_kit_runs: [
    {
      id: 'k-alive',
      brand_id: 'brand-1',
      user_id: 'user-1',
      thread_id: 'thread-kit',
      state: 'running',
      heartbeat_at: iso(30_000),
      created_at: iso(5 * 60_000)
    },
    {
      id: 'k-done',
      brand_id: 'brand-1',
      user_id: 'user-1',
      thread_id: 'thread-done',
      state: 'done',
      heartbeat_at: iso(30_000),
      created_at: iso(30 * 60_000)
    },
    {
      id: 'k-dead',
      brand_id: 'brand-1',
      user_id: 'user-1',
      thread_id: 'thread-dead',
      state: 'running',
      heartbeat_at: iso(10 * 60_000),
      created_at: iso(40 * 60_000)
    }
  ]
};

function runningUrl(): URL {
  return new URL('http://localhost/app/acme/chat?running=1');
}

describe('loadThreadState ?running=1', () => {
  it('vede ogni conversazione al lavoro: chat, tool job e run kit vivi', async () => {
    const db = createTestSupabase(seed);

    const res = await loadThreadState(db.client, session(), 'acme', runningUrl());
    const { threadIds } = (await res.json()) as { threadIds: string[] };

    expect([...threadIds].sort()).toEqual(['thread-chat', 'thread-kit', 'thread-tool']);
  });

  it('lascia fuori i run finiti e quelli morti (battito fermo)', async () => {
    const db = createTestSupabase(seed);

    const res = await loadThreadState(db.client, session(), 'acme', runningUrl());
    const { threadIds } = (await res.json()) as { threadIds: string[] };

    expect(threadIds).not.toContain('thread-done');
    expect(threadIds).not.toContain('thread-dead');
  });
});

/**
 * IL DETTAGLIO VIVO DI UN LAVORO IN BACKGROUND.
 *
 * La riga «1 background job» sapeva solo QUANTI ce n'erano: `id, tool_name, status, created_at`,
 * e il commento nel componente lo diceva — «non c'e` niente da aprire». Ma l'avanzamento esiste
 * gia`, scritto in diretta su `chat_jobs.partial` dal runner. Non arrivava alla UI perche` la
 * select non lo chiedeva: durante un render di dieci minuti l'unico posto dove guardare diceva
 * un numero e nient'altro.
 */
describe('pending_tools porta anche COSA sta facendo, non solo quanti sono', () => {
  it('il parziale del job arriva al client, tool in corso compresi', async () => {
    const kit = createTestSupabase({
      brands: [{ id: 'brand-1', slug: 'acme', plan: 'starter' }],
      chat_jobs: [
        {
          id: 'j-motion',
          brand_id: 'brand-1',
          user_id: 'user-1',
          thread_id: 'thread-1',
          tool_name: 'motion_video',
          status: 'running',
          created_at: NOW,
          partial: {
            text: 'sto costruendo il terzo beat',
            tools: [{ toolCallId: 'a', toolName: 'write_source', status: 'running' }]
          }
        }
      ]
    });

    const res = await loadThreadState(
      kit.client,
      session(),
      'acme',
      new URL('https://x/app/acme/chat?thread=thread-1&pending_tools=1')
    );

    const { jobs } = await (res as Response).json();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].partial?.text).toContain('terzo beat');
    expect(jobs[0].partial?.tools?.[0]?.toolName).toBe('write_source');

    // E la select deve CHIEDERLO davvero: il finto client torna la riga intera comunque, quindi
    // senza questa riga il test resterebbe verde con una colonna che in produzione non arriva.
    const q = kit.calls.find((c) => c.table === 'chat_jobs' && c.op === 'select');
    expect(q?.columns).toContain('partial');
  });
});

describe('lettura del log per cursore', () => {
  const events = [
    { thread_id: 'thread-chat', seq: 1, source_key: 'message:m1', kind: 'message', payload: { id: 'm1' } },
    { thread_id: 'thread-chat', seq: 4, source_key: 'run-1:progress:2', kind: 'progress', payload: { runId: 'run-1' } },
    { thread_id: 'thread-chat', seq: 5, source_key: 'message:m2', kind: 'message', payload: { id: 'm2' } },
    { thread_id: 'altro', seq: 2, source_key: 'message:m9', kind: 'message', payload: { id: 'm9' } }
  ];

  it('restituisce solo gli eventi del thread oltre il cursore', async () => {
    const db = createTestSupabase({ ...seed, thread_events: events });

    const res = await loadThreadState(
      db.client,
      session(),
      'acme',
      new URL('http://x/app/acme/chat?thread=thread-chat&events_after=1')
    );

    expect(await res.json()).toEqual({ events: [events[1], events[2]] });
  });

  it('un cursore a zero porta tutto il thread, mai quello di un altro', async () => {
    const db = createTestSupabase({ ...seed, thread_events: events });

    const res = await loadThreadState(
      db.client,
      session(),
      'acme',
      new URL('http://x/app/acme/chat?thread=thread-chat&events_after=0')
    );

    expect(await res.json()).toEqual({ events: [events[0], events[1], events[2]] });
  });
});
