/**
 * `/goal` — il comando con cui la PERSONA detta l'obiettivo, invece di lasciarlo derivare all'agente.
 *
 * La modalità obiettivo nasce automatica (l'agente se lo dà da solo davanti a un lavoro lungo), e
 * resta la strada principale. Questo comando serve al caso opposto e altrettanto reale: quando è
 * l'utente ad avere in testa la definizione di "fatto" — *l'obiettivo è che entro venerdì ci siano
 * dodici post approvati* — e non vuole scoprire a fine turno che l'agente ne aveva scritta un'altra.
 *
 * Il parsing sta qui, in un file condiviso e senza dipendenze, perché lo devono fare in due:
 *
 * - il **client**, per intercettare le due forme che non meritano un turno di modello (mostrare
 *   l'obiettivo, chiuderlo) e risolverle sul posto;
 * - il **server**, perché un comando è tale solo se vale ovunque — dalla chat del browser, dalla
 *   CLI, da un incarico ricorrente. Una regola che vive solo nel client è una regola che sparisce
 *   appena il messaggio arriva da un'altra parte.
 */
export type GoalCommand =
  /** `/goal <testo>` — apre (o riformula) l'obiettivo della conversazione. */
  | { kind: 'set'; statement: string }
  /** `/goal stop` — lo chiude e ferma le riprese automatiche. */
  | { kind: 'stop' }
  /** `/goal` da solo — fammi vedere a che punto è. */
  | { kind: 'show' };

/** Come si scrive il comando. Due lingue, perché la chat è bilingue e nessuno traduce uno slash. */
export const GOAL_COMMAND_ALIASES = ['/goal', '/obiettivo'] as const;

/** Le parole che chiudono l'obiettivo invece di diventarne il testo. */
const STOP_WORDS = new Set([
  'stop',
  'off',
  'clear',
  'cancel',
  'annulla',
  'chiudi',
  'ferma',
  'reset',
  'basta'
]);

/** Un obiettivo dettato è una frase, non un documento: oltre, il testo si tronca. */
export const MAX_GOAL_STATEMENT = 500;

/**
 * Riconosce il comando, o `null` se il messaggio è un messaggio normale.
 *
 * Prudente per costruzione: deve esserci lo slash in testa e l'alias deve finire lì o su uno
 * spazio, così `/goalkeeper` resta una parola e non diventa un obiettivo chiamato "keeper".
 */
export function parseGoalCommand(text: string | null | undefined): GoalCommand | null {
  const raw = String(text ?? '').trim();
  if (!raw.startsWith('/')) return null;

  const lower = raw.toLowerCase();
  const alias = GOAL_COMMAND_ALIASES.find(
    (a) => lower === a || lower.startsWith(`${a} `) || lower.startsWith(`${a}\n`)
  );
  if (!alias) return null;

  const rest = raw.slice(alias.length).trim();
  if (!rest) return { kind: 'show' };
  if (STOP_WORDS.has(rest.toLowerCase())) return { kind: 'stop' };
  return { kind: 'set', statement: rest.slice(0, MAX_GOAL_STATEMENT) };
}

/**
 * Cosa legge il MODELLO quando l'utente ha dettato un obiettivo.
 *
 * Il messaggio resta nella conversazione come l'utente l'ha scritto — è quello che ha scritto — ma
 * al modello non serve interpretare uno slash: gli serve sapere che l'obiettivo è già suo, che deve
 * scomporlo in criteri verificabili e che deve iniziare, non chiedere conferma.
 */
export function goalCommandInstruction(cmd: GoalCommand, locale: string): string {
  const en = locale === 'en';
  if (cmd.kind === 'set') {
    return en
      ? [
          `The user has set the goal of this conversation, in their own words: «${cmd.statement}»`,
          'Your FIRST action is set_goal with exactly that statement and the verifiable criteria you derive from it — facts about the real state, checkable one by one, not steps of your process.',
          'Then start on the first criterion and close each one with update_goal as it becomes true. Do not ask for permission and do not ask them to reword it: if something is genuinely ambiguous, pick the reading you can defend, say which one in one line, and go.'
        ].join('\n')
      : [
          `L'utente ha dettato l'obiettivo di questa conversazione, con parole sue: «${cmd.statement}»`,
          'La tua PRIMA azione è set_goal con esattamente quella frase e i criteri verificabili che ne derivi — fatti sullo stato reale, controllabili uno per uno, non passi del tuo processo.',
          "Poi parti dal primo criterio e chiudili con update_goal mano a mano che diventano veri. Non chiedere il permesso e non chiedere di riformulare: se qualcosa è davvero ambiguo, scegli la lettura che sai difendere, dilla in una riga e vai."
        ].join('\n');
  }
  if (cmd.kind === 'stop') {
    return en
      ? 'The user closed the goal of this conversation. It is gone: no criteria, no automatic resumes. Confirm in one line and stop there.'
      : "L'utente ha chiuso l'obiettivo di questa conversazione. Non c'è più: niente criteri, niente riprese automatiche. Conferma in una riga e fermati lì.";
  }
  return en
    ? 'The user asked where the goal stands. Answer in one short line: the goal, how many criteria are closed, and which one you are on. Nothing else, no tools.'
    : "L'utente ha chiesto a che punto è l'obiettivo. Rispondi in una riga: l'obiettivo, quanti criteri sono chiusi e a quale stai lavorando. Nient'altro, nessun tool.";
}
