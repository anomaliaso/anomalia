/**
 * I tre tool con cui l'agente si dà un obiettivo, lo spunta e lo chiude.
 *
 * Sono scritti perché li chiami DA SOLO. Non c'è un comando dell'utente che li attiva, e dal
 * 23/8/2026 non c'è nemmeno più un capitolo del system prompt che lo spieghi: `GOAL_BLOCK` erano
 * 3.268 caratteri (817 token) ricopiati a ogni passo per dire, in gran parte, quello che queste
 * tre descrizioni dicevano già. Le regole vivono adesso in UN posto solo — qui, accanto alla cosa
 * che governano, dove non possono divergere — e il motore a fine turno guarda cosa è rimasto
 * aperto. La differenza rispetto a una to-do list che il modello si scrive nel testo è
 * tutta qui: questa lista la legge il codice, e il codice non si convince da solo di aver finito.
 *
 * Il pezzo che fa il lavoro vero è il rifiuto dentro `close_goal`: dichiarare l'obiettivo raggiunto
 * con un criterio ancora aperto non è permesso. Non è una guardia contro la malafede — un modello
 * che chiude in anticipo di solito ci crede — ma contro l'unico modo in cui un agente può
 * consegnare metà lavoro con la faccia di chi ha finito.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { looksLikeAPromise } from '$lib/agent/bridge/verdict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_CRITERION_CHARS,
  MAX_GOAL_CRITERIA,
  closeGoal,
  findCriterion,
  goalProgress,
  leftATrace,
  loadOpenGoal,
  openCriteria,
  setThreadGoal,
  succeededToolNamesFromMessages,
  toolsNamedBy,
  toolsProvenSinceGoal,
  updateGoalCriteria,
  type GoalCriterion
} from '$lib/server/chat/goal';

export const GOAL_TOOL_KEYS = ['set_goal', 'update_goal', 'close_goal'] as const;

/**
 * IL RIFIUTO DENTRO IL CICLO — la forma di `finish` della pagina /motion-video, portata in chat.
 *
 * Lì (`motion-video/agent.ts` ~1064) l'agente chiede di finire e il sistema gli dice di no
 * spiegando cosa non va, con un budget di rifiuti: il turno finisce su un `finish` ACCETTATO, sul
 * tetto dei passi o sulla scadenza. È il motivo per cui quel percorso lavora mezz'ora di fila.
 *
 * In chat quel punto **non esiste** e non si può creare: il ciclo dell'AI SDK continua solo se
 * l'ultimo passo ha prodotto chiamate a strumenti (`node_modules/ai/dist/index.mjs:4879` per
 * generateText, `:7974` per streamText); un passo di solo testo chiude il turno comunque, e
 * `stopWhen` può solo fermare prima, mai prolungare. Un tool `finish` aggiunto qui non
 * cambierebbe niente: il modello che smette di chiamare strumenti smetterebbe anche di chiamare
 * `finish`, e il rifiuto non scatterebbe mai proprio nel caso che deve prendere.
 *
 * Ma un punto in cui il modello DICHIARA di aver finito qualcosa c'è, ed è questo: `update_goal`.
 * Rifiutare qui costa un passo e ha tutto il contesto in mano — la ripresa asincrona, invece,
 * apre un job nuovo che riparte da capo, ed è per questo che tre passaggi hanno prodotto solo
 * altre letture.
 *
 * Stesso budget e stessa ragione della pagina: rifiutare all'infinito brucia il turno senza
 * salvare niente. Esaurito, si registra — e le guardie di fine turno (`refusedToolNames`,
 * `wroteNothing`) restano come rete.
 *
 * Il budget copre anche il falso positivo noto: `opts.messages` è la storia in INGRESSO allo step,
 * quindi un modello che chiama `render_motion_video` e `update_goal` nello STESSO step non ha
 * ancora il risultato del render lì dentro e si prende un rifiuto di troppo. Costa una chiamata, e
 * la successiva vede il risultato e passa.
 */
const MAX_GOAL_REFUSALS = 2;

/** Cosa l'agente vede della lista dopo ogni chiamata: la stessa forma, sempre, così la rilegge. */
function checklist(criteria: { id: string; text: string; status: string; note?: string | null }[]) {
  return criteria.map((c) => ({
    id: c.id,
    text: c.text,
    status: c.status,
    ...(c.note ? { note: c.note } : {})
  }));
}

/**
 * Il rifiuto, o null se la spunta regge. Specifico per criterio, e con l'uscita in bocca.
 *
 * Due prove, in ordine di costo:
 *  1. **Il criterio nomina uno strumento** («MP4 rendered via `render_motion_video`») e quello
 *     strumento non è mai andato a buon fine da quando l'obiettivo è aperto.
 *  2. **In tutto l'obiettivo non è mai riuscita una scrittura**: solo letture. Allora nessuna delle
 *     spunte regge, qualunque cosa dicano — è il caso del 22/08 21:12, dodici chiamate tutte di
 *     lettura e cinque cose «fatte» nel testo.
 *
 * La lettura del passato costa una query e parte SOLO quando il turno da solo non basta: chi
 * renderizza al primo giro e marca al secondo è nel giusto e non deve incontrare questo muro.
 *
 * L'uscita è sempre nominata, perché un rifiuto senza uscita è un ciclo: fai il lavoro e richiamami,
 * oppure `drop` con la ragione. Il prompt lo dice da sempre e non lo pretende mai nessuno.
 */
async function refuseUnbackedClosures(
  supabase: SupabaseClient,
  goal: Parameters<typeof toolsProvenSinceGoal>[1],
  done: string[],
  here: string[] | null
): Promise<Record<string, unknown> | null> {
  // ponytail: FAIL-OPEN senza la lista dei tool del turno. Se non si vede il turno non si rifiuta:
  // un percorso che un giorno non la passasse bloccherebbe OGNI chiusura, cioè un guasto totale al
  // posto di una guardia. Stessa scelta di `hasReadFile` in agent-files.ts.
  if (!here) return null;
  const wanted = done
    .map((ref) => findCriterion(goal.criteria, ref))
    .filter((c): c is GoalCriterion => !!c && c.status === 'open');
  if (!wanted.length) return null;

  const named = wanted.filter((c) => toolsNamedBy(c.text, TOOL_VOCABULARY).length > 0);
  const namedUnbacked = named.filter(
    (c) => !toolsNamedBy(c.text, TOOL_VOCABULARY).some((t) => here.includes(t))
  );
  if (!namedUnbacked.length && leftATrace(here)) return null;

  // Il turno da solo non basta: guarda tutto l'obiettivo prima di dire di no.
  const past = await toolsProvenSinceGoal(supabase, goal).catch(() => [] as string[]);
  const all = [...here, ...past];
  const stillUnbacked = namedUnbacked.filter(
    (c) => !toolsNamedBy(c.text, TOOL_VOCABULARY).some((t) => all.includes(t))
  );
  const nothingWritten = !leftATrace(all);
  if (!stillUnbacked.length && !nothingWritten) return null;

  const blocked = stillUnbacked.length ? stillUnbacked : wanted;
  return {
    success: false,
    error: 'not_backed_by_work',
    refused: blocked.map((c) => ({
      id: c.id,
      text: c.text,
      why: stillUnbacked.length
        ? `${toolsNamedBy(c.text, TOOL_VOCABULARY).join(' / ')} has not returned a successful result since this goal was opened.`
        : 'Nothing has been written in this goal yet — every tool that succeeded so far was a read.'
    })),
    instruction:
      'These are NOT closed. Do the work now — the tool that produces the thing, not another read — and call update_goal again when it has returned. If a criterion is genuinely impossible, call update_goal(drop=["cN"], note="why") and say so; leaving it open and wrapping up is the one thing you cannot do.'
  };
}

/**
 * Il vocabolario dei nomi di strumento che un criterio può nominare. Non è il registro dei tool:
 * è l'insieme dei nomi che vale la pena riconoscere dentro una frase in linguaggio naturale.
 * `toolsNamedBy` intersecta, quindi un nome che non è qui semplicemente non ancora un'ancora.
 */
const TOOL_VOCABULARY = [
  'render_motion_video',
  'create_motion_video',
  'write_motion_source',
  'replace_motion_source',
  'generate_voiceover',
  'generate_music',
  'render_stills',
  // `review_video` è uscito il 23/8/2026: smontato dalla chat
  // (CHAT_REVIEW_VIDEO_ENABLED). Un'ancora su un tool che non può più tornare con successo è un
  // obiettivo che non chiude mai — il nome qui vale solo se il tool è in mano all'agente.
  'design_graphic',
  'generate_image',
  'create_post',
  'approve_post',
  'schedule_post',
  'write_article',
  'publish_article',
  'study_motion_reference',
  'capture_website',
  // Gli stessi mestieri sul motore kit, dove i nomi hanno il prefisso del plugin: un criterio che
  // nomina `content_schedule` deve valere quanto uno che nomina `approve_post`.
  'content_create_post',
  'content_design_graphic',
  'content_generate_image',
  'content_schedule',
  'motion_write',
  'motion_render',
  'motion_stills',
  'ugc_generate_video',
  'web_update_article',
  'web_schedule_article',
  'web_write_planned_article',
  'brand_write'
] as const;

export function createGoalTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId?: string;
  /**
   * I tool già andati a buon fine in QUESTO turno, per chi non gira dentro il ciclo dell'AI SDK e
   * quindi non riceve `opts.messages` — il ponte del kit (`agent/plugins/goal.ts`). Senza,
   * la lista si legge dai messaggi come sempre.
   */
  succeededThisTurn?: () => string[];
}) {
  const { supabase, brandId, userId, threadId, succeededThisTurn } = opts;

  const noThread = { success: false, error: 'No thread — a goal belongs to a conversation.' };
  /** Per turno: `createChatTools` viene chiamato una volta per turno, come la pagina. */
  let refusals = 0;

  return {
    set_goal: tool({
      description: [
        'Write down, BEFORE you start, what has to be true for this job to be finished — and let the system hold you to it.',
        'Call it yourself, without being asked, whenever the user hands you work that takes more than a couple of tool calls: a batch, a fix across many items, a week to produce, an audit, anything you would otherwise track in your head.',
        'Criteria must be checkable facts about the real state ("the 12 September posts exist and are approved", "no article is left without a cover"), never intentions ("analyse the situation") or steps of your own process.',
        'A CRITERION COMES FROM TWO PLACES AND NO THIRD: the REQUEST, and the READY line at the top of your CAPABILITIES — the one that says what your trade has to hand over before the thing counts as made (a draft in pending with caption AND visual, an MP4 rendered, an article written and scheduled). Everything else you hold yourself to on every job — always leave a new idea behind, always build one proposal on a contrast — is how you work, not what this job is. THE TEST: if the criterion is in neither of those two, and would be just as true and just as required for a completely different request, it is not a criterion of this goal.',
        'While a goal is open the turn is not allowed to end as finished: whatever is still open gets picked back up automatically. So keep the list to what genuinely defines "done".',
        'WHILE A GOAL IS OPEN YOU DO NOT ASK PERMISSION TO CARRY ON: no "shall I write it now or do the voice-over first?", no choice between two ways of doing the same thing, no ending the turn on a question while a criterion is still yours to close. The goal IS the permission and the order of the steps is your craft; if a review or a QC is what is missing, run it instead of waiting for a verdict you can give yourself. THE ONE EXCEPTION is a real decision gate — publishing or going live, spending well beyond what was asked, something destructive or hard to reverse, a payment: an open goal does not authorise those, and there you do stop and ask. Ask only for what exists nowhere but in the user\'s head — and then with ask_user_questions, which stops the turn, never as a question in prose that stops nothing. If you are blocked, leave the goal open and say what is blocking.',
        'Do NOT open one for a question, a single edit, or anything you complete in one call. Skip it if a goal is already open and still fits — just update that one.'
      ].join(' '),
      inputSchema: z.object({
        statement: z
          .string()
          .min(8)
          .max(500)
          .describe('The goal in one sentence, in the user’s language: what will be true when this is done'),
        criteria: z
          .array(z.string().min(3).max(MAX_CRITERION_CHARS))
          .min(1)
          .max(MAX_GOAL_CRITERIA)
          .describe(
            `Between 1 and ${MAX_GOAL_CRITERIA} verifiable facts, each one checkable on its own. Order them the way you will work through them.`
          )
      }),
      execute: async (input: { statement: string; criteria: string[] }) => {
        if (!threadId) return noThread;
        const { goal, created, error } = await setThreadGoal(supabase, {
          brandId,
          userId,
          threadId,
          statement: input.statement,
          criteria: input.criteria,
          source: 'agent'
        });
        if (!goal) return { success: false, error: error ?? 'Could not open the goal' };
        const { done, total } = goalProgress(goal.criteria);
        return {
          success: true,
          goal_id: goal.id,
          created,
          statement: goal.statement,
          criteria: checklist(goal.criteria),
          progress: `${done}/${total}`,
          instruction: created
            ? 'The goal is now visible to the user and it outlives this turn. Re-read the list once: any criterion that would be just as true and just as required for a completely different request is a standard of your craft, not part of what was asked — drop it now with update_goal before you start. Then work the first one, and close each one with update_goal the moment it is really true.'
            : 'A goal was already open on this thread: it has been updated, and the criteria already closed kept their state. Carry on from the first open one.'
        };
      }
    }),

    update_goal: tool({
      description: [
        'Tick off, drop or add criteria on the goal that is open in this conversation.',
        'Close a criterion the moment it is really true — after the tool that did the work returned, not before, and not all of them together at the end.',
        'CLOSING IS A CALL, NOT A LABEL: writing "c1 done" in your reply closes nothing, because the checklist is read by code and code only sees this tool. A pass that describes work as finished without calling it is a pass that closed nothing, and the goal stalls on it.',
        'A close is REFUSED when nothing backs it: if the criterion names a tool that has not returned successfully since the goal opened, or if every tool that has succeeded in this goal was a read. The refusal names the criteria and what is missing — do the work and call again, or drop the criterion with a reason.',
        'Drop one (with a reason) when it turns out to be impossible or pointless: leaving it open forever is worse, and marking it done would be a lie.',
        'Add one when the work uncovers something that genuinely belongs to this goal — not to log a step you took.'
      ].join(' '),
      inputSchema: z.object({
        done: z
          .array(z.string())
          .optional()
          .describe('Criteria that are now TRUE, by id ("c2") or exact text. Only what really happened.'),
        drop: z
          .array(z.string())
          .optional()
          .describe('Criteria that no longer make sense, by id or exact text. Always explain in note.'),
        add: z
          .array(z.string().min(3).max(MAX_CRITERION_CHARS))
          .optional()
          .describe('New criteria that belong to this same goal'),
        note: z
          .string()
          .max(MAX_CRITERION_CHARS)
          .optional()
          .describe('One line on what is actually true now, or why a criterion was dropped')
      }),
      execute: async (
        input: { done?: string[]; drop?: string[]; add?: string[]; note?: string },
        opts?: { messages?: Array<{ role?: string; content?: unknown }> }
      ) => {
        if (!threadId) return noThread;
        const current = await loadOpenGoal(supabase, threadId);
        if (!current) {
          return {
            success: false,
            error: 'No goal is open in this conversation. Open one with set_goal if this job needs it.'
          };
        }
        // ── Il rifiuto, prima di registrare ────────────────────────────────────────────────
        if (input.done?.length && refusals < MAX_GOAL_REFUSALS) {
          const here = succeededThisTurn
            ? succeededThisTurn().filter((t) => !GOAL_TOOL_KEYS.includes(t as (typeof GOAL_TOOL_KEYS)[number]))
            : opts?.messages
              ? succeededToolNamesFromMessages(opts.messages, GOAL_TOOL_KEYS)
              : null;
          const refusal = await refuseUnbackedClosures(supabase, current, input.done, here);
          if (refusal) {
            refusals += 1;
            return refusal;
          }
        }
        const { goal, closed, unknown } = await updateGoalCriteria(supabase, current, input);
        const { done, total } = goalProgress(goal.criteria);
        const still = openCriteria(goal.criteria);
        // Il tetto di otto criteri è silenzioso per costruzione (la lista si normalizza e taglia).
        // Silenzioso va bene per il codice, non per chi ha chiesto: un criterio che l'agente crede
        // di aver aggiunto e che non c'è è un pezzo di lavoro che nessuno rivedrà mai.
        const notAdded = (input.add ?? []).filter(
          (text) => !goal.criteria.some((c) => c.text.trim().toLowerCase() === text.trim().toLowerCase())
        );
        return {
          success: true,
          criteria: checklist(goal.criteria),
          progress: `${done}/${total}`,
          closed_now: closed,
          ...(unknown.length ? { not_found: unknown } : {}),
          ...(notAdded.length
            ? {
                not_added: notAdded,
                note: `This goal is full (max ${MAX_GOAL_CRITERIA} criteria). Close or drop something before adding more, or finish this goal and open the next one.`
              }
            : {}),
          instruction: still.length
            ? `Still open: ${still.map((c) => `${c.id} (${c.text})`).join(', ')}. Keep going — do not wrap up the turn as if the job were done.`
            : 'Every criterion is closed. Call close_goal(outcome="met") with a one-line summary, then tell the user what actually happened.',
          ...(unknown.length
            ? {
                warning:
                  'Some references matched no criterion and were ignored — check the ids above, they are still open.'
              }
            : {})
        };
      }
    }),

    close_goal: tool({
      description: [
        'Close the goal of this conversation: outcome="met" when every criterion is true, outcome="abandoned" when the goal itself stopped making sense (the user changed direction, the premise fell apart).',
        'outcome="met" is REFUSED while any criterion is still open — close them with update_goal first, or drop the ones that no longer apply, with a reason.',
        'summary is REQUIRED and its shape depends on the outcome: for "met" name what EXISTS now that did not exist before, with the ids (the video id, the post ids, the file) — the same discipline update_goal asks of you; for "abandoned" say why it cannot be done, which is the part the user actually needs and the part that gets lost.',
        'Repeating the criteria back is not a summary: they are already on screen. Write the one line that is not on screen.',
        'Never abandon a goal just because it is hard or you ran out of room: say what is left and it gets picked back up.'
      ].join(' '),
      inputSchema: z.object({
        outcome: z.enum(['met', 'abandoned']).describe('met = every criterion is true; abandoned = the goal no longer applies'),
        summary: z
          .string()
          .min(3)
          .max(500)
          .describe(
            'REQUIRED. met → what exists now that did not exist before, with ids. abandoned → why it cannot be done. Not a restatement of the criteria.'
          )
      }),
      execute: async (input: { outcome: 'met' | 'abandoned'; summary: string }) => {
        if (!threadId) return noThread;
        const current = await loadOpenGoal(supabase, threadId);
        if (!current) return { success: false, error: 'No goal is open in this conversation.' };

        // IL GIUDICE ALLA PORTA (richiesta del 23/8): un summary che ANNUNCIA lavoro futuro
        // non è un summary di ciò che esiste — è la promessa che stava chiudendo il goal al
        // posto del fatto. Stesso filtro deterministico del giudice di chiusura del kit.
        if (input.outcome === 'met' && looksLikeAPromise(input.summary)) {
          return {
            success: false,
            error: 'This summary announces future work ("I will now...", "correggo e poi...") — that is a promise, not a result.',
            instruction:
              'Do the promised step NOW, in this turn, then close the goal with a summary of what EXISTS (with ids). If you cannot finish, leave the goal open and say what is blocking.'
          };
        }

        const still = openCriteria(current.criteria);
        if (input.outcome === 'met' && still.length) {
          return {
            success: false,
            error: `Cannot close this goal as met: ${still.length} criterion(s) still open.`,
            still_open: checklist(still),
            instruction:
              'Either do the work and close them with update_goal, or drop the ones that no longer apply with a reason. If you truly cannot finish, leave the goal open and say what is blocking — the work is resumed automatically.'
          };
        }

        const closedGoal = await closeGoal(supabase, current.id, input.outcome, input.summary);
        const { done, total } = goalProgress((closedGoal ?? current).criteria);
        return {
          success: true,
          outcome: input.outcome,
          progress: `${done}/${total}`,
          instruction:
            input.outcome === 'met'
              ? 'Goal closed. Tell the user what was actually done, in one short recap — the checklist is already on screen, do not repeat it item by item.'
              : 'Goal dropped. Say plainly why it no longer applies, so the user can disagree.',
          ...(closedGoal ? {} : { warning: 'The goal was already closed by another turn.' })
        };
      }
    })
  };
}
