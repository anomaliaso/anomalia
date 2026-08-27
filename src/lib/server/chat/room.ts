/**
 * ROOM — più agenti nello stesso thread, e uno solo (o due) che rispondono a ogni messaggio.
 *
 * L'unica decisione architetturale che conta qui dentro: IL SILENZIO SI DECIDE PRIMA DEL TURNO, NON
 * DENTRO. Una chiamata sola, corta, su modello economico (`compactionModel`) legge la roster e le
 * ultime battute e restituisce chi parla; solo quei membri fanno un turno vero, col LORO prompt e i
 * LORO tool. Un membro silenzioso costa la sua riga nel prompt del router: zero tool, zero contesto,
 * zero generazione. Il conto di un messaggio è `1 router + N speaker`, con N di norma 1 e mai oltre
 * ROOM_MAX_SPEAKERS.
 *
 * Sequenziale, mai parallelo: il thread ha già un lock per turno e la seconda voce deve poter leggere
 * quello che ha appena scritto la prima — è una conversazione, non un fan-out.
 *
 * Il primo speaker lo esegue il turno interattivo, il secondo arriva come turno accodato con l'agente
 * forzato. Nei turni non presidiati (schedulati, continuazioni, DM) il router NON gira mai: una
 * stanza si anima solo quando c'è una persona che ha appena scritto.
 */
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { harnessGenerateText } from '$lib/server/harness';
import { logAiCall } from '$lib/server/ai-log';
import { AGENTS, AGENT_IDS, type AgentId } from '$lib/server/chat/agents';
import {
  BUILTIN_AGENT_AVATARS,
  DEFAULT_CHAT_AGENT_AVATAR,
  fallbackAvatarColor,
  fallbackAvatarFace,
  normalizeAvatarColor,
  normalizeAvatarFace
} from '$lib/agent-avatars';
import { compactionModel, takeKieUsage } from '$lib/server/chat/model';
import { getCustomAgentsByIds } from '$lib/server/custom-agents-read';

/** Tetto ai membri: oltre, il prompt del router smette di essere corto e la stanza di essere leggibile. */
export const ROOM_MAX_MEMBERS = 4;

/**
 * Quante voci al massimo in una battuta. Due, non quattro: il caso vero per cui esiste il secondo
 * speaker è la richiesta che sta a cavallo di due mestieri ("fammi il reel e dimmi se regge sui
 * numeri"). Tre voci sulla stessa domanda sono rumore, e sono tre turni pagati.
 */
export const ROOM_MAX_SPEAKERS = 2;

/**
 * Quante voci al massimo per UN messaggio dell'utente, contando la prima. Tre, dai costi veri: una
 * voce costa ~700 volte una chiamata al router, quindi si spendono router con generosità e voci con
 * avarizia — il router gira dopo ogni voce e di norma dice «nessuno», per cui il caso tipico resta
 * una voce sola. Il tetto serve al caso peggiore, e a 4 la quarta battuta è quella che nessuno legge.
 *
 * Controllato PRIMA di accodare, in `roomContinue`: un tetto scritto in un prompt è un suggerimento.
 */
export const ROOM_MAX_VOICES_PER_MESSAGE = 3;

/** Prefisso delle chiavi membro che puntano a un custom agent dell'utente. */
const CUSTOM_PREFIX = 'custom:';

/**
 * `AGENT_IDS` contiene i cinque specialisti e basta, perché `auto` non è un mestiere: è il caso
 * «nessuna specializzazione, tutti i tool» (`resolveAgent('auto') === null`). Per l'utente però
 * Anomalia È un agente, e in stanza copre la richiesta che non appartiene a nessuno specialista.
 *
 * La sua chiave è quindi un membro valido e resta ovunque `agent: null`, così tutto il percorso a
 * valle la tratta già come «l'assistente pieno» senza imparare niente di nuovo.
 */
export const ROOM_GENERALIST = 'auto';
const GENERALIST_LABELS = { it: 'Anomalia', en: 'Anomalia' };
/** L'unica riga che il router legge di lei: dice quando è LEI la scelta giusta. */
const GENERALIST_AREA = {
  it: "tutto il resto: la richiesta che non è di nessuno specialista in particolare, le domande sul brand, l'organizzazione del lavoro — accesso pieno ai tool",
  en: 'everything else: requests that belong to no single specialist, questions about the brand, organising the work — full tool access'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Interruttore globale. Spento = ogni thread si comporta come oggi, un agente solo. */
export function groupChatsEnabled(): boolean {
  return env.GROUP_CHATS === 'true';
}

/**
 * Chiavi membro normalizzate da quello che c'è nel database (o arriva da un client).
 * Scarta ciò che non riconosce invece di alzare: una room con un id di agente rinominato deve
 * restare una room con gli altri, non diventare un thread illeggibile.
 */
export function parseRoomAgents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const key = String(entry ?? '').trim();
    if (!key) continue;
    if (key.startsWith(CUSTOM_PREFIX)) {
      if (!UUID.test(key.slice(CUSTOM_PREFIX.length))) continue;
    } else if (key !== ROOM_GENERALIST && !(AGENT_IDS as readonly string[]).includes(key)) {
      continue;
    }
    if (out.includes(key)) continue;
    out.push(key);
    if (out.length >= ROOM_MAX_MEMBERS) break;
  }
  return out;
}

/**
 * È una room? Servono la feature accesa e almeno due membri. Un solo membro è un thread normale
 * con una colonna in più, e va trattato come tale: nessun router, nessun costo aggiunto.
 */
export function isRoomThread(thread: { room_agents?: unknown } | null | undefined): boolean {
  if (!groupChatsEnabled() || !thread) return false;
  return parseRoomAgents(thread.room_agents).length >= 2;
}

/** Scrive la roster sul thread. Torna le chiavi effettivamente salvate (normalizzate). */
export async function setThreadRoomAgents(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string,
  raw: unknown
): Promise<string[]> {
  const keys = parseRoomAgents(raw);
  const { error } = await supabase
    .from('chat_threads')
    .update({ room_agents: keys.length >= 2 ? keys : null })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
  // Colonna assente (0209 non applicata) = la room non si salva e il thread resta a un agente.
  // Non è un errore da propagare al client: la chat funziona lo stesso.
  if (error) {
    console.warn('[room] room_agents non salvata:', error.message);
    return [];
  }
  return keys.length >= 2 ? keys : [];
}

export type RoomMember = {
  /** Chiave stabile: id agente di sistema, oppure `custom:<uuid>`. È anche il valore di attribuzione. */
  key: string;
  /** Agente di sistema che scopre prompt e tool del turno. Per un custom agent è null → toolset pieno. */
  agent: AgentId | null;
  customAgentId: string | null;
  name: string;
  /** Una riga su cosa fa: è tutto ciò che il router legge di questo membro. */
  area: string;
  /** Volto e colore per la pila di avatar della sidebar. Stesse chiavi di `$lib/agent-avatars`. */
  face: string;
  color: string;
};

/**
 * La roster leggibile della stanza. Una query sola per i custom agent, e solo se ce ne sono.
 * L'ordine è quello della colonna: il primo membro è il padrone di casa (vedi `roomBeat`).
 */
export async function roomRoster(
  supabase: SupabaseClient,
  brandId: string,
  keys: string[],
  locale: string = 'it'
): Promise<RoomMember[]> {
  const lang = locale === 'en' ? 'en' : 'it';
  const customIds = keys
    .filter((k) => k.startsWith(CUSTOM_PREFIX))
    .map((k) => k.slice(CUSTOM_PREFIX.length));

  const customById = new Map<
    string,
    { name: string; brief: string; agent: AgentId | null; face: string; color: string }
  >();
  if (customIds.length) {
    // `custom:<uuid>` in una stanza è UNA PERSONA, e dalla 0210 le persone stanno su
    // `custom_agents` (prima erano righe di schedulazione: agente e incarico nella stessa riga).
    for (const row of await getCustomAgentsByIds(supabase, brandId, customIds)) {
      const scoped = String(row.agent ?? '');
      customById.set(row.id, {
        name: row.name || 'Agent',
        // Il router non deve leggere il brief intero: la prima riga dice già il mestiere.
        brief: String(row.prompt ?? '').split('\n')[0]?.slice(0, 160) ?? '',
        // Un custom agent può essere già ristretto a un mestiere: quella restrizione vale anche
        // dentro la stanza, altrimenti entrando in una room si allargherebbe i tool.
        agent: (AGENT_IDS as readonly string[]).includes(scoped) ? (scoped as AgentId) : null,
        face: normalizeAvatarFace(row.avatar_face ?? undefined, fallbackAvatarFace(row.id)),
        color: normalizeAvatarColor(row.avatar_color, fallbackAvatarColor(row.id))
      });
    }
  }

  const members: RoomMember[] = [];
  for (const key of keys) {
    if (key.startsWith(CUSTOM_PREFIX)) {
      const id = key.slice(CUSTOM_PREFIX.length);
      const row = customById.get(id);
      if (!row) continue; // agente cancellato: esce dalla stanza da solo
      members.push({
        key,
        agent: row.agent,
        customAgentId: id,
        name: row.name,
        area: row.brief,
        face: row.face,
        color: row.color
      });
      continue;
    }
    if (key === ROOM_GENERALIST) {
      // `agent: null` = nessuna specializzazione, tool pieni: è già il significato di Anomalia
      // dappertutto (buildSystemPrompt, pickTools), non un caso speciale in più.
      const av = BUILTIN_AGENT_AVATARS[ROOM_GENERALIST] ?? DEFAULT_CHAT_AGENT_AVATAR;
      members.push({
        key,
        agent: null,
        customAgentId: null,
        name: GENERALIST_LABELS[lang],
        area: GENERALIST_AREA[lang],
        face: av.face,
        color: av.color
      });
      continue;
    }
    const def = AGENTS[key as AgentId];
    if (!def) continue;
    const av = BUILTIN_AGENT_AVATARS[key] ?? DEFAULT_CHAT_AGENT_AVATAR;
    members.push({
      key,
      agent: key as AgentId,
      customAgentId: null,
      name: def.labels[lang],
      area: def.area[lang],
      face: av.face,
      color: av.color
    });
  }
  return members;
}

/**
 * L'output del router, letto con tolleranza: i modelli piccoli incorniciano il JSON, lo chiamano
 * ```json, o rispondono con la sola lista. Qualunque chiave riconosciuta vince; niente di
 * riconosciuto → lista vuota, e il chiamante applica il ripiego.
 */
export function parseSpeakers(raw: string, members: RoomMember[]): string[] {
  const valid = new Set(members.map((m) => m.key));
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m.key]));
  const out: string[] = [];

  const push = (candidate: unknown) => {
    const s = String(candidate ?? '').trim();
    if (!s) return;
    const key = valid.has(s) ? s : byName.get(s.toLowerCase());
    if (key && !out.includes(key)) out.push(key);
  };

  const json = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : ((parsed as { speakers?: unknown })?.speakers ?? []);
      if (Array.isArray(list)) for (const item of list) push(item);
    } catch {
      /* sotto ci pensa la scansione a testo */
    }
  }
  // Nessun JSON valido: cerca le chiavi nel testo nudo, nell'ordine in cui compaiono.
  if (!out.length) {
    for (const m of members) {
      if (new RegExp(`(^|[^a-z0-9_])${m.key}([^a-z0-9_]|$)`, 'i').test(raw)) push(m.key);
    }
  }
  return out.slice(0, ROOM_MAX_SPEAKERS);
}

/**
 * La coda del thread, letta UNA volta per due cose che servono sempre insieme.
 *
 * `lines` — le ultime battute in righe «Nome: testo». Senza, il router vede solo l'ultimo messaggio
 * dell'utente, e un messaggio corto («sì fallo») non contiene il mestiere di nessuno: la scelta cade
 * sul ripiego, cioè sul primo membro, che da fuori si legge come «risponde sempre lo stesso».
 *
 * `spokenSinceUser` — chi ha già preso la parola in QUESTA battuta: insieme il conto delle voci e
 * l'insieme da togliere ai candidati. Deriva dai messaggi salvati e non da un contatore sul job — un
 * contatore si perde a un rilancio, si duplica a un doppio drenaggio e mente dopo un turno salvato
 * dal reaper.
 */
async function loadRoomTail(
  supabase: SupabaseClient,
  threadId: string,
  members: RoomMember[]
): Promise<{ lines: string[]; spokenSinceUser: string[] }> {
  const { data } = await supabase
    .from('chat_messages')
    .select('role, content, name')
    .eq('thread_id', threadId)
    .eq('superseded', false)
    .neq('content', '')
    .order('created_at', { ascending: false })
    .limit(10);
  const nameOf = new Map(members.map((m) => [m.key, m.name]));
  const rows = (data ?? [])
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .reverse();

  const lines = rows.map((r) => {
    const who = r.role === 'user' ? 'Utente' : (nameOf.get(String(r.name ?? '')) ?? 'Assistente');
    return `${who}: ${String(r.content ?? '').slice(0, 200)}`;
  });

    // Chi ha già parlato DOPO l'ultimo messaggio dell'utente: è il conto delle voci di questa battuta.
  const lastUser = rows.map((r) => r.role).lastIndexOf('user');
  const spokenSinceUser: string[] = [];
  for (const r of rows.slice(lastUser + 1)) {
    const key = String(r.name ?? '');
    if (r.role === 'assistant' && key && !spokenSinceUser.includes(key)) spokenSinceUser.push(key);
  }
  return { lines, spokenSinceUser };
}

/** Le ultime battute per lo smistatore, in righe "Nome: testo". Vedi `loadRoomTail`. */
async function roomRecentLines(
  supabase: SupabaseClient,
  threadId: string,
  members: RoomMember[]
): Promise<string[]> {
  return (await loadRoomTail(supabase, threadId, members)).lines;
}

/**
 * Lo smistatore della CONTINUAZIONE fa una domanda diversa dal primo giro: non «di chi è questa
 * richiesta?», che una risposta ce l'ha sempre, ma «manca ancora qualcosa?», la cui risposta normale
 * è no. La barra è alta di proposito — una stanza diventa insopportabile facendo parlare in quattro
 * quando il primo aveva già finito.
 *
 * `adds` PRIMA di `speaker`, e non è cosmesi: chi non sa nominare cosa manca non ottiene una voce. La
 * regola sta in tre posti (campo obbligatorio, forma del JSON, `parseNextSpeaker` che scarta se è
 * vuoto), così un modello che imita il formato senza avere niente da dire non passa lo stesso.
 */
const NEXT_PROMPT = `Sei lo smistatore di una chat di gruppo di lavoro. Un agente ha appena risposto all'utente.
Decidi se manca ancora qualcosa di IMPORTANTE che un ALTRO mestiere deve dire, e chi.

La risposta normale è NESSUNO. Rispondi {"speaker":null} e basta se:
- la risposta data copre già la richiesta;
- quello che si potrebbe aggiungere è d'accordo, un complimento, un riassunto o una ripetizione;
- l'aggiunta sarebbe una cosa generica che l'utente non ha chiesto;
- il messaggio dell'utente era di una sola area e quell'area ha già parlato.

Scegli qualcuno SOLO se:
- una parte esplicita della richiesta dell'utente non ha ancora avuto risposta, e non è del mestiere di chi ha parlato;
- oppure chi ha parlato ha detto qualcosa che un altro mestiere deve correggere o contraddire, perché così com'è porta l'utente fuori strada.

Se scegli qualcuno devi dire in poche parole COSA aggiunge, di concreto, che l'utente non ha già.
Se non sai dirlo, allora non manca niente: rispondi {"speaker":null}.

Rispondi SOLO con JSON: {"adds":"<cosa manca, poche parole>","speaker":"<chiave>"} oppure {"speaker":null}`;

/**
 * L'uscita del router di continuazione. Torna null per "nessuno" — che è il caso normale, non un
 * errore — e null anche quando il modello nomina qualcuno senza saper dire cosa aggiunge, o nomina
 * qualcuno che non è più un candidato (ha già parlato, o non è della stanza).
 */
export function parseNextSpeaker(
  raw: string,
  candidates: RoomMember[]
): { adds: string; speaker: string } | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let parsed: { adds?: unknown; speaker?: unknown };
  try {
    parsed = JSON.parse(json) as { adds?: unknown; speaker?: unknown };
  } catch {
    return null;
  }
  const speaker = String(parsed.speaker ?? '').trim();
  if (!speaker || speaker === 'null') return null;
  const byName = new Map(candidates.map((m) => [m.name.toLowerCase(), m.key]));
  const key = candidates.some((m) => m.key === speaker) ? speaker : byName.get(speaker.toLowerCase());
  if (!key) return null;
  // Il gate vero: una voce si guadagna dicendo cosa porta. Senza, la battuta in più è quella
  // che non dice niente — il modo esatto in cui questa funzione diventerebbe un costo e basta.
  const adds = String(parsed.adds ?? '').trim();
  if (!adds) return null;
  return { adds, speaker: key };
}

const ROUTER_PROMPT = `Sei lo smistatore di una chat di gruppo di lavoro. Nella stanza ci sono più agenti.
Decidi CHI risponde all'ultimo messaggio dell'utente.

Regole:
- Di norma parla UNO solo: quello il cui mestiere copre la richiesta.
- Un membro può essere il generalista (chiave "auto"): è lui la scelta quando la richiesta non è di nessun mestiere in particolare. Non sceglierlo per rubare il lavoro a uno specialista che c'è.
- Due solo se la richiesta chiede davvero due mestieri diversi nella stessa risposta. Mai più di due.
- Chi non ha niente da aggiungere non compare nell'elenco: restare in silenzio è la scelta normale, non un fallimento.
- LEGGI LE ULTIME BATTUTE PRIMA DI SCEGLIERE. Se il nuovo messaggio risponde, conferma o corregge qualcosa che ha detto un membro ("sì fallo", "no, più corto", "e i numeri?"), parla QUEL membro — non chi viene prima nella lista.
- Se l'utente nomina uno specialista, è quello.
- Solo se davvero nessuna delle regole sopra decide (un saluto a stanza fredda, una domanda generica senza un filo aperto): il generalista "auto" se c'è, altrimenti il primo della lista.
- L'ordine della lista NON è una preferenza: è solo l'ordine in cui l'utente ha messo insieme la stanza.

Rispondi SOLO con JSON: {"speakers":["<chiave>"]}`;

/**
 * Chi parla in questa battuta. Una chiamata corta su modello economico; qualunque cosa vada storta
 * (modello assente, timeout, output illeggibile) ripiega sul primo membro.
 *
 * Una lista vuota NON diventa «nessuno risponde»: una persona che ha appena scritto e non riceve
 * niente legge un prodotto rotto, e non ha modo di distinguerlo da un turno morto. Quindi l'elenco
 * vuoto ricade sul padrone di casa, come un router andato giù.
 * ponytail: se servisse il silenzio vero, il posto è qui — ma vuole anche una riga in chat che dica
 * che nessuno ha preso la parola.
 */
export async function pickRoomSpeakers(opts: {
  members: RoomMember[];
  userMessage: string;
  /** Ultime battute, già ridotte a righe "Nome: testo". Poche: al router serve il contesto, non la storia. */
  recent?: string[];
  brandId: string;
  userId: string;
  threadId: string;
}): Promise<string[]> {
  const { members } = opts;
  if (members.length < 2) return members.map((m) => m.key);

  const t0 = Date.now();
  const model = compactionModel();

    /**
     * OGNI USCITA SI FIRMA. `members[0]` è il ripiego di qualunque cosa vada storta, e quando il primo
     * membro è anche il generalista una SCELTA del router e un ERRORE inghiottito producono la stessa
     * riga nel database. Il perché va in `ai_calls.context` (`chat:room:pick` contro
     * `chat:room:fallback:{no-model,error,unparsed,empty}`), così una query sola separa il ripiego
     * dalla scelta e nessun ripiego resta invisibile.
     */
  const logRouter = (outcome: string, extra: { error?: string; res?: { usage?: { inputTokens?: number; outputTokens?: number } } } = {}) =>
    logAiCall({
      label: 'chatRoomRouter',
      provider: model?.provider ?? 'none',
      model: model?.modelId ?? 'none',
      ms: Date.now() - t0,
      ok: outcome === 'pick',
      ...(extra.error ? { error: extra.error } : {}),
      inputTokens: extra.res?.usage?.inputTokens,
      outputTokens: extra.res?.usage?.outputTokens,
      ...(model ? takeKieUsage(model) : {}),
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: opts.threadId,
      context: `chat:room:${outcome}`
    });

  /** Il ripiego non è mai muto: dice sul log del server perché sta ripiegando. */
  const fallbackTo = (outcome: string, why: string, error: string): string[] => {
    logRouter(outcome, { error });
    console.warn(`[room] ripiego sul primo membro (${members[0].key}) — ${why}; thread=${opts.threadId}`);
    return [members[0].key];
  };

  if (!model) {
    return fallbackTo('fallback:no-model', 'nessun modello economico configurato', 'no compaction model configured');
  }

  const roster = members.map((m) => `- ${m.key} — ${m.name}: ${m.area}`).join('\n');
  const history = (opts.recent ?? []).slice(-6).join('\n');
  try {
    const res = await harnessGenerateText(
      {
        brandId: opts.brandId,
        userId: opts.userId,
        threadId: opts.threadId,
        agent: 'chat_room_router',
        mode: 'route',
        model: model.modelId,
        provider: model.provider,
        surface: 'room'
      },
      {
        model: model.model,
        system: ROUTER_PROMPT,
        prompt: `Stanza:\n${roster}\n\n${history ? `Ultime battute:\n${history}\n\n` : ''}Nuovo messaggio dell'utente:\n${opts.userMessage.slice(0, 2000)}`,
        ...model.callOptions
      }
    );
    const raw = res.text ?? '';
    const speakers = parseSpeakers(raw, members);
    if (speakers.length) {
      logRouter('pick', { res });
      return speakers;
    }
      // Lista vuota VOLUTA e risposta illeggibile finiscono entrambe sul primo membro, ma sono due
      // guasti diversi: contarle insieme vuol dire non accorgersi mai di quale sta succedendo.
    const deliberate = /"speakers"\s*:\s*\[\s*\]/.test(raw);
    return deliberate
      ? fallbackTo('fallback:empty', 'il router non ha scelto nessuno', 'router returned an empty speakers list')
      : fallbackTo('fallback:unparsed', 'risposta del router illeggibile', `unparsable router output: ${raw.slice(0, 200)}`);
  } catch (e) {
    return fallbackTo('fallback:error', 'il modello è saltato', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Il blocco che si aggiunge al system prompt dello speaker: dove si trova, con chi, e che gli altri
 * leggono tutto. Senza, l'agente scrive come se fosse solo e ripresenta il brand a ogni battuta.
 *
 * Due cose che NON fa, di proposito:
 * - non è un secondo instradatore: chi parla lo ha già deciso `pickRoomSpeakers` prima del turno, e
 *   un agente che potesse ridecidere si rimbalzerebbe la palla con un collega a spese dell'utente;
 * - non ha una lista di membri sua: nomi e mestieri escono da `roomRoster`, la stessa fonte del
 *   router e delle firme, quindi non esiste un secondo elenco che possa divergere.
 *
 * Entra in OGNI turno di OGNI stanza: per questo l'area di un membro è una riga sola, non il brief.
 */
export function roomSystemBlock(members: RoomMember[], speakerKey: string, locale = 'it'): string {
  const me = members.find((m) => m.key === speakerKey);
  const others = members.filter((m) => m.key !== speakerKey);
  if (!me || !others.length) return '';
  const list = others.map((m) => `${m.name} (${m.area})`).join('; ');
  return locale === 'en'
    ? `\n\n## GROUP CHAT\nThis thread is a room: several agents and the user, in one conversation. You are **${me.name}**. Also here: ${list}. Everyone reads every message, yours included, and only ONE agent writes at a time — you were picked to answer THIS one. So: do not repeat what someone already said, do not summarise them, do not answer for them, do not introduce yourself again. If part of the request belongs to another craft, say so in one line and leave it to them — badly doing their job costs the user more than the handover. And you are not obliged to weigh in on everything: when the message is not really for you, the useful answer is a short one, or none.\nYOUR VOICE IS YOURS, THEIRS IS THEIRS. You may report what a colleague has ALREADY said in this chat, attributed to them (\"as Analyst said, ...\"). NEVER write new words in their name, never answer \"on their behalf\", never sign a section with their craft: they are here and speak for themselves. If you need their input you do not have it yet — say in one line what is needed and end your turn: the floor passes to them after you.`
    : `\n\n## CHAT DI GRUPPO\nQuesto thread è una stanza: più agenti e l'utente, in una conversazione sola. Tu sei **${me.name}**. Ci sono anche: ${list}. Tutti leggono tutti i messaggi, compreso il tuo, e scrive UN agente alla volta — per questo è stato scelto te. Quindi: non ripetere quello che qualcuno ha già detto, non riassumerlo, non rispondere al posto suo, non ripresentarti. Se un pezzo della richiesta è di un altro mestiere, dillo in una riga e lasciaglielo — farglielo male al posto suo costa all'utente più del passaggio di mano. E non sei obbligato a intervenire su tutto: quando il messaggio non è davvero per te, la risposta utile è breve, o nessuna.\nLA TUA VOCE È TUA, QUELLA DEGLI ALTRI È LORO. Puoi riferire quello che un collega ha GIÀ detto in questa chat, attribuendoglielo (\"come diceva Analyst, ...\"). Non scrivere MAI parole nuove a nome suo, non rispondere \"da parte sua\", non firmare un pezzo col suo mestiere: è qui dentro e parla da sé. Se ti serve il suo contributo non ce l'hai ancora — di' in una riga cosa serve e chiudi il tuo turno: la parola passa a lui dopo di te.`;
}

/**
 * La battuta completa: chi parla, in che ordine. La prima voce la esegue il turno già in corso, le
 * successive le accoda lo stesso file con `enqueueQueuedChatTurn`.
 *
 * Il router decide QUI, una volta, PRIMA del turno — mai a cascata: un agente che rispondesse dentro
 * la stanza convocandone un altro rimbalzerebbe la palla a spese dell'utente, e nessun tetto scritto
 * in un prompt reggerebbe.
 */
export async function roomBeat(
  supabase: SupabaseClient,
  opts: {
    thread: { id: string; room_agents?: unknown };
    brandId: string;
    userId: string;
    userMessage: string;
    recent?: string[];
    locale?: string;
  }
): Promise<{ members: RoomMember[]; speakers: RoomMember[] } | null> {
  if (!isRoomThread(opts.thread)) return null;
  const keys = parseRoomAgents(opts.thread.room_agents);
  const members = await roomRoster(supabase, opts.brandId, keys, opts.locale);
  if (members.length < 2) return null;
  const picked = await pickRoomSpeakers({
    members,
    userMessage: opts.userMessage,
    recent: opts.recent ?? (await roomRecentLines(supabase, opts.thread.id, members)),
    brandId: opts.brandId,
    userId: opts.userId,
    threadId: opts.thread.id
  });
  return {
    members,
    speakers: picked.map((k) => members.find((m) => m.key === k)!).filter(Boolean)
  };
}

/**
 * La stanza come pila di avatar per la sidebar, nella stessa forma di `listThreadAgentAvatars`, così
 * `threadIdentity` e `AgentAvatarStack` non imparano niente di nuovo. `id` è la CHIAVE membro
 * (`motion`, `custom:<uuid>`), non l'id della riga: è quello che il client ritrova in `room_agents` e
 * in `chat_messages.name`.
 */
export function roomAvatars(
  members: RoomMember[]
): Array<{ id: string; name: string; face: string; color: string }> {
  return members.map((m) => ({ id: m.key, name: m.name, face: m.face, color: m.color }));
}

/**
 * LA BATTUTA CONTINUA — o finisce. Si chiama DOPO che una voce ha salvato la sua risposta: invece di
 * decidere un piano di N voci prima del turno, si decide UNA voce alla volta guardando quello che è
 * appena stato detto. Il router costa ~1/700 di una voce, quindi si chiede spesso e si parla poco.
 *
 * Tre freni, in ordine, e il più forte è il primo perché non passa da nessun modello:
 *  1. UNA VOCE A TESTA per messaggio dell'utente, applicata QUI nel codice: rende impossibile — non
 *     sconsigliato — che due agenti si scambino cortesie, e limita la catena da solo.
 *  2. IL TETTO (`ROOM_MAX_VOICES_PER_MESSAGE`), contato sulle battute vere, prima di accodare.
 *  3. IL ROUTER dice «nessuno», che è la sua risposta normale.
 *
 * Ogni uscita lascia una riga in `ai_calls.context` (`chat:room:next:*`): è la differenza fra un'ora
 * e un giorno di indagine quando qualcuno dirà «risponde sempre lo stesso».
 */
export async function roomContinue(
  supabase: SupabaseClient,
  opts: {
    thread: { id: string; room_agents?: unknown };
    brandId: string;
    userId: string;
    /** Il messaggio dell'utente che ha aperto la battuta: ogni voce risponde a QUELLO. */
    userMessage: string;
    locale?: string;
    origin: string;
    mode?: string;
    tier?: string;
  }
): Promise<RoomMember | null> {
  if (!isRoomThread(opts.thread)) return null;
  const locale = opts.locale === 'en' ? 'en' : 'it';
  const members = await roomRoster(supabase, opts.brandId, parseRoomAgents(opts.thread.room_agents), locale);
  if (members.length < 2) return null;

  const t0 = Date.now();
  const model = compactionModel();
  const log = (outcome: string, extra: { error?: string; res?: { usage?: { inputTokens?: number; outputTokens?: number } } } = {}) =>
    logAiCall({
      label: 'chatRoomNext',
      provider: model?.provider ?? 'none',
      model: model?.modelId ?? 'none',
      ms: Date.now() - t0,
      ok: !outcome.startsWith('fallback'),
      ...(extra.error ? { error: extra.error } : {}),
      inputTokens: extra.res?.usage?.inputTokens,
      outputTokens: extra.res?.usage?.outputTokens,
      ...(model ? takeKieUsage(model) : {}),
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: opts.thread.id,
      context: `chat:room:next:${outcome}`
    });

  const { lines, spokenSinceUser } = await loadRoomTail(supabase, opts.thread.id, members);
  // Nessuno ha ancora parlato: non è una continuazione, la prima voce la sceglie `roomBeat`.
  if (!spokenSinceUser.length) return null;

  // FRENO 2 — il tetto. Prima del modello: un giro che è già finito non paga un router.
  if (spokenSinceUser.length >= ROOM_MAX_VOICES_PER_MESSAGE) {
    log('stop:cap');
    return null;
  }

  // FRENO 1 — una voce a testa. Chi ha parlato non è più un candidato, punto.
  const candidates = members.filter((m) => !spokenSinceUser.includes(m.key));
  if (!candidates.length) {
    log('stop:all-spoken');
    return null;
  }

  if (!model) {
    log('fallback:no-model', { error: 'no compaction model configured' });
    return null;
  }

  let picked: { adds: string; speaker: string } | null = null;
  try {
    const roster = candidates.map((m) => `- ${m.key} — ${m.name}: ${m.area}`).join('\n');
    const res = await harnessGenerateText(
      {
        brandId: opts.brandId,
        userId: opts.userId,
        threadId: opts.thread.id,
        agent: 'chat_room_next',
        mode: 'route',
        model: model.modelId,
        provider: model.provider,
        surface: 'room'
      },
      {
        model: model.model,
        system: NEXT_PROMPT,
        prompt: `Chi può ancora parlare:\n${roster}\n\nMessaggio dell'utente:\n${opts.userMessage.slice(0, 2000)}\n\nLa conversazione finora:\n${lines.join('\n')}`,
        ...model.callOptions
      }
    );
    picked = parseNextSpeaker(res.text ?? '', candidates);
    // FRENO 3 — "nessuno". Non è un errore: è come finisce un giro, quasi sempre.
    if (!picked) {
      log('stop:nobody', { res });
      return null;
    }
    log('pick', { res });
  } catch (e) {
      // Il modello è saltato: la battuta finisce qui. Un ripiego che fa PARLARE qualcuno pagherebbe
      // una voce intera per un errore di instradamento.
    log('fallback:error', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }

  const next = candidates.find((m) => m.key === picked!.speaker);
  if (!next) return null;

  const { enqueueQueuedChatTurn } = await import('./queue');
  await enqueueQueuedChatTurn(supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    threadId: opts.thread.id,
    userMessage: opts.userMessage,
    locale,
    origin: opts.origin,
    mode: opts.mode,
    tier: opts.tier,
      // `next.agent` è null per i membri senza mestiere (Anomalia, un custom non ristretto): la chiave
      // nuda risolve comunque a null e dice «assistente pieno», invece di far ricadere il runner sulla
      // colonna `agent` del thread, cioè su un altro membro.
    agent: next.agent ?? next.key,
    customAgentId: next.customAgentId,
    speaker: next.key,
    userMessageSaved: true,
    // L'INCARICO, non solo le regole della stanza. `parseNextSpeaker` rifiuta una voce che non sa
    // dire cosa aggiunge (`adds`) proprio perché quella frase È il motivo per cui si paga un turno
    // in più — e finiva scartata qui: il secondo agente riceveva lo stesso blocco generico del
    // primo, la stessa domanda dell'utente e nessuna consegna, quindi rispondeva daccapo. Misurato:
    // in una stanza di tre, la seconda voce ripeteva la prima quasi parola per parola.
    brief: `${roomSystemBlock(members, next.key, locale)}\n${
      locale === 'en'
        ? `WHY YOU AND NOT SOMEONE ELSE: the others have already answered; you were called for ONE thing they left out — ${picked.adds}. Say that, and only that. Everything already said stays said: no recap, no agreeing, no reopening the whole question. If on reading the chat you find it is already covered, one line saying so is the right answer.`
        : `PERCHÉ TU E NON UN ALTRO: gli altri hanno già risposto, tu sei stato chiamato per UNA cosa che manca — ${picked.adds}. Di' quella, e solo quella. Il già detto resta detto: niente riassunto, niente conferme, niente riaprire tutta la domanda. Se leggendo la chat vedi che è già coperta, la risposta giusta è una riga che lo dice.`
    }`
  });
  return next;
}

/**
 * DENTRO UNA STANZA NON SI SCRIVE IN PRIVATO A CHI È NELLA STANZA: un thread privato con qualcuno che
 * è già qui e legge tutto è un giro inutile che finisce nella voce sbagliata — chi legge non vede un
 * riassunto, vede uno che prende il posto di un altro che potrebbe parlare da sé.
 *
 * Il bersaglio è un PARAMETRO libero, non il nome del tool, quindi non si può togliere dallo schema:
 * si rifiuta all'esecuzione e lo si dice nella descrizione (i due posti che il modello vede). Verso
 * chi NON è nella stanza il DM resta valido, ed è perché il tool non si cancella e basta.
 */
export function stripRoomPeerTools<T extends Record<string, unknown>>(
  tools: T,
  memberKeys: string[]
): T {
  if (memberKeys.length < 2) return tools;
  const dm = tools.message_agent as
    | { description?: string; execute?: (a: unknown, o: unknown) => Promise<unknown> }
    | undefined;
  if (!dm?.execute) return tools;

  const inRoom = new Set(memberKeys);
  const original = dm.execute.bind(dm);
  return {
    ...tools,
    message_agent: {
      ...dm,
      description: `${dm.description ?? ''}\nNOT for the agents in this room (${memberKeys.join(', ')}): they read this conversation and speak in it themselves. Say what you need and finish your turn — they get the floor after you. Use this only for an agent who is NOT in the room.`,
      execute: async (args: unknown, o: unknown) => {
        // `to` è uno o una LISTA (il fan-out): il controllo guarda tutti i destinatari, altrimenti
        // basterebbe mettere il membro della stanza dentro un array per scavalcare il divieto.
        const raw = (args as { to?: unknown })?.to;
        const targets = (Array.isArray(raw) ? raw : [raw]).map((t) => String(t ?? '').trim());
        const here = targets.filter((t) => inRoom.has(t));
        if (here.length) {
          return {
            error: 'recipient_is_in_this_room',
            hint: `${here.join(', ')} ${here.length > 1 ? 'are' : 'is'} in this room and speak${here.length > 1 ? '' : 's'} for themselves. Do not write to them privately and do not answer in their name: say what you need in your reply and finish — they take the floor after you.`
          };
        }
        return original(args, o);
      }
    }
  } as T;
}
