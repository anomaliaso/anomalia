import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideGoalContinuation } from './goal';
import { UNATTENDED_TOOL_EXCLUSIONS } from './unattended';

/**
 * LA DOMANDA ALL'UTENTE FERMA IL TURNO — e deve fermarlo per costruzione, non per buona volontà
 * del modello.
 *
 * Il bug che questi test rendono impossibile: `ask_user_questions` chiamato, la card disegnata, e
 * il modello che tira dritto nello stesso turno rispondendosi da solo alla domanda appena fatta.
 * Era solo una riga di prompt ("wait for their reply"); ora è `hasToolCall` in `stopWhen` — lo
 * step della domanda è l'ultimo — più il divieto di ripresa automatica a fine turno.
 *
 * Il cablaggio si verifica leggendo il sorgente, come già fa unattended.test.ts: è una riga per
 * motore, la regressione tipica è perderla in un merge o aggiungere un quarto motore che se la
 * dimentica.
 */

/** Ogni motore che monta i tool della chat: se ne nasce un altro, va aggiunto qui. */
const ENGINES = [
  'src/lib/server/chat/queue.ts',
  'src/routes/api/v1/chat/respond/run/+server.ts'
];

describe('ask_user_questions chiude il turno', () => {
  it.each(ENGINES)('%s ferma il loop con hasToolCall in stopWhen', (path) => {
    const src = readFileSync(path, 'utf8');
    const stop = src.indexOf('stopWhen:');
    expect(stop).toBeGreaterThan(-1);
    // Nello stesso blocco stopWhen, non da qualche altra parte nel file.
    const block = src.slice(stop, src.indexOf(']', stop));
    expect(block).toContain("hasToolCall('ask_user_questions')");
    expect(src).toContain("hasToolCall");
    expect(src).toMatch(/import \{[^}]*hasToolCall[^}]*\} from 'ai';/);
  });

  /**
   * Fermare il turno non basta: i due motori che sanno rimettersi in coda da soli lo farebbero
   * comunque (tempo scaduto, criteri aperti) e la ripresa risponderebbe alla domanda al posto
   * dell'utente, con la card ancora sullo schermo.
   */
  it.each([ENGINES[0]])('%s non si auto-continua con una domanda aperta', (path) => {
    const src = readFileSync(path, 'utf8');
    expect(src).toContain("tc.toolName === 'ask_user_questions'");
    const decl = src.indexOf('const awaitingAnswer');
    const should = src.indexOf('const shouldContinue');
    expect(decl).toBeGreaterThan(-1);
    expect(should).toBeGreaterThan(decl);
    expect(src.slice(should, should + 260)).toContain('!awaitingAnswer');
    // E l'obiettivo lo sa: niente giro consumato, niente riga "riprendo in background".
    expect(src).toContain('awaitingAnswer,');
  });

  /**
   * La domanda in PROSA è l'altra metà del difetto: non passa da `ask_user_questions`, quindi
   * `awaitingAnswer` è falso e il turno finisce comunque — solo che finisce senza aver chiuso
   * niente. Il divieto sta nel prompt (nei tre posti), e il recupero nella ripresa informata.
   */
  it.each([ENGINES[0]])('%s passa al goal il testo del turno e se ha lavorato', (path) => {
    const src = readFileSync(path, 'utf8');
    expect(src).toContain('turnText:');
    // E «se ha lavorato» vuol dire il RISULTATO dei tool, non la loro chiamata: vedi goal.ts,
    // succeededToolNames — due `create_motion_video` falliti chiudevano un criterio.
    expect(src).toContain('succeededTools');
    expect(src).toContain('GOAL_TOOL_KEYS');
    expect(src).toContain('knownTools:');
  });

  /**
   * 23/08/2026 — la regola non e` cambiata, e` cambiata la sua CASA: `GOAL_BLOCK` e` uscito dal
   * system prompt (817 token a ogni passo, per dire quasi parola per parola quello che le
   * descrizioni dei tre tool dicevano gia`) e queste due righe sono andate dove vivono le altre.
   * Le definizioni degli strumenti si rispediscono a ogni passo esattamente come il prompt, quindi
   * il modello le legge con la stessa frequenza di prima — con una copia in meno da tenere allineata.
   */
  it("il divieto di chiedere il permesso sta dove l'obiettivo si apre e si chiude", () => {
    const src = readFileSync('src/lib/agent/tools/goal-tools.ts', 'utf8');
    expect(src).toContain('YOU DO NOT ASK PERMISSION TO CARRY ON');
    expect(src).toContain('CLOSING IS A CALL, NOT A LABEL');
    // E non e` rimasta una seconda copia nel prompt: e` da li` che diverge.
    expect(readFileSync('src/lib/server/chat/agents.ts', 'utf8')).not.toContain(
      'YOU DO NOT ASK PERMISSION TO CARRY ON'
    );
  });

  /**
   * E vale ANCHE fuori da un obiettivo: «non deve chiedere alcun permesso, lo deve fare punto e
   * basta». Sta in WORK_ETHIC_BLOCK, cioè nella testa condivisa che entra in tutti e due i tipi di
   * agente e in ogni turno, non solo in quelli con un obiettivo aperto.
   */
  it('il bivio offerto all’utente è vietato nella testa condivisa, non solo in modalità obiettivo', () => {
    const src = readFileSync('src/lib/server/chat/agents.ts', 'utf8');
    const ethic = src.slice(src.indexOf('WORK_ETHIC_BLOCK ='), src.indexOf('ORCHESTRATION_BLOCK ='));
    expect(ethic).toContain('A CHOICE IS NOT A QUESTION');
    expect(ethic).toContain('ask_user_questions');
  });

  /**
   * Da dove nasce un criterio. Un `set_goal` che copia una riga di mestiere («lascia sempre
   * un'idea nel banco») inventa un task che l'utente non ha chiesto e poi ci tiene in ostaggio il
   * lavoro. La guardia è dichiaratamente di prompt — vedi il commento su MAX_GOAL_CRITERIA — e sta
   * dove l'obiettivo nasce: il blocco permanente e la descrizione del tool.
   */
  it('la provenienza di un criterio è scritta dove l’obiettivo nasce', () => {
    const tools = readFileSync('src/lib/agent/tools/goal-tools.ts', 'utf8');
    // Le fonti sono DUE, non zero. La versione precedente diceva «MAI dal tuo mestiere», e
    // contraddiceva la riga READY in cima alle CAPABILITIES di ogni specialista («drafts sitting
    // in pending with caption AND visual», «RENDERED to MP4»): quella riga È uno standard di
    // mestiere, vale per qualunque richiesta di quel mestiere, e sotto la vecchia regola andava
    // scartata — cioè un obiettivo poteva chiudersi su un abbozzo. Adesso è una fonte dichiarata.
    expect(tools).toContain('A CRITERION COMES FROM TWO PLACES AND NO THIRD');
    expect(tools).toContain('READY line');
    // E il metro per tutto il resto torna nell'output del tool, dopo che la lista esiste davvero.
    expect(tools).toContain('completely different request is a standard of your craft');
  });

  it('un turno non presidiato non ha il tool: nessuno risponderebbe', () => {
    expect(UNATTENDED_TOOL_EXCLUSIONS).toContain('ask_user_questions');
  });
});

describe('decideGoalContinuation con una domanda aperta', () => {
  const base = {
    goal: null,
    closedThisTurn: 0,
    timeRanOut: false,
    loopStalled: false,
    aborted: false,
    failed: false,
    depth: 0,
    maxDepth: 9
  };

  it('non riprende, e non è una resa: l’obiettivo resta aperto', () => {
    const d = decideGoalContinuation({ ...base, awaitingAnswer: true });
    expect(d.continue).toBe(false);
    expect(d.reason).toBe('awaiting_answer');
    expect(d.handBack).toBe(false);
  });

  it('batte anche il tempo scaduto, che altrimenti riprenderebbe sempre', () => {
    expect(decideGoalContinuation({ ...base, timeRanOut: true }).continue).toBe(true);
    expect(
      decideGoalContinuation({ ...base, timeRanOut: true, awaitingAnswer: true }).continue
    ).toBe(false);
  });

  it('senza domanda niente cambia', () => {
    expect(decideGoalContinuation({ ...base, awaitingAnswer: false }).reason).toBe('no_goal');
  });
});
