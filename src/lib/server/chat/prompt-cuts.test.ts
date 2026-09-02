import { describe, expect, it } from 'vitest';
import { AGENT_IDS, type AgentId } from './agents';
import { buildSystemPrompt } from './system-prompt';
import { AGENT_FILES, createFileTools, filesIndexFor } from './agent-files';
import { createGoalTools } from '$lib/agent/tools/goal-tools';
import { MOTION_CRAFT_SPECS } from '$lib/motion-video/craft';
import { disruptiveSystemSection } from '$lib/disruptive';
import { aiActSystemSection } from '$lib/ai-act';

/**
 * I CINQUE TAGLI AL PROMPT (direttiva 22 del 23/08/2026), pinnati.
 *
 * Una regola tiene solo se vive in tre posti: il prompt, un esempio che gira, e un controllo che
 * rifiuta l'imitazione. Questo file è il terzo. Ognuno dei cinque tagli qui dentro ha DUE
 * asserzioni gemelle e non una: «non è più nel prompt» E «è ancora raggiungibile» — perché un
 * taglio che toglie e basta non è un alleggerimento, è un impoverimento, e i due si scrivono uguale.
 */

const ROWS: Record<string, unknown> = {
  brand_kit: {
    category: 'SaaS',
    about: 'Brand di prova',
    target_audience: 'PMI',
    content_pillars: ['pilastro-a'],
    brand_colors: ['#123456'],
    fonts: ['Inter']
  },
  editorial_plans: { voice: { mood: 'MOOD-DI-PROVA', tone: 'diretto' }, weeks: [] },
  products: [
    { id: 'pr1', title: 'PRODOTTO-DI-PROVA', description: 'd', pricing: '10€', kind: 'product', featured: true, url: 'https://x.test/p', images: [] }
  ],
  people: [{ id: 'pe1', name: 'PERSONA-DI-PROVA', role: 'founder', kind: 'real', description: 'd', images: [] }],
  brand_documents: [{ id: 'd1', kind: 'doc', title: 'DOC-DI-PROVA', summary: 's', status: 'ready', chunk_count: 1, collection: null }],
  competitors: [{ name: 'CONCORRENTE-DI-PROVA', website: 'https://c.test', kind: 'direct', rationale: 'r' }],
  brands: { name: 'Brand di prova', website: 'https://x.test', target_platforms: ['instagram'], content_prefs: { language: 'it' } }
};

function stubSupabase() {
  const chain = (table: string) => {
    const data = ROWS[table] ?? null;
    const node: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data, count: 0, error: null }).then(res),
      maybeSingle: async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }),
      single: async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null })
    };
    for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'in', 'is', 'order', 'limit', 'range', 'filter', 'or', 'contains', 'overlaps', 'update', 'insert', 'upsert', 'delete'])
      node[m] = () => node;
    return node;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => chain(t), rpc: () => chain('__rpc__') } as any;
}

const BRAND = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'prova',
  name: 'Brand di prova',
  website: 'https://x.test',
  plan: 'pro',
  status: 'active',
  timezone: 'Europe/Rome',
  target_platforms: ['instagram'],
  content_prefs: { language: 'it' },
  onboarding_state: null,
  setup_completed_at: '2026-01-01',
  org_id: null
};

const prompts = new Map<AgentId | 'null', string>();
async function promptFor(id: AgentId | null) {
  const key = id ?? 'null';
  const hit = prompts.get(key);
  if (hit) return hit;
  const p = await buildSystemPrompt(stubSupabase(), { ...BRAND }, 'it', id);
  prompts.set(key, p);
  return p;
}
const EVERY: Array<AgentId | null> = [...AGENT_IDS, null];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readFile = (agent: AgentId | null, path: string): Promise<any> =>
  (
    createFileTools(agent, 'th', {
      supabase: stubSupabase(),
      brandId: BRAND.id,
      threadId: 'th',
      userId: 'u1'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).read_file as any
  ).execute({ path }, {});

describe('1. la dottrina dirompente è uscita dal prompt, non dal prodotto', () => {
  it.each(EVERY)('%s non la porta più a ogni passo', async (id) => {
    expect(await promptFor(id)).not.toContain('## IDEE DIROMPENTI');
  });

  it('ma ogni mestiere sa dove sta, e la legge per intero', async () => {
    for (const id of AGENT_IDS) expect(filesIndexFor(id), id).toContain('how/DISRUPTIVE-IDEAS.md');
    const out = await readFile('analyst', 'how/DISRUPTIVE-IDEAS.md');
    expect(out.content).toBe(disruptiveSystemSection());
  });

  it('e il banco resta nel prompt, con il rimando al file invece che a un blocco che non c’è più', async () => {
    // Il banco sono le idee VIVE di questo brand: un fatto, non una dottrina. Ma nominava «i tre
    // test» che stavano nel blocco tolto — senza questo rimando sarebbe un puntatore nel vuoto.
    const src = (await import('node:fs')).readFileSync('src/lib/server/disruptive-ideas.ts', 'utf8');
    expect(src).toContain('how/DISRUPTIVE-IDEAS.md');
  });
});

describe('2. le craft specs del motion stanno solo dove si scrive motion', () => {
  it.each(EVERY)('%s non se le ricopia nel prompt', async (id) => {
    const p = await promptFor(id);
    expect(p).not.toContain('DEFAULT CRAFT (always on');
    expect(p.includes(MOTION_CRAFT_SPECS)).toBe(false);
  });

  it('chi scrive il sorgente le riceve dal file, e il file le contiene davvero', async () => {
    const out = await readFile('motion', 'how/MAKE-MOTION-VIDEO.md');
    expect(out.content).toContain(MOTION_CRAFT_SPECS);
  });

  it('e le tre azioni che scrivono il sorgente restano dietro quel file', () => {
    for (const t of ['create_motion_video', 'write_motion_source', 'replace_motion_source']) {
      expect(AGENT_FILES['how/MAKE-MOTION-VIDEO.md'].unlocks, t).toContain(t);
    }
  });
});

describe('3. le regole dell’obiettivo vivono accanto ai tre tool, in una copia sola', () => {
  it.each(EVERY)('%s non porta più il capitolo GOAL nel prompt', async (id) => {
    expect(await promptFor(id)).not.toContain('GOAL — YOU SET IT YOURSELF');
  });

  it('e le due regole che il prompt diceva in più sono passate nelle descrizioni', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = createGoalTools({ supabase: stubSupabase(), brandId: BRAND.id, userId: 'u', threadId: 't' }) as any;
    expect(String(t.set_goal.description)).toContain('YOU DO NOT ASK PERMISSION TO CARRY ON');
    expect(String(t.set_goal.description)).toContain('A CRITERION COMES FROM');
    expect(String(t.update_goal.description)).toContain('CLOSING IS A CALL, NOT A LABEL');
    // Il conto che rende il taglio vero e non un trasloco: 817 token tolti dal prompt contro 287
    // aggiunti qui. Se le descrizioni ricrescono oltre il blocco che hanno sostituito, il taglio
    // si è mangiato da solo.
    const tot = ['set_goal', 'update_goal', 'close_goal'].reduce((n, k) => n + String(t[k].description).length, 0);
    expect(tot).toBeLessThan(3268 + 1500);
  });
});

describe('4. i fatti del brand sono un file, e il file li contiene tutti', () => {
  it.each(EVERY)('%s non riceve più il documento Studio nel prompt', async (id) => {
    expect(await promptFor(id)).not.toContain('# DESIGN.md');
  });

  it('ogni mestiere lo vede nell’indice, e lo vede col «quando»', () => {
    for (const id of AGENT_IDS) {
      const index = filesIndexFor(id);
      expect(index, id).toContain('brand/studio.md');
      // Senza il «quando», il modello lo apre a ogni turno: uno step (~31.000 token) per
      // risparmiarne 3.352. La riga di indice È la condizione perché il taglio paghi.
      expect(index, id).toMatch(/Not needed to answer a question/);
    }
  });

  it('andata e ritorno: quello che il prompt stampava, il file lo restituisce', async () => {
    const out = await readFile('motion', 'brand/studio.md');
    for (const atteso of [
      '# DESIGN.md',
      'PRODOTTO-DI-PROVA',
      'PERSONA-DI-PROVA',
      'DOC-DI-PROVA',
      'CONCORRENTE-DI-PROVA',
      'MOOD-DI-PROVA',
      '#123456',
      'pilastro-a'
    ]) {
      expect(out.content, atteso).toContain(atteso);
    }
  });

  it('e lo legge anche un mestiere che non ha nessun pacchetto', async () => {
    // Era il punto di `MAKER_AGENTS`, cancellato: i file non hanno mestiere, quindi non serve più
    // un elenco di eccezioni che qualcuno deve ricordarsi di aggiornare.
    const out = await readFile('ugc', 'brand/studio.md');
    expect(out.content).toContain('PRODOTTO-DI-PROVA');
  });

  it('senza contesto di brand rifiuta invece di rendere un documento bianco', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (createFileTools('content').read_file as any).execute({ path: 'brand/studio.md' }, {});
    expect(out.error).toBeTruthy();
    expect(out.content).toBeUndefined();
  });
});

describe('5. AI Act e Work Ethic: accorciati, NON fusi', () => {
  it.each(EVERY)('%s riceve il blocco legale per intero', async (id) => {
    const p = await promptFor(id);
    expect(p).toContain('## EU AI ACT');
    expect(p).toContain('PROHIBITED PRACTICES (Art. 5');
    expect(p).toContain('TRANSPARENCY (Art. 50)');
    expect(p).toContain('HUMAN OVERSIGHT (Art. 14 / Art. 26)');
  });

  /**
   * LA FUSIONE NON È STATA FATTA, E IL TEST È LA DICHIARAZIONE.
   *
   * L'AI Act è un VINCOLO LEGALE con una lista tassativa; Work Ethic è una postura di lavoro. Non
   * si sovrappongono in una riga: fondere avrebbe risparmiato un'intestazione (~15 token) e messo
   * la blacklist dell'Art. 5 dentro un capitolo che si legge come consigli su come lavorare. Il
   * risparmio vero — 176 token — è venuto dall'accorciarli, che è ortogonale al fonderli.
   */
  it('restano due sezioni distinte, e nessuna delle due è cresciuta', async () => {
    const p = await promptFor('content');
    expect(p).toContain('WORK ETHIC — THE USER FINDS EVERYTHING READY');
    expect(p.indexOf('## EU AI ACT')).not.toBe(p.indexOf('WORK ETHIC — THE USER FINDS EVERYTHING READY'));
    expect(aiActSystemSection().length).toBeLessThanOrEqual(4997);
  });
});

/**
 * IL TETTO, che è l'unica cosa che impedisce al prompt di ricrescere una riga alla volta.
 *
 * Misurato con questo stesso stub il 23/08/2026, subito dopo i cinque tagli. Non è una previsione:
 * è il numero che il prompt ha davvero, più un margine. Quando questo test fallisce, la domanda
 * giusta non è «alzo il tetto?» ma «cosa è rientrato dalla finestra?».
 */
describe('il prompt non ricresce da solo', () => {
  const TETTO: Record<string, number> = {
    // Misurati con questo stub alle 11:20 del 23/08/2026, subito dopo i cinque tagli, più il 15%:
    // content 48.580 · ugc 35.201 · motion 38.586 · web 35.622 · analyst 35.668 · nullo 55.154.
    // Il margine è largo di proposito — il prompt cresce di una riga per volta e un tetto che
    // scatta ogni pomeriggio è un tetto che qualcuno alza senza guardare. Questo scatta quando
    // rientra un BLOCCO, che è il difetto vero.
    content: 56_000,
    ugc: 40_500,
    motion: 44_500,
    web: 41_000,
    analyst: 41_000,
    null: 63_500
  };
  it.each(EVERY)('%s resta sotto il suo tetto', async (id) => {
    const p = await promptFor(id);
    expect(p.length, `${id ?? 'null'}: ${p.length} caratteri`).toBeLessThan(TETTO[id ?? 'null']);
  });
});

/**
 * La regola che ha fermato amazon.in (27/8/2026): un messaggio inglese non deve poter diventare
 * una risposta italiana. Vale per OGNI mestiere — non solo per i turni del kit, dove
 * `live.test.ts` la copia già con il messaggio reale di quella sessione.
 */
describe('REPLY LANGUAGE nel prompt classico', () => {
  it('il blocco assoluta è in ogni prompt, e nessuna direttiva contraddice il messaggio dell\'utente', async () => {
    for (const id of EVERY) {
      const p = await promptFor(id);
      expect(p, String(id)).toContain("REPLY LANGUAGE — ABSOLUTE RULE: write every user-facing message in the language of the user's latest message");
      expect(p, String(id)).not.toMatch(/Respond in (Italian|English)\b/);
    }
  });

  it('nemmeno il playbook dei crediti pinnna una lingua al posto dell\'utente', async () => {
    // Il blocco crediti sta dietro i dati del budget (qui nudi nello stub): si copia il
    // sorgente, che è ciò che il prompt poi incolla.
    const src = (await import('node:fs')).readFileSync('src/lib/server/chat/system-prompt.ts', 'utf8');
    expect(src).toContain("in the language of the user's latest message, ${lang} only as fallback");
    expect(src).not.toContain('Explain clearly in ${lang}');
  });
});
