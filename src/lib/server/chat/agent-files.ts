/**
 * I FILE DELL'AGENTE — la conoscenza si va a prendere, non si riceve a ogni passo.
 *
 * Il materiale che stava nel prompt di `content` e `motion` (craft specs + ricettario, ~15k token a
 * OGNI step di OGNI turno, anche scrivendo una didascalia) qui è un file: facoltativo da leggere e
 * OBBLIGATORIO per agire — chi chiama un'azione in `unlocks` senza averlo letto in questo turno si
 * vede rifiutare la scrittura, con il nome del file. È la cosa che un prompt non può fare.
 *
 * Via di ritorno se il cancello peggiora gli agenti: rimettere il blocco negli head di `agents.ts`
 * (ricomponibile da `MOTION_CRAFT_SPECS` + `MOTION_TRANSITIONS_COOKBOOK_PROMPT`) e togliere
 * `unlocks`. Nient'altro dipende da questo file.
 *
 * I corpi sono COSTANTI DI CODICE, con i loro test. Un override dal bucket vince sul codice in
 * `readAgentFile`, ma i gate no: se un file dicesse il contrario di `assertMotionVoiceGate`, vince
 * il gate.
 */
import { tool, type ToolExecutionOptions, type ModelMessage } from 'ai';
import { z } from 'zod';
import { MOTION_CRAFT_SPECS } from '$lib/motion-video/craft';
import { MOTION_TRANSITIONS_COOKBOOK_PROMPT, TRANSITIONS_COOKBOOK } from '$lib/motion-video/transitions-cookbook';
import {
  MOTION_LIBRARY,
  libraryFileBody,
  motionLibraryIndex
} from '$lib/motion-video/library';
import { defaultMotionSource } from '$lib/motion-video/source';
import { defaultGraphicHtml } from '$lib/design/graphic-source';
import { disruptiveSystemSection } from '$lib/disruptive';
import { renderBrandStudioFile, renderBrandStrategyFile } from '$lib/server/chat/brand-file';
import { DEFAULT_SKILLS } from '$lib/server/default-skills';
import VIDEO_PROMPTS_GUIDE from '$lib/agent-docs/how/WRITE-VIDEO-PROMPTS.md?raw';
import { AGENTS, type AgentId } from '$lib/server/chat/agents';
import { logAiCall } from '$lib/server/ai-log';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redactFor } from '$lib/server/redact';

/**
 * Una dichiarazione sola per file: da qui si derivano l'indice E il cancello (`REQUIRED_READS`),
 * invece di tenere allineati due elenchi.
 *
 * `how/` è per mestiere, i dati del brand sono di tutti: ogni file che NON sta sotto `how/` nasce
 * con `agents: null`, e il test lo pinna — altrimenti un rifiuto manderebbe l'Analyst a chiedere a
 * Motion quali sono i prodotti.
 */
export type AgentFile = {
  /** Chi lo vede nell'indice e può leggerlo. `null` = tutti. */
  agents: readonly AgentId[] | null;
  /**
   * Se compare nell'INDICE del prompt. Default true. Leggibile e elencato sono due cose diverse:
   * l'indice si paga a ogni passo, e metterci dentro ricettario, skill e semi lo farebbe passare da
   * ~100 a più di mille token, cioè rifare il muro che questo file esiste per togliere.
   */
  indexed?: boolean;
  /** Le azioni che senza questa lettura, in questo turno, rifiutano. */
  unlocks: readonly string[];
  /**
   * Quando il cancello morde davvero: è PER TOOL, e `create_post` fa un post-foto, un carosello e un
   * reel con lo stesso nome. Senza il predicato, la guida dei video bloccherebbe ogni post.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  only?: (input: any) => boolean;
  /** Una riga per l'indice: cosa c'è dentro e QUANDO si legge. */
  summary: string;
  /** Pigro: il corpo si compone solo quando qualcuno legge davvero. */
  body: () => string;
};

/** Gli unici due mestieri che scrivono TSX Remotion — gli stessi di `MOTION_WRITERS`. */
const MOTION_WRITERS = ['motion', 'content'] as const satisfies readonly AgentId[];

export const AGENT_FILES: Record<string, AgentFile> = {
  'how/MAKE-MOTION-VIDEO.md': {
    agents: MOTION_WRITERS,
    unlocks: ['create_motion_video', 'write_motion_source', 'replace_motion_source'],
    summary:
      'how a Remotion motion video is built here: the transition recipes WITH their code, the craft specs, and the checks that refuse a render',
    /**
     * L'indice della libreria sta nel CORPO e non in `filesIndexFor`: l'indice di radice si paga a
     * ogni passo, questo una volta per turno e solo a chi scrive motion.
     *
     * ponytail: `MOTION_TRANSITIONS_COOKBOOK_PROMPT` inlina ancora tutte e undici le ricette (~15k
     * token) mentre esistono già una per file sotto `how/motion/transitions/` — sostituibile con il
     * suo indice.
     */
    body: () => `${MOTION_CRAFT_SPECS}\n\n${motionLibraryIndex()}\n\n${MOTION_TRANSITIONS_COOKBOOK_PROMPT}`
  },

  // ── Le PARTI, per chi le deve rivedere una alla volta ──────────────────────────────────────
  // Fuori dall'indice (`indexed: false`): l'agente le riceve già dentro MAKE-MOTION-VIDEO.md, e
  // elencarle a ogni turno rifarebbe il muro. Esistono come path perché il proprietario le
  // revisiona una per una, e perché un `grep` deve poterle trovare separate.
  'how/motion/craft.md': {
    agents: MOTION_WRITERS,
    unlocks: [],
    indexed: false,
    summary: 'le craft specs del motion, da sole',
    body: () => MOTION_CRAFT_SPECS
  },
  'how/graphic/seed.html': {
    agents: ['content'],
    unlocks: [],
    indexed: false,
    summary: 'il seme di una grafica tipografica — la forma da cui parte ogni composizione',
    body: () => defaultGraphicHtml({ brandName: 'Brand', headline: 'Il titolo del pezzo' })
  },
  /**
   * IL CANCELLO QUI SE LO MERITA, e i numeri lo dicono più forte del ricettario.
   *
   * Il ricettario ha il cancello perché senza si scriveva l'import sbagliato: due render morti in
   * produzione. Qui il danno equivalente è chiedere al diffusore di SCRIVERE del testo — e la
   * misura è peggiore: 131 prompt su 340 lo chiedono, e il 16,8% delle review ritrova testo
   * corrotto sullo schermo («Social growts», «Scopa menu»). Non è un rischio teorico, è il difetto
   * più frequente che abbiamo sui visuali.
   *
   * Ma morde SOLO sui video (`only`): `create_post` fa anche foto e caroselli, e pretendere una
   * guida sui prompt video prima di una foto sarebbe il cancello che qualcuno toglie perché dà
   * fastidio. Chi scrive un reel la legge; chi scrive una didascalia no.
   */
  'how/WRITE-VIDEO-PROMPTS.md': {
    agents: ['content', 'ugc'],
    unlocks: ['create_post'],
    only: (input) => String(input?.content_type ?? '') === 'video',
    summary:
      'come si scrive un prompt per Seedance 2.5: struttura, i lock numerici, le note per genere — e perché il testo non si chiede MAI dentro il prompt',
    body: () => VIDEO_PROMPTS_GUIDE
  },
    /**
     * `agents: null` e nessun `unlocks`: vale per tutti (anche l'Analyst propone angoli) e non blocca
     * niente. Un cancello qui sarebbe sproporzionato — il difetto che copre è «la proposta è
     * prudente», non «il render muore», e un cancello che dà fastidio è un cancello che si toglie.
     */
  'how/DISRUPTIVE-IDEAS.md': {
    agents: null,
    unlocks: [],
    summary:
      'come si propone un\'idea che non sia il default corretto: i tre test, le leve di contrasto e i limiti non negoziabili — si legge PRIMA di consegnare angoli, campagne, script o varianti, non prima di ogni post',
    body: () => disruptiveSystemSection()
  },

  'how/motion/seed.tsx': {
    agents: MOTION_WRITERS,
    unlocks: [],
    indexed: false,
    summary: 'il seme di un motion video — il documento piu` letto del sistema, il modello imita questo',
    body: () => defaultMotionSource({ brandName: 'Brand' })
  }
};

// Una voce della libreria entra solo dopo aver prodotto un MP4 nella stessa VM del render di
// produzione; il ricettario è verificato solo dal compilatore. La differenza è costata due render:
// `compileMotionSource` esegue solo il corpo del modulo, quindi un import sbagliato passa il
// controllo e muore in VM.
for (const e of MOTION_LIBRARY) {
  AGENT_FILES[`how/motion/library/${e.id}.md`] = {
    agents: MOTION_WRITERS,
    unlocks: [],
    indexed: false,
    summary: e.intent,
    body: () => libraryFileBody(e)
  };
}

  // Generate dal registro vero (`TRANSITIONS_COOKBOOK`), non trascritte: il ricettario esiste in una
  // forma sola — quella che il suo test compila — e una seconda copia sarebbe la copia che diverge.
for (const e of TRANSITIONS_COOKBOOK) {
  // Solo le voci che RENDERIZZANO. `renders` è il risultato dell'ultima cottura in VM
  // (`npm run bake:motion-library -- --cookbook`), non della compilazione: una voce che compila e
  // muore al render insegna un video rotto, ed è così che sono esplosi due render in produzione.
  if (!e.renders) continue;
  AGENT_FILES[`how/motion/transitions/${e.name}.md`] = {
    agents: MOTION_WRITERS,
    unlocks: [],
    indexed: false,
    summary: e.when,
    body: () => `# ${e.name}\n\n${e.when}\n\n\`\`\`tsx\n${e.code}\n\`\`\`\n`
  };
}

// Stesso corpo che restituisce `read_memory`, e lo stesso campo `agents` di default-skills.ts.
for (const sk of DEFAULT_SKILLS) {
  AGENT_FILES[`how/skills/${sk.key}.md`] = {
    agents: (sk.agents as readonly AgentId[] | null) ?? null,
    unlocks: [],
    indexed: false,
    summary: sk.value.split('\n')[0],
    body: () => `# ${sk.key}\n\nGATE: ${sk.gate}\n\n${sk.value}\n`
  };
}

  // La libreria di animazioni si legge dai FILE dell'altro agente con `import.meta.glob` (nativo di
  // Vite, inlinea a build time): il formato `<categoria>/<slug>/{source.tsx,meta.json}` resta suo e
  // non c'è niente da tenere allineato.
  //
  // La skill Remotion ufficiale: 146 file, ~55k token, tutti leggibili (`grep` deve arrivare ovunque)
  // e nessuno nell'indice — le mappe da sole sono metà del corpus e noi facciamo social.
  // `remotion-markup/remotion-maps/**` è ESCLUSO: copia verbatim, identica tranne la profondità dei
  // link relativi, e senza l'esclusione ogni `grep` sulle mappe torna in doppia copia.
const REMOTION_SKILL = import.meta.glob('/.agents/skills/remotion-best-practices/**/*.{md,tsx,ts}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;
for (const [abs, text] of Object.entries(REMOTION_SKILL)) {
  const rel = abs.replace(/^\/?\.agents\/skills\/remotion-best-practices\//, '');
  if (rel.startsWith('remotion-markup/remotion-maps/')) continue;
  AGENT_FILES[`skills/remotion/${rel}`] = {
    agents: MOTION_WRITERS,
    unlocks: [],
    indexed: false,
    summary: `documentazione Remotion ufficiale — ${rel}`,
    body: () => text
  };
}

const LIBRARY = import.meta.glob('/src/lib/motion-video/library/**/*.{tsx,json}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;
for (const [abs, text] of Object.entries(LIBRARY)) {
  const rel = abs.replace('/src/lib/motion-video/library/', '');
  AGENT_FILES[`library/${rel}`] = {
    agents: MOTION_WRITERS,
    unlocks: [],
    indexed: false,
    summary: `libreria animazioni — ${rel}`,
    body: () => text
  };
}

  /**
   * `AGENT_FILES['constructor']` non è `undefined`: è `Object.prototype.constructor`, passa `if (!f)`
   * e muore su `f.body()` con un TypeError NON catturato dentro `execute`. Il registro non è
   * un'allowlist finché non glielo si chiede così — questa riga è la costruzione.
   */
const hasFile = (p: string): boolean => Object.hasOwn(AGENT_FILES, p);

/** Al massimo due segmenti, e MAI il file stesso: `how/MAKE-MOTION-VIDEO.md/` passato a `ls` o a
 * `grep` non elenca niente, e insegnare un prefisso che non funziona è peggio di nessun prefisso. */
function dirOf(p: string): string {
  const d = p.split('/').slice(0, -1).slice(0, 2);
  return d.length ? `${d.join('/')}/` : '';
}

/**
 * NFC più gli accenti tolti, su ENTRAMBI i lati: `includes()` confronta code point, e «però» in NFC
 * e in NFD sono due stringhe diverse — il sintomo sarebbe «il file non contiene quella parola».
 * Togliere anche gli accenti (`perche` trova `perché`) è deliberato: `grep` è scoperta, allargare è
 * l'errore giusto. Non sposta i numeri di riga: né la decomposizione né i segni toccano `\n`.
 */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Derivato da `unlocks`: un solo elenco a monte, niente da tenere allineato a mano. */
export const REQUIRED_READS: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_FILES).flatMap(([path, f]) => f.unlocks.map((t) => [t, path]))
);

/**
 * `custom:<uuid>` non è un mestiere: gira col set pieno di tool, quindi vede tutti i file. Stessa
 * regola di `buildMemoryContext` per le skill — due filtri sullo stesso concetto prima o poi
 * divergono.
 */
function asAgentId(agent?: string | null): AgentId | null {
  if (!agent || agent.startsWith('custom:')) return null;
  return agent in AGENTS ? (agent as AgentId) : null;
}

function visibleTo(f: AgentFile, agent: AgentId | null): boolean {
  return !f.agents || !agent || f.agents.includes(agent);
}

/** I path che questo mestiere può leggere. */
export function filePathsFor(agent?: string | null, opts?: { all?: boolean }): string[] {
  const id = asAgentId(agent);
  return Object.entries(AGENT_FILES)
    .filter(([, f]) => visibleTo(f, id) && (opts?.all || f.indexed !== false))
    .map(([p]) => p);
}

/** Chi possiede un file di mestiere, per nome leggibile — serve al rifiuto che instrada. */
function ownersOf(f: AgentFile): string {
  return (f.agents ?? []).map((a) => AGENTS[a].labels.en).join(' or ');
}

/**
 * L'indice sta NEL PROMPT e non dietro `ls`: se per sapere cosa esiste serve una chiamata, ogni
 * lettura costa due step invece di uno e il meccanismo perde in latenza quello che vince in token.
 * Ed è per mestiere, così l'Analyst non paga le righe dei tutorial che non può usare.
 *
 * Il tetto sano resta ~20 voci in radice, una riga l'una; le sottocartelle si elencano dentro il
 * file che le possiede. Stringa vuota se il mestiere non ha file.
 */
export function filesIndexFor(agent?: string | null): string {
  const id = asAgentId(agent);
  const lines = Object.entries(AGENT_FILES)
    .filter(([, f]) => f.indexed !== false && visibleTo(f, id))
    .map(([path, f]) => {
      const req = f.unlocks.length
        ? ` REQUIRED: ${f.unlocks.join(', ')} refuse until you have read it in this turn.`
        : '';
      return `- ${path} — ${f.summary}.${req}`;
    });
    // Ogni riga dice QUANDO si legge, non solo che il file esiste: senza il "quando" un modello lo
    // apre a ogni turno, e uno step speso costa più dei token che il file risparmia.
  for (const [path, f] of Object.entries(BRAND_FILES)) lines.push(`- ${path} — ${f.summary}`);
  lines.push(
    `- ${WORK_HISTORY_PATH} — what the brand has ACTUALLY published, from both places it can live: its own connected accounts (with real metrics) and this product. Read it before any claim about performance, and before concluding nothing was published — one of the two is often empty on its own.`
  );
  lines.push(
    '- runs/<id>.md — the full trace of a sub-agent you dispatched: every tool it called, with what, and what came back. The path comes back in the delegate_task result. Read it when a report is vague, suspicious, or claims work you cannot see — not when it went well. Long: grep it for "error" first.'
  );
    // Le primitive si nominano: il nome è l'unica cosa che un modello legge di uno strumento che non
    // ha ancora usato.
  return `## FILES — read them instead of being told
read_file(path) hands you the full text, always current (offset/limit page a long one).
grep(query, path?) searches INSIDE them, glob(pattern) finds them by NAME, ls(path?) shows what is
there. The lines below are the curated few; ls, glob and grep reach the whole tree.
Reading is cheap; guessing is not.
${lines.join('\n')}`;
}

/**
 * Il bucket è lo specchio di cosa leggono gli agenti, e la sicurezza sta nella struttura:
 *
 *   defaults/<path>   ← lo scriviamo NOI, si rigenera dal codice
 *   overrides/<path>  ← lo scrive il proprietario, vince quando c'è
 *   INDEX/<agente>.md ← l'indice VERO che quell'agente riceve nel prompt, dalla stessa filesIndexFor
 *
 * Il riallineamento tocca solo `defaults/`, quindi non può cancellare niente di suo, e il rollback
 * è cancellare un oggetto in `overrides/`. Non è un controllo che qualcuno può dimenticare: è la
 * forma delle cartelle.
 *
 * SERVE LA MIGRATION 0214 (bucket privato `agent-docs`). Finché non è applicata ogni funzione qui
 * degrada in silenzio e vince il codice: nessuna lettura si rompe per un bucket che non c'è.
 */
export const AGENT_DOCS_BUCKET = 'agent-docs';

/**
 * In coda a ogni `INDEX/<agente>.md`, contro la conclusione sbagliata facile: chi apre il bucket e
 * vede solo `how/` crede che i dati del brand non esistano. Non si scrivono qui perché sarebbero
 * centinaia di oggetti da tenere allineati a un database che cambia da solo.
 */
const BUCKET_NOTE = `---
Questo bucket contiene SOLO i file globali del prodotto — il mestiere, uguale per ogni brand.
- defaults/  scritti da noi e rigenerati: sono ciò che dice il codice
- overrides/ scritti da te: VINCONO su defaults/. Cancellare l'oggetto è il rollback.
- INDEX/     questo file: l'indice esatto che quel mestiere riceve nel prompt

I FILE DEI DATI DEL BRAND (prodotti, persone, concorrenti, piano...) NON stanno qui, ed è
deliberato: si rendono al momento dal database, per brand, e non si conservano — una copia salvata
è una copia che invecchia. Si guardano da GET /api/v1/agent-files, che risponde con la mappa di
cosa ogni agente può leggere.`;

async function docsBucket() {
  const { createAdminClient } = await import('$lib/server/supabase-admin');
  return createAdminClient().storage.from(AGENT_DOCS_BUCKET);
}

/**
 * ELENCO CHIUSO, e il test lo pinna. Il bucket è GLOBALE, non per brand, e in `readAgentFile`
 * l'override vince sul codice: finché qui sotto c'è solo materia di prodotto è innocuo, ma un
 * `overrides/brand/products.md` servirebbe gli stessi prodotti a TUTTI i brand, in silenzio e con
 * l'aria di funzionare. Per questo `brand/studio.md` non passa da `readAgentFile` ma si risolve in
 * `resolve()`, dal database del brand che sta parlando.
 */
export const OVERRIDABLE_PREFIXES = ['how/', 'skills/', 'library/'] as const;
export const isOverridable = (path: string): boolean =>
  OVERRIDABLE_PREFIXES.some((p) => path.startsWith(p));

/**
 * GLI OVERRIDE SI CERCANO UNA VOLTA, NON CENTOCINQUANTATRÉ VOLTE.
 *
 * Misurato il 23/8 su questo albero: un `grep` senza risultati chiamava `download()` su tutti e
 * 153 i file e ci metteva **20.056 ms**. Venti secondi per sentirsi dire «niente» — e nessuno di
 * quei download trovava niente, perché `overrides/` è vuoto: il costo era interamente la prova che
 * fosse vuoto, rifatta file per file. Il tetto globale di `grep` lo nascondeva solo finché la
 * query aveva molti risultati; con il tetto PER FILE (che è la riparazione giusta) ogni `grep`
 * scansiona l'albero intero, quindi questa diventa la strada normale.
 *
 * Si chiede UNA volta quali cartelle esistono sotto `overrides/`, e si scarica solo per i path che
 * stanno lì sotto. Bucket assente, migration 0214 non applicata, rete rotta: insieme vuoto, cioè
 * zero download e vince il codice — la stessa degradazione di prima, senza l'attesa.
 *
 * ponytail: TTL 60s, nessuna invalidazione. Un override appena caricato si vede al massimo un
 * minuto dopo, e il prezzo è dichiarato qui. Se un giorno deve essere immediato, la cosa da
 * azzerare è questa variabile.
 */
const OVERRIDE_TTL_MS = 60_000;
let overrideRoots: { at: number; roots: Promise<Set<string>> } | null = null;
function overrideRootsNow(): Promise<Set<string>> {
  if (overrideRoots && Date.now() - overrideRoots.at < OVERRIDE_TTL_MS) return overrideRoots.roots;
  // L'IIFE cattura tutto: la promessa memoizzata non può restare in stato "rifiutata".
  const roots = (async () => {
    try {
      const { data } = await (await docsBucket()).list('overrides');
      return new Set((data ?? []).map((o) => o.name));
    } catch {
      return new Set<string>();
    }
  })();
  overrideRoots = { at: Date.now(), roots };
  return roots;
}

/**
 * `overrides/<path>` vince quando c'è. Qualunque errore — bucket assente, oggetto assente, rete —
 * torna null e vince il codice compilato. Una lettura non può fallire per colpa dello specchio.
 */
async function readOverride(path: string): Promise<string | null> {
  if (!isOverridable(path)) return null;
  if (!(await overrideRootsNow()).has(path.split('/')[0])) return null;
  try {
    const { data, error } = await (await docsBucket()).download(`overrides/${path}`);
    if (error || !data) return null;
    const text = (await data.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Il testo di un file (override se c'è, altrimenti il codice), o null se il path non è nel registro. */
export async function readAgentFile(path: string): Promise<string | null> {
  if (!hasFile(path)) return null;
  return (await readOverride(path)) ?? AGENT_FILES[path].body();
}

/**
 * Materializza `defaults/**` e `INDEX/*.md`. Idempotente: si può chiamare quanto si vuole, e non
 * tocca MAI `overrides/`.
 */
export async function syncAgentFiles(): Promise<{ written: string[]; error?: string }> {
  const written: string[] = [];
  try {
    const b = await docsBucket();
    const put = async (key: string, text: string) => {
      const { error } = await b.upload(key, new Blob([text], { type: 'text/markdown' }), {
        upsert: true,
        contentType: 'text/markdown; charset=utf-8'
      });
      if (error) throw new Error(error.message);
      written.push(key);
    };
    for (const [path, f] of Object.entries(AGENT_FILES)) await put(`defaults/${path}`, f.body());
    for (const id of Object.keys(AGENTS) as AgentId[]) {
      const index = filesIndexFor(id);
      await put(`INDEX/${id}.md`, `${index || '(nessun file per questo mestiere)'}\n\n${BUCKET_NOTE}`);
    }
    return { written };
  } catch (e) {
    return { written, error: e instanceof Error ? e.message : String(e) };
  }
}

/** La mappa, per chi vuole guardarla senza aprire lo storage: chi legge cosa, e cosa è sovrascritto. */
export async function agentFilesManifest() {
  let overridden: string[] = [];
  try {
    const b = await docsBucket();
    for (const dir of new Set(Object.keys(AGENT_FILES).map((p) => p.split('/').slice(0, -1).join('/')))) {
      const { data } = await b.list(`overrides/${dir}`.replace(/\/$/, ''));
      for (const o of data ?? []) overridden.push(dir ? `${dir}/${o.name}` : o.name);
    }
  } catch {
    overridden = [];
  }
  return {
    bucket: AGENT_DOCS_BUCKET,
    files: Object.entries(AGENT_FILES).map(([path, f]) => ({
      path,
      agents: f.agents ?? 'all',
      unlocks: f.unlocks,
      chars: f.body().length,
      overridden: overridden.includes(path)
    })),
    indexes: Object.fromEntries((Object.keys(AGENTS) as AgentId[]).map((id) => [id, filesIndexFor(id)]))
  };
}

/**
 * Il file è stato letto in QUESTO turno, e la lettura è ANDATA A BUON FINE? Guardare la
 * `tool-call` e non il suo risultato apriva il cancello su un `read_file` tornato errore.
 *
 * Si guarda `opts.messages` e non una closure: una closure si azzera a ogni continuazione dopo il
 * muro, e costringerebbe a rileggere il file a ogni ripresa.
 */
export function hasReadFile(messages: ModelMessage[] | undefined, path: string): boolean {
  // Prima il risultato: un `read_file` che è tornato errore non ha letto niente.
  const failed = new Set<string>();
  const ok = new Set<string>();
  for (const m of messages ?? []) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      const p = part as { type?: string; toolCallId?: string; output?: unknown; result?: unknown };
      if (p.type !== 'tool-result' && !(p.type === 'tool-call' && p.output !== undefined)) continue;
      if (!p.toolCallId) continue;
      (resultIsError(p.output ?? p.result) ? failed : ok).add(p.toolCallId);
    }
  }
  for (const m of messages ?? []) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      const p = part as { type?: string; toolName?: string; toolCallId?: string; input?: unknown };
      if (p.type !== 'tool-call' || p.toolName !== 'read_file') continue;
      const input = p.input as { path?: unknown; offset?: unknown; limit?: unknown } | undefined;
      if (String(input?.path ?? '') !== path) continue;
        // UNA LETTURA A PEZZI NON È UNA LETTURA, per il cancello: con `limit` l'agente vedrebbe la
        // prima pagina di 68.000 caratteri e il cancello si aprirebbe lo stesso. Senza argomenti la
        // lettura è integrale, quindi la strada normale non cambia.
      if (input?.offset !== undefined || input?.limit !== undefined) continue;
        // ponytail: FAIL-OPEN su un risultato che non c'è (chiamata in corso, storia rigiocata senza
        // output). Fail-closed bloccherebbe ogni scrittura motion se la riproduzione perdesse gli
        // output. Il difetto vero, l'output con `error`, è chiuso qui sopra.
      if (p.toolCallId && failed.has(p.toolCallId) && !ok.has(p.toolCallId)) continue;
      return true;
    }
  }
  return false;
}

/** `{type:'json',value:{…}}` è come l'SDK incarta un output; sotto c'è l'oggetto vero. */
function resultIsError(raw: unknown): boolean {
  const o = raw as Record<string, unknown> | null | undefined;
  if (o && typeof o === 'object' && typeof o.type === 'string' && String(o.type).startsWith('error')) return true;
  const out = o && typeof o === 'object' && 'value' in o && 'type' in o ? o.value : raw;
  const o2 = out as Record<string, unknown> | null | undefined;
  // `retry` è un rifiuto ripetibile (es. storyboard_first): non è una consegna. Vedi output-tools.ts.
  return !!(o2 && typeof o2 === 'object' && (o2.error || o2.retry));
}

/**
 * Avvolge le azioni di `REQUIRED_READS` col cancello. Un nome che non esiste in `tools` è ignorato
 * in silenzio: si applica ai singoli factory, non a un registro completo.
 *
 * FAIL-OPEN quando il file non c'è nel registro: un tutorial mancante non deve mai bloccare la
 * produzione.
 */
export function gateOnFileRead<T extends Record<string, unknown>>(tools: T): T {
  const out: Record<string, unknown> = { ...tools };
  for (const [name, path] of Object.entries(REQUIRED_READS)) {
    const t = out[name] as { execute?: (i: unknown, o: ToolExecutionOptions<unknown>) => unknown } | undefined;
    if (!t?.execute) continue;
    if (!AGENT_FILES[path]) continue; // fail-open: il file non esiste, si passa
    const inner = t.execute.bind(t);
    out[name] = {
      ...t,
      execute: async (input: unknown, opts: ToolExecutionOptions<unknown>) => {
        const f = AGENT_FILES[path];
        if (f?.only && !f.only(input)) return inner(input, opts);
        if (!hasReadFile(opts?.messages, path)) {
          return {
            error: `Read ${path} first — call read_file({ path: "${path}" }). It carries the transition recipes with their code and the checks that refuse the render. This tool stays refused until you have read it in this turn.`,
            read_file: path
          };
        }
        return inner(input, opts);
      }
    };
  }
  return out as T;
}

/**
 * I path dinamici — `runs/<id>.md` (la traccia di un sotto-agente: senza, l'orchestratore può solo
 * credere al rapporto o rifare il lavoro) e i file `brand/` (i fatti del brand).
 *
 * Non stanno in `AGENT_FILES` perché il corpo di un `AgentFile` è `() => string`, sincrono e senza
 * database: quel registro è per COSTANTI di codice. Questi si risolvono in `resolve()`, col `ctx`.
 *
 * Una riga per file e nient'altro: l'indice del prompt, l'elenco di `ls`/`grep`/`glob` e la
 * risoluzione della lettura leggono tutti da qui, quindi un file nuovo si aggiunge una volta sola.
 */
type BrandFile = {
  summary: string;
  render: (ctx: RunCtx) => Promise<string>;
  /** Cosa si legge quando il render torna vuoto: mai un documento bianco spacciato per completo. */
  emptyReason: string;
};

const BRAND_FILES: Record<string, BrandFile> = {
  'brand/studio.md': {
    summary:
      "the brand's Studio as one document: identity, voice, palette, fonts, logo, art direction, content pillars, products, people, knowledge index, competitors. Read it before you WRITE anything the brand's own marks appear in — a post, a graphic, a video, an article. Not needed to answer a question, navigate, or read data back.",
    render: (ctx) => renderBrandStudioFile(ctx.supabase, ctx.brandId),
    emptyReason: "this brand's Studio has not been filled in yet."
  },
  'brand/strategy.md': {
    summary:
      'what this brand has DECIDED to do: positioning, the competitive research summary, the active editorial plan week by week (theme, focus, content mix, the user brief that overrides it, the products picked for that week) and the active GTM roadmap with its phases. Read it before planning, before proposing what to publish next, and before judging whether something fits the plan.',
    render: (ctx) => renderBrandStrategyFile(ctx.supabase, ctx.brandId),
    emptyReason: 'this brand has no strategy, no active editorial plan and no GTM plan yet.'
  }
};

export const BRAND_FILE_PATHS: readonly string[] = Object.keys(BRAND_FILES);

/**
 * `work/history.md` — CIO' CHE IL BRAND HA DAVVERO PUBBLICATO.
 *
 * La spec dell'Analyst («Ground every claim in `query` results or `work/history/`») mandava a un
 * path che non esisteva: `filesIndexFor` non lo conosceva, `resolve` rispondeva «No such file», e
 * l'agente ripiegava su `query` indovinando la tabella. Il giro del 24/8 finiva con «Non risultano
 * post pubblicati» detto a un brand che ne aveva quattro.
 *
 * Il difetto non era il modello: erano DUE tabelle e nessuna strada che le unisse.
 *  - `social_post_history` (source='zernio') = quello che il brand ha pubblicato sui SUOI account,
 *    con le metriche vere. E' questo che manca a chi guarda solo `posts`.
 *  - `posts` con status='published' = quello che ha pubblicato QUESTO prodotto.
 * Un brand vero ha entrambe, e «cosa ho pubblicato» ha risposta legittima in tutte e due.
 *
 * Si proietta a file come `brand/studio.md` e `runs/<id>.md`, non si aggiunge a `AGENT_FILES`: quel
 * registro e' per costanti di codice, questo ha bisogno del database.
 *
 * Gli alias esistono perche' la spec scrive `work/history/` con la barra e i modelli la copiano
 * alla lettera: far fallire una lettura per un carattere e' uno step buttato per niente.
 */
const WORK_HISTORY_PATH = 'work/history.md';
const WORK_HISTORY_ALIASES = new Set(['work/history', 'work/history/', 'work/history.md']);
const WORK_HISTORY_ROWS = 40;

const RUN_PATH = /^runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

/** Tetto dichiarato: una traccia può contenere l'output intero di un comando in sandbox. */
const RUN_MAX_CHARS = 24_000;

/**
 * Da eventi a testo leggibile: cosa ha chiamato, con cosa, cosa è tornato.
 *
 * `full` esiste perché il troncamento dice «usa grep su questo stesso percorso» e `grep` passava
 * dalla STESSA resa, ricevendo il testo già tagliato: l'uscita promessa non esisteva. Chi impagina e
 * chi cerca ricevono il testo intero.
 */
function renderRunTrace(row: Record<string, unknown>, brandId?: string, full?: boolean): string {
  const ev = Array.isArray(row.events) ? (row.events as Array<Record<string, unknown>>) : [];
  const head = `# run ${row.id} — ${row.mode ?? '?'} / ${row.agent ?? 'none'} (${row.status ?? '?'})
model: ${row.provider ?? '?'} ${row.model ?? ''} · eventi: ${row.event_count ?? ev.length}${row.error ? `\nERRORE: ${row.error}` : ''}`;
  const body = ev.map((e, i) => {
    const d = (e.data ?? {}) as Record<string, unknown>;
    const at = String(e.at ?? '').slice(11, 19);
    // `kind` è la forma del recorder; `?? type` è l'assicurazione, non un ramo: il filtro su
    // `surface` garantisce già la prima.
    const kind = e.kind ?? e.type;
    if (kind === 'tool_call') {
      return `## ${i + 1}. ${at} tool ${d.tool ?? '?'}\ninput: ${JSON.stringify(d.input ?? {})}\noutput: ${JSON.stringify(d.output ?? null)}`;
    }
    if (kind === 'assistant_text') return `## ${i + 1}. ${at} il modello scrive\n${String(d.text ?? '')}`;
    if (kind === 'report') return `## ${i + 1}. ${at} RAPPORTO FINALE\n${String(d.report ?? '')}`;
    if (kind === 'error') return `## ${i + 1}. ${at} ERRORE\n${String(d.message ?? '')}`;
    return `## ${i + 1}. ${at} ${kind}\n${JSON.stringify(d)}`;
  }).join('\n\n');
  const text = redactFor(`${head}\n\n${body}`, brandId);
  if (full || text.length <= RUN_MAX_CHARS) return text;
  return `${text.slice(0, RUN_MAX_CHARS)}\n\n…[troncato: ${text.length - RUN_MAX_CHARS} caratteri in più. Usa grep su questo stesso percorso — cerca sul testo INTERO — oppure rileggi con offset: ${RUN_MAX_CHARS}.]`;
}

/**
 * `threadId` e `userId` sono facoltativi qui e OBBLIGATORI dentro `readRunTrace`: nessuna traccia è
 * più pubblica della conversazione che trascrive, e `agent_sessions` è protetta solo per brand
 * mentre il suo transcript contiene i messaggi dell'utente — senza thread il perimetro diventa «le
 * conversazioni dei colleghi». I fatti del brand (`brand/studio.md`) non hanno quel perimetro, o
 * sarebbero illeggibili a ogni superficie senza thread (un job, un sotto-agente, la QC motion).
 */
export type RunCtx = { supabase: SupabaseClient; brandId: string; threadId?: string; userId?: string };

/** Una riga per post: data, piattaforma, prima riga del testo, metriche se ci sono. */
function historyLine(
  date: string | null,
  platform: string | null,
  text: string | null,
  metrics?: Record<string, unknown> | null
): string {
  const day = (date ?? '').slice(0, 10) || '????-??-??';
  const first = (text ?? '').trim().split('\n')[0];
  const m = metrics
    ? Object.entries(metrics)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
    : '';
  return `- ${day} · ${platform ?? 'unknown'} — ${clipLabel(first, 120)}${m ? ` · ${m}` : ''}`;
}

/**
 * Il file si costruisce dalle DUE sorgenti, sempre entrambe, e quando una e' vuota lo DICE invece
 * di tacere: «nessuna riga» letto su una sezione sola è esattamente l'equivoco da cui nasceva
 * «Non risultano post pubblicati». Un `null` qui significa davvero zero post, ovunque.
 */
async function renderWorkHistoryFile(ctx: RunCtx): Promise<string | null> {
  const { loadOwnPostHistory } = await import('$lib/server/own-post-history');
  const [own, published] = await Promise.all([
    loadOwnPostHistory(ctx.supabase, ctx.brandId, { limit: WORK_HISTORY_ROWS }),
    ctx.supabase
      .from('posts')
      .select('caption, platforms, published_at, created_at')
      .eq('brand_id', ctx.brandId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(WORK_HISTORY_ROWS)
      .then(({ data }) => (data ?? []) as Array<Record<string, unknown>>)
  ]);
  if (!own.length && !published.length) return null;

  const out = [
    '# Published history',
    '',
    'Everything this brand has actually published, from both places it can live. A claim about',
    'performance is grounded here or in `query` — never estimated.',
    '',
    `## On the brand's own accounts (${own.length})`,
    own.length
      ? own.map((r) => historyLine(r.published_at, r.platform, r.content, r.metrics)).join('\n')
      : '(none synced yet — the brand has no connected account, or nothing has been pulled in)',
    '',
    `## Published by this product (${published.length})`,
    published.length
      ? published
          .map((r) =>
            historyLine(
              (r.published_at ?? r.created_at) as string | null,
              Array.isArray(r.platforms) ? (r.platforms as string[]).join('/') : null,
              r.caption as string | null
            )
          )
          .join('\n')
      : '(none — nothing scheduled through this product has gone out yet)'
  ];
  return out.join('\n');
}

/**
 * Perimetro: solo i giri di QUESTO brand e di QUESTO thread. Non "filtra il risultato" — non lo va
 * proprio a prendere, come l'allowlist per costruzione dei file.
 */
async function readRunTrace(ctx: RunCtx | undefined, id: string, full?: boolean): Promise<string | { error: string }> {
  if (!ctx?.supabase || !ctx.brandId || !ctx.threadId || !ctx.userId) {
    return { error: 'Le tracce non sono disponibili su questa superficie.' };
  }
    // Mai `system_prompt`: contiene i dati del brand, l'email dell'utente e lo stripe_customer_id,
    // pesa fino a 150k caratteri e non serve a capire una run.
  const q = ctx.supabase
    .from('agent_sessions')
    .select('id, agent, mode, status, model, provider, error, events, event_count')
    .eq('id', id)
    .eq('brand_id', ctx.brandId)
    .eq('thread_id', ctx.threadId)
    .eq('user_id', ctx.userId)
    // `format_version < 2` vuol dire «non redatta alla scrittura»: quelle righe non si servono.
    .gte('format_version', 2)
      // SOLO i sotto-agenti: `agent_sessions` ospita anche le sessioni della chat e dei batch, i cui
      // eventi hanno una FORMA DIVERSA (`type`/`content[]` invece di `kind`/`data`). Senza il filtro
      // un id indovinato renderebbe un documento che sembra una traccia e non lo è.
    .eq('surface', 'chat_subagent');
  const { data } = await q.maybeSingle();
  if (!data) {
      // Riga assente ≠ giro senza attività: `agent_sessions` non ha una politica di conservazione, e
      // il giorno che si pota questo messaggio è la differenza fra "non c'è più" e un file bianco su
      // cui l'orchestratore trarrebbe la conclusione sbagliata.
    return { error: `Traccia non più disponibile (runs/${id}.md). Le tracce non sono conservate per sempre: giudica dal rapporto, o rifai il passo.` };
  }
  return renderRunTrace(data as Record<string, unknown>, ctx.brandId, full);
}

/**
 * Gli artifact si PROIETTANO a file dalle tabelle che già esistono (`motion_videos`, `brand_media`,
 * `graphic_designs`), come `runs/<id>.md`: risolti in `resolve()` e non in `AGENT_FILES`, che è per
 * costanti di codice. Visibili a tutti i mestieri: non sono il metodo di un `how/`, sono ciò che il
 * brand ha già prodotto.
 */
const ARTIFACT_TYPES = ['motion', 'media', 'graphic'] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];
const ARTIFACT_PATH =
  /^artifacts\/(motion|media|graphic)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

/** Tetto dichiarato: il sorgente TSX di un motion video intero può superarlo di parecchio. */
const ARTIFACT_SOURCE_MAX_CHARS = 60_000;

function clipLabel(s: string | null | undefined, n = 60): string {
  const t = (s ?? '').trim();
  if (!t) return '(senza titolo)';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Stesso taglio dichiarato di `renderRunTrace`, applicato a un sorgente TSX/HTML invece che a una traccia. */
function capSource(src: string, full?: boolean): string {
  if (full || src.length <= ARTIFACT_SOURCE_MAX_CHARS) return src;
  return `${src.slice(0, ARTIFACT_SOURCE_MAX_CHARS)}\n\n…[troncato: ${src.length - ARTIFACT_SOURCE_MAX_CHARS} caratteri in più. Rileggi read_file con offset: ${ARTIFACT_SOURCE_MAX_CHARS}.]`;
}

type ArtifactRow = { path: string; type: ArtifactType; label: string; status: string; date: string; sortKey: string };

/**
 * `status` è DERIVATO: `motion_videos` non ha quella colonna. La verità sono due fatti — c'è un MP4
 * (`preview_url`) ed è mai stato giudicato `ship` — la stessa lettura di `unfinished.ts`.
 */
function motionStatus(previewUrl: string | null, score: { verdict: string; overall: number } | null): string {
  if (!previewUrl) return 'no render yet';
  if (!score) return 'rendered, not yet scored';
  if (score.verdict === 'ship') return `shipped (craft ${score.overall}/10)`;
  return `rendered, verdict ${score.verdict} (craft ${score.overall}/10)`;
}

async function fetchMotionRows(ctx: RunCtx, limit: number): Promise<ArtifactRow[]> {
  const { data } = await ctx.supabase
    .from('motion_videos')
    .select('id, title, preview_url, created_at')
    .eq('brand_id', ctx.brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{ id: string; title: string; preview_url: string | null; created_at: string }>;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { data: scoreRows } = await ctx.supabase
    .from('motion_craft_scores')
    .select('video_id, verdict, overall, created_at')
    .in('video_id', ids)
    .order('created_at', { ascending: true });
  // Ascendente e si sovrascrive: l'ultima scrittura per id è quella più recente.
  const latest = new Map<string, { verdict: string; overall: number }>();
  for (const s of (scoreRows ?? []) as Array<{ video_id: string; verdict: string; overall: number }>) {
    latest.set(s.video_id, { verdict: s.verdict, overall: s.overall });
  }
  return rows.map((r) => ({
    path: `artifacts/motion/${r.id}.md`,
    type: 'motion' as const,
    label: clipLabel(r.title),
    status: motionStatus(r.preview_url, latest.get(r.id) ?? null),
    date: (r.created_at || '').slice(0, 10),
    sortKey: r.created_at || ''
  }));
}

async function fetchMediaRows(ctx: RunCtx, limit: number): Promise<ArtifactRow[]> {
  const { data } = await ctx.supabase
    .from('brand_media')
    .select('id, title, file_name, catalog_status, created_at')
    .eq('brand_id', ctx.brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{
    id: string;
    title: string | null;
    file_name: string | null;
    catalog_status: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    path: `artifacts/media/${r.id}.md`,
    type: 'media' as const,
    label: clipLabel(r.title || r.file_name),
    status: r.catalog_status || 'pending',
    date: (r.created_at || '').slice(0, 10),
    sortKey: r.created_at || ''
  }));
}

async function fetchGraphicRows(ctx: RunCtx, limit: number): Promise<ArtifactRow[]> {
  const { data } = await ctx.supabase
    .from('graphic_designs')
    .select('id, version, brief, created_at')
    .eq('brand_id', ctx.brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{ id: string; version: number; brief: string | null; created_at: string }>;
  // `v${version}` e basta: la versione superata si calcola solo nella lettura di UN artifact
  // (una query in più, giustificata lì), non nell'elenco — sarebbe una query per riga.
  return rows.map((r) => ({
    path: `artifacts/graphic/${r.id}.md`,
    type: 'graphic' as const,
    label: clipLabel(r.brief),
    status: `v${r.version}`,
    date: (r.created_at || '').slice(0, 10),
    sortKey: r.created_at || ''
  }));
}

/** Righe per `ls('artifacts/…')`, ordinate per data desc. `type` filtra a un solo sottoalbero. */
async function listArtifactRows(ctx: RunCtx, type?: ArtifactType, limit = 200): Promise<ArtifactRow[]> {
  const wants = (t: ArtifactType) => !type || type === t;
  const [motion, media, graphic] = await Promise.all([
    wants('motion') ? fetchMotionRows(ctx, limit) : Promise.resolve([]),
    wants('media') ? fetchMediaRows(ctx, limit) : Promise.resolve([]),
    wants('graphic') ? fetchGraphicRows(ctx, limit) : Promise.resolve([])
  ]);
  return [...motion, ...media, ...graphic].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

function formatArtifactLine(r: ArtifactRow): string {
  return `${r.path} — ${r.type} · ${r.label} · ${r.status} · ${r.date}`;
}

async function resolveMotionArtifact(ctx: RunCtx, id: string, full?: boolean): Promise<string | { error: string }> {
  const { data } = await ctx.supabase
    .from('motion_videos')
    .select('id, title, source, preview_url, fps, duration_in_frames, width, height, created_at, updated_at')
    .eq('id', id)
    .eq('brand_id', ctx.brandId)
    .maybeSingle();
  if (!data) {
    return {
      error: `Artifact not found: artifacts/motion/${id}.md — deleted, wrong id, or belongs to another brand. Try ls("artifacts/motion/") for real ids.`
    };
  }
  const row = data as {
    id: string;
    title: string;
    source: string;
    preview_url: string | null;
    fps: number;
    duration_in_frames: number;
    width: number;
    height: number;
    created_at: string;
    updated_at: string;
  };
  const { data: scoreRows } = await ctx.supabase
    .from('motion_craft_scores')
    .select('verdict, overall, created_at')
    .eq('video_id', id)
    .order('created_at', { ascending: false })
    .limit(1);
  const latest = ((scoreRows ?? [])[0] ?? null) as { verdict: string; overall: number } | null;

  const head = `# artifacts/motion/${row.id}.md

Motion video · created ${row.created_at} · updated ${row.updated_at}
Status: ${motionStatus(row.preview_url, latest)}
Public URL: ${row.preview_url || 'none — not rendered yet, so there is no MP4 to link.'}
Linked post: none — motion videos live in their own gallery, not attached to a post.`;

  const meta = `## Meta
- id: ${row.id}
- title: ${row.title}
- fps: ${row.fps}
- duration_in_frames: ${row.duration_in_frames}
- size: ${row.width}x${row.height}
- craft verdict (latest): ${latest ? `${latest.verdict} (${latest.overall}/10)` : 'not yet scored'}`;

  const source = `## Source
\`\`\`tsx
${capSource(row.source ?? '', full)}
\`\`\``;

  return `${head}\n\n${meta}\n\n${source}`;
}

async function resolveMediaArtifact(ctx: RunCtx, id: string): Promise<string | { error: string }> {
  const { data } = await ctx.supabase
    .from('brand_media')
    .select('*')
    .eq('id', id)
    .eq('brand_id', ctx.brandId)
    .maybeSingle();
  if (!data) {
    return {
      error: `Artifact not found: artifacts/media/${id}.md — deleted, wrong id, or belongs to another brand. Try ls("artifacts/media/") for real ids.`
    };
  }
  const row = data as Record<string, unknown>;
  const head = `# artifacts/media/${row.id}.md

Media asset (${row.kind}) · created ${row.created_at}
Status: ${row.catalog_status ?? 'pending'}${row.catalog_status === 'failed' && row.catalog_error ? ` — ${row.catalog_error}` : ''}
Storage path (private bucket): ${row.storage_path ?? row.url ?? 'none'}
Note: this bucket is private — there is no standing public URL. The app signs a short-lived link when it shows this asset; none is stored here, so none is invented here either.`;

  const fields: Array<[string, unknown]> = [
    ['title', row.title],
    ['file_name', row.file_name],
    ['description', row.description],
    ['media_kind', row.media_kind],
    ['mood', row.mood],
    ['tags', Array.isArray(row.tags) ? (row.tags as string[]).join(', ') : row.tags],
    ['subjects', Array.isArray(row.subjects) ? (row.subjects as string[]).join(', ') : row.subjects],
    ['colors', Array.isArray(row.colors) ? (row.colors as string[]).join(', ') : row.colors],
    ['suggested_use', row.suggested_use],
    ['when_to_use', row.when_to_use],
    ['how_to_use', row.how_to_use],
    ['where_to_use', row.where_to_use],
    ['dimensions', row.width && row.height ? `${row.width}x${row.height}` : null],
    ['bytes', row.bytes],
    ['mime', row.mime],
    ['duration_seconds', row.duration_seconds],
    ['source', row.source],
    ['times_used', row.times_used],
    ['last_used_at', row.last_used_at]
  ];
  const lines = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const meta = `## Meta
${lines || '(nessun metadato catalogato)'}

Generation prompt: not recorded — brand_media has no stored prompt column, so none is shown rather than guessed. description and suggested_use above are the closest catalog context (AI-written from the pixels, not the original brief).`;

  return `${head}\n\n${meta}`;
}

async function resolveGraphicArtifact(ctx: RunCtx, id: string, full?: boolean): Promise<string | { error: string }> {
  const { data } = await ctx.supabase
    .from('graphic_designs')
    .select('*')
    .eq('id', id)
    .eq('brand_id', ctx.brandId)
    .maybeSingle();
  if (!data) {
    return {
      error: `Artifact not found: artifacts/graphic/${id}.md — deleted, wrong id, or belongs to another brand. Try ls("artifacts/graphic/") for real ids.`
    };
  }
  const row = data as {
    id: string;
    target_kind: string;
    target_id: string;
    slide_index: number | null;
    version: number;
    spec: unknown;
    media_url: string;
    brief: string | null;
    source: string | null;
    created_at: string;
  };

  // La versione superata si vede solo qui (una query in più), non nell'elenco: `target_kind` +
  // `target_id` + `slide_index` è la stessa chiave di `graphic_designs_version_key`.
  let latestQ = ctx.supabase
    .from('graphic_designs')
    .select('version')
    .eq('brand_id', ctx.brandId)
    .eq('target_kind', row.target_kind)
    .eq('target_id', row.target_id)
    .order('version', { ascending: false })
    .limit(1);
  latestQ = row.slide_index == null ? latestQ.is('slide_index', null) : latestQ.eq('slide_index', row.slide_index);
  const { data: latestRows } = await latestQ;
  const latestVersion = (latestRows ?? [])[0]?.version as number | undefined;
  const versionStatus =
    latestVersion != null && latestVersion > row.version
      ? `superseded by v${latestVersion} (this is v${row.version})`
      : `current version (v${row.version})`;

  const head = `# artifacts/graphic/${row.id}.md

Graphic · created ${row.created_at}
Status: ${versionStatus}
Rendered image: ${row.media_url || 'none'}
Linked ${row.target_kind}: ${row.target_id}${row.slide_index != null ? ` (slide ${row.slide_index})` : ''}`;

  const meta = `## Meta
- id: ${row.id}
- version: ${row.version}
- target_kind: ${row.target_kind}
- target_id: ${row.target_id}
- slide_index: ${row.slide_index ?? '(none — cover)'}
- brief: ${row.brief || '(none recorded)'}
- spec:
\`\`\`json
${JSON.stringify(row.spec ?? null, null, 2)}
\`\`\``;

  const source = row.source
    ? `## Source
\`\`\`html
${capSource(row.source, full)}
\`\`\``
    : `## Source
(none — this version predates editable source, or was never saved with one. The spec above is the only record.)`;

  return `${head}\n\n${meta}\n\n${source}`;
}

/** Dispatcher unico per `resolve()`: stesso schema di `readRunTrace`. */
async function resolveArtifact(
  ctx: RunCtx | undefined,
  type: ArtifactType,
  id: string,
  full?: boolean
): Promise<string | { error: string }> {
  if (!ctx?.supabase || !ctx.brandId) {
    return { error: `artifacts/${type}/${id}.md needs a brand context this run does not have.` };
  }
  if (type === 'motion') return resolveMotionArtifact(ctx, id, full);
  if (type === 'media') return resolveMediaArtifact(ctx, id);
  return resolveGraphicArtifact(ctx, id, full);
}

function prefixesOf(paths: string[]): string[] {
  return [...new Set(paths.map(dirOf))].filter(Boolean).sort();
}

/** Il tetto degli elenchi. Dichiarato ovunque tagli, e alzabile con `limit`. */
const LS_CAP = 60;

/**
 * `*` dentro un segmento, `**` attraverso le cartelle. Il resto è letterale.
 *
 * ponytail: sedici caratteri di regex invece di `minimatch` (che non è installato) — niente
 * `{a,b}`, niente `[abc]`, niente negazioni. Se un giorno servono davvero, si aggiunge la
 * dipendenza; oggi le domande sono «tutti i .tsx» e «tutto sotto questa cartella».
 */
function globToRegExp(pattern: string): RegExp {
  const src = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${src}$`, 'i');
}

/**
 * `read_file` + `ls`, con l'allowlist chiusa sul mestiere di chi chiama. Due rifiuti diversi perché
 * mandano in due posti diversi: path inesistente → errore con l'indice allegato; path di un altro
 * mestiere → si nomina il mestiere e si indica `delegate_task`.
 *
 * `delegate_task` e NON `message_agent`: il rifiuto arriva a metà lavoro e serve una risposta in
 * QUESTO turno; un DM accoda un turno intero del collega e risponde dopo che questo è finito.
 *
 * Il terzo caso — «è un fatto del brand, il file è già tuo» — non esiste per costruzione: i file
 * fuori da `how/` nascono `agents: null`. Invariante verificata dal test, non un ramo di codice.
 */
export function createFileTools(agent?: string | null, threadId?: string, ctx?: RunCtx) {
  const id = asAgentId(agent);
    // DUE ELENCHI: `mine` finisce nella DESCRIZIONE del tool, cioè nel prompt di OGNI step, quindi
    // resta corto; `all` è quello che risponde `ls`, chiamato una volta e proprio quando serve tutto.
    // `brand/studio.md` si aggiunge qui e non in `filePathsFor`: quella risponde sul registro
    // `AGENT_FILES`, e ogni suo chiamante fa `AGENT_FILES[path]` subito dopo.
  const mine = [...BRAND_FILE_PATHS, ...filePathsFor(agent)];
  const all = [...BRAND_FILE_PATHS, ...filePathsFor(agent, { all: true })];

    /**
     * Risoluzione unica: file del registro, oppure traccia di un giro. Il resto non esiste. `full` lo
     * passano `grep` e chi impagina — la traccia è tagliata a 24.000 caratteri e il taglio indica
     * `grep` come via d'uscita, che riceveva lo stesso testo già tagliato.
     */
  async function resolve(
    raw: string,
    opts?: { full?: boolean }
  ): Promise<{ content: string } | { error: string; available?: string[] }> {
    const p = raw.trim();
    const run = RUN_PATH.exec(p);
    if (run) {
      const out = await readRunTrace(ctx, run[1], opts?.full);
      return typeof out === 'string' ? { content: out } : out;
    }
    const art = ARTIFACT_PATH.exec(p);
    if (art) {
      const out = await resolveArtifact(ctx, art[1] as ArtifactType, art[2], opts?.full);
      return typeof out === 'string' ? { content: out } : out;
    }
    if (WORK_HISTORY_ALIASES.has(p)) {
      if (!ctx) return { error: `${WORK_HISTORY_PATH} needs a brand context this run does not have.` };
      const doc = await renderWorkHistoryFile(ctx);
        // «Non ha ancora pubblicato NIENTE» è un fatto, e va detto come fatto: la risposta sbagliata
        // da dare qui è un file vuoto, che si legge come «i dati non ci sono» invece che «i post non
        // ci sono» — la differenza fra un'analisi onesta e una che tace.
      return doc
        ? { content: doc }
        : { content: `# Published history\n\nThis brand has published NOTHING yet — not on its own accounts (social_post_history) and not through this product (posts). That is the real answer, not missing data: say it plainly instead of looking elsewhere.` };
    }
    if (Object.hasOwn(BRAND_FILES, p)) {
        // Un file bianco qui verrebbe letto come «questo brand non ha una palette»: si dice che non
        // si può leggere, non si inventa un documento vuoto.
      const bf = BRAND_FILES[p];
      if (!ctx) return { error: `${p} needs a brand context this run does not have.` };
      const doc = await bf.render(ctx);
      return doc ? { content: doc } : { error: `${p} is empty — ${bf.emptyReason}` };
    }
      // `hasFile`, non `AGENT_FILES[p]`: `constructor` e `__proto__` rispondono dalla catena dei
      // prototipi, passano l'`if` e muoiono su `f.body()` con un TypeError non catturato.
    if (!hasFile(p)) return { error: `No such file: ${p}`, available: all };
    const f = AGENT_FILES[p];
    if (!visibleTo(f, id)) {
      return {
        error: `${p} belongs to another trade (${ownersOf(f)}). Do not read it — you would be following a craft you have no tools for. If the job needs that trade, delegate_task it with a brief of what you want back.`,
        available: all
      };
    }
      // Il `?? body()` è la rete: uno storage che non risponde non deve poter svuotare una lettura.
    return { content: (await readAgentFile(p)) ?? f.body() };
  }

  return {
    read_file: tool({
        // La descrizione NON inlina `mine`: per i mestieri con l'albero vuoto diventava «Yours: .» a
        // ogni passo, e per gli altri ripeteva l'indice che sta già nel prompt (`filesIndexFor`).
      description: `Read a file, full text, always current${all.length ? ` — ${all.length} files in your tree, ls lists them` : ' — your tree has no files yet, and ls will say so'}. offset/limit page through a long one; omit both and you get all of it. Also runs/<id>.md, the full trace of a sub-agent you dispatched: grep it first, they are long.`,
      inputSchema: z.object({
        path: z
          .string()
          .describe('Exact path from the FILES index or from ls/glob, or runs/<id>.md from a delegate_task result'),
        offset: z.number().int().min(0).optional().describe('Start at this character. Default 0.'),
        limit: z.number().int().min(1).max(200_000).optional().describe('How many characters. Default: the whole file.')
      }),
      execute: async ({ path, offset, limit }: { path: string; offset?: number; limit?: number }) => {
        const t0 = Date.now();
          // Chi impagina vuole il testo VERO, non quello già tagliato da `renderRunTrace`: altrimenti
          // `offset: 24000` su una traccia lunga risponde vuoto e sembra la fine.
        const paged = offset !== undefined || limit !== undefined;
        const out = await resolve(path, { full: paged });
          // `context` porta il path in una forma che una `group by` legge senza parsing. Il mestiere
          // non si duplica: si ricava unendo `thread_id` a `chat_threads.agent`.
        logAiCall({
          label: 'read_file',
          provider: 'internal',
          ms: Date.now() - t0,
          ok: !('error' in out),
          context: `read_file:${path.trim().replace(RUN_PATH, 'runs/<id>.md')}`,
          threadId
        });
        if ('error' in out) return out;
        const size = out.content.length;
        const from = Math.min(offset ?? 0, size);
        const content = limit === undefined ? out.content.slice(from) : out.content.slice(from, from + limit);
        return {
          path: path.trim(),
          content,
            // Ogni taglio dichiara come riprendere: una lettura impaginata senza `next_offset` si
            // legge come il file intero, ed è così che un agente conclude che il resto non esiste.
          ...(from + content.length < size
            ? { chars: `${from}-${from + content.length} di ${size}`, next_offset: from + content.length }
            : paged
              ? { chars: `${from}-${size} di ${size} — fine del file` }
              : {})
        };
      }
    }),

      /**
       * `grep` PRIMA di `read`, e su TUTTO l'albero: `path` è un PREFISSO facoltativo, non un file
       * obbligatorio. È ciò che rende utili 124 file invece che rumorosi — l'indice nomina solo ciò
       * che facciamo, la portata arriva dappertutto e non costa niente finché nessuno la usa.
       *
       * E DICHIARA DOVE HA CERCATO: un `grep` che tace su ciò che non guarda è cieco in silenzio, e
       * l'agente legge «nessun risultato» come «non esiste».
       */
    grep: tool({
      description:
        'Search inside your files: guides, the transition cookbook, the animation library, the full official Remotion documentation. `path` is an optional PREFIX (e.g. "skills/remotion/") or one exact path — omit it to search everything. Literal text, case- and accent-insensitive. Cheaper than reading: use it first. To find files by NAME instead of content, use glob.',
      inputSchema: z.object({
        query: z.string().min(2).describe('Literal text, case- and accent-insensitive (e.g. "TransitionSeries")'),
        path: z.string().optional().describe('Optional prefix to narrow the search, or one exact path'),
        max_matches: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Default 12, spread across the files that match — never all from one file')
      }),
      execute: async ({ query, path, max_matches }: { query: string; path?: string; max_matches?: number }) => {
        const t0 = Date.now();
        const cap = max_matches ?? 12;
        const prefix = (path ?? '').trim();
        const run = RUN_PATH.exec(prefix);
        const art = ARTIFACT_PATH.exec(prefix);
          // `art`: un solo artifact per path esatto. Un `path: "artifacts/"` senza id NON entra qui —
          // quel prefisso non sta nel registro statico `all` — e il ramo `blind` qui sotto lo dichiara
          // invece di tacere. `createFileTools` resta sincrono per i suoi molti chiamanti.
        const targets =
          run || art ? [prefix] : all.filter((p) => !prefix || p === prefix || p.startsWith(prefix));
        const log = () =>
          logAiCall({
            label: 'grep',
            provider: 'internal',
            ms: Date.now() - t0,
            ok: true,
              // Il prefisso, non il path completo, o `ai_calls` prende un valore distinto per traccia
              // e la cardinalità esplode.
            context: `grep:${run ? 'runs/<id>.md' : art ? 'artifacts/<tipo>/<id>.md' : prefix || '*'}`,
            threadId
          });
          // UN PREFISSO CHE NON CONOSCO NON È UN ERRORE: «non esiste» è un fatto sul mondo, «qui non
          // guardo» è un fatto su di me, e un modello che legge il primo chiude l'indagine invece di
          // spostarla. Stesso ramo che risponde a un mestiere con l'albero ancora vuoto.
        if (!targets.length) {
          log();
          const artifactsHint =
            prefix === 'artifacts' || prefix.startsWith('artifacts/')
              ? ' artifacts/ esiste — ls("artifacts/") elenca gli id — ma grep in blocco non ci arriva: cerca con il path ESATTO di un artifact, o leggilo con read_file.'
              : '';
          return {
            query,
            matches: [],
            searched_files: 0,
            blind:
              (prefix
                ? `NON ho cercato: "${prefix}" non è un percorso del mio albero. Questo non dice niente su cosa esista — dice solo dove non ho guardato.`
                : 'NON ho cercato: il mio albero non ha ancora file. Questo non dice niente su cosa esista — dice solo dove non ho guardato.') +
              artifactsHint,
            available_prefixes: prefixesOf(all)
          };
        }
        const q = fold(query);
        const hits: Array<{ path: string; lines: Array<{ line: number; text: string }> }> = [];
        const unreadable: string[] = [];
        let found = 0;
        for (const p of targets) {
            // `full`: sulle tracce il taglio nasconderebbe il resto anche a `grep`, che il messaggio
            // di troncamento indica come via d'uscita.
          const got = await resolve(p, { full: true });
          if ('error' in got) {
            unreadable.push(p);
            continue;
          }
          const raw = got.content.split('\n');
            // Si piega tutto il testo in una volta e si divide di nuovo: né la decomposizione né la
            // rimozione dei segni toccano `\n`, quindi gli indici combaciano.
          const foldedAll = fold(got.content).split('\n');
          const folded = foldedAll.length === raw.length ? foldedAll : raw.map(fold);
          const lines: Array<{ line: number; text: string }> = [];
          for (let i = 0; i < raw.length; i++) {
            if (folded[i].includes(q)) lines.push({ line: i + 1, text: raw[i].slice(0, 300) });
          }
          if (lines.length) {
            hits.push({ path: p, lines });
            found += lines.length;
          }
        }
          // ROUND-ROBIN, NON I PRIMI DODICI: un tetto globale si ferma al primo file e risponde tutte
          // le righe dallo STESSO, dichiarando gli altri «non guardati». Chi sta in fondo all'elenco
          // non esisterebbe mai. Una riga per file a giro, poi il riempimento.
        const matches: Array<{ path: string; line: number; text: string }> = [];
        for (let round = 0; matches.length < cap; round++) {
          let added = false;
          for (const h of hits) {
            if (matches.length >= cap) break;
            const l = h.lines[round];
            if (!l) continue;
            matches.push({ path: h.path, line: l.line, text: l.text });
            added = true;
          }
          if (!added) break;
        }
        const searched = targets.length - unreadable.length;
        log();
        return {
          query,
          matches,
            // `searched`, NON `targets.length`: dichiarare «cercato in 153 file» con `searched_files`
            // a 1 accanto è un tool che mente, e chiude l'indagine invece di lasciarla aperta.
          searched_files: searched,
          scope: `cercato in ${searched} file${prefix ? ` sotto "${prefix}"` : ` su ${all.length} del mio albero`} — ${found} righe in ${hits.length} file`,
          ...(found > matches.length
            ? {
                not_shown: `${found - matches.length} righe in più: tetto di ${cap}, distribuito fra i file che hanno un risultato. Alza max_matches, oppure restringi con path.`
              }
            : {}),
          ...(unreadable.length
            ? { not_searched: `${unreadable.length} non leggibili: ${unreadable.slice(0, 3).join(', ')}` }
            : {})
        };
      }
    }),

      /**
       * `grep` cerca DENTRO i file, `glob` cerca i NOMI: con un albero da 153 file «dove sta qualunque
       * cosa si chiami così» non ha nessun'altra risposta.
       */
    glob: tool({
      description:
        'Find files by the shape of their path: glob("**/*.tsx"), glob("how/motion/**"), glob("skills/remotion/**/*.md"). `*` stays inside one segment, `**` crosses folders. ls answers "what is in this folder", glob answers "where is anything named like this". Names only — grep searches inside them.',
      inputSchema: z.object({
        pattern: z.string().min(1).describe('e.g. "**/*.tsx", "library/text/**", "**/seed.*"'),
        limit: z.number().int().min(1).max(200).optional().describe(`Default ${LS_CAP}`)
      }),
      execute: async ({ pattern, limit }: { pattern: string; limit?: number }) => {
        const t0 = Date.now();
        const cap = limit ?? LS_CAP;
        const re = globToRegExp(pattern.trim());
        const files = all.filter((p) => re.test(p));
        logAiCall({ label: 'glob', provider: 'internal', ms: Date.now() - t0, ok: true, context: 'glob', threadId });
        return {
          pattern,
          files: files.slice(0, cap),
          total: files.length,
          ...(files.length > cap ? { note: `${cap} di ${files.length} — alza limit o restringi il pattern` } : {}),
            // Zero risultati NON è un errore, ed è il caso in cui serve dire com'è fatto lo strumento:
            // quasi sempre manca il `**/` davanti.
          ...(files.length
            ? {}
            : {
                blind: `Nessun path fatto così fra i ${all.length} del mio albero. "*" resta dentro un segmento, "**" attraversa le cartelle: se cercavi ovunque, prova "**/${pattern.trim().replace(/^\*+\/?/, '')}".`,
                available_prefixes: prefixesOf(all)
              })
        };
      }
    }),

    ls: tool({
      description:
        'List what you can read. Without a prefix: the curated guides plus a one-line summary of the bigger folders. With a prefix (e.g. "skills/remotion/"): what sits DIRECTLY inside it — subfolders with a file count each, plus the files at that level. recursive:true walks the whole subtree; query filters by path text; limit raises the cap.',
      inputSchema: z.object({
        path: z.string().optional().describe('Optional prefix to list inside'),
        recursive: z
          .boolean()
          .optional()
          .describe('Default false — one level only. true returns every path under the prefix, which can be dozens.'),
        query: z
          .string()
          .optional()
          .describe('Keep only paths containing this text, case- and accent-insensitive. Use it when a folder is bigger than the cap.'),
        limit: z.number().int().min(1).max(500).optional().describe(`Default ${LS_CAP}`)
      }),
      execute: async ({
        path,
        recursive,
        query,
        limit
      }: {
        path?: string;
        recursive?: boolean;
        query?: string;
        limit?: number;
      }) => {
        const t0 = Date.now();
        const prefix = (path ?? '').trim();
        const cap = limit ?? LS_CAP;
        const q = query ? fold(query.trim()) : '';
          // Il tetto da solo mente lo stesso: «60 di 1.000» è onesto e inutile, perché l'agente sa che
          // gli manca qualcosa e non ha modo di prenderselo. `query` e `limit` sono la maniglia.
        const pick = (rows: string[]) => (q ? rows.filter((p) => fold(p).includes(q)) : rows);
          // IL TETTO SI DICHIARA SEMPRE, e dice cosa fare: un troncamento muto si legge come «ce ne
          // sono sessanta».
        const capped = (rows: string[]) => ({
          ...(rows.length > cap
            ? {
                note: `${cap} di ${rows.length}${q ? ` che contengono "${query}"` : ''} — alza limit, restringi il prefisso o la query, oppure usa grep o glob`
              }
            : {})
        });
          // Il passo di SCOPERTA va loggato o il prima/dopo della migrazione non esiste: `ai_calls`
          // aveva righe `read_file` e zero `ls`.
        const done = <T,>(r: T): T => {
          logAiCall({
            label: 'ls',
            provider: 'internal',
            ms: Date.now() - t0,
            ok: true,
            context: `ls:${prefix || '/'}${recursive ? ' -r' : ''}${q ? ' +query' : ''}`,
            threadId
          });
          return r;
        };
          // `artifacts/` non sta nel registro statico `all` (è una lettura dal database del brand),
          // quindi esce dalla logica generica qui sotto: una riga formattata con tipo, titolo, stato e
          // data invece del path nudo.
        if (prefix === 'artifacts' || prefix.startsWith('artifacts/')) {
          const seg = prefix.split('/')[1];
          const type =
            seg && (ARTIFACT_TYPES as readonly string[]).includes(seg) ? (seg as ArtifactType) : undefined;
          const rows = ctx ? await listArtifactRows(ctx, type) : [];
          const lines = (q ? rows.filter((r) => fold(formatArtifactLine(r)).includes(q)) : rows).map(
            formatArtifactLine
          );
          return done({
            path: prefix,
            ...(q ? { query } : {}),
            files: lines.slice(0, cap),
            ...(lines.length > cap
              ? {
                  note: `${cap} di ${lines.length}${q ? ` che contengono "${query}"` : ''} — alza limit${type ? '' : ', o ls("artifacts/<tipo>/") per un sottoinsieme'}`
                }
              : {}),
            ...(ctx ? {} : { blind: 'Nessun contesto di brand su questa superficie: artifacts/ non è consultabile qui.' })
          });
        }
        if (prefix || recursive) {
          const under = pick(all.filter((p) => p.startsWith(prefix)));
            // RICORSIVO SI CHIEDE, NON SI SUBISCE: `skills/remotion/` sono 74 file. Il default nomina
            // il livello, e il conteggio accanto a ogni sottocartella rende la decisione informata.
          if (recursive)
            return done({
              path: prefix,
              recursive: true,
              ...(q ? { query } : {}),
              files: under.slice(0, cap),
              ...capped(under)
            });
          const files: string[] = [];
          const dirs: Record<string, number> = {};
          for (const p of under) {
            const rest = p.slice(prefix.length);
            const cut = rest.indexOf('/');
            if (cut < 0) files.push(p);
            else dirs[`${prefix}${rest.slice(0, cut)}/`] = (dirs[`${prefix}${rest.slice(0, cut)}/`] ?? 0) + 1;
          }
          return done({
            path: prefix,
            ...(q ? { query } : {}),
            folders: Object.entries(dirs)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `${k} — ${n} file (ls con questo prefisso, o grep)`),
            files: files.slice(0, cap),
            ...capped(files)
          });
        }
          // L'albero è completo, l'indice è curato: senza prefisso si nomina solo ciò che facciamo
          // davvero, il resto è una riga per cartella col numero di file.
          //
          // Questa vista NON è «i figli della radice», di proposito: darebbe tre righe e perderebbe le
          // guide indicizzate (l'unica risposta a «da dove comincio») e il secondo livello, dove
          // `how/motion/` e `skills/remotion/` sono mestieri diversi. Coerenza contro utilità, vince
          // l'utilità — ma nessuna delle due viste rovescia un sottoalbero non richiesto.
          //
          // `indexed` È `mine`: si scorre l'albero intero e l'indice resta solo ciò che si salta.
          // Scorrendo `mine` il `continue` scattava su ogni elemento e `folders` usciva sempre vuoto.
        const indexed = pick(mine);
        const rest: Record<string, number> = {};
        for (const p of pick(all)) {
          if (indexed.includes(p)) continue;
            // `dirOf` toglie PRIMA il nome del file, o `library/bake-manifest.json` si stampa come una
            // cartella da un elemento.
          rest[dirOf(p)] = (rest[dirOf(p)] ?? 0) + 1;
        }
        return done({
          ...(q ? { query, matching: pick(all).length } : {}),
          guides: indexed.slice(0, cap),
          folders: Object.entries(rest)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k} — ${n} file (ls con questo prefisso, o grep)`),
            // `total` è l'albero INTERO, sempre; con un filtro attivo `matching` dice quanti ne restano.
          total: all.length,
          ...capped(indexed)
        });
      }
    })
  };
}
