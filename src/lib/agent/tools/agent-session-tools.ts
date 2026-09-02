import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveDmInitiator } from '$lib/agent/tools/agent-dm-tools';
import { getThread, saveMessages } from '$lib/server/chat/persistence';
import { enqueueQueuedChatTurn, kickChatQueueWork, threadHasActiveChatResponse } from '$lib/server/chat/queue';
import { getOrCreateTeamThread } from '$lib/server/team-ignition';
import { AGENT_IDS } from '$lib/server/chat/agents';

/**
 * `open_session_with_user` — un agente apre una SESSIONE con l'utente e ci lavora.
 *
 * Il DM fra agenti è il posto giusto per coordinarsi ma NON per fare il lavoro che riguarda la
 * persona: chi lo riceve parla con un collega, l'utente legge ma non scrive. Quando il lavoro
 * delegato ha bisogno dell'utente — una scelta, un'approvazione, una domanda sul brand, un
 * risultato da consegnare — il collega apre il SUO thread utente (surface='team' +
 * surface_key=<agentId>, lo stesso dei diari di squadra), ci scrive la riga di apertura come
 * messaggio ASSISTANT e fa partire il suo turno lì dentro, in continuazione. Il delegante riceve
 * nel DM la conferma con l'id del thread ("ho aperto una sessione con l'utente, lavoro lì").
 *
 * NON è un fan-out e NON è una stanza: un solo thread, quello DEL PARLANTE, e ci lavora solo lui.
 * Se il thread è già aperto lo riusa (indice unico 0199) — riaprirne un secondo sarebbe il
 * doppione che il get-or-create impedisce.
 */
export function createAgentSessionTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId?: string;
  origin: string;
  locale: string;
}) {
  const { supabase, brandId, userId, threadId, origin, locale } = opts;

  return {
    open_session_with_user: tool({
      description: [
        'Open a session WITH THE USER, in your own thread, where the user can answer and you keep working — and start the work there.',
        'Use it when a piece of work handed to you (by another agent, or a task you are running) needs the person: a decision, an approval, a question only they can answer, or a result to hand over. You cannot talk to the user from a private agent chat, and the work must not die there.',
        'It creates or reuses YOUR user thread (the one in the sidebar with your face and your name), writes your visible opening line, and starts your own turn there. The agent who asked you gets the thread id back so they can point the user to it.',
        'NOT a broadcast and NOT a group chat: this is only your thread, and only you work in it. If you are already in your own user session, you have no reason to call it — just keep working there.'
      ].join('\n'),
      inputSchema: z.object({
        message: z
          .string()
          .min(1)
          .max(600)
          .describe(
            'Your visible opening line to the user, in their language: what you are about to do for them or what you need from them. Short, human, no internal names — the user reads this as the opening of a session with you.'
          )
      }),
      execute: async ({ message }: { message: string }) => {
        if (!threadId) return { error: 'No thread for this turn — a session needs one' };

        const thread = await getThread(supabase, threadId, brandId, userId);
        const me = await resolveDmInitiator(supabase, brandId, thread, locale);
        if (me.key === 'anomalia') {
          return { error: 'You are Anomalia, the generalist — you have no dedicated user session. Do the work here, or hand it to the specialist whose craft it is.' };
        }
        if (!me.agent || !(AGENT_IDS as readonly string[]).includes(me.agent)) {
          return { error: 'This session needs a specialist agent. Work in the current thread instead.' };
        }

        const opened = await getOrCreateTeamThread(supabase, brandId, me.agent as never);
        if (!opened?.threadId) {
          return { error: 'The user session could not be opened right now. Keep the work here.' };
        }

        // L'apertura è la riga ASSISTANT del collega: "sono Web Specialist, questo lo faccio io".
        // Il turno accodato è una CONTINUAZIONE: la storia finisce su quella riga e il modello
        // prosegue il lavoro; nessun messaggio utente duplicato (userMessageSaved → alreadySaved skip).
        await saveMessages(supabase, brandId, opened.userId, [{ role: 'assistant', content: message }], opened.threadId, {
          speaker: me.key
        });

        const jobId = await enqueueQueuedChatTurn(supabase, {
          brandId,
          userId: opened.userId,
          threadId: opened.threadId,
          // Il testo di ripresa va SOLO al modello (replay: mai salvato, mai mostrato): il
          // provider non accetta una conversazione che non apre con un turno user.
          userMessage: 'Your opening line to the user is already in front of them. Continue the work you just announced, in your own voice.',
          locale,
          origin,
          agent: me.agent,
          continuation: true,
          continuationDepth: 1,
          userMessageSaved: true,
          speaker: me.key
        });
        if (!jobId) {
          return { error: 'The session is open but the turn could not be queued. Tell the user it is open.' };
        }

        const busy = await threadHasActiveChatResponse(supabase, { userId: opened.userId, threadId: opened.threadId });
        if (!busy && origin) void kickChatQueueWork(origin);

        return {
          success: true,
          thread_id: opened.threadId,
          hint: `Your user session is open (id ${opened.threadId}). The user can now write there and you keep working. Tell the agent who asked you in the DM: ONE line, the thread id, and that you are working there.`
        };
      }
    })
  };
}
