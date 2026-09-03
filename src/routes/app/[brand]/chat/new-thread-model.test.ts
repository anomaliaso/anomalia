import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LA SCELTA FATTA PRIMA CHE IL THREAD ESISTA.
 *
 * Dal composer di `/app/<brand>` non c'e` ancora un thread, quindi `createModelChoiceSave` non
 * salva niente: la scelta viaggia solo nel payload del turno. Il turno gira sul modello giusto —
 * e poi l'app naviga sul thread appena nato, che nasce SENZA preferenza, e il picker torna a
 * mostrare il default. Da fuori sembra che la selezione non abbia avuto effetto.
 *
 * Il thread deve nascere con la scelta che l'ha creato.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

vi.mock('$env/dynamic/private', () => ({ env: {} }));

function fakeSupabase() {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return {
          select: () => ({ single: async () => ({ data: { id: 'thread-1', created_at: 'now' } }) })
        };
      },
      upsert: async () => ({ error: null })
    })
  } as unknown as SupabaseClient;
  return { client, inserts };
}

describe('un thread nasce con la scelta di modello del turno che lo ha creato', () => {
  it('createThread scrive la preferenza sulla riga', async () => {
    const { createThread } = await import('$lib/server/chat/persistence');
    const { client, inserts } = fakeSupabase();

    await createThread(client, 'brand-1', 'user-1', 'Nuova chat', null, null, null, null, {
      family: 'luna',
      thinking: 'high',
      model: 'anthropic/claude-opus-5'
    });

    expect(inserts[0]?.model).toEqual({
      family: 'luna',
      thinking: 'high',
      model: 'anthropic/claude-opus-5'
    });
  });

  it('senza scelta la riga non porta un model finto', async () => {
    const { createThread } = await import('$lib/server/chat/persistence');
    const { client, inserts } = fakeSupabase();

    await createThread(client, 'brand-1', 'user-1');

    expect(inserts[0]).not.toHaveProperty('model');
  });

  /**
   * Il difetto non stava in `createThread`, stava in chi lo chiama: il POST della chat creava il
   * thread e buttava via `tier` e `reasoning` del corpo. Un test sul solo `createThread` non
   * sarebbe mai fallito.
   */
  /**
   * IL PERCORSO VERO, e quello che il primo fix aveva mancato. Dalla home il thread NON nasce dal
   * POST della chat: il composer chiama prima `POST /chat/threads` e poi manda il turno su un
   * thread che esiste gia`. La suite era verde e il bug era ancora li` — l'ha trovato il browser.
   */
  it('la creazione del thread dalla home porta con se\' la scelta', () => {
    const store = read('../../../../lib/stores/chat.ts');
    const create = store.slice(store.indexOf('export async function createThread('), store.indexOf('[createThread] Response status'));
    expect(create).toMatch(/model/);

    const endpoint = read('./threads/+server.ts');
    const post = endpoint.slice(endpoint.indexOf('// POST: create a new thread'), endpoint.indexOf('const customAgentId ='));
    expect(post).toMatch(/turnModelFamily/);

    const column = read('../../../../lib/components/ChatColumn.svelte');
    expect(column).toMatch(/createThread\([\s\S]{0,220}policyForChoice/);
  });

  it('il POST della chat passa la scelta del turno al thread che crea', () => {
    const server = read('./+server.ts');
    const call = server.indexOf('await createThread(');
    const start = server.lastIndexOf('} else {', call);
    const branch = server.slice(start, server.indexOf('\n  }', call));

    // La scelta del corpo diventa la riga del thread...
    expect(branch).toMatch(/policyForChoice/);
    // ...e vale anche per QUESTO turno, non solo per i successivi.
    expect(branch).toMatch(/threadModel = /);
  });
});
