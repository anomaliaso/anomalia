import { describe, expect, it } from 'vitest';

/**
 * La campanella per gli agenti. Ciò che va tenuto fermo:
 *  - l'enum di scrittura NON contiene 'error' (riservato ai fatti di sistema);
 *  - stesso topic aperto → update, mai un doppione;
 *  - resolve chiude davvero, e chiudere il nulla lo dice;
 *  - il tetto per brand rifiuta la sesta notifica;
 *  - senza tabella/service key si degrada morbido (risposta chiara, nessun throw);
 *  - il blocco nel prompt è taggato per severità e cappato;
 *  - un sotto-agente non può scrivere la campanella (legge sì).
 */

import {
  agentNoticeToWarning,
  listAgentNotices,
  normalizeTopic,
  renderNotificationsBlock,
  resolveAgentNotice,
  upsertAgentNotice,
  MAX_OPEN_AGENT_NOTICES,
  type AgentNotice
} from './brand-warnings';
import { createNotificationTools } from './chat/notification-tools';
import { subagentToolNames } from './chat/subagents';
import type { AppWarning } from '$lib/warnings';

type Row = Record<string, unknown>;

type FakeState = {
  open?: Row | null;
  openCount?: number;
  rows?: Row[];
  resolvedRows?: Row[];
  updates: Row[];
  upserts: Row[];
  failAll?: boolean;
};

// Catena PostgREST minima: select/eq/like/is/order/limit incatenano, i terminali risolvono da
// `state`. `failAll` simula la tabella assente (o la service key mancante) su OGNI lettura.
function fakeAdmin(state: FakeState) {
  const ERR = { message: 'relation "incidents" does not exist' };
  return {
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = { _head: false };
      q.select = (_cols?: string, opts?: { head?: boolean }) => {
        q._head = !!opts?.head;
        return q;
      };
      for (const m of ['eq', 'like', 'is', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () =>
        state.failAll ? { data: null, error: ERR } : { data: state.open ?? null, error: null };
      q.update = (row: Row) => {
        state.updates.push(row);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u: any = {};
        for (const m of ['eq', 'is']) u[m] = () => u;
        u.select = () => ({
          then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
            Promise.resolve(
              state.failAll ? { data: null, error: ERR } : { data: state.resolvedRows ?? [], error: null }
            ).then(ok, err)
        });
        u.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve({ error: state.failAll ? ERR : null }).then(ok, err);
        return u;
      };
      q.upsert = (row: Row) => {
        state.upserts.push(row);
        return {
          then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
            Promise.resolve({ error: state.failAll ? ERR : null }).then(ok, err)
        };
      };
      q.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(
          state.failAll
            ? { data: null, error: ERR, count: null }
            : q._head
              ? { count: state.openCount ?? 0 }
              : { data: state.rows ?? [], error: null }
        ).then(ok, err);
      return q;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ARGS = {
  brandId: 'b1',
  topic: 'LinkedIn Token Expiring',
  severity: 'warning' as const,
  title: 'Token LinkedIn in scadenza',
  message: 'Fra 5 giorni i post LinkedIn smetteranno di uscire.',
  threadId: 'th-9'
};

describe('normalizeTopic', () => {
  it('produce una chiave stabile', () => {
    expect(normalizeTopic('LinkedIn Token Expiring!')).toBe('linkedin-token-expiring');
    expect(normalizeTopic('  linkedin—token—expiring ')).toBe('linkedin-token-expiring');
  });
});

describe('upsertAgentNotice', () => {
  it('crea quando il topic non è aperto', async () => {
    const state: FakeState = { open: null, openCount: 0, updates: [], upserts: [] };
    const res = await upsertAgentNotice(fakeAdmin(state), ARGS);
    expect(res.status).toBe('created');
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].kind).toBe('agent:linkedin-token-expiring');
    expect(state.upserts[0].resolved_at).toBeNull();
    expect((state.upserts[0].details as Row).thread_id).toBe('th-9');
  });

  it('stesso topic aperto → update, mai un doppione', async () => {
    const state: FakeState = { open: { id: 'i1' }, openCount: 1, updates: [], upserts: [] };
    const res = await upsertAgentNotice(fakeAdmin(state), ARGS);
    expect(res.status).toBe('updated');
    expect(state.upserts).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
  });

  it('tetto per brand: la ennesima notifica nuova viene rifiutata', async () => {
    const state: FakeState = { open: null, openCount: MAX_OPEN_AGENT_NOTICES, updates: [], upserts: [] };
    const res = await upsertAgentNotice(fakeAdmin(state), ARGS);
    expect(res.status).toBe('cap_reached');
    expect(state.upserts).toHaveLength(0);
  });

  it('tabella assente → errore morbido, nessun throw', async () => {
    const state: FakeState = { failAll: true, updates: [], upserts: [] };
    const res = await upsertAgentNotice(fakeAdmin(state), ARGS);
    expect(res.status).toBe('error');
  });
});

describe('resolveAgentNotice', () => {
  it('chiude la notifica aperta', async () => {
    const state: FakeState = { resolvedRows: [{ id: 'i1' }], updates: [], upserts: [] };
    const res = await resolveAgentNotice(fakeAdmin(state), 'b1', 'linkedin-token-expiring');
    expect(res.resolved).toBe(true);
    expect(state.updates[0].resolved_at).toBeTruthy();
  });

  it('niente da chiudere → resolved false, nessun errore', async () => {
    const state: FakeState = { resolvedRows: [], updates: [], upserts: [] };
    const res = await resolveAgentNotice(fakeAdmin(state), 'b1', 'x');
    expect(res).toEqual({ resolved: false });
  });
});

describe('listAgentNotices', () => {
  it('tabella assente → lista vuota, mai un throw', async () => {
    const state: FakeState = { failAll: true, updates: [], upserts: [] };
    await expect(listAgentNotices(fakeAdmin(state), 'b1')).resolves.toEqual([]);
  });

  it('mappa le righe e il warning per la campanella linka il thread', async () => {
    const state: FakeState = {
      rows: [
        {
          id: 'i1',
          kind: 'agent:competitor-price-drop',
          severity: 'indication',
          details: { source: 'agent', title: 'T', message: 'M', thread_id: 'th-1' },
          detected_at: '2026-08-21T10:00:00Z'
        }
      ],
      updates: [],
      upserts: []
    };
    const [n] = await listAgentNotices(fakeAdmin(state), 'b1');
    expect(n.topic).toBe('competitor-price-drop');
    const w = agentNoticeToWarning(n, '/app/acme');
    expect(w.severity).toBe('suggestion'); // indication → terzo livello della campanella
    expect(w.href).toBe('/app/acme/chat/th-1');
    expect(w.values).toMatchObject({ text: 'T', message: 'M' });
  });
});

describe('set_notification tool', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (admin?: any) =>
    // supabase non viene toccato da set_notification: un finto vuoto basta.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createNotificationTools({ supabase: {} as any, brandId: 'b1', threadId: 'th-9', admin });

  it("l'enum di severità NON contiene 'error'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = (tools().set_notification as any).inputSchema;
    const bad = schema.safeParse({ topic: 'x-topic', severity: 'error', title: 'ttt', message: 'mmmm' });
    expect(bad.success).toBe(false);
    const ok = schema.safeParse({ topic: 'x-topic', severity: 'warning', title: 'ttt', message: 'mmmm' });
    expect(ok.success).toBe(true);
  });

  it('scrive con dedup e riporta lo stato', async () => {
    const state: FakeState = { open: null, openCount: 0, updates: [], upserts: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exec = (tools(fakeAdmin(state)).set_notification as any).execute;
    const res = await exec({ topic: 'a-b', severity: 'indication', title: 'ttt', message: 'mmmm' });
    expect(res.ok).toBe(true);
    expect(state.upserts[0].kind).toBe('agent:a-b');
  });

  it('resolve:true chiude senza titolo né messaggio', async () => {
    const state: FakeState = { resolvedRows: [{ id: 'i1' }], updates: [], upserts: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exec = (tools(fakeAdmin(state)).set_notification as any).execute;
    const res = await exec({ topic: 'a-b', resolve: true });
    expect(res.resolved).toBe(true);
  });

  it('storage assente → risposta chiara, nessun throw', async () => {
    const state: FakeState = { failAll: true, updates: [], upserts: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exec = (tools(fakeAdmin(state)).set_notification as any).execute;
    const res = await exec({ topic: 'a-b', severity: 'warning', title: 'ttt', message: 'mmmm' });
    expect(res.error).toBe('notifications_unavailable');
  });
});

describe('renderNotificationsBlock', () => {
  const warn = (i: number, severity: AppWarning['severity']): AppWarning => ({
    id: `w-${severity}-${i}`,
    severity,
    title: 'k.t',
    message: 'k.m',
    href: '/app/x/calendar'
  });
  const notice = (i: number): AgentNotice => ({
    id: `n${i}`,
    topic: `topic-${i}`,
    severity: 'indication',
    title: `Titolo ${i}`,
    message: `Messaggio ${i}`,
    thread_id: 'th-1',
    detected_at: '2026-08-21T10:00:00Z'
  });

  it('è cappato a 10 righe e taggato per severità', () => {
    const warnings = [
      ...Array.from({ length: 5 }, (_, i) => warn(i, 'error')),
      ...Array.from({ length: 5 }, (_, i) => warn(i, 'warning')),
      ...Array.from({ length: 5 }, (_, i) => warn(i, 'suggestion'))
    ];
    const block = renderNotificationsBlock(warnings, [notice(1), notice(2)]);
    const lines = block.split('\n').filter((l) => l.startsWith('- ['));
    expect(lines).toHaveLength(10);
    expect(block).toContain('Open now: 17');
    expect(block).toContain('[error]');
    expect(block).toContain('[indication] (agent');
    expect(block).toContain('read_notifications');
    // gli errori (severità massima) devono sopravvivere al cap
    expect(lines.filter((l) => l.includes('[error]'))).toHaveLength(5);
  });

  it('vuoto quando non c’è nulla', () => {
    expect(renderNotificationsBlock([], [])).toBe('');
  });
});

describe('perimetro sotto-agenti', () => {
  const available = ['read_notifications', 'set_notification', 'read_posts', 'create_post'];
  it('un delegato legge la campanella ma non la scrive', () => {
    const research = subagentToolNames('research', 'content', available);
    expect(research).toContain('read_notifications');
    expect(research).not.toContain('set_notification');
    const execute = subagentToolNames('execute', 'content', available);
    expect(execute).not.toContain('set_notification');
  });
});
