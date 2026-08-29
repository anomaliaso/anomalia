/**
 * IL PERIMETRO DEL TURNO NON PRESIDIATO — minimo, non un recinto.
 *
 * Un turno schedulato gira con TUTTO il runtime della chat: la libertà di scelta è il punto. Si
 * tolgono solo i tool il cui SIGNIFICATO richiede una persona nella stanza — una domanda o
 * un'offerta senza nessuno davanti resta appesa e insegna a ignorare il thread; un agente che ne
 * ASSUME un altro è un loop che si riproduce da solo e spende crediti per sempre; lo sticker è un
 * gesto verso chi guarda; l'identità del brand re-skinna tutto ciò che verrà generato dopo, senza
 * che nessun render fallisca.
 *
 * Il confine è il CONSENSO, non la presenza: `propose_custom_agent` resta dentro perché non crea
 * niente — aspetta che una persona confermi. `notify_user` resta dentro perché è l'unico modo che
 * un turno non presidiato ha di raggiungere la persona, e ha già i suoi tetti.
 *
 * Una lista, due consumatori: la coda la applica a ogni `chat_response` con `input_params.scheduled`,
 * quindi agenti di default promossi e agenti custom schedulati. I turni interattivi non passano di
 * qui e non perdono niente.
 */
export const UNATTENDED_TOOL_EXCLUSIONS: readonly string[] = [
  'ask_user_questions',
  'offer_upgrade',
  'create_scheduled_agent',
  // Stessa ragione un giro più in là: un turno notturno che si RISCRIVE il brief da solo si modifica
  // il mandato senza che nessuno lo veda. Spegnere e riaccendere resta permesso: è reversibile.
  'update_scheduled_agent',
  'set_expression',
  // Una stanza si anima solo quando ci scrive una persona: aperta di notte da una routine è un
  // thread vuoto che l'utente trova al mattino senza sapere perché. Il DM notturno resta — quello
  // consegna davvero qualcosa.
  'create_group_chat',
  'update_logo',
  'update_brand_colors',
  'extract_colors'
];

/** Il set di tool di un turno schedulato: tutto meno le esclusioni qui sopra. */
export function stripUnattendedTools<T extends Record<string, unknown>>(tools: T): T {
  const out = { ...tools };
  for (const name of UNATTENDED_TOOL_EXCLUSIONS) delete out[name];
  return out;
}

/** Il catalogo kit parla nomi suoi per lo stesso concetto: la domanda bloccante è `ask_user`. */
export const UNATTENDED_KIT_TOOL_EXCLUSIONS: readonly string[] = ['ask_user'];
