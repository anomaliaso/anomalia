import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolExecutionOptions } from 'ai';
import {
  APPROVABLE_STATUSES,
  POST_CONTENT_TYPES,
  approvePostContract,
  crossPostContract,
  rejectPostContract,
  reschedulePostContract,
  updatePostContract
} from './post-tools';
import { createTestSupabase } from '$lib/testkit/supabase';
import { createChatTools } from '$lib/server/chat/tools';
import { AGENT_FILES, REQUIRED_READS } from '$lib/server/chat/agent-files';

/**
 * Questo file È il pattern: quando aggiungi un tool a contratto, aggiungilo a
 * CONTRACTS qui sotto e (se tocca il DB in modo puro) dagli una sample call con il
 * testkit. I due controlli generici valgono per tutti senza scrivere altro:
 *
 * 1. ogni valore di enum DICHIARATO nel contratto compare davvero nel testo del tool
 *    (description + describe dei parametri) — se qualcuno riscrive la description a
 *    mano senza interpolare dalla costante, questo fallisce;
 * 2. ogni token "macchina" del vocabolario (pending_user, generated_video, …) citato
 *    nel testo DEVE essere dichiarato in `enums` — una description che insegna un
 *    valore che il contratto non possiede è esattamente la deriva dell'audit.
 */

const TZ = 'Europe/Rome';

const CONTRACTS = {
  update_post: updatePostContract,
  approve_post: approvePostContract(TZ),
  reject_post: rejectPostContract,
  reschedule_post: reschedulePostContract(TZ),
  cross_post: crossPostContract
};

/**
 * Il testo che il modello legge: description + le describe dei parametri + il `how/*.md` che
 * l'azione PRETENDE, quando ne ha uno.
 *
 * Il file entra nel conteggio perché dal 22/8/2026 parte del materiale non sta più nella
 * description ma in un file che l'azione obbliga a leggere prima di agire (chat/agent-files.ts).
 * Un enum insegnato lì è insegnato al modello esattamente come se stesse nella description — di
 * più, visto che la lettura è obbligatoria e la description no. Senza questa riga, accorciare una
 * description grassa spostandone il contenuto nel file farebbe diventare rosso un test che sta
 * verificando una cosa ancora vera.
 */
function toolText(c: { description: string; inputSchema: z.ZodType }, name?: string): string {
  const path = name ? REQUIRED_READS[name] : undefined;
  const how = path ? (AGENT_FILES[path]?.body() ?? '') : '';
  return c.description + ' ' + JSON.stringify(z.toJSONSchema(c.inputSchema)) + ' ' + how;
}

// I valori-macchina del vocabolario post (quelli con underscore: inconfondibili nel
// testo inglese, a differenza di "text" o "approved").
const MACHINE_VOCAB = [
  'pending_user',
  'generated_image',
  'generated_video',
  'generated_graphic',
  'uploaded_image'
];

describe('contracts: enum nelle description', () => {
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    it(`${name}: ogni valore dichiarato compare nel testo del tool`, () => {
      const text = toolText(contract, name);
      for (const [param, values] of Object.entries(contract.enums ?? {})) {
        for (const v of values) {
          expect(text, `${name}.${param}: "${v}" dichiarato ma assente dal testo`).toContain(v);
        }
      }
    });

    it(`${name}: nessun valore-macchina citato senza essere dichiarato`, () => {
      const text = toolText(contract, name);
      const declared = new Set(Object.values(contract.enums ?? {}).flat());
      for (const v of MACHINE_VOCAB) {
        if (text.includes(v)) {
          expect(
            declared.has(v),
            `${name}: il testo cita "${v}" ma il contratto non lo dichiara in enums — interpola dalla costante`
          ).toBe(true);
        }
      }
    });
  }
});

describe('contracts: schema dagli stessi valori del codice', () => {
  it('update_post.content_type accetta tutti i POST_CONTENT_TYPES e rifiuta i format', () => {
    const schema = updatePostContract.inputSchema;
    for (const ct of POST_CONTENT_TYPES) {
      expect(schema.safeParse({ post_id: 'p1', content_type: ct }).success, ct).toBe(true);
    }
    // Il finding #11: "carousel" è un format, non un content_type — ora non passa la porta.
    for (const wrong of ['carousel', 'reel', 'story']) {
      expect(schema.safeParse({ post_id: 'p1', content_type: wrong }).success, wrong).toBe(false);
    }
  });
});

// ── Sample call strutturali: il campo promesso dal contratto viene prodotto davvero ──
// Solo i rami che toccano SOLO supabase (nessun Zernio/publish): post pending_user.

const OPTS = { toolCallId: 't1', messages: [] } as unknown as ToolExecutionOptions;

function toolsWithPosts(posts: Record<string, unknown>[]) {
  const kit = createTestSupabase({ posts });
  const tools = createChatTools(kit.client, 'b1', TZ, 'u1');
  return { kit, tools };
}

const PENDING = {
  id: 'p1',
  brand_id: 'b1',
  status: 'pending_user',
  platform: 'instagram',
  platforms: null,
  caption: 'old'
};

describe('contracts: execute produce i campi dichiarati', () => {
  it('update_post aggiorna il post e risponde con updated_fields', async () => {
    const { kit, tools } = toolsWithPosts([{ ...PENDING }]);
    const res = (await tools.update_post.execute!({ post_id: 'p1', caption: 'new' }, OPTS)) as Record<string, unknown>;
    expect(res).toMatchObject({ success: true, updated_fields: ['caption'] });
    expect(kit.tables.get('posts')![0].caption).toBe('new');
  });

  it('approve_post rifiuta uno stato non approvabile citando gli stati veri', async () => {
    const { tools } = toolsWithPosts([{ ...PENDING, status: 'published' }]);
    const res = (await tools.approve_post.execute!({ post_id: 'p1' }, OPTS)) as Record<string, unknown>;
    expect(String(res.error)).toContain('published');
    expect(String(res.error)).toContain(APPROVABLE_STATUSES[0]);
  });

  it('reject_post cancella il draft e risponde con deleted', async () => {
    const { kit, tools } = toolsWithPosts([{ ...PENDING }]);
    const res = (await tools.reject_post.execute!({ post_id: 'p1', confirm: true }, OPTS)) as Record<string, unknown>;
    expect(res).toEqual({ success: true, deleted: 'p1' });
    expect(kit.tables.get('posts')).toHaveLength(0);
  });

  it('reschedule_post rifiuta un draft pending_user (lo pubblicherebbe senza approvazione)', async () => {
    const { kit, tools } = toolsWithPosts([{ ...PENDING }]);
    const res = (await tools.reschedule_post.execute!(
      { post_id: 'p1', scheduled_for: '2027-01-01T10:00' },
      OPTS
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('pending_user');
    // E soprattutto: non ha toccato la riga.
    expect(kit.tables.get('posts')![0].status).toBe('pending_user');
  });

  it('cross_post su un draft pending unisce le piattaforme senza pubblicare', async () => {
    const { kit, tools } = toolsWithPosts([{ ...PENDING }]);
    const res = (await tools.cross_post.execute!(
      { post_id: 'p1', platforms: ['facebook'] },
      OPTS
    )) as Record<string, unknown>;
    expect(res).toMatchObject({ success: true, status: 'pending_user', platforms: ['instagram', 'facebook'] });
    expect(kit.tables.get('posts')![0].platforms).toEqual(['instagram', 'facebook']);
  });
});
