import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { env } from '$env/dynamic/private';
import {
  ROOM_MAX_MEMBERS,
  ROOM_MAX_SPEAKERS,
  isRoomThread,
  parseRoomAgents,
  parseSpeakers,
  roomRoster,
  roomSystemBlock,
  stripRoomPeerTools,
  type RoomMember
} from './room';

const members: RoomMember[] = [
  { key: 'motion', agent: 'motion', customAgentId: null, name: 'Motion Specialist', area: 'video', face: 'visor', color: '#8b5cf6' },
  { key: 'analyst', agent: 'analyst', customAgentId: null, name: 'Analyst', area: 'numeri', face: 'focus', color: '#10b981' }
];

describe('parseRoomAgents', () => {
  it('tiene solo agenti noti e custom:<uuid>, in ordine e senza doppioni', () => {
    expect(
      parseRoomAgents([
        'motion',
        'motion',
        'reparto-inesistente',
        'custom:11111111-2222-3333-4444-555555555555',
        'custom:non-un-uuid'
      ])
    ).toEqual(['motion', 'custom:11111111-2222-3333-4444-555555555555']);
  });

  it('taglia al tetto dei membri', () => {
    const many = parseRoomAgents(['content', 'ugc', 'motion', 'web', 'analyst']);
    expect(many.length).toBe(ROOM_MAX_MEMBERS);
  });

  it("tiene `auto`: Anomalia è un membro, non uno scarto", () => {
    // `AGENT_IDS` non la contiene (non è un mestiere), ma in stanza è la voce che risponde
    // quando la richiesta non è di nessuno specialista. Prima veniva scartata in silenzio e la
    // stanza [auto, content] si riduceva a un membro, cioè a un thread normale.
    expect(parseRoomAgents(['auto', 'content'])).toEqual(['auto', 'content']);
    expect(isRoomThreadWithFlag(['auto', 'content'])).toBe(true);
  });

  it('degrada a vuoto su null / colonna assente', () => {
    expect(parseRoomAgents(undefined)).toEqual([]);
    expect(parseRoomAgents(null)).toEqual([]);
    expect(parseRoomAgents('motion')).toEqual([]);
  });
});

/** `isRoomThread` con la feature accesa, senza ripetere il salvataggio di env in ogni describe. */
function isRoomThreadWithFlag(keys: string[]): boolean {
  const prev = env.GROUP_CHATS;
  env.GROUP_CHATS = 'true';
  try {
    return isRoomThread({ room_agents: keys });
  } finally {
    env.GROUP_CHATS = prev;
  }
}

describe('isRoomThread', () => {
  const prev = env.GROUP_CHATS;
  beforeEach(() => {
    env.GROUP_CHATS = 'true';
  });
  afterEach(() => {
    env.GROUP_CHATS = prev;
  });

  it('serve la feature accesa', () => {
    env.GROUP_CHATS = 'false';
    expect(isRoomThread({ room_agents: ['motion', 'analyst'] })).toBe(false);
  });

  it('un membro solo non è una stanza', () => {
    expect(isRoomThread({ room_agents: ['motion'] })).toBe(false);
    expect(isRoomThread({})).toBe(false);
    expect(isRoomThread(null)).toBe(false);
  });

  it('due membri validi sì', () => {
    expect(isRoomThread({ room_agents: ['motion', 'analyst'] })).toBe(true);
  });
});

describe('roomRoster', () => {
  // Nessun `custom:` fra le chiavi ⇒ nessuna query: il client non viene mai toccato.
  const noSupabase = null as never;

  it('dà ad Anomalia nome, volto e la riga che il router legge — con agent null', async () => {
    const roster = await roomRoster(noSupabase, 'brand-1', ['auto', 'content'], 'it');
    expect(roster.map((m) => m.key)).toEqual(['auto', 'content']);
    const anomalia = roster[0];
    expect(anomalia.name).toBe('Anomalia');
    // `agent: null` = nessuna specializzazione, tool pieni. È già il significato di Anomalia
    // ovunque a valle (buildSystemPrompt, pickTools): la stanza non impara niente di nuovo.
    expect(anomalia.agent).toBeNull();
    expect(anomalia.customAgentId).toBeNull();
    expect(anomalia.area.length).toBeGreaterThan(10);
    expect(anomalia.face).toBeTruthy();
  });

  it('una stanza di soli specialisti resta identica', async () => {
    const roster = await roomRoster(noSupabase, 'brand-1', ['content', 'motion'], 'it');
    expect(roster.map((m) => m.agent)).toEqual(['content', 'motion']);
  });
});

describe('parseSpeakers', () => {
  it('legge il JSON pulito', () => {
    expect(parseSpeakers('{"speakers":["motion"]}', members)).toEqual(['motion']);
  });

  it('legge il JSON dentro un blocco markdown', () => {
    expect(parseSpeakers('```json\n{"speakers":["analyst","motion"]}\n```', members)).toEqual([
      'analyst',
      'motion'
    ]);
  });

  it('accetta la lista nuda e il nome umano', () => {
    expect(parseSpeakers('["Motion Specialist"]', members)).toEqual(['motion']);
  });

  it('ripiega sulla scansione del testo quando il JSON non c\'è', () => {
    expect(parseSpeakers('parla motion, direi', members)).toEqual(['motion']);
  });

  it('scarta chi non è nella stanza e non supera il tetto delle voci', () => {
    expect(parseSpeakers('{"speakers":["web","motion","analyst"]}', members).length).toBeLessThanOrEqual(
      ROOM_MAX_SPEAKERS
    );
    expect(parseSpeakers('{"speakers":["web"]}', members)).toEqual([]);
  });

  it('silenzio unanime = nessuna voce (il chiamante ripiega sul primo membro)', () => {
    expect(parseSpeakers('{"speakers":[]}', members)).toEqual([]);
  });
});

/**
 * COGNIZIONE DI CAUSA — quello che un agente scelto deve sapere prima di aprire bocca.
 *
 * È l'unico posto che glielo dice: senza, riceve il prompt del suo mestiere e scrive come se
 * fosse una conversazione a due — ripete quello che un altro ha appena detto e non passa mai la
 * palla. Sei cose, e ognuna qui ha la sua riga perché ognuna è un comportamento che si vede da
 * fuori quando manca.
 */
describe('roomSystemBlock', () => {
  const block = () => roomSystemBlock(members, 'motion', 'it');

  it('dice che è una stanza con più agenti E l\'utente, non una chat a due', () => {
    expect(block()).toContain("più agenti e l'utente");
  });

  it('dice chi è LUI, e chi sono gli altri per nome e mestiere', () => {
    expect(block()).toContain('Tu sei **Motion Specialist**');
    // L'altro compare col nome E con la sua area: senza l'area, "passa la palla ad Analyst"
    // resta un ordine senza criterio per capire QUANDO.
    expect(block()).toContain('Analyst (numeri)');
    // E non nomina sé stesso fra "gli altri".
    expect(block().split('Ci sono anche:')[1]).not.toContain('Motion Specialist');
  });

  it('dice che si scrive uno alla volta e che tutti leggono tutto', () => {
    expect(block()).toContain('Tutti leggono tutti i messaggi');
    expect(block()).toContain('UN agente alla volta');
    expect(block()).toContain('non ripetere quello che qualcuno ha già detto');
  });

  it('dice di PASSARE il lavoro di un altro mestiere, non di farlo male', () => {
    expect(block()).toContain("è di un altro mestiere, dillo in una riga e lasciaglielo");
  });

  it('dice che tacere (o rispondere corto) è una risposta legittima', () => {
    expect(block()).toContain('non sei obbligato a intervenire su tutto');
  });

  /**
   * La trappola: questo blocco NON deve rimettere in discussione chi parla. Lo smistamento è già
   * avvenuto (`pickRoomSpeakers`), e un agente che potesse convocarne un altro farebbe rimbalzare
   * la palla fra due specialisti a spese dell'utente. Quindi niente istruzioni su CHI risponde.
   */
  it('non è un secondo instradatore: non dice a chi tocca, dice come comportarsi', () => {
    const b = block();
    expect(b).toContain('per questo è stato scelto te');
    expect(b).not.toMatch(/scegli chi|decidi chi|chiama .*Analyst|convoca/i);
  });

  it('un membro custom compare col SUO nome, non col mestiere sottostante', () => {
    // Un custom agent ristretto a `content` resta "Ghostwriter" per la stanza: il mestiere è
    // sotto (tool e prompt), il nome è quello che l'utente gli ha dato.
    const withCustom: RoomMember[] = [
      members[0],
      {
        key: 'custom:11111111-2222-3333-4444-555555555555',
        agent: 'content',
        customAgentId: '11111111-2222-3333-4444-555555555555',
        name: 'Ghostwriter',
        area: 'scrive le newsletter lunghe',
        face: 'wide',
        color: '#111111'
      }
    ];
    expect(roomSystemBlock(withCustom, 'motion', 'it')).toContain(
      'Ghostwriter (scrive le newsletter lunghe)'
    );
    // E visto dall'altra parte: il custom agent sa di essere Ghostwriter.
    expect(
      roomSystemBlock(withCustom, 'custom:11111111-2222-3333-4444-555555555555', 'it')
    ).toContain('Tu sei **Ghostwriter**');
  });

  it("l'inglese dice le stesse sei cose", () => {
    const en = roomSystemBlock(members, 'motion', 'en');
    expect(en).toContain('several agents and the user');
    expect(en).toContain('You are **Motion Specialist**');
    expect(en).toContain('Everyone reads every message');
    expect(en).toContain('only ONE agent writes at a time');
    expect(en).toContain('leave it to them');
    expect(en).toContain('not obliged to weigh in on everything');
  });

  it('niente blocco se la stanza ha una voce sola', () => {
    expect(roomSystemBlock([members[0]], 'motion')).toBe('');
  });
});


/**
 * DENTRO UNA STANZA NON SI SCRIVE IN PRIVATO A CHI È NELLA STANZA.
 *
 * I consulti `ask_to_*` non esistono più (erano la macchina dell'impersonazione). Resta il DM, e
 * verso un membro della stanza va chiuso per la stessa ragione: chi è qui parla da sé.
 */
describe('stripRoomPeerTools', () => {
  const tools = () => ({
    read_posts: { description: 'leggi' },
    message_agent: {
      description: 'scrivi a un collega',
      execute: async (a: unknown) => ({ sent: (a as { to: string }).to })
    }
  });

  it('scrivere in privato a un membro della stanza viene rifiutato, col motivo', async () => {
    const out = stripRoomPeerTools(tools(), ['auto', 'ugc', 'motion']);
    const dm = out.message_agent as { execute: (a: unknown, o: unknown) => Promise<{ error?: string; sent?: string; hint?: string }> };
    const blocked = await dm.execute({ to: 'ugc', message: 'ciao' }, {});
    expect(blocked.error).toBe('recipient_is_in_this_room');
    // Il motivo dice cosa fare invece, o il modello riprova all'infinito.
    expect(blocked.hint).toContain('speaks for themselves');
  });

  /**
   * IL BUCO CHE IL FAN-OUT HA APERTO, e che si richiude solo guardando TUTTI i destinatari.
   *
   * `to` era una stringa e il controllo faceva `String(args.to)`: da quando prende anche una lista,
   * `['ugc']` diventava la stringa `"ugc"` per fortuna, ma `['analyst','ugc']` diventava
   * `"analyst,ugc"` — che non è in `inRoom`, quindi passava. Bastava mettere il membro della stanza
   * dentro un array insieme a un estraneo per scrivergli in privato mentre gli si sta seduti accanto.
   */
  it('il divieto non si scavalca mettendo il membro in una LISTA insieme a un estraneo', async () => {
    const out = stripRoomPeerTools(tools(), ['auto', 'ugc', 'motion']);
    const dm = out.message_agent as { execute: (a: unknown, o: unknown) => Promise<{ error?: string; sent?: unknown; hint?: string }> };
    const blocked = await dm.execute({ to: ['analyst', 'ugc'], message: 'ciao' }, {});
    expect(blocked.error).toBe('recipient_is_in_this_room');
    // E il motivo nomina CHI era di troppo, non la lista intera: il fan-out va corretto, non buttato.
    expect(blocked.hint).toContain('ugc');
    expect(blocked.hint).not.toContain('analyst');
  });

  it('una lista di soli estranei passa: il fan-out fuori dalla stanza resta legittimo', async () => {
    const out = stripRoomPeerTools(tools(), ['auto', 'ugc', 'motion']);
    const dm = out.message_agent as { execute: (a: unknown, o: unknown) => Promise<{ sent?: unknown }> };
    expect((await dm.execute({ to: ['analyst', 'web'], message: 'ciao' }, {})).sent).toEqual(['analyst', 'web']);
  });

  it('verso chi NON è nella stanza il DM passa: è ancora un caso legittimo', async () => {
    const out = stripRoomPeerTools(tools(), ['auto', 'ugc', 'motion']);
    const dm = out.message_agent as { execute: (a: unknown, o: unknown) => Promise<{ sent?: string }> };
    expect((await dm.execute({ to: 'analyst', message: 'ciao' }, {})).sent).toBe('analyst');
  });

  it('la descrizione nomina i membri, così il modello non ci prova nemmeno', () => {
    const out = stripRoomPeerTools(tools(), ['auto', 'ugc', 'motion']);
    expect((out.message_agent as { description: string }).description).toContain('NOT for the agents in this room');
  });

  it('fuori da una stanza non cambia NIENTE: l’oggetto torna com’era', () => {
    const t = tools();
    expect(stripRoomPeerTools(t, ['motion'])).toBe(t);
  });
});

/** La metà mancante: la voce di un membro presente appartiene solo a lui. */
describe('la voce non si prende in prestito', () => {
  it('il blocco vieta di scrivere a nome di un altro, e permette di CITARE chi ha già parlato', () => {
    const it_ = roomSystemBlock(members, 'motion', 'it');
    expect(it_).toContain('LA TUA VOCE È TUA');
    expect(it_).toContain('Non scrivere MAI parole nuove a nome suo');
    expect(it_).toContain('attribuendoglielo');
    const en = roomSystemBlock(members, 'motion', 'en');
    expect(en).toContain('YOUR VOICE IS YOURS');
    expect(en).toContain('NEVER write new words in their name');
  });
});
