import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { AGENT_IDS, pickTools } from './agents';
import { createTestSupabase } from '$lib/testkit/supabase';

/**
 * LA TELEMETRIA È FINTA QUI, E NON PER COMODITÀ.
 *
 * `logAiCall` scrive davvero in `ai_calls`: senza questo mock ogni giro di questi test apriva una
 * connessione verso la Supabase di produzione e ci lasciava un `insert failed: invalid input
 * syntax for type uuid: "th"`. Un test unitario che parla col database vero è lento e non
 * deterministico — e qui serve anche l'opposto: poter GUARDARE cosa è stato registrato, perché il
 * passo di scoperta (`ls`, `grep`, `glob`) non lasciava traccia da nessuna parte e senza traccia
 * il prima/dopo della migrazione non esiste.
 */
const logged = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const bucketFiles = vi.hoisted(() => new Map<string, string>());

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        list: async (prefix: string) => ({
          data: [...bucketFiles.keys()]
            .filter((k) => k.startsWith(`${prefix}/`))
            .map((k) => ({ name: k.slice(prefix.length + 1).split('/')[0] }))
        }),
        download: async (path: string) =>
          bucketFiles.has(path)
            ? { data: { text: async () => bucketFiles.get(path) }, error: null }
            : { data: null, error: { message: 'not found' } },
        upload: async (key: string, body: Blob) => {
          bucketFiles.set(key, await body.text());
          return { error: null };
        }
      })
    }
  })
}));

const netHits = vi.hoisted(() => [] as string[]);

beforeEach(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    netHits.push(url);
    throw new Error(`rete vietata nei test di agent-files: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(netHits, `questi test hanno provato a parlare con la rete: ${[...new Set(netHits)].join(', ')}`).toEqual([]);
  netHits.length = 0;
});

vi.mock('$lib/server/ai-log', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logAiCall: (row: unknown) => {
      logged.push(row as Record<string, unknown>);
    }
  };
});

import {
  AGENT_FILES,
  BRAND_FILE_PATHS,
  createFileTools,
  REQUIRED_READS,
  filePathsFor,
  filesIndexFor,
  gateOnFileRead,
  hasReadFile
} from './agent-files';
import { createChatTools } from './tools';
import { createSubagentTools } from './subagents';
import { createSandboxTools } from './sandbox-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub = {} as any;
const ALL = {
  ...createChatTools(stub, 'b1', 'Europe/Rome', 'u1'),
  ...createSubagentTools({ supabase: stub, brandId: 'b1', tools: {}, model: stub }),
  ...createSandboxTools({ supabase: stub, brandId: 'b1', userId: 'u1', agentId: undefined, mode: 'compute' }).tools
};

const call = (toolName: string, input: unknown): ModelMessage =>
  ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 't', toolName, input }] }) as ModelMessage;

/**
 * L'INVARIANTE CHE IMPEDISCE IL VICOLO CIECO, ed è il motivo per cui questo file esiste.
 *
 * Un'azione con `unlocks` rifiuta finché il suo file non è stato letto IN QUEL TURNO. Se un
 * mestiere avesse l'azione ma non il file nel proprio indice, avrebbe in mano uno strumento che gli
 * è vietato imparare a usare: uno strumento che **non può mai chiamare**, invisibile finché
 * qualcuno non ci sbatte. Due elenchi che qualcuno deve ricordarsi di allineare producono
 * esattamente questo, prima o poi — quindi lo blocca un test, non la buona volontà.
 */
describe('file e tool derivano dalla stessa dichiarazione', () => {
  it('ogni azione con un file obbligatorio ha quel file nel proprio indice', () => {
    const dead: string[] = [];
    for (const id of AGENT_IDS) {
      const tools = new Set(Object.keys(pickTools(ALL, id)));
      const files = new Set(filePathsFor(id));
      for (const [toolName, path] of Object.entries(REQUIRED_READS)) {
        if (tools.has(toolName) && !files.has(path)) dead.push(`${id}: ${toolName} pretende ${path}, che non vede`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('ogni agente che vede un file di mestiere ha almeno una delle azioni che sblocca', () => {
    // L'inverso: un tutorial nell'indice di chi non può eseguirlo è una riga pagata a ogni turno
    // per un lavoro che quel mestiere non fa.
    const idle: string[] = [];
    for (const id of AGENT_IDS) {
      const tools = new Set(Object.keys(pickTools(ALL, id)));
      for (const path of filePathsFor(id)) {
        const unlocks = AGENT_FILES[path].unlocks;
        if (unlocks.length && !unlocks.some((t) => tools.has(t))) idle.push(`${id}: ${path}`);
      }
    }
    expect(idle).toEqual([]);
  });

  it('ogni azione dichiarata in unlocks è un tool vero', () => {
    const missing = Object.keys(REQUIRED_READS).filter((t) => !(t in ALL));
    expect(missing).toEqual([]);
  });

  it('i dati del brand sono di tutti: solo il MESTIERE può essere per mestiere', () => {
    // I fatti sul brand appartengono al brand, il mestiere all'agente — la stessa dottrina della
    // memoria. Senza questa regola un rifiuto manderebbe l'Analyst a chiedere a Motion quali sono
    // i prodotti: la cosa più costosa e più stupida che gli possiamo far fare.
    // `how/`, `skills/` e `library/` sono materia di mestiere: una guida al motion appartiene a
    // chi scrive TSX, e darla all'Analyst sarebbe una riga pagata per un lavoro che non fa.
    // Tutto il resto — i FATTI sul brand — nasce `agents: null`, o un rifiuto manderebbe
    // l'Analyst a chiedere a Motion quali sono i prodotti.
    const MESTIERE = ['how/', 'skills/', 'library/'];
    for (const [path, f] of Object.entries(AGENT_FILES)) {
      if (!MESTIERE.some((m) => path.startsWith(m))) expect(f.agents, path).toBeNull();
    }
  });

  /**
   * IL CASO CHE IL TEST NON COPRIVA, ed è quello che sarebbe rimasto vivo per mesi.
   *
   * Una persona custom ha DUE identità: `memoryAgent` vale `custom:<uuid>` (che significa "vede
   * tutto", come per le skill di default) e i tool le arrivano da `pickTools(agentId)`, cioè dal
   * mestiere di BASE. Se l'indice si costruisse dalla prima e gli strumenti dalla seconda, una
   * persona basata su `analyst` si vedrebbe promettere il file del motion e non avrebbe nemmeno il
   * `read_file` per aprirlo: il vicolo cieco che questo file esiste per impedire, in agguato
   * proprio dove l'invariante sui cinque mestieri non guarda.
   *
   * `buildSystemPrompt` usa `agentId ?? opts.memoryAgent` — in quest'ordine. Questo test È
   * quell'ordine: `filesIndexFor` interrogato con l'identità che decide anche gli strumenti.
   */
  it('una persona custom non si vede promettere file che i suoi strumenti non aprono', () => {
    for (const base of AGENT_IDS) {
      // Com'è costruito il prompt: agentId (il mestiere di base) vince su `custom:<uuid>`.
      const index = filesIndexFor(base ?? 'custom:11111111-1111-1111-1111-111111111111');
      const tools = new Set(Object.keys(pickTools(ALL, base)));
      for (const path of filePathsFor(base)) {
        if (!index.includes(path)) continue;
        expect(tools.has('read_file'), `${base}: promette ${path} senza read_file`).toBe(true);
      }
    }
    // E la prova che l'ordine sbagliato sarebbe stato un difetto vero: da sola, l'identità custom
    // vale "tutti i file" — quindi darebbe a un mestiere il file di un altro.
    expect(filesIndexFor('custom:11111111-1111-1111-1111-111111111111')).toContain('MAKE-MOTION-VIDEO');
    expect(filesIndexFor('analyst')).not.toContain('MAKE-MOTION-VIDEO');
  });

  it('read_file e ls sono in mano a ogni mestiere che ha un indice', () => {
    for (const id of AGENT_IDS) {
      if (!filesIndexFor(id)) continue;
      const tools = Object.keys(pickTools(ALL, id));
      expect(tools, id).toContain('read_file');
      expect(tools, id).toContain('ls');
    }
  });
});

describe("l'indice resta un indice, non il vecchio muro", () => {
  it('una riga per file, e nessun mestiere paga più di ~1000 token di indice', () => {
    for (const id of AGENT_IDS) {
      const index = filesIndexFor(id);
      // ~4 byte per token: la stessa proporzione con cui sono state misurate le definizioni.
      expect(Math.round(index.length / 4), id).toBeLessThan(1000);
    }
  });

  it("l'Analyst non paga le righe del motion", () => {
    expect(filesIndexFor('analyst')).not.toContain('MAKE-MOTION-VIDEO');
    expect(filesIndexFor('motion')).toContain('MAKE-MOTION-VIDEO');
    expect(filesIndexFor('content')).toContain('MAKE-MOTION-VIDEO');
  });

  it('ogni mestiere ha almeno la traccia dei propri delegati', () => {
    // `delegate_task` è in SHARED: chiunque può ritrovarsi con il rapporto di un delegato di cui
    // non si fida, quindi chiunque deve avere il percorso per verificarlo. È la ragione per cui le
    // primitive sono salite in SHARED_TOOL_KEYS.
    for (const id of AGENT_IDS) expect(filesIndexFor(id), id).toContain('runs/<id>.md');
  });

  it("l'indice dice QUANDO leggere una traccia, non solo che esiste", () => {
    // Se la si legge sempre, si rovesciano nel padre proprio i token che il delegato risparmiava.
    expect(filesIndexFor('analyst')).toContain('not when it went well');
  });
});

describe('leggi prima di agire', () => {
  const gated = gateOnFileRead({
    write_motion_source: { description: 'x', execute: async () => ({ ok: true }) }
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (messages: ModelMessage[]) => (gated.write_motion_source as any).execute({}, { toolCallId: 't', messages });

  it('senza lettura, rifiuta e dice quale file', async () => {
    const out = await run([]);
    expect(out.error).toContain('how/MAKE-MOTION-VIDEO.md');
    expect(out.read_file).toBe('how/MAKE-MOTION-VIDEO.md');
  });

  it('dopo la lettura, passa', async () => {
    const out = await run([call('read_file', { path: 'how/MAKE-MOTION-VIDEO.md' })]);
    expect(out).toEqual({ ok: true });
  });

  it('la lettura di un ALTRO file non conta', async () => {
    const out = await run([call('read_file', { path: 'how/MAKE-A-POST.md' })]);
    expect(out.error).toBeTruthy();
  });

  it('non blocca le azioni che non lo pretendono', () => {
    const other = gateOnFileRead({ render_motion_video: { description: 'x', execute: async () => ({ ok: true }) } });
    expect(other.render_motion_video).toBeDefined();
    expect(Object.keys(REQUIRED_READS)).not.toContain('render_motion_video');
  });

  /**
   * La ragione per cui il cancello guarda `opts.messages` e non una closure: una closure si azzera
   * a ogni continuazione dopo il muro dei 300 secondi, e costringerebbe a rileggere il file a ogni
   * ripresa. La storia rigiocata porta la lettura con sé — questo test È quella proprietà.
   */
  it('la lettura sopravvive alla continuazione del turno', () => {
    const replayed: ModelMessage[] = [
      call('read_file', { path: 'how/MAKE-MOTION-VIDEO.md' }),
      { role: 'user', content: 'Keep working on the goal you set for yourself.' } as ModelMessage
    ];
    expect(hasReadFile(replayed, 'how/MAKE-MOTION-VIDEO.md')).toBe(true);
  });
});


/**
 * LA TRACCIA DI UN SOTTO-AGENTE, e le tre cose che devono valere prima di esporla.
 *
 * Il rapporto non basta a fare bug fixing: se è vago, l'orchestratore deve poter andare a vedere.
 * Ma il registro contiene input e output VERI degli strumenti, quindi va esposto solo dentro il
 * perimetro giusto e passato al filtro dei segreti.
 */
describe('runs/<id>.md', () => {
  const RUN = 'runs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md';
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    agent: 'motion', mode: 'execute', status: 'ok', model: 'm', provider: 'p', error: null,
    event_count: 2,
    events: [
      { kind: 'tool_call', at: '2026-08-22T10:00:00Z', data: { tool: 'sandbox_exec', input: { cmd: 'curl -H "Authorization: Bearer ghp_AAAAAAAAAAAAAAAAAAAAAAAA"' }, output: { stdout: 'ok' } } },
      { kind: 'report', at: '2026-08-22T10:00:05Z', data: { report: 'verdict: fail' } }
    ],
    ...over
  });
  // Supabase finto: registra i filtri applicati, così il perimetro si verifica invece di sperarci.
  const fake = (found: unknown) => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      gte: (k: string, v: unknown) => { filters[k] = v; return q; },
      maybeSingle: async () => ({ data: found })
    };
    return { client: { from: () => q } as never, filters };
  };

  it('legge un giro e lo rende testo, non JSON grezzo', async () => {
    const f = fake(row());
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1', threadId: 'th', userId: 'u1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.read_file as any).execute({ path: RUN });
    expect(out.content).toContain('tool sandbox_exec');
    expect(out.content).toContain('RAPPORTO FINALE');
  });

  it('non lascia passare un token che era finito negli ARGOMENTI', async () => {
    // Gli output li pulisce già `scrub()` in sandbox-tools alla fonte; gli input no.
    const f = fake(row());
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1', threadId: 'th', userId: 'u1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.read_file as any).execute({ path: RUN });
    expect(out.content).not.toContain('ghp_AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(out.content).toContain('redacted');
  });

  it('il perimetro è brand + thread, e si vede nei filtri applicati', async () => {
    const f = fake(row());
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1', threadId: 'th', userId: 'u1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.read_file as any).execute({ path: RUN });
    expect(f.filters.brand_id).toBe('b1');
    expect(f.filters.thread_id).toBe('th');
    // E la superficie: in agent_sessions convivono le sessioni della chat e dei batch, con eventi
    // di forma diversa. Senza questo filtro un id indovinato renderebbe un documento che sembra
    // una traccia e non lo è.
    expect(f.filters.surface).toBe('chat_subagent');
    expect(f.filters.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('una traccia potata dice "non più disponibile", non un file bianco', async () => {
    // `agent_sessions` non ha conservazione: un file vuoto farebbe concludere "il delegato non ha
    // fatto niente", che è la conclusione sbagliata.
    const f = fake(null);
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1', threadId: 'th', userId: 'u1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.read_file as any).execute({ path: RUN });
    expect(out.error).toContain('non più disponibile');
  });

  it('grep trova la riga senza rovesciare tutto il giro nel padre', async () => {
    const f = fake(row());
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1', threadId: 'th', userId: 'u1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.grep as any).execute({ path: RUN, query: 'verdict' });
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches[0].text).toContain('verdict');
  });

  it('senza contesto di brand non si legge niente', async () => {
    const tools = createFileTools('motion', 'th');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.read_file as any).execute({ path: RUN });
    expect(out.error).toBeTruthy();
  });

  it('un thread mancante chiude la lettura, non la allarga', async () => {
    // Con `threadId` facoltativo il perimetro era «tutto il brand», cioè le conversazioni dei
    // colleghi: `agent_sessions` non ha la policy `user_id = auth.uid()` che hanno chat_threads e
    // chat_messages, e il transcript contiene i messaggi dell'utente.
    const f = fake(row());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1' } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.read_file as any).execute({ path: RUN });
    expect(out.error).toBeTruthy();
  });

  it('rifiuta una riga scritta prima della redazione', async () => {
    const f = fake(row());
    const tools = createFileTools('motion', 'th', { supabase: f.client, brandId: 'b1', threadId: 'th', userId: 'u1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.read_file as any).execute({ path: RUN });
    expect(f.filters.format_version).toBe(2);
    expect(f.filters.user_id).toBe('u1');
  });
});


describe('hasReadFile — una lettura fallita non è una lettura', () => {
  const path = 'how/MAKE-MOTION-VIDEO.md';
  const call = (id: string) =>
    ({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: id, toolName: 'read_file', input: { path } }]
    }) as unknown as ModelMessage;
  const result = (id: string, output: unknown) =>
    ({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: id, toolName: 'read_file', output }]
    }) as unknown as ModelMessage;

  it('la lettura riuscita apre il cancello', () => {
    expect(hasReadFile([call('a'), result('a', { type: 'json', value: { path, content: 'DEFAULT CRAFT…' } })], path)).toBe(true);
  });

  it('un output con error non conta come lettura', () => {
    expect(hasReadFile([call('a'), result('a', { type: 'json', value: { error: 'db timeout' } })], path)).toBe(false);
  });

  it('e neanche un risultato marcato come errore dall SDK', () => {
    expect(hasReadFile([call('a'), result('a', { type: 'error-text', value: 'boom' })], path)).toBe(false);
  });

  it('una seconda lettura riuscita recupera la prima fallita', () => {
    const msgs = [
      call('a'),
      result('a', { type: 'json', value: { error: 'db timeout' } }),
      call('b'),
      result('b', { type: 'json', value: { path, content: 'DEFAULT CRAFT…' } })
    ];
    expect(hasReadFile(msgs, path)).toBe(true);
  });

  it('ponytail: fail-open quando il risultato non c è ancora, non si blocca il prodotto', () => {
    expect(hasReadFile([call('a')], path)).toBe(true);
  });
});

/**
 * `ls` E `grep` RISPONDONO SULL'ALBERO INTERO, NON SULL'INDICE.
 *
 * `mine` (i soli file `indexed`) è la lista curata che sta nella DESCRIZIONE di `read_file`: lì
 * deve restare corta, si paga a ogni step. Ma `ls` e `grep` sono il modo di scoprire cosa esiste,
 * e se rispondono da `mine` l'agente vede un file su 153: `ls('skills/remotion/')` torna vuoto,
 * `grep` con un prefisso vero dà errore, e ogni via d'uscita insegna che la cosa non esiste.
 * Il test non fissa un numero — cambia a ogni voce aggiunta — ma la PROPRIETÀ.
 */
describe('ls e grep vedono tutto l’albero, non solo l’indice', () => {
  const withTree = AGENT_IDS.filter((id) => filePathsFor(id, { all: true }).length > filePathsFor(id).length);

  it('c’è almeno un mestiere con file non indicizzati, o il test non prova niente', () => {
    expect(withTree.length).toBeGreaterThan(0);
  });

  it('ls senza prefisso conta l’albero intero e nomina le cartelle', async () => {
    for (const id of withTree) {
      const { ls } = createFileTools(id);
      const out = (await ls.execute({ path: '' }, stub)) as { total: number; folders: string[] };
      expect(out.total, id).toBe(filePathsFor(id, { all: true }).length + BRAND_FILE_PATHS.length);
      // `folders` vuoto era il sintomo gemello: il filtro che le costruiva era identico a `mine`,
      // quindi ogni elemento veniva saltato.
      expect(out.folders.length, id).toBeGreaterThan(0);
    }
  });

  it('ls e grep su un prefisso che esiste nell’albero non tornano vuoti', async () => {
    for (const id of withTree) {
      const hidden = filePathsFor(id, { all: true }).filter((p) => !filePathsFor(id).includes(p));
      const prefix = `${hidden[0].split('/').slice(0, 2).join('/')}/`;
      const { ls, grep } = createFileTools(id);
      const listed = (await ls.execute({ path: prefix }, stub)) as { files: string[]; folders: string[] };
      // Non «ha file»: un livello può essere fatto di sole sottocartelle. Non deve essere VUOTO.
      expect(listed.files.length + listed.folders.length, `${id} ls ${prefix}`).toBeGreaterThan(0);
      // Un errore è peggio del vuoto: insegna al modello che il prefisso non esiste.
      const found = (await grep.execute({ query: 'the', path: prefix }, stub)) as { error?: string };
      expect(found.error, `${id} grep ${prefix}`).toBeUndefined();
    }
  });

  it('una cartella è una cartella: un file non si stampa come tale', async () => {
    for (const id of withTree) {
      const { ls } = createFileTools(id);
      const out = (await ls.execute({ path: '' }, stub)) as { folders: string[] };
      for (const row of out.folders) {
        const prefix = row.split(' — ')[0];
        expect(AGENT_FILES[prefix.replace(/\/$/, '')], `${id}: ${prefix}`).toBeUndefined();
      }
    }
  });
});

/**
 * UN LIVELLO PER VOLTA; IL SOTTOALBERO SI CHIEDE.
 *
 * `ls('skills/remotion/')` rovesciava 74 path in un colpo — il camion che questo tool esiste per
 * togliere. Adesso il default nomina il livello (11 sottocartelle col loro conteggio + 1 file) e
 * `recursive: true` resta disponibile per chi lo vuole davvero. Il booleano è POSITIVO di
 * proposito: un modello che legge novanta definizioni sbaglia i negativi (`shallow`, `no_recurse`)
 * più spesso di quanto convenga.
 */
describe('ls: un livello per volta, il sottoalbero si chiede', () => {
  /** Un prefisso di secondo livello che ha davvero qualcosa sotto, o il test non prova niente. */
  const deepPrefixes = AGENT_IDS.flatMap((id) => {
    const nested = filePathsFor(id, { all: true }).find((p) => p.split('/').length > 3);
    return nested ? [[id, `${nested.split('/').slice(0, 2).join('/')}/`] as [string, string]] : [];
  });

  it('c’è almeno un mestiere con un sottoalbero vero', () => {
    expect(deepPrefixes.length).toBeGreaterThan(0);
  });

  it('il default resta al livello, il ricorsivo scende', async () => {
    for (const [id, prefix] of deepPrefixes) {
      const { ls } = createFileTools(id);
      const shallow = (await ls.execute({ path: prefix }, stub)) as { files: string[]; folders: string[] };
      const deep = (await ls.execute({ path: prefix, recursive: true }, stub)) as { files: string[] };
      const isDeeper = (p: string) => p.slice(prefix.length).includes('/');

      expect(shallow.files.filter(isDeeper), `${id} ${prefix}`).toEqual([]);
      expect(deep.files.some(isDeeper), `${id} ${prefix}`).toBe(true);
      // Meno voci: è tutto il punto. Il ricorsivo può solo costare di più.
      expect(shallow.files.length + shallow.folders.length, `${id} ${prefix}`).toBeLessThan(deep.files.length);
      // Ogni cartella porta il suo conteggio, o la scelta di scendere è alla cieca.
      for (const row of shallow.folders) expect(row, `${id} ${row}`).toMatch(/ — \d+ file /);
    }
  });

  it('nessuna delle due nasconde un troncamento', async () => {
    // Il giro qui sotto è condizionale: se nessun prefisso supera il tetto non asserisce niente.
    // Questo caso invece lo supera per costruzione — l'albero intero — quindi il ramo è coperto.
    const big = AGENT_IDS.filter((id) => filePathsFor(id, { all: true }).length > 60);
    expect(big.length).toBeGreaterThan(0);
    for (const id of big) {
      const out = (await createFileTools(id).ls.execute({ recursive: true }, stub)) as {
        files: string[];
        note?: string;
      };
      expect(out.files.length, id).toBeLessThan(filePathsFor(id, { all: true }).length);
      expect(out.note, id).toMatch(/grep/);
    }
    for (const [id, prefix] of deepPrefixes) {
      const { ls } = createFileTools(id);
      const under = filePathsFor(id, { all: true }).filter((p) => p.startsWith(prefix));
      for (const args of [{ path: prefix }, { path: prefix, recursive: true }]) {
        const out = (await ls.execute(args, stub)) as { files: string[]; folders?: string[]; note?: string };
        const shown = args.recursive ? under.length : under.filter((p) => !p.slice(prefix.length).includes('/')).length;
        if (out.files.length < shown) expect(out.note, `${id} ${prefix} ${!!args.recursive}`).toMatch(/grep/);
      }
    }
  });
});

/**
 * LE PRIMITIVE NON MENTONO — un test per ognuno dei difetti trovati il 23/8, che fallisce se torna.
 *
 * Sono tutti sulla PROPRIETÀ e non sui numeri: l'albero cresce a ogni voce aggiunta, e un test che
 * fissa «153» è un test che qualcuno aggiorna senza leggerlo. La regola che li tiene insieme è una
 * sola: ogni tetto dichiarato, ogni cecità dichiarata, ogni troncamento dichiarato. Un `grep` che
 * dice «cercato in tutti i file» quando ne ha guardato uno non è impreciso: chiude l'indagine.
 */
describe('nessuna primitiva mente', () => {
  const GUIDE = 'how/MAKE-MOTION-VIDEO.md';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const T = (id: string) => createFileTools(id) as any;

  it('read_file impagina, e dichiara dove si è fermato', async () => {
    const { read_file } = T('motion');
    const whole = await read_file.execute({ path: GUIDE });
    const page = await read_file.execute({ path: GUIDE, offset: 10, limit: 50 });
    expect(page.content).toBe(whole.content.slice(10, 60));
    // Un taglio senza «come riprendo» si legge come il file intero: è così che un agente conclude
    // che il resto non esiste.
    expect(page.next_offset).toBe(60);
    expect(page.chars).toContain(String(whole.content.length));
    const tail = await read_file.execute({ path: GUIDE, offset: whole.content.length - 5 });
    expect(tail.content.length).toBe(5);
    expect(tail.next_offset).toBeUndefined();
    expect(tail.chars).toContain('fine del file');
    // E chi non impagina non paga i campi della paginazione.
    expect(whole.chars).toBeUndefined();
  });

  it('una lettura impaginata NON apre il cancello del motion', () => {
    // 67.726 caratteri di specifiche: con `limit: 2000` l'agente ne vedrebbe il 3% e scriverebbe
    // lo stesso. «Riuscita» e «completa» sono due cose diverse da quando esiste `offset`.
    expect(hasReadFile([call('read_file', { path: GUIDE })], GUIDE)).toBe(true);
    expect(hasReadFile([call('read_file', { path: GUIDE, limit: 2000 })], GUIDE)).toBe(false);
    expect(hasReadFile([call('read_file', { path: GUIDE, offset: 500 })], GUIDE)).toBe(false);
  });

  it('la descrizione di read_file non dice a nessun mestiere che non ha niente da leggere', () => {
    // Diceva `Yours: ${mine.join(', ')}`, e per `web` e `analyst` quella lista è VUOTA: la
    // descrizione diceva «Yours: .» a ogni passo. La proprietà, che non invecchia: la descrizione
    // non è un elenco di path — non contiene NESSUN path e non cresce con l'albero.
    for (const id of AGENT_IDS) {
      const d = String(T(id).read_file.description);
      expect(d, id).toMatch(/\bls\b/);
      expect(d, id).not.toMatch(/Yours:\s*\./);
      for (const p of filePathsFor(id, { all: true })) expect(d.includes(p), `${id} inlina ${p}`).toBe(false);
    }
  });

  it('grep distribuisce il tetto fra i file, non lo esaurisce sul primo', async () => {
    // Il tetto era GLOBALE: `useCurrentFrame` esiste in decine di file e tornavano 12 righe tutte
    // dallo stesso, con «152 file non guardati» accanto. È la fame delle fonti del radar applicata
    // ai file — chi sta in fondo all'elenco non esiste mai.
    const out = await T('motion').grep.execute({ query: 'the', max_matches: 8 });
    expect(out.matches.length).toBe(8);
    expect(new Set(out.matches.map((m: { path: string }) => m.path)).size).toBeGreaterThan(1);
    // E il resto si dichiara: quante righe sono rimaste fuori, non «fermato a 8».
    expect(out.not_shown).toMatch(/\d+ righe in più/);
  });

  it('grep dichiara quanti file ha guardato DAVVERO', async () => {
    // `scope` diceva «cercato in tutti i 153 file» mentre `searched_files` accanto diceva 1.
    const out = await T('motion').grep.execute({ query: 'the', max_matches: 3 });
    expect(out.scope).toContain(String(out.searched_files));
    expect(out.searched_files).toBeGreaterThan(1);
  });

  it('grep trova una parola accentata scritta nell’altra forma Unicode', async () => {
    // I contenuti arrivano da scrape e database, dove NFC e NFD convivono: «però» nelle due forme
    // sono due stringhe diverse per `includes()`, e il sintomo è «il file non contiene quella
    // parola». La traccia di un giro è l'unico corpo di cui questo test controlla il testo.
    const RUN = 'runs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md';
    const row = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      agent: 'motion', mode: 'execute', status: 'ok', model: 'm', provider: 'p', error: null,
      event_count: 1,
      events: [{ kind: 'report', at: '2026-08-23T10:00:00Z', data: { report: 'però la resa è corretta' } }]
    };
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, gte: () => q, maybeSingle: async () => ({ data: row })
    };
    const tools = createFileTools('motion', 'th', {
      supabase: { from: () => q } as never, brandId: 'b1', threadId: 'th', userId: 'u1'
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grepIt = (query: string) => (tools.grep as any).execute({ path: RUN, query });
    expect((await grepIt('però')).matches.length).toBeGreaterThan(0);
    expect((await grepIt('però')).matches.length).toBeGreaterThan(0); // NFD
    expect((await grepIt('pero')).matches.length).toBeGreaterThan(0); // senza accento
  });

  it('un prefisso sconosciuto NON è un errore: è «qui non guardo»', async () => {
    // Un errore un modello lo legge come «quella cosa non esiste» e chiude l'indagine. «Non
    // esiste» è un fatto sul mondo, «non ho guardato» è un fatto sullo strumento.
    for (const id of AGENT_IDS) {
      const { grep } = T(id);
      const ovunque = await grep.execute({ query: 'brand' });
      expect(ovunque.error, `${id} grep senza prefisso`).toBeUndefined();
      const altrove = await grep.execute({ query: 'brand', path: 'non/esiste/' });
      expect(altrove.error, `${id} grep prefisso ignoto`).toBeUndefined();
      expect(altrove.blind, id).toMatch(/NON ho cercato/);
      expect(altrove.matches, id).toEqual([]);
    }
  });

  it('ogni prefisso che grep suggerisce funziona davvero', async () => {
    // `how/MAKE-MOTION-VIDEO.md/` era fra i suggeriti: un prefisso che l'agente copia-incolla e
    // che non elenca niente. Un suggerimento sbagliato costa uno step e insegna la stessa cosa
    // falsa del rifiuto che voleva evitare.
    const { grep, ls } = T('motion');
    const out = await grep.execute({ query: 'qualunque', path: 'non/esiste/' });
    expect(out.available_prefixes.length).toBeGreaterThan(0);
    for (const p of out.available_prefixes) {
      const listed = await ls.execute({ path: p });
      expect(listed.files.length + listed.folders.length, `ls ${p}`).toBeGreaterThan(0);
    }
  });

  it('ls sa filtrare, non solo tagliare', async () => {
    // Dichiarare «60 di 1.000» è onesto e inutile: l'agente sa che gli manca qualcosa e non ha
    // modo di andarselo a prendere. `query` e `limit` sono la maniglia.
    const paths = filePathsFor('motion', { all: true });
    const target = paths.find((p) => p.split('/').length > 3) ?? paths[0];
    const token = (target.split('/').pop() as string).slice(0, 6);
    const { ls } = T('motion');
    const filtered = await ls.execute({ recursive: true, query: token, limit: 500 });
    expect(filtered.files.length).toBeGreaterThan(0);
    expect(filtered.files).toContain(target);
    for (const p of filtered.files) expect(p.toLowerCase(), token).toContain(token.toLowerCase());
    // E il tetto resta dichiarato quando morde.
    const capped = await ls.execute({ recursive: true, limit: 5 });
    expect(capped.files.length).toBe(5);
    expect(capped.note).toMatch(/^5 di \d+/);
  });

  it('glob trova per forma del nome, e un pattern senza risultati non è un errore', async () => {
    const { glob } = T('motion');
    const tsx = await glob.execute({ pattern: '**/*.tsx', limit: 500 });
    const attesi = filePathsFor('motion', { all: true }).filter((p) => p.endsWith('.tsx'));
    expect(attesi.length).toBeGreaterThan(0);
    expect(tsx.total).toBe(attesi.length);
    for (const p of tsx.files) expect(p.endsWith('.tsx'), p).toBe(true);
    // `*` non attraversa le cartelle, `**` sì: se fossero uguali, `glob` sarebbe `ls` con un nome
    // diverso.
    const dentroUnSegmento = await glob.execute({ pattern: '*.tsx', limit: 500 });
    expect(dentroUnSegmento.total).toBeLessThan(tsx.total);
    const niente = await glob.execute({ pattern: '**/*.zzz' });
    expect(niente.error).toBeUndefined();
    expect(niente.blind).toMatch(/Nessun path/);
  });

  it('una chiave della catena dei prototipi rifiuta, non esplode', async () => {
    // `AGENT_FILES['constructor']` risponde `Object.prototype.constructor`: passava `if (!f)` e
    // moriva su `f.body()` con un TypeError NON catturato dentro `execute`.
    const { read_file } = T('motion');
    for (const p of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const out = await read_file.execute({ path: p });
      expect(out.error, p).toContain('No such file');
    }
  });

  it('ls, grep e glob lasciano una riga in ai_calls come read_file', async () => {
    // Il passo di SCOPERTA era invisibile agli strumenti con cui tutto è stato misurato: righe
    // `read_file` e zero `ls`. Senza, il prima/dopo della migrazione non è confrontabile.
    logged.length = 0;
    const t = T('motion');
    await t.ls.execute({});
    await t.grep.execute({ query: 'the', max_matches: 2 });
    await t.glob.execute({ pattern: '**/*.md', limit: 1 });
    await t.read_file.execute({ path: GUIDE });
    expect(logged.map((r) => r.label).sort()).toEqual(['glob', 'grep', 'ls', 'read_file']);
  });
});

/**
 * IL PATH CHE `motion_list` PROMETTE. La descrizione di quel tool manda l'agente a leggere il
 * sorgente su `artifacts/motion/<id>.md`: se la proiezione smettesse di rispondere, il tool
 * manderebbe tutti in un vicolo cieco e nessun test se ne accorgerebbe.
 */
describe('artifacts/motion/<id>.md è il sorgente, non una promessa', () => {
  const ID = '11111111-2222-3333-4444-555555555555';
  const SOURCE = 'export const durationInFrames = 90;\nexport default function MotionVideo() { return null; }';

  it('read_file su quel path restituisce il TSX salvato', async () => {
    const kit = createTestSupabase({
      motion_videos: [
        {
          id: ID,
          brand_id: 'b1',
          title: 'Trailer',
          source: SOURCE,
          preview_url: null,
          fps: 30,
          duration_in_frames: 90,
          width: 1080,
          height: 1080,
          created_at: '2026-03-04T10:00:00Z',
          updated_at: '2026-03-05T11:00:00Z'
        }
      ]
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { read_file } = createFileTools('motion', 'run1', {
      supabase: kit.client,
      brandId: 'b1',
      threadId: 'run1'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as any;
    const out = await read_file.execute({ path: `artifacts/motion/${ID}.md` });
    expect(out.error).toBeUndefined();
    expect(out.content).toContain(SOURCE);
  });
});

/**
 * LA GUIDA AI PROMPT IMMAGINE STA DOVE SI MINTA UN'IMMAGINE, e da nessun'altra parte.
 *
 * `generate_image` prende un `prompt` scritto dall'agente in chat (post-editor-tools.ts): quel
 * testo diventa il brief dell'image agent, e sul percorso legacy — `isImageAgentEnabled()` falso —
 * arriva al renderer così com'è. Chi ha quel tool deve vedere la guida; chi non ce l'ha no, perché
 * un indice si paga a ogni passo.
 */
describe('how/WRITE-IMAGE-PROMPTS.md', () => {
  const PATH = 'how/WRITE-IMAGE-PROMPTS.md';

  it('la vedono tutti e soli i mestieri che possono mintare un\'immagine', () => {
    const minters = AGENT_IDS.filter((id) => 'generate_image' in pickTools(ALL, id));
    expect(minters.length).toBeGreaterThan(0);
    for (const id of AGENT_IDS) {
      expect(filePathsFor(id).includes(PATH), `${id}`).toBe(minters.includes(id));
    }
  });

  it('non è un cancello: nessun numero lo giustifica ancora', () => {
    expect(AGENT_FILES[PATH].unlocks).toEqual([]);
    expect(Object.values(REQUIRED_READS)).not.toContain(PATH);
  });
});
