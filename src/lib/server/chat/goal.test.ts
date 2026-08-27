import { describe, expect, it } from 'vitest';
import {
  applyCriteriaUpdate,
  declaredClosures,
  leftATrace,
  PROSE_CLOSE_NOTE,
  proseClosedCount,
  refusedToolNames,
  succeededToolNames,
  toolsNamedBy,
  unprovenCriteria,
  criteriaClosedBetween,
  decideGoalContinuation,
  goalBriefing,
  goalContinuationPrompt,
  goalIsMet,
  goalProgress,
  goalTurnNotice,
  closedSince,
  NOTICE_MAX_NAMED_CLOSED,
  goalWorthyRequest,
  nextCriterionId,
  normalizeGoalCriteria,
  openCriteria,
  type ChatGoal,
  type GoalCriterion
} from './goal';

const crit = (id: string, text: string, status: GoalCriterion['status'] = 'open'): GoalCriterion => ({
  id,
  text,
  status,
  note: null
});

const goalWith = (criteria: GoalCriterion[], laps = 0): ChatGoal => ({
  id: 'g1',
  brand_id: 'b1',
  thread_id: 't1',
  statement: 'Tutti i post di settembre approvati',
  criteria,
  status: 'open',
  laps,
  source: 'agent',
  closing_note: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
});

describe('normalizeGoalCriteria', () => {
  it('numera, ripulisce e scarta le righe vuote', () => {
    const out = normalizeGoalCriteria(['  primo  ', '', '   ', 'secondo']);
    expect(out.map((c) => [c.id, c.text, c.status])).toEqual([
      ['c1', 'primo', 'open'],
      ['c2', 'secondo', 'open']
    ]);
  });

  it('non duplica un criterio che esiste già, comunque scritto', () => {
    const existing = [crit('c1', 'Coprire tutti i post', 'done')];
    const out = normalizeGoalCriteria(['  coprire TUTTI i post ', 'nuovo'], existing);
    expect(out).toHaveLength(2);
    // e soprattutto: quello già chiuso non torna aperto
    expect(out[0]?.status).toBe('done');
    expect(out[1]?.id).toBe('c2');
  });

  it('taglia al tetto invece di accettare un piano di progetto', () => {
    const out = normalizeGoalCriteria(Array.from({ length: 20 }, (_, i) => `criterio ${i}`));
    expect(out).toHaveLength(8);
  });

  it('non riusa un id già speso quando si aggiunge dopo una cancellazione', () => {
    expect(nextCriterionId([crit('c1', 'a'), crit('c5', 'b')])).toBe('c6');
  });
});

describe('applyCriteriaUpdate', () => {
  const base = [crit('c1', 'primo'), crit('c2', 'secondo'), crit('c3', 'terzo')];

  it('chiude per id e per testo esatto', () => {
    const r = applyCriteriaUpdate(base, { done: ['c1', 'secondo'] });
    expect(r.closed).toBe(2);
    expect(r.criteria.filter((c) => c.status === 'done').map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('richiudere un criterio già chiuso non conta come avanzamento', () => {
    const once = applyCriteriaUpdate(base, { done: ['c1'] });
    const twice = applyCriteriaUpdate(once.criteria, { done: ['c1'] });
    expect(twice.closed).toBe(0);
  });

  it('un riferimento che non esiste torna indietro invece di sparire', () => {
    const r = applyCriteriaUpdate(base, { done: ['c9'] });
    expect(r.unknown).toEqual(['c9']);
    expect(openCriteria(r.criteria)).toHaveLength(3);
  });

  it('buttare un criterio lo toglie dal conto senza fingere che sia fatto', () => {
    const r = applyCriteriaUpdate(base, { drop: ['c3'], note: 'la pagina non esiste più' });
    expect(r.criteria[2]?.status).toBe('dropped');
    expect(r.criteria[2]?.note).toBe('la pagina non esiste più');
    expect(goalProgress(r.criteria)).toEqual({ done: 0, open: 2, total: 2 });
  });

  it('aggiunge in coda con un id nuovo', () => {
    const r = applyCriteriaUpdate(base, { add: ['quarto'] });
    expect(r.criteria.at(-1)).toMatchObject({ id: 'c4', text: 'quarto', status: 'open' });
  });
});

describe('goalIsMet', () => {
  it('è raggiunto solo quando nessun criterio è aperto', () => {
    expect(goalIsMet([crit('c1', 'a', 'done'), crit('c2', 'b', 'dropped')])).toBe(true);
    expect(goalIsMet([crit('c1', 'a', 'done'), crit('c2', 'b')])).toBe(false);
  });

  it('un obiettivo senza criteri non è raggiungibile', () => {
    expect(goalIsMet([])).toBe(false);
  });
});

describe('criteriaClosedBetween', () => {
  it('conta solo i criteri che si sono chiusi in questo turno', () => {
    const before = [crit('c1', 'a', 'done'), crit('c2', 'b'), crit('c3', 'c')];
    const after = [crit('c1', 'a', 'done'), crit('c2', 'b', 'done'), crit('c3', 'c')];
    expect(criteriaClosedBetween(before, after)).toBe(1);
  });

  it('un criterio nato e chiuso dentro lo stesso turno è avanzamento', () => {
    expect(criteriaClosedBetween([], [crit('c1', 'a', 'done')])).toBe(1);
  });

  it('senza obiettivo di partenza non inventa avanzamenti', () => {
    expect(criteriaClosedBetween(null, [crit('c1', 'a')])).toBe(0);
  });
});

describe('goalWorthyRequest', () => {
  it('riconosce un lavoro a lotti', () => {
    expect(goalWorthyRequest('Sistema tutti gli articoli del blog senza copertina, per favore')).toBe(true);
    expect(goalWorthyRequest('produci la settimana di contenuti per il lancio di ottobre')).toBe(true);
    expect(goalWorthyRequest('fix all the drafts that are missing a caption please')).toBe(true);
  });

  it('lascia in pace una domanda', () => {
    expect(goalWorthyRequest('come è andato il post di ieri?')).toBe(false);
    expect(goalWorthyRequest('ciao')).toBe(false);
    // troppo corto per essere un incarico, anche se contiene una parola da incarico
    expect(goalWorthyRequest('sistema')).toBe(false);
  });
});

describe('decideGoalContinuation', () => {
  const base = {
    closedThisTurn: 1,
    timeRanOut: false,
    loopStalled: false,
    aborted: false,
    failed: false,
    depth: 0,
    maxDepth: 9
  };

  // 25/8: un obiettivo aperto non rilancia piu' l'agente da solo. E' la ragione per DIRLO alla
  // persona, non per ripartire senza che l'abbia chiesto — spendendo modello e credito mentre
  // guarda una card che si aggiorna da se'. Il lavoro non si perde: riparte col prossimo messaggio,
  // dove il prompt dell'obiettivo torna comunque in cima.
  it('criteri aperti: si ferma e torna alla persona, non riparte', () => {
    const d = decideGoalContinuation({ ...base, goal: goalWith([crit('c1', 'a', 'done'), crit('c2', 'b')]) });
    expect(d).toEqual({ continue: false, reason: 'open_criteria', handBack: true });
  });

  it('si ferma quando l’obiettivo è raggiunto', () => {
    const d = decideGoalContinuation({ ...base, goal: goalWith([crit('c1', 'a', 'done')]) });
    expect(d.continue).toBe(false);
    expect(d.reason).toBe('met');
  });

  it('non riprende mai dopo uno Stop dell’utente o uno stream morto', () => {
    const goal = goalWith([crit('c1', 'a')]);
    expect(decideGoalContinuation({ ...base, goal, aborted: true }).continue).toBe(false);
    expect(decideGoalContinuation({ ...base, goal, failed: true }).continue).toBe(false);
  });

  it('non riprende dentro un loop, ma restituisce il lavoro alla persona', () => {
    const d = decideGoalContinuation({ ...base, goal: goalWith([crit('c1', 'a')]), loopStalled: true });
    expect(d).toEqual({ continue: false, reason: 'stalled', handBack: true });
  });

  it('il tempo scaduto riprende anche senza obiettivo: è il comportamento che c’era già', () => {
    const d = decideGoalContinuation({ ...base, goal: null, timeRanOut: true });
    expect(d).toEqual({ continue: true, reason: 'out_of_time', handBack: false });
  });

  it('senza obiettivo e senza tempo scaduto non succede niente', () => {
    expect(decideGoalContinuation({ ...base, goal: null }).reason).toBe('no_goal');
  });

  it('un giro a vuoto non si riprova piu\': era il caso che spendeva senza avanzare', () => {
    const primo = goalWith([crit('c1', 'a')], 0);
    expect(decideGoalContinuation({ ...base, goal: primo, closedThisTurn: 0 }).continue).toBe(false);

    const secondo = goalWith([crit('c1', 'a')], 1);
    expect(decideGoalContinuation({ ...base, goal: secondo, closedThisTurn: 0 }).continue).toBe(false);
  });

  it('il giro a vuoto che ha chiuso qualcosa non è un giro a vuoto', () => {
    const goal = goalWith([crit('c1', 'a', 'done'), crit('c2', 'b')], 2);
    expect(decideGoalContinuation({ ...base, goal, closedThisTurn: 1 }).reason).toBe('open_criteria');
  });

  it('una domanda vera all’utente batte anche la ripresa del giro a vuoto', () => {
    const goal = goalWith([crit('c1', 'a')], 1);
    const d = decideGoalContinuation({ ...base, goal, closedThisTurn: 0, awaitingAnswer: true });
    expect(d).toEqual({ continue: false, reason: 'awaiting_answer', handBack: false });
  });

  it('un obiettivo dettato e mai scomposto non fa ripartire niente', () => {
    // Riprendere significherebbe rilanciare la stessa istruzione che il turno ha appena ignorato.
    const d = decideGoalContinuation({ ...base, goal: goalWith([]) });
    expect(d).toEqual({ continue: false, reason: 'no_criteria', handBack: false });
  });

  // I giri non si contano piu': non se ne fa nessuno. La ragione resta `open_criteria`.
  it('nessun giro, con qualunque conteggio alle spalle', () => {
    const d = decideGoalContinuation({ ...base, goal: goalWith([crit('c1', 'a')], 4) });
    expect(d).toEqual({ continue: false, reason: 'open_criteria', handBack: true });
  });

  it('il tetto della catena vince su tutto il resto', () => {
    const d = decideGoalContinuation({
      ...base,
      goal: goalWith([crit('c1', 'a')]),
      timeRanOut: true,
      depth: 9,
      maxDepth: 9
    });
    expect(d.continue).toBe(false);
    expect(d.reason).toBe('depth_exhausted');
  });
});

describe('closedSince', () => {
  it('dà i criteri passati da aperti a non-aperti, e criteriaClosedBetween li conta', () => {
    const before = [crit('c1', 'a'), crit('c2', 'b', 'done'), crit('c3', 'c')];
    const after = [crit('c1', 'a', 'done'), crit('c2', 'b', 'done'), crit('c3', 'c', 'dropped')];
    expect(closedSince(before, after).map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(criteriaClosedBetween(before, after)).toBe(2);
    // Un criterio nato E chiuso nello stesso turno è avanzamento, e va nominato come gli altri.
    expect(closedSince([], [crit('c9', 'nuovo', 'done')]).map((c) => c.id)).toEqual(['c9']);
  });
});

describe('declaredClosures — raccontare non è fare', () => {
  // Il caso vero (thread 630fca9f, 22/08): «c1 chiuso… c2 chiuso… c3 aperto…», e sotto `0/5`.
  const criteria = [
    crit('c1', 'Referenza studiata'),
    crit('c2', 'UI reale catturata'),
    crit('c3', 'Composizione TSX')
  ];

  it('pesca i criteri dati per chiusi a parole, e solo quelli', () => {
    const text =
      '**Obiettivo in corso.**\n\nc1 chiuso: referenza studiata.\nc2 chiuso: UI catturata.\nc3 aperto: composizione TSX.';
    expect(declaredClosures(text, criteria)).toEqual(['c1', 'c2']);
  });

  it('non si fa ingannare da un criterio descritto come aperto', () => {
    expect(declaredClosures('c3 aperto: MP4 renderizzato + review QC', criteria)).toEqual([]);
  });

  it('en, e senza doppioni', () => {
    expect(declaredClosures('c1 done. c1 done again. c2: closed', criteria)).toEqual(['c1', 'c2']);
  });

  it('ignora chi è già chiuso e chi non esiste', () => {
    const half = [crit('c1', 'a', 'done'), crit('c2', 'b')];
    expect(declaredClosures('c1 fatto, c2 fatto, c9 fatto', half)).toEqual(['c2']);
  });

  it('un testo senza id non chiude niente per associazione', () => {
    expect(declaredClosures('Fatto. Ho riscritto tutto e renderizzato il video.', criteria)).toEqual([]);
  });
});

describe('goalTurnNotice', () => {
  const open = goalWith([crit('c1', 'a', 'done'), crit('c2', 'coprire le pagine')]);

  it('promette il background solo se la ripresa è davvero in coda', () => {
    const decision = { continue: true, reason: 'open_criteria' as const, handBack: false };
    expect(goalTurnNotice(open, decision, 'it', true)).toContain('Riprendo in background');
    expect(goalTurnNotice(open, decision, 'it', false)).toContain('prossimo messaggio');
  });

  it('dice cosa manca, non solo che manca qualcosa', () => {
    const decision = { continue: false, reason: 'no_progress' as const, handBack: true };
    const line = goalTurnNotice(open, decision, 'it');
    expect(line).toContain('coprire le pagine');
    expect(line).toContain('1/2');
  });

  it('la ripresa dopo un giro a vuoto usa la riga di sempre: «riprovo» non deve sembrare «mi fermo»', () => {
    const line = goalTurnNotice(open, { continue: true, reason: 'no_progress_retry', handBack: false }, 'it', true);
    expect(line).toContain('Riprendo in background');
    expect(line).not.toContain('fermo');
  });

  it('nomina i criteri chiusi in QUESTO turno, non tutti quelli fatti finora', () => {
    const decision = { continue: true, reason: 'open_criteria' as const, handBack: false };
    const line = goalTurnNotice(open, decision, 'it', true, [crit('c1', 'referenza studiata', 'done')]);
    expect(line).toContain('(appena chiuso: referenza studiata)');
    expect(line).toContain('1/2');
    // en, e il plurale italiano
    expect(goalTurnNotice(open, decision, 'en', true, [crit('c1', 'a', 'done')])).toContain(
      '(just closed: a)'
    );
    expect(
      goalTurnNotice(open, decision, 'it', true, [crit('c1', 'a', 'done'), crit('c2', 'b', 'done')])
    ).toContain('(appena chiusi: a; b)');
  });

  it('senza chiusure in questo turno la riga è identica a prima — è il caso più frequente', () => {
    const decision = { continue: true, reason: 'open_criteria' as const, handBack: false };
    expect(goalTurnNotice(open, decision, 'it', true, [])).toBe(
      goalTurnNotice(open, decision, 'it', true)
    );
    expect(goalTurnNotice(open, decision, 'it', true)).not.toContain('appena');
  });

  it('oltre il tetto non ne nomina nessuno: un elenco troncato sembrerebbe completo', () => {
    const many = Array.from({ length: NOTICE_MAX_NAMED_CLOSED + 1 }, (_, i) =>
      crit(`c${i}`, `criterio ${i}`, 'done')
    );
    const line = goalTurnNotice(open, { continue: true, reason: 'open_criteria', handBack: false }, 'it', true, many);
    expect(line).not.toContain('appena chiusi');
    expect(line).toContain('1/2');
  });

  it('la riga di resa nomina anche lei, con la motivazione che resta staccata', () => {
    const line = goalTurnNotice(
      open,
      { continue: false, reason: 'laps_exhausted', handBack: true },
      'en',
      false,
      [crit('c1', 'a', 'done')]
    );
    expect(line).toContain('1/2 (just closed: a) — I used every automatic pass.');
  });

  it('tace quando il tempo scaduto ha già la sua riga', () => {
    expect(goalTurnNotice(open, { continue: true, reason: 'out_of_time', handBack: false }, 'it')).toBeNull();
  });

  it('tace quando non c’è nessun obiettivo', () => {
    expect(goalTurnNotice(null, { continue: false, reason: 'no_goal', handBack: false }, 'it')).toBeNull();
  });
});

describe('goalBriefing', () => {
  it('un obiettivo dell’utente senza criteri chiede una cosa sola: scomporlo, subito', () => {
    const brief = goalBriefing({ ...goalWith([]), source: 'user' }, 'it');
    expect(brief).toContain('set_goal');
    expect(brief).toContain('non ancora scomposto');
  });

  it('dice che chiudere è una chiamata e che dentro un obiettivo non si chiede il permesso', () => {
    const brief = goalBriefing(goalWith([crit('c1', 'a')]), 'it');
    expect(brief).toContain("CHIUDERE È UNA CHIAMATA");
    expect(brief).toContain('NON CHIEDI IL PERMESSO');
    expect(brief).toContain('ask_user_questions');
    const en = goalBriefing(goalWith([crit('c1', 'a')]), 'en');
    expect(en).toContain('CLOSING IS A CALL');
    expect(en).toContain('DO NOT ASK PERMISSION');
  });

  it('dice di buttare i criteri che sono standard di mestiere e non richieste', () => {
    const it1 = goalBriefing(goalWith([crit('c1', 'a')]), 'it');
    expect(it1).toContain('standard del tuo mestiere');
    expect(it1).toContain('richiesta completamente diversa');
    expect(goalBriefing(goalWith([crit('c1', 'a')]), 'en')).toContain('a completely different request');
  });

  it('con i criteri, li elenca con il loro stato e vieta di dichiarare finito', () => {
    const brief = goalBriefing(goalWith([crit('c1', 'copertine', 'done'), crit('c2', 'bozze')]), 'it');
    expect(brief).toContain('[x] c1: copertine');
    expect(brief).toContain('[ ] c2: bozze');
    expect(brief).toContain('close_goal');
  });
});

describe('goalContinuationPrompt', () => {
  it('il giro a vuoto riparte sapendo perché: marcare, non chiedere, non aspettare un giudizio', () => {
    const p = goalContinuationPrompt(goalWith([crit('c1', 'a')], 1), 'it', { emptyLap: true });
    expect(p).toContain('NON HA CHIUSO NIENTE');
    expect(p).toContain('update_goal');
    expect(p).toContain('permesso');
    // Senza il flag resta la ripresa normale: nessun rimprovero a chi stava avanzando.
    expect(goalContinuationPrompt(goalWith([crit('c1', 'a')], 1), 'it')).not.toContain(
      'NON HA CHIUSO NIENTE'
    );
  });

  it('ripete i criteri aperti, così la ripresa non ricomincia dal primo', () => {
    const p = goalContinuationPrompt(
      goalWith([crit('c1', 'fatto', 'done'), crit('c2', 'copertine mancanti')]),
      'it'
    );
    expect(p).toContain('copertine mancanti');
    expect(p).not.toContain('c1: fatto');
  });
});


describe('succeededToolNames — un tool chiamato non è un tool riuscito', () => {
  // Il turno vero (thread e61c5136, 22/08, 20:04): due scritture, due errori, e il testo che
  // annuncia «(c1 closed)». Prima contava la CHIAMATA, e c1 si chiudeva su un lavoro inesistente.
  const failedTurn = [
    {
      toolCalls: [
        { toolName: 'create_motion_video', toolCallId: 'a' },
        { toolName: 'write_motion_source', toolCallId: 'b' }
      ],
      toolResults: [
        { toolCallId: 'a', output: { error: 'Import not allowed: "./motion-trailer-1x1"' } },
        { toolCallId: 'b', output: { error: 'Import not allowed: "./motion-trailer-1x1"' } }
      ]
    }
  ];

  it('un turno di soli errori non ha lavorato', () => {
    expect(succeededToolNames(failedTurn)).toEqual([]);
  });

  it('conta chi è tornato senza error, e salta i tool dell obiettivo', () => {
    const steps = [
      {
        toolCalls: [
          { toolName: 'set_goal', toolCallId: 'g' },
          { toolName: 'render_motion_video', toolCallId: 'r' }
        ],
        toolResults: [
          { toolCallId: 'g', output: { success: true } },
          { toolCallId: 'r', output: { video_id: 'x', preview_url: 'https://…' } }
        ]
      }
    ];
    expect(succeededToolNames(steps, ['set_goal', 'update_goal', 'close_goal'])).toEqual([
      'render_motion_video'
    ]);
  });

  it('legge anche l output incartato dall SDK, e una chiamata senza risultato non conta', () => {
    const steps = [
      {
        toolCalls: [{ toolName: 'read_file', toolCallId: 'r' }, { toolName: 'generate_voiceover', toolCallId: 'v' }],
        toolResults: [{ toolCallId: 'r', output: { type: 'json', value: { content: 'ciao' } } }]
      }
    ];
    expect(succeededToolNames(steps)).toEqual(['read_file']);
  });
});

describe('unprovenCriteria — trovato non è fatto', () => {
  const known = ['render_motion_video', 'list_motion_videos', 'create_motion_video'];
  const c2 = crit('c2', 'MP4 rendered via render_motion_video and shown to the user');

  it('il criterio nomina il tool: senza quel tool riuscito non si chiude', () => {
    // Ciò che il turno aveva fatto davvero: LEGGERE la gallery, e da lì copiare un mp4 di sei ore prima.
    expect(unprovenCriteria([c2], new Set(['list_motion_videos']), known).map((c) => c.id)).toEqual(['c2']);
  });

  it('con il tool nominato davvero riuscito, il criterio passa', () => {
    expect(unprovenCriteria([c2], new Set(['render_motion_video']), known)).toEqual([]);
  });

  it('un criterio che non nomina nessun tool non è toccato: qui non si indovina', () => {
    const c1 = crit('c1', 'Composition 1080x1080 exists in the motion gallery');
    expect(unprovenCriteria([c1], new Set(), known)).toEqual([]);
  });

  it('toolsNamedBy vede solo i tool veri, non ogni snake_case', () => {
    expect(toolsNamedBy('il file motion_trailer_1x1.tsx esiste', known)).toEqual([]);
    expect(toolsNamedBy('MP4 rendered via render_motion_video', known)).toEqual(['render_motion_video']);
  });
});


describe('leftATrace / refusedToolNames — spuntare in un giro che non ha prodotto', () => {
  it('un giro di sole letture non ha lasciato traccia', () => {
    expect(leftATrace(['read_file', 'list_motion_videos', 'grep_motion_source', 'study_motion_reference'])).toBe(false);
    expect(leftATrace(['read_file', 'create_motion_video'])).toBe(true);
    expect(leftATrace([])).toBe(false);
  });

  // Sul motore kit il verbo sta DOPO il prefisso del mestiere: con l'ancora in testa un turno che
  // aveva solo letto l'albero del brand e interrogato il database contava come lavoro fatto, e
  // bastava a far passare la chiusura di un criterio che nessuno aveva prodotto.
  it('vale anche sui nomi del kit, dove il verbo non è in testa', () => {
    expect(leftATrace(['brand_read', 'brand_ls', 'brand_grep', 'query', 'content_list_posts', 'web_read_seo_audit', 'ugc_check_video'])).toBe(false);
    expect(leftATrace(['brand_read', 'content_create_post'])).toBe(true);
    expect(leftATrace(['query', 'motion_render'])).toBe(true);
    expect(leftATrace(['brand_read', 'brand_write'])).toBe(true);
  });

  // Il caso vero (22/08 21:13:39): render rifiutato con `retry`, e nello stesso turno update_goal
  // chiude «Finished MP4 is rendered and attached to the gallery» — un criterio che non nomina
  // nessuno strumento, quindi invisibile a unprovenCriteria.
  const turn = [
    {
      toolCalls: [
        { toolName: 'render_motion_video', toolCallId: 'r' },
        { toolName: 'read_file', toolCallId: 'f' }
      ],
      toolResults: [
        { toolCallId: 'r', output: { retry: 'storyboard_first', scenes: 2 } },
        { toolCallId: 'f', output: { error: 'db timeout' } }
      ]
    }
  ];

  it('nomina il rifiuto vero e ignora le letture andate male', () => {
    expect(refusedToolNames(turn, ['set_goal', 'update_goal', 'close_goal'])).toEqual(['render_motion_video']);
  });

  it('un tool rifiutato e poi riuscito nello stesso turno non conta come rifiuto', () => {
    const recovered = [
      ...turn,
      {
        toolCalls: [{ toolName: 'render_motion_video', toolCallId: 'r2' }],
        toolResults: [{ toolCallId: 'r2', output: { url: 'https://x/y.mp4' } }]
      }
    ];
    expect(refusedToolNames(recovered)).toEqual([]);
  });
});


/**
 * LA FRASE DEL SISTEMA SPACCIATA PER QUELLA DELL'AGENTE.
 *
 * Il goal `a83b45eb` (22/08 21:45) si è chiuso `met` con «Closed automatically: every criterion was
 * met» — che l'agente non ha mai scritto. Due dei quattro criteri venivano dalla scorciatoia della
 * prosa. `close_goal` una `summary` a mano la chiede già; questa strada non passa da lì.
 */
describe('proseClosedCount — quante spunte vengono dal testo e non da uno strumento', () => {
  it('riconosce la nota che scrive settleGoalForTurn, in entrambe le lingue', () => {
    const criteria = [
      { ...crit('c1', 'a', 'done'), note: 'Gallery composition c6165abb has 5 beats.' },
      { ...crit('c2', 'b', 'done'), note: PROSE_CLOSE_NOTE.en },
      { ...crit('c3', 'c', 'done'), note: PROSE_CLOSE_NOTE.it },
      crit('c4', 'd', 'done')
    ];
    expect(proseClosedCount(criteria)).toBe(2);
  });

  it('un obiettivo chiuso tutto da chiamate vere non ha niente da segnalare', () => {
    expect(proseClosedCount([{ ...crit('c1', 'a', 'done'), note: 'render ok' }])).toBe(0);
  });
});
