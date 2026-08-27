/**
 * LA BATTUTA DELLA STANZA — chi parla, e il cablaggio che lo fa parlare davvero.
 *
 * Due metà, come il codice: `roomBeat` (chi viene scelto, e cosa succede quando lo smistatore
 * fallisce) girato per davvero, e il turno interattivo verificato leggendo il sorgente — la stessa
 * scelta di ask-user-blocking.test.ts, perché montare l'intero POST della chat costerebbe più
 * mock che codice, e la regressione tipica di queste due righe è perderle in un merge.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { env } from '$env/dynamic/private';

let routerText = '{"speakers":["analyst"]}';
let routerThrows = false;
/** Il prompt che lo smistatore ha ricevuto davvero: è lì che si vede se le battute ci sono. */
let routerPrompt = '';
/**
 * La risposta dello smistatore in funzione del prompt. Di norma è `routerText` fisso; i test della
 * continuazione la sostituiscono per avere uno smistatore che dice sempre di sì — la condizione
 * peggiore, quella in cui l'unica cosa che tiene il conto sono i freni scritti nel codice.
 */
let routerReply: (prompt: string) => string = () => routerText;
vi.mock('$lib/server/harness', () => ({
  harnessGenerateText: vi.fn(async (_meta: unknown, args: { prompt?: string }) => {
    routerPrompt = String(args?.prompt ?? '');
    if (routerThrows) throw new Error('modello giù');
    return { text: routerReply(routerPrompt), usage: {} };
  })
}));
/** I turni che la continuazione accoda: il conto delle voci PAGATE di una battuta. */
const enqueued: Array<Record<string, unknown>> = [];
vi.mock('./queue', () => ({
  enqueueQueuedChatTurn: vi.fn(async (_s: unknown, args: Record<string, unknown>) => {
    enqueued.push(args);
  })
}));
/** Le righe che finirebbero in `ai_calls`: è lì che si distingue una scelta da un ripiego. */
const logged: Array<{ ok: boolean; context?: string; error?: string }> = [];
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: (e: { ok: boolean; context?: string; error?: string }) => logged.push(e)
}));
vi.mock('./model', () => ({
  compactionModel: () => ({
    model: {},
    modelId: 'flash',
    provider: 'test',
    callOptions: {}
  }),
  takeKieUsage: () => ({})
}));

const { roomBeat, roomContinue, ROOM_MAX_VOICES_PER_MESSAGE } = await import('./room');

/**
 * La stanza usata qui è di soli specialisti, quindi `roomRoster` non tocca il database — ma
 * `roomBeat` legge le ultime battute per lo smistatore, e quella query passa da qui.
 */
let recentRows: Array<{ role: string; content: string; name: string | null }> = [];
const chain = {
  eq: () => chain,
  neq: () => chain,
  order: () => chain,
  limit: async () => ({ data: recentRows })
};
const supabase = { from: () => ({ select: () => chain }) } as never;
const opts = {
  brandId: 'brand-1',
  userId: 'user-1',
  userMessage: 'fammi il reel e dimmi se regge sui numeri',
  locale: 'it'
};

const prev = env.GROUP_CHATS;
beforeEach(() => {
  env.GROUP_CHATS = 'true';
  routerText = '{"speakers":["analyst"]}';
  routerThrows = false;
  routerPrompt = '';
  routerReply = () => routerText;
  recentRows = [];
  logged.length = 0;
  enqueued.length = 0;
});
afterEach(() => {
  env.GROUP_CHATS = prev;
});

describe('roomBeat', () => {
  const thread = { id: 'room-1', room_agents: ['motion', 'analyst'] };

  it('il primo speaker è quello scelto dallo smistatore, non il primo della lista', async () => {
    const beat = await roomBeat(supabase, { thread, ...opts });
    expect(beat?.speakers.map((s) => s.key)).toEqual(['analyst']);
    expect(beat?.members.map((m) => m.key)).toEqual(['motion', 'analyst']);
    // Il membro porta con sé tutto quello che serve al turno: agente, persona, firma.
    expect(beat?.speakers[0].agent).toBe('analyst');
    expect(beat?.speakers[0].customAgentId).toBe(null);
  });

  it('lo smistatore legge le ultime battute, firmate col nome del membro', async () => {
    recentRows = [
      { role: 'assistant', content: 'Ti propongo un taglio a 12 secondi.', name: 'motion' },
      { role: 'user', content: 'ok', name: null }
    ];
    await roomBeat(supabase, { thread, ...opts, userMessage: 'sì, fallo' });
    // La firma diventa il NOME del membro: `motion` da solo non direbbe niente al router.
    expect(routerPrompt).toContain('Motion Specialist: Ti propongo un taglio a 12 secondi.');
    expect(routerPrompt).toContain('Utente: ok');
    // E l'ordine è quello della conversazione, non quello della query (che scende).
    expect(routerPrompt.indexOf('Motion Specialist:')).toBeLessThan(routerPrompt.indexOf('Utente: ok'));
  });

  /**
   * IL RIPIEGO NON PUÒ ESSERE INVISIBILE.
   *
   * Il primo membro è il ripiego di ogni guasto. Se è anche il generalista, "ha risposto auto" può
   * voler dire due cose opposte — il router ha scelto lui, oppure è saltato tutto — e in produzione
   * le due righe sono identiche. Questo è il controllo che tiene separate le due cose: senza,
   * qualunque correzione futura resta indimostrabile (ed è già successo).
   */
  describe('scelta e ripiego non si confondono in ai_calls', () => {
    const contexts = () => logged.map((l) => l.context);

    it('una scelta vera si firma pick, con ok', async () => {
      await roomBeat(supabase, { thread, ...opts });
      expect(contexts()).toEqual(['chat:room:pick']);
      expect(logged[0].ok).toBe(true);
    });

    it('lista vuota deliberata e risposta illeggibile sono DUE guasti diversi', async () => {
      routerText = '{"speakers":[]}';
      await roomBeat(supabase, { thread, ...opts });
      expect(contexts()).toEqual(['chat:room:fallback:empty']);

      logged.length = 0;
      routerText = 'boh, direi di sì';
      await roomBeat(supabase, { thread, ...opts });
      expect(contexts()).toEqual(['chat:room:fallback:unparsed']);
      // E l'output vero finisce nel log: senza, non si può capire cosa ha sbagliato il modello.
      expect(logged[0].error).toContain('boh, direi di sì');
    });

    it('il modello che salta si firma error, non passa per buono', async () => {
      routerThrows = true;
      await roomBeat(supabase, { thread, ...opts });
      expect(contexts()).toEqual(['chat:room:fallback:error']);
      expect(logged[0].ok).toBe(false);
    });

    it('ogni ripiego lascia comunque UNA riga sola: il conto delle chiamate resta vero', async () => {
      routerThrows = true;
      await roomBeat(supabase, { thread, ...opts });
      expect(logged).toHaveLength(1);
    });
  });

  it('due mestieri = due voci, in ordine — e mai più di due', async () => {
    routerText = '{"speakers":["motion","analyst","web"]}';
    const beat = await roomBeat(supabase, { thread, ...opts });
    expect(beat?.speakers.map((s) => s.key)).toEqual(['motion', 'analyst']);
  });

  it('smistatore muto o rotto = parla il padrone di casa, una voce sola', async () => {
    routerText = '{"speakers":[]}';
    expect((await roomBeat(supabase, { thread, ...opts }))?.speakers.map((s) => s.key)).toEqual([
      'motion'
    ]);
    routerThrows = true;
    expect((await roomBeat(supabase, { thread, ...opts }))?.speakers.map((s) => s.key)).toEqual([
      'motion'
    ]);
  });

  it('non è una stanza: feature spenta, un membro solo, o un DM fra agenti', async () => {
    env.GROUP_CHATS = 'false';
    expect(await roomBeat(supabase, { thread, ...opts })).toBe(null);
    env.GROUP_CHATS = 'true';
    expect(
      await roomBeat(supabase, { thread: { id: 'x', room_agents: ['motion'] }, ...opts })
    ).toBe(null);
    // Marcatore DM: un OGGETTO, non un array — per le stanze non esiste.
    expect(
      await roomBeat(supabase, {
        thread: { id: 'x', room_agents: { dm: ['analyst', 'content'] } },
        ...opts
      })
    ).toBe(null);
  });
});

describe('il turno interattivo esegue il piano', () => {
  // Il motore interattivo è spezzato in due moduli: la preparazione del turno e la sua chiusura.
  const src = readFileSync('src/routes/app/[brand]/chat/lib/turn-prep.ts', 'utf8');
  const finish = readFileSync('src/routes/app/[brand]/chat/lib/turn-finish.ts', 'utf8');

  it("l'agente del turno è il primo speaker, e il blocco stanza è nel system prompt", () => {
    expect(src).toContain('const roomSpeaker');
    // agentId nasce dallo speaker prima di ricadere sul body/thread.
    const agentLine = src.slice(src.indexOf('const agentId ='), src.indexOf('const agentId =') + 220);
    expect(agentLine).toContain('roomSpeaker');
    expect(agentLine).toContain('resolveAgentForPlan(roomSpeaker.agent');
    expect(src).toContain('systemPrompt += roomSystemBlock(roomPlan.members, roomSpeaker.key, locale)');
    // E il persona del turno è quello del membro, non quello inciso sul thread.
    expect(src).toContain('const customAgentId = roomSpeaker');
  });

  /**
   * Non c'è più un piano di N voci deciso prima del turno: dopo che la voce ha salvato, si
   * richiede al router se manca qualcosa (`roomContinue`), e si accoda AL MASSIMO una voce.
   */
  it('dopo la risposta si richiede al router, invece di eseguire un piano deciso prima', () => {
    expect(finish).toContain('await roomContinue(supabase, {');
    // Il piano a due voci non esiste più: se torna, torna anche il fan-out.
    expect(finish).not.toContain('roomPlan.speakers.length > 1');
    expect(finish).not.toContain('roomPlan.speakers[1]');
  });

  /**
   * UNO ALLA VOLTA. Le voci non si serializzano con un lock nuovo: si serializzano perché la riga
   * della successiva nasce mentre il job di questa è ancora `running`, e il drenaggio salta ogni
   * thread che ha un `chat_response` pending/running. L'ordine delle tre scritture È il
   * meccanismo — salva la risposta → decidi e accoda → chiudi il job — quindi è quello che va
   * bloccato: invertire le ultime due farebbe partire la voce dopo SOPRA questa.
   */
  it('la voce dopo si accoda mentre il turno è ancora running, e prima che si chiuda', () => {
    const save = finish.indexOf('const [savedId] = await saveMessages(');
    const cont = finish.indexOf('await roomContinue(supabase, {');
    const close = finish.indexOf('// Update job status to done');
    expect(save).toBeGreaterThan(-1);
    expect(cont).toBeGreaterThan(save);
    expect(close).toBeGreaterThan(cont);
    expect(finish.indexOf('scheduleQueueKick', close)).toBeGreaterThan(close);
  });

  /**
   * STOP FERMA LA CATENA. Un utente che preme Stop e vede arrivare altre due voci non pensa "si
   * sta fermando", pensa che il prodotto non gli obbedisce — ed è il tipo di cosa che si nota una
   * volta e non si dimentica più. La guardia sta PRIMA della decisione, così non si paga nemmeno
   * il router per una battuta che l'utente ha già interrotto.
   */
  it('Stop impedisce di accodare la voce successiva', () => {
    const cont = finish.indexOf('await roomContinue(supabase, {');
    const guard = finish.lastIndexOf('isJobCancelled(supabase, jobId)', cont);
    expect(guard).toBeGreaterThan(-1);
    // La guardia è nella condizione che avvolge roomContinue, non lontana nel file.
    expect(cont - guard).toBeLessThan(300);
    expect(finish.slice(guard - 40, cont)).toContain('!(await');
  });

  it('il drenaggio non tocca un thread con un turno vivo (è il lock delle due voci)', () => {
    const q = readFileSync('src/lib/server/chat/queue.ts', 'utf8');
    const at = q.indexOf('for (const c of candidates)');
    expect(at).toBeGreaterThan(-1);
    const loop = q.slice(at, at + 700);
    expect(loop).toContain('threadHasActiveChatResponse');
    expect(loop).toContain('if (busy) continue;');
  });
});

/**
 * I FRENI DELLA CONTINUAZIONE — cioè il motivo per cui una stanza da quattro non costa quattro.
 *
 * Erano verificati solo leggendo il sorgente del chiamante ("roomContinue viene chiamata"), il che
 * dimostra che la funzione esiste, non che si ferma. Qui gira davvero, con lo smistatore che dice
 * SEMPRE di sì: è la condizione peggiore, quella in cui l'unica cosa che tiene il conto sono i tre
 * freni scritti nel codice. Se un giorno uno salta, questi test falliscono prima di una bolletta.
 */
describe('roomContinue — N agenti non rispondono tutti allo stesso messaggio', () => {
  const room = { id: 'room-1', room_agents: ['content', 'motion', 'web', 'analyst'] };
  const contOpts = {
    brandId: 'brand-1',
    userId: 'user-1',
    userMessage: 'fammi il reel',
    locale: 'it',
    origin: 'http://localhost:5173'
  };

  /** Lo smistatore più permissivo possibile: nomina il PRIMO candidato che gli viene offerto. */
  const routerSaysYes = () => {
    routerReply = (prompt) =>
      JSON.stringify({ adds: 'il taglio tecnico', speaker: prompt.match(/^- (\S+) —/m)?.[1] ?? null });
  };

  /**
   * Una battuta salvata. Va in TESTA perché la query vera scende (`order desc`) e `loadRoomTail`
   * la rigira: il messaggio dell'utente è il più vecchio, quindi l'ultimo della lista.
   */
  const spoke = (key: string) => recentRows.unshift({ role: 'assistant', content: `battuta di ${key}`, name: key });

  beforeEach(() => {
    recentRows = [{ role: 'user', content: 'fammi il reel', name: null }];
  });

  it('IL TETTO: quattro membri, lo smistatore dice sempre sì, e le voci restano ROOM_MAX_VOICES_PER_MESSAGE', async () => {
    routerSaysYes();
    spoke('content'); // la prima voce l'ha già fatta il turno interattivo

    // Si gira finché la battuta non si chiude da sola: ogni voce accodata salva la sua riga.
    let voices = 1;
    for (let i = 0; i < 10; i++) {
      const next = await roomContinue(supabase, { thread: room, ...contOpts });
      if (!next) break;
      voices += 1;
      spoke(next.key);
    }

    expect(voices).toBe(ROOM_MAX_VOICES_PER_MESSAGE);
    // Il punto: la stanza ha quattro membri e uno NON ha parlato, pur avendo uno smistatore che
    // avrebbe fatto parlare chiunque. Quattro membri ≠ quattro turni pagati.
    expect(voices).toBeLessThan(room.room_agents.length);
    expect(enqueued).toHaveLength(ROOM_MAX_VOICES_PER_MESSAGE - 1);
    // E il tetto non paga nemmeno il router per la battuta già chiusa: l'ultimo giro esce prima.
    expect(logged.at(-1)?.context).toBe('chat:room:next:stop:cap');
  });

  /**
   * Il router GATE-a la voce in più su `adds` («cosa aggiunge, di concreto, che l'utente non ha
   * già») e senza quella frase rifiuta di far parlare qualcuno. Quella frase deve ARRIVARE a chi
   * parla: consegnata, il secondo agente sa perché è stato chiamato; scartata — com'era — riceve la
   * stessa domanda e lo stesso blocco generico del primo, e riscrive la stessa risposta. Misurato
   * in una stanza vera di tre: la seconda voce ripeteva la prima quasi parola per parola, a spese
   * dell'utente.
   */
  it("L'INCARICO ARRIVA A CHI PARLA: `adds` finisce nel brief del turno accodato", async () => {
    routerReply = () =>
      JSON.stringify({ adds: 'il costo di produzione, che nessuno ha nominato', speaker: 'analyst' });
    spoke('content');

    const next = await roomContinue(supabase, { thread: room, ...contOpts });
    expect(next?.key).toBe('analyst');
    const brief = String(enqueued[0].brief);
    // La ragione per cui questa voce si paga, testuale.
    expect(brief).toContain('il costo di produzione, che nessuno ha nominato');
    // E accanto restano le regole della stanza: l'incarico si aggiunge, non sostituisce.
    expect(brief).toContain('CHAT DI GRUPPO');
  });

  it('UNA VOCE A TESTA: chi ha già parlato non è candidato, e non lo diventa se lo smistatore lo nomina', async () => {
    routerReply = () => JSON.stringify({ adds: 'qualcosa', speaker: 'motion' });
    spoke('motion');

    expect(await roomContinue(supabase, { thread: room, ...contOpts })).toBeNull();
    expect(enqueued).toHaveLength(0);
    // Non è che lo smistatore ha sbagliato: `motion` non gli è stato nemmeno offerto.
    expect(routerPrompt).not.toContain('- motion —');
  });

  it('"NESSUNO" è la risposta normale: il giro finisce senza accodare niente', async () => {
    routerReply = () => '{"speaker":null}';
    spoke('content');

    expect(await roomContinue(supabase, { thread: room, ...contOpts })).toBeNull();
    expect(enqueued).toHaveLength(0);
    expect(logged.at(-1)?.context).toBe('chat:room:next:stop:nobody');
  });

  it('una voce si guadagna dicendo cosa aggiunge: senza `adds`, non parla', async () => {
    routerReply = () => '{"speaker":"analyst"}';
    spoke('content');

    expect(await roomContinue(supabase, { thread: room, ...contOpts })).toBeNull();
    expect(enqueued).toHaveLength(0);
  });

  it('il modello che salta NON fa parlare nessuno: un ripiego che parla sarebbe il caso peggiore', async () => {
    routerThrows = true;
    spoke('content');

    expect(await roomContinue(supabase, { thread: room, ...contOpts })).toBeNull();
    expect(enqueued).toHaveLength(0);
    expect(logged.at(-1)?.context).toBe('chat:room:next:fallback:error');
  });

  it('nessuno ha ancora parlato = non è una continuazione (la prima voce la sceglie roomBeat)', async () => {
    routerSaysYes();
    expect(await roomContinue(supabase, { thread: room, ...contOpts })).toBeNull();
    expect(enqueued).toHaveLength(0);
  });
});
