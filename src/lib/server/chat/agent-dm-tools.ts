/**
 * `message_agent` — un agente scrive a UN ALTRO agente, in un thread privato e persistente.
 *
 * Il modello mentale è il DM di un ufficio, non una consultazione: `ask_to_*` paga un modello per
 * un parere una tantum che muore col turno; qui il messaggio finisce in un thread vero (uno per
 * coppia per brand, riusato per sempre — quella È la memoria condivisa dei due), il destinatario
 * risponde con un SUO turno accodato — i SUOI tool via `pickTools`, il SUO prompt — e l'utente
 * vede la conversazione arrivare nella sidebar, in sola lettura.
 *
 * ASYNC PER COSTRUZIONE. Il tool non aspetta mai: torna subito con l'id del thread. `await:true`
 * non blocca — dice al giro di ritorno di reinfilare un riassunto della risposta nel thread di
 * partenza come riga user, che la mid-turn-mailbox assorbe a un confine di step se il turno
 * dell'iniziatore gira ancora. Se il turno finisce prima, l'onestà sta nell'hint: "di' che hai
 * scritto e che risponderà nel vostro thread", mai un ciclo di attesa.
 *
 * PERIMETRO: orchestratore soltanto (mai i sotto-agenti — chi parla è uno solo, vedi
 * NEVER_FOR_SUBAGENTS), ma i turni schedulati SÌ: lo Stratega che di notte scrive al Produttore è
 * il caso per cui esiste. Tetto di 3 invii per turno e dedupe sul messaggio identico: un loop che
 * scrive DM è un loop che accoda turni pagati.
 *
 * Dentro un thread DM il tool si RIFIUTA: la risposta del turno È già il messaggio all'altro
 * (niente ping-pong di turni auto-accodati), e un DM verso un terzo da lì dentro non saprebbe
 * nemmeno chi lo firma (l'agente del turno sta nei params del job, non sul thread).
 *
 * FAN-OUT (`to` come lista). Scrivere a più colleghi in un colpo è UNA azione con N destinatari,
 * non N azioni — ma è una azione che chiede l'UTENTE. Due freni, diversi apposta:
 *   • la regola sociale — più di un destinatario pretende `because_user_asked`, cioè che l'agente
 *     sappia dire cosa gli è stato chiesto. Chi non sa dirlo si stava allargando da solo.
 *   • il costo — il tetto per turno si conta in DESTINATARI, non in chiamate: tre destinatari sono
 *     tre turni accodati e pagati, che stiano in una chiamata o in tre. Il fan-out cambia la
 *     grammatica, mai il conto.
 *
 * `create_group_chat` sta qui accanto per simmetria: è l'altro modo di raggiungere più di un
 * collega, e l'unico che non paga nessun turno finché non parla una persona (vedi il suo docblock).
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { AGENTS, AGENT_IDS, resolveAgent, type AgentId } from '$lib/server/chat/agents';
import { createThread, getThread, saveMessages, type ChatThreadRow } from '$lib/server/chat/persistence';
import { markThreadRead } from '$lib/server/chat/unread';
import { kickChatQueueWork, threadHasActiveChatResponse } from '$lib/server/chat/queue';
import {
  ROOM_GENERALIST,
  ROOM_MAX_MEMBERS,
  groupChatsEnabled,
  parseRoomAgents,
  roomRoster,
  setThreadRoomAgents
} from '$lib/server/chat/room';
import { dmAgents, dmMarker, dmNames } from '$lib/chat-dm';

/**
 * Tetto agli invii per turno: oltre, non è coordinamento — è un loop che accoda turni pagati.
 *
 * Si conta PER DESTINATARIO, non per chiamata: un fan-out a tre è tre turni accodati come tre
 * chiamate separate, e il tetto esiste per quei turni, non per il numero di volte che il modello
 * ha premuto il pulsante. Il fan-out cambia la GRAMMATICA (una azione dell'utente, N destinatari),
 * mai il conto.
 */
export const DM_SENDS_PER_TURN = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DmMember = {
  /** Chiave stabile e attribuzione: id agente di sistema, `custom:<uuid>`, o `anomalia`. */
  key: string;
  name: string;
  /** Agente di sistema che scopre prompt e tool del turno di risposta. null = set pieno. */
  agent: AgentId | null;
  customAgentId: string | null;
};

const lang = (locale: string) => bilingualNoticeLocale(locale);

/**
 * Le chiavi con cui un modello prova a scrivere ad ANOMALIA. Non è un destinatario: è il
 * coordinatore invisibile — l'identità dei thread senza agente e la voce di ripiego quando una
 * richiesta non è di nessuno specialista. Un agente che le scrive sta delegando all'unico
 * collega che non ha un mestiere: il lavoro va allo specialista competente, o resta suo.
 * `AGENT_IDS` non l'ha mai contenuta, quindi `resolveDmTarget` la respingeva già — ma con
 * "Unknown agent", che invita a riprovare con un'altra grafia invece di cambiare strada.
 */
export const DM_FORBIDDEN_TARGETS = ['auto', 'anomalia'];

/** Il destinatario, validato contro roster vivo + custom del brand. null = sconosciuto. */
export async function resolveDmTarget(
  supabase: SupabaseClient,
  brandId: string,
  to: string,
  locale: string
): Promise<DmMember | null> {
  const key = to.trim();
  if ((AGENT_IDS as readonly string[]).includes(key)) {
    const def = AGENTS[key as AgentId];
    return { key, name: def.labels[lang(locale)], agent: key as AgentId, customAgentId: null };
  }
  // Accetta sia `custom:<uuid>` sia l'uuid nudo — il modello li scrive entrambi.
  const id = key.startsWith('custom:') ? key.slice('custom:'.length) : key;
  if (!UUID.test(id)) return null;
  const { data } = await supabase
    .from('custom_agent_schedules')
    .select('id, name, agent')
    .eq('brand_id', brandId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return {
    key: `custom:${data.id as string}`,
    name: (data.name as string) || 'Agent',
    // La restrizione di mestiere del custom vale anche nel DM (stessa regola di roomRoster).
    agent: resolveAgent(data.agent),
    customAgentId: data.id as string
  };
}

/** Chi firma il messaggio: il persona custom del thread, l'agente del thread, o il generalista. */
export async function resolveDmInitiator(
  supabase: SupabaseClient,
  brandId: string,
  thread: ChatThreadRow | null,
  locale: string
): Promise<DmMember> {
  if (thread?.custom_agent_id) {
    const { data } = await supabase
      .from('custom_agent_schedules')
      .select('id, name, agent')
      .eq('brand_id', brandId)
      .eq('id', thread.custom_agent_id)
      .maybeSingle();
    if (data) {
      return {
        key: `custom:${data.id as string}`,
        name: (data.name as string) || 'Agent',
        agent: resolveAgent(data.agent),
        customAgentId: data.id as string
      };
    }
  }
  const agent = resolveAgent(thread?.agent);
  if (agent) {
    return { key: agent, name: AGENTS[agent].labels[lang(locale)], agent, customAgentId: null };
  }
  // Thread senza agente = il generalista. Nelle room non esiste; nei DM è chi scrive più spesso.
  return { key: 'anomalia', name: 'Anomalia', agent: null, customAgentId: null };
}

/**
 * UN thread per coppia per brand, riusato per sempre — la persistenza È il punto ("memoria").
 * La coppia è ordinata (dmMarker), e il containment jsonb matcha a prescindere dall'ordine, quindi
 * A→B e B→A trovano lo stesso thread. Niente indice unico: due invii davvero simultanei sulla
 * stessa coppia possono creare due thread — il primo trovato vince dal giro dopo.
 * ponytail: race accettata; indice unico su (brand, dm-pair) se mai dovesse succedere davvero.
 */
export async function getOrCreateDmThread(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; a: DmMember; b: DmMember }
): Promise<ChatThreadRow | null> {
  const marker = dmMarker(opts.a, opts.b);
  const { data: existing } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('brand_id', opts.brandId)
    .eq('user_id', opts.userId)
    .contains('room_agents', { dm: marker.dm })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as ChatThreadRow;

  const { data, error } = await supabase
    .from('chat_threads')
    .insert({
      brand_id: opts.brandId,
      user_id: opts.userId,
      title: `${opts.a.name} ⇄ ${opts.b.name}`.slice(0, 120),
      room_agents: marker
    })
    .select('*')
    .single();
  // Colonna assente (0209 non applicata) o insert negato: niente DM senza marcatore — un thread
  // agente-agente in cui l'utente può scrivere è peggio di un tool che dice "non ora".
  if (error || !data) {
    console.warn('[agent-dm] dm thread create failed:', error?.message);
    return null;
  }
  // Il thread nasce letto (0207): serve il "prima" contro cui il primo messaggio accende il badge.
  await markThreadRead(supabase, data.id as string, opts.userId, data.created_at as string);
  return data as ChatThreadRow;
}

export function createAgentDmTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId?: string;
  origin: string;
  locale: string;
}) {
  const { supabase, brandId, userId, threadId, origin } = opts;
  const locale = lang(opts.locale);
  // Stato del TURNO: i tool si ricostruiscono a ogni turno, quindi il tetto e il dedupe vivono
  // nella closure — nessuna tabella, nessun contatore da ripulire.
  let sends = 0;
  const seen = new Set<string>();
  /** Stanze aperte in questo turno. Una: vedi il docblock di `create_group_chat`. */
  let rooms = 0;

  const tools = {
    message_agent: tool({
      description: [
        'Send a message to ANOTHER agent of this brand, in a persistent private thread between the two of you (one thread per pair, reused forever — your shared memory). The other agent replies there with their own tools and context; the user can read the thread but not write in it.',
        'Use it to delegate a piece of work to a colleague, report a blocker, or coordinate — when you want THEM to act with THEIR tools, not just an opinion (for a one-shot opinion use ask_to_*).',
        'ASYNC, never blocking: the tool returns immediately. With await:true, a short summary of their reply is dropped back into THIS conversation as soon as it lands — it may arrive at a later step of this turn. If it has not arrived by your final message, say so honestly ("ho scritto a X, risponderà nel nostro thread") and finish — NEVER stall or loop waiting for it. With await:false (default), the reply simply stays in your private thread.',
        'The send is ALREADY delivered and ALREADY visible to the user as a compact chip in this chat. Do NOT repeat or paraphrase the message content in your reply — at most one operational line ("Ho scritto a X, ti aggiorno quando risponde"), or nothing if the context does not call for it.',
        `ONE recipient by default. \`to\` also takes a LIST — the same message to several agents in one action — but only when the USER asked for it: then pass because_user_asked. Deciding on your own to tell everyone is not coordination, it is noise the user pays for.`,
        `Max ${DM_SENDS_PER_TURN} RECIPIENTS per turn, counted across all your calls (a list of 3 spends the whole budget). Do not repeat the same message to the same agent.`
      ].join('\n'),
      inputSchema: z.object({
        to: z
          .union([
            z.string().min(1).max(64),
            z.array(z.string().min(1).max(64)).min(1).max(DM_SENDS_PER_TURN)
          ])
          .describe(
            `Recipient: a system agent id (${AGENT_IDS.join(', ')}) or a custom agent id. "auto"/"anomalia" is NOT a recipient — pick the specialist whose craft it is. A LIST of ids sends the same message to each of them, and needs because_user_asked.`
          ),
        message: z
          .string()
          .min(1)
          .max(4000)
          .describe('The message for the other agent: concise, operational, self-contained'),
        await: z
          .boolean()
          .optional()
          .describe('true = drop a summary of their reply back into this conversation when it lands (default false)'),
        because_user_asked: z
          .string()
          .max(300)
          .optional()
          .describe(
            'Required when `to` is a list of more than one: what the user actually asked that calls for several agents ("chiedi a tutti", "senti Motion e Web"). Never write it to unlock a fan-out you decided yourself.'
          )
      }),
      execute: async ({
        to,
        message,
        await: awaitReply,
        because_user_asked: becauseUserAsked
      }: {
        to: string | string[];
        message: string;
        await?: boolean;
        because_user_asked?: string;
      }) => {
        if (!threadId) return { error: 'No thread for this turn — agent DMs need one' };

        const thread = await getThread(supabase, threadId, brandId, userId);
        // Dentro un DM la risposta È già il messaggio all'altro: il tool qui non serve, e
        // permetterlo aprirebbe il ping-pong di turni auto-accodati (vedi commento di testa).
        if (dmAgents((thread as { room_agents?: unknown } | null)?.room_agents)) {
          return {
            error:
              'You are already in a private agent chat: your reply text IS your message to the other agent. Just write it.'
          };
        }

        // Un destinatario o N: da qui in giù è sempre una lista. I doppioni dentro la stessa
        // chiamata spariscono qui e non consumano budget — scrivere due volte a `motion` nella
        // stessa lista è un errore di battitura, non due messaggi.
        const recipients = [
          ...new Set((Array.isArray(to) ? to : [to]).map((t) => String(t ?? '').trim()).filter(Boolean))
        ];
        if (!recipients.length) return { error: 'No recipient — `to` is empty.' };

        /**
         * IL FAN-OUT È UNA COSA CHE CHIEDE L'UTENTE, NON UNA CHE DECIDE L'AGENTE.
         *
         * Non è una regola di costo — quella è il budget qui sotto, che conta i destinatari uno
         * per uno. È una regola sociale: un agente che di sua iniziativa avvisa tutta la squadra
         * riempie tre thread e paga tre turni per una cosa che era di un mestiere solo. Il campo
         * obbligatorio serve a questo: chi non sa dire cosa ha detto l'utente non stava
         * eseguendo una richiesta, si stava allargando da solo.
         */
        if (recipients.length > 1 && !becauseUserAsked?.trim()) {
          return {
            error: 'fan_out_needs_the_user',
            hint: `Writing to several agents at once is something the USER asks for, not something you decide: one recipient is the default, ${recipients.length} is a fan-out. Pick the ONE agent whose craft this is and write to them. If the user really did ask for several, call this again with because_user_asked saying what they asked for.`
          };
        }

        // Il budget si conta in DESTINATARI, non in chiamate: un fan-out a tre accoda tre turni
        // pagati esattamente come tre chiamate separate. Tutto-o-niente, così il modello non si
        // ritrova una lista spedita a metà senza sapere quale metà.
        if (sends + recipients.length > DM_SENDS_PER_TURN) {
          return {
            error: `DM budget for this turn is ${DM_SENDS_PER_TURN} recipients: ${sends} already used and this call asks for ${recipients.length}. Write to fewer agents now and continue next turn.`
          };
        }

        const initiator = await resolveDmInitiator(supabase, brandId, thread, locale);
        const sent: Array<{ dm_thread_id: string; to: string; to_name: string }> = [];
        const failed: Array<{ to: string; error: string }> = [];

        for (const one of recipients) {
          // Anomalia non riceve DM: dirlo PRIMA di "Unknown agent" cambia la mossa successiva del
          // modello — non un'altra grafia, un altro destinatario.
          if (DM_FORBIDDEN_TARGETS.includes(one.toLowerCase())) {
            failed.push({
              to: one,
              error:
                'Anomalia does not receive agent messages — she is not a specialist, she is the fallback voice for requests that belong to no craft. Send this to the specialist whose trade it is instead (' +
                AGENT_IDS.join(', ') +
                "), or to one of this brand's custom agents. If no craft owns it, do it yourself with your own tools."
            });
            continue;
          }

          const target = await resolveDmTarget(supabase, brandId, one, locale);
          if (!target) {
            failed.push({
              to: one,
              error: `Unknown agent "${one}". Valid: ${AGENT_IDS.join(', ')} or a custom agent id.`
            });
            continue;
          }
          if (target.key === initiator.key) {
            failed.push({ to: one, error: 'That is you — pick another agent.' });
            continue;
          }

          const dedupeKey = `${target.key} ${message.trim()}`;
          if (seen.has(dedupeKey)) {
            failed.push({
              to: one,
              error: 'Already sent this exact message to this agent in this turn — not sending it twice.'
            });
            continue;
          }

          const dmThread = await getOrCreateDmThread(supabase, { brandId, userId, a: initiator, b: target });
          if (!dmThread) {
            failed.push({ to: one, error: 'Agent DMs are unavailable right now (thread could not be created).' });
            continue;
          }

          // Il messaggio compare SUBITO nel thread (l'utente lo vede arrivare); il turno del
          // destinatario poi non lo risalva — vedi il ramo `dm` in processNextQueuedChatJob.
          await saveMessages(supabase, brandId, userId, [{ role: 'user', content: message }], dmThread.id, {
            speaker: initiator.key
          });

          const names = dmNames((dmThread as { room_agents?: unknown }).room_agents);
          const { error: jobError } = await supabase.from('chat_jobs').insert({
            brand_id: brandId,
            user_id: userId,
            tool_name: 'chat_response',
            thread_id: dmThread.id,
            status: 'pending',
            input_params: {
              user_message: message,
              locale,
              origin,
              queued: true,
              // Il seam dell'agente forzato (queue.ts): CHI risponde lo dicono i params, non il thread.
              dm: true,
              ...(target.agent ? { agent: target.agent } : {}),
              ...(target.customAgentId ? { custom_agent_id: target.customAgentId } : {}),
              speaker: target.key,
              speaker_name: names[target.key] ?? target.name,
              from_speaker: initiator.key,
              // Niente `brief` nei params: il blocco DM lo monta il RUNNER dal marker del thread
              // (dmBrief in $lib/chat-dm), così vale per qualunque turno su questo thread.
              tier: 'auto',
              ...(awaitReply === true ? { reply_to_thread: threadId } : {})
            }
          });
          if (jobError) {
            failed.push({ to: one, error: `Message saved but reply turn not queued: ${jobError.message}` });
            continue;
          }

          sends += 1;
          seen.add(dedupeKey);
          sent.push({ dm_thread_id: dmThread.id as string, to: target.key, to_name: target.name });

          // Parte subito se il thread DM è libero; altrimenti il drain lo pesca appena si libera.
          const busy = await threadHasActiveChatResponse(supabase, { userId, threadId: dmThread.id });
          if (!busy && origin) void kickChatQueueWork(origin);
        }

        // Nessuno raggiunto: è un fallimento, e con un destinatario solo il motivo torna nudo in
        // `error` — la forma che il modello leggeva già prima del fan-out.
        if (!sent.length) {
          return failed.length === 1 ? { error: failed[0].error } : { error: 'No message was delivered.', failed };
        }

        const names = sent.map((s) => s.to_name).join(', ');
        return {
          success: true,
          // Un destinatario solo tiene la forma di sempre in cima: ChatDmChip e le tool-call già
          // salvate leggono `dm_thread_id`/`to`/`to_name` e non devono imparare niente per il caso
          // normale. `sends` c'è comunque, ed è la lista che il fan-out riempie.
          ...(sent.length === 1 ? sent[0] : {}),
          sends: sent,
          ...(failed.length ? { failed } : {}),
          await: awaitReply === true,
          hint:
            awaitReply === true
              ? 'Delivered — the user already sees this send as a chip in this chat: do NOT repeat the message content. Their reply summary will appear in THIS conversation as a "📩 …" message, possibly at a later step. If it has not arrived by your final message, say you wrote to them and that they will answer in your private thread — do not wait in a loop.'
              : `Delivered — the user already sees this send as a chip in this chat: do NOT repeat the message content. At most one short line ("Ho scritto a ${names}, ti aggiorno quando risponde"), or nothing. Do not block this turn on it.`
        };
      }
    }),

    /**
     * `create_group_chat` — l'agente apre una STANZA, cioè il thread; non ci fa parlare nessuno.
     *
     * La macchina della stanza esiste già tutta (room.ts: smistatore economico, una voce a testa,
     * tetto di voci per messaggio) e ha una regola sopra tutte le altre: **una stanza si anima
     * solo quando c'è una persona che ha appena scritto** — nei turni non presidiati lo
     * smistatore non gira mai. Quindi questo tool non è un fan-out mascherato e non può
     * diventarlo: costa una insert, e la prima battuta la fa partire un messaggio dell'utente.
     *
     * Per la stessa ragione NON semina un primo messaggio: sarebbe una riga `user` scritta da un
     * agente, cioè mettere parole in bocca alla persona per far partire N turni pagati. Quello
     * che l'agente voleva dire lo dice nel TITOLO della stanza e nella sua risposta in chat.
     *
     * Una per turno: creare stanze non costa quasi niente, ma una sidebar con quattro stanze vuote
     * è lo stesso danno di un loop, pagato in confusione invece che in dollari.
     *
     * ponytail: nessuna chip dedicata in chat — la stanza compare nella sidebar col suo titolo e
     * la pila di avatar dei membri. Se gli utenti non la trovano, il posto è ChatDmChip.svelte.
     */
    create_group_chat: tool({
      description: [
        `Open a GROUP CHAT (a room): a new thread with 2-${ROOM_MAX_MEMBERS} agents in it, where the user writes once and whoever has something to say answers with their own voice and their own tools.`,
        'Use it when the user asks to talk to several agents together, or when a piece of work genuinely needs two crafts in the same conversation.',
        'The room is created EMPTY, and that is deliberate: the agents speak when the USER writes in it. Creating it makes nobody answer and delivers no message — if you have something to say to a colleague right now, that is message_agent.',
        'Not a way to broadcast: put in the room only the agents whose craft the conversation needs. One room per turn.',
        'After creating it, tell the user in one line that the room is open (by its title) and that they can write there.'
      ].join('\n'),
      inputSchema: z.object({
        members: z
          .array(z.string().min(1).max(64))
          .min(2)
          .max(ROOM_MAX_MEMBERS)
          .describe(
            `The agents in the room: system agent ids (${AGENT_IDS.join(', ')}), "${ROOM_GENERALIST}" for Anomalia (the generalist), or custom agent ids. Include yourself if the conversation is yours too.`
          ),
        title: z
          .string()
          .min(1)
          .max(80)
          .describe(
            'What the room is about, in a few words — the user reads this in the sidebar, and it is the only brief the room carries'
          )
      }),
      execute: async ({ members, title }: { members: string[]; title: string }) => {
        if (rooms >= 1) {
          return { error: 'One group chat per turn. Use the one you just opened, or wait for the next turn.' };
        }
        if (!threadId) return { error: 'No thread for this turn — group chats need one' };

        const thread = await getThread(supabase, threadId, brandId, userId);
        // Stessa ragione del DM: in un thread privato fra due agenti non c'è nessun utente che
        // possa poi scrivere nella stanza, quindi la stanza nascerebbe morta.
        if (dmAgents((thread as { room_agents?: unknown } | null)?.room_agents)) {
          return {
            error:
              'You are in a private agent chat: no user reads here, and a room only comes alive when a person writes in it. Say what you need in your reply instead.'
          };
        }

        const keys = parseRoomAgents(members);
        if (keys.length < 2) {
          return {
            error: `A room needs at least 2 valid members; got ${keys.length} out of ${JSON.stringify(members)}. Valid: ${AGENT_IDS.join(', ')}, "${ROOM_GENERALIST}", or custom:<uuid>.`
          };
        }

        const clean = title.trim().slice(0, 120);
        // Il thread nasce con `agent` = il primo membro di mestiere: è chi risponde se la stanza
        // non regge (colonna 0209 assente), esattamente come fa il POST dei thread lato utente.
        const fallbackAgent = keys.find((k) => (AGENT_IDS as readonly string[]).includes(k)) ?? null;
        const created = await createThread(supabase, brandId, userId, clean, null, fallbackAgent);
        if (!created) return { error: 'Group chat could not be created.' };

        const saved = await setThreadRoomAgents(supabase, created.id as string, brandId, userId, keys);
        if (saved.length < 2) {
          return {
            error: 'group_chat_not_saved',
            hint: 'The room could not be stored. Write to the agent you need with message_agent instead.'
          };
        }

        rooms += 1;
        const roster = await roomRoster(supabase, brandId, saved, locale);
        return {
          success: true,
          thread_id: created.id,
          title: clean,
          members: roster.map((m) => ({ key: m.key, name: m.name })),
          hint: `Room "${clean}" is open with ${roster.map((m) => m.name).join(', ')} — it is in the user's sidebar. Nobody has spoken and nobody will until the user writes there: say that in one line, do not pretend a conversation has started.`
        };
      }
    })
  };

  /**
   * Dove le stanze non esistono, il tool non si OFFRE — non risponde "non qui".
   *
   * Un tool che c'è e fallisce sempre insegna al modello a promettere all'utente una cosa che non
   * può fare ("ti apro una stanza con Motion e Web") e a scoprirlo dopo averla detta; e nel
   * frattempo la sua descrizione si paga in token a ogni turno. Meglio non averlo: senza,
   * `message_agent` è l'unica strada verso un collega, che è esattamente la verità.
   */
  if (!groupChatsEnabled()) delete (tools as Partial<typeof tools>).create_group_chat;
  return tools;
}
