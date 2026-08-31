import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/static/public', async (originale) => ({
  ...((await originale()) as Record<string, string>),
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }
}));

const events = [
  { thread_id: 't', seq: 1, source_key: 'u1', kind: 'message', payload: { id: 'm1', role: 'user', content: 'che ore sono?' } },
  { thread_id: 't', seq: 2, source_key: 'a1', kind: 'message', payload: { id: 'm2', role: 'assistant', content: 'le tre' } },
  { thread_id: 't', seq: 3, source_key: 'u2', kind: 'message', payload: { id: 'm3', role: 'user', content: 'e domani?' } },
  { thread_id: 't', seq: 4, source_key: 'a2', kind: 'message', payload: { id: 'm4', role: 'assistant', content: 'pioggia' } }
];

vi.mock('./thread-events', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  loadThreadEvents: vi.fn(async () => events)
}));

import { loadThreadUiHistory, loadHistoryForUI } from './persistence';

const supabase = {} as never;

describe('la cronologia proiettata dal log degli eventi', () => {
  it('esce in ordine cronologico, non capovolta', async () => {
    const { messages } = await loadThreadUiHistory(supabase, 'b', 'u', 't');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('tiene la CODA quando il thread supera il limite, non la testa', async () => {
    const { messages } = await loadThreadUiHistory(supabase, 'b', 'u', 't', 2);
    expect(messages.map((m) => m.id)).toEqual(['m3', 'm4']);
  });

  it('vale anche per la lettura senza progress', async () => {
    const messages = await loadHistoryForUI(supabase, 'b', 'u', 't');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
});
