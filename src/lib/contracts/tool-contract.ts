import { tool, type Tool, type ToolExecutionOptions } from 'ai';
import type { z } from 'zod';

/**
 * Contratto di un tool di chat: schema di input, TIPO di risposta e description in
 * un'unica dichiarazione, così i tre non possono più divergere in silenzio.
 *
 * L'audit di oggi ha trovato ~20 casi di deriva description/codice: description che
 * insegnano enum mai usati dal sistema, parametri accettati ma ignorati, campi di
 * risposta promessi e mai prodotti. Il pattern qui:
 *
 * - gli enum citati nel testo si INTERPOLANO dalla stessa costante che usa il codice
 *   (`enumList(POST_CONTENT_TYPES)`), mai riscritti a mano come stringhe;
 * - la costante va dichiarata anche in `enums`, così `contracts.test.ts` verifica che
 *   ogni valore compaia davvero nel testo del tool;
 * - il tipo di risposta è un type param del contratto: `toolFromContract` obbliga
 *   `execute` a produrlo (garanzia a livello di tipi — un campo dichiarato e mai
 *   restituito non compila).
 *
 * Per un tool nuovo: dichiara il contratto in src/lib/contracts/ (vedi post-tools.ts),
 * costruisci il tool con `toolFromContract(contratto, execute)` e aggiungi il contratto
 * alla lista in contracts.test.ts.
 */

/** Ramo d'errore comune a tutti i tool: `{ error }` più eventuale contesto. */
export type ToolFailure = { error: string; [k: string]: unknown };

export type ToolContract<In extends z.ZodType, Out extends Record<string, unknown>> = {
  description: string;
  inputSchema: In;
  /**
   * Gli enum che la description cita, presi dalla STESSA costante usata dal codice.
   * contracts.test.ts fallisce se un valore dichiarato non compare nel testo del tool.
   */
  enums?: Record<string, readonly string[]>;
  /** Phantom per il tipo di risposta — mai valorizzato a runtime. */
  __result?: Out;
};

/**
 * Applicazione parziale dei type param: `defineContract<MioResult>()({ … })` dichiara
 * Out esplicito lasciando inferire lo schema (TS non sa fare le due cose in una chiamata).
 */
export const defineContract =
  <Out extends Record<string, unknown>>() =>
  <In extends z.ZodType>(c: {
    description: string;
    inputSchema: In;
    enums?: Record<string, readonly string[]>;
  }): ToolContract<In, Out> =>
    c;

/**
 * Il punto in cui il contratto vincola l'implementazione: `execute` DEVE restituire il
 * tipo di risposta dichiarato (o un ToolFailure). Un campo promesso dal contratto e
 * assente in execute è un errore di compilazione, non una scoperta dell'utente.
 */
export function toolFromContract<In extends z.ZodType, Out extends Record<string, unknown>>(
  contract: ToolContract<In, Out>,
  execute: (input: z.infer<In>, opts: ToolExecutionOptions<unknown>) => Promise<Out | ToolFailure>
): Tool<z.infer<In>, Out | ToolFailure> {
  // Il cast e' confinato qui: la garanzia sul tipo di risposta e' gia' imposta dalla firma
  // di QUESTA funzione (execute deve produrre Out | ToolFailure); gli overload di tool()
  // dell'SDK non sanno unificare uno ZodType generico, quindi dentro si passa opaco.
  return tool({
    description: contract.description,
    inputSchema: contract.inputSchema,
    execute
  } as never) as Tool<z.infer<In>, Out | ToolFailure>;
}

/** Rende un enum citabile in una description: `"a", "b", "c"` — sempre interpolato, mai a mano. */
export const enumList = (values: readonly string[]) => values.map((v) => `"${v}"`).join(', ');
