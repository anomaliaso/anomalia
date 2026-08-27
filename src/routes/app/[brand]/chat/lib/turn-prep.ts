import type { ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadHistory,
  saveMessages,
  setThreadAgent,
  setThreadCustomAgent,
  supersedeFromMessage,
  type HistoryMedia
} from '$lib/server/chat/persistence';
import { customAgentSystemBlock, getCustomAgentPersona } from '$lib/server/custom-agent-persona';
import { agentStickerColor } from '$lib/chat-expression';
import { touchThreadAgentRun } from '$lib/server/custom-agents';
import { buildSystemPrompt, buildTurnVolatileBlock, wrapTurnMessage } from '$lib/server/chat/system-prompt';
import { attachmentParts, withoutVideo } from '$lib/media-parts';
import { resolveAgentForPlan, pickTools, stripWebHubTools } from '$lib/server/chat/agents';
import { withSubagentTools } from '$lib/server/chat/subagents';
import { withSandboxTools } from '$lib/server/chat/sandbox-tools';
import { computerOwner } from '$lib/agent-computer';
import { listThreadArtifacts, formatArtifactsForPrompt } from '$lib/server/chat/artifacts';
import { resolveChatModel, modelSeesImages, modelSeesVideo } from '$lib/server/chat/model';
import { roomBeat, roomSystemBlock, stripRoomPeerTools, type RoomMember } from '$lib/server/chat/room';
import { filterToolsForMode, isChatMode, modeSystemBlock, type ChatMode } from '$lib/chat-modes';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { createChatTools } from '$lib/server/chat/tools';
import {
  CHAT_HISTORY_DOC_CAP,
  formatAttachedDocsBlock,
  formatAttachedDocsForModel,
  parseChatDocuments,
  type ChatDocument
} from '$lib/chat-documents';
import { hydrateChatDocuments } from '$lib/server/hydrate-chat-documents';
import {
  closeGoal,
  goalBriefing,
  goalNudge,
  goalWorthyRequest,
  loadOpenGoal,
  setThreadGoal
} from '$lib/server/chat/goal';
import { aiActTurnBriefing, screenForProhibitedPractice, type PracticeHit } from '$lib/ai-act';
import { goalCommandInstruction, parseGoalCommand } from '$lib/goal-command';
import { lastUserText } from './jobs';
import { persistChatAttachments, resolveChatAttachments } from './attachments';

export type DeadlineRef = { current: { remainingMs: () => number } | null };

type TurnBrand = Parameters<typeof buildSystemPrompt>[1];

/**
 * Tutto ciò che il turno porta con sé PRIMA di toccare la cronologia: smistatore di stanza,
 * agente e persona, prompt di sistema, tool montati per modo e piano, modello risolto.
 */
export async function buildTurnContext(input: {
  supabase: SupabaseClient;
  brand: TurnBrand;
  userId: string;
  body: Record<string, unknown>;
  userMessages: ModelMessage[] | undefined;
  threadId: string;
  threadAgent: string | null;
  threadCustomAgentId: string | null;
  threadRoomAgents: unknown;
  isRedo: boolean;
  webHubEnabled: boolean;
  locale: string;
  origin: string;
  cookieHeader: string;
  deadlineRef: DeadlineRef;
  /** La preferenza salvata su thread o agente custom (0225). null = decide il tier. */
  modelPref: unknown;
}) {
  const {
    supabase, brand, userId, body, userMessages, threadId, threadAgent, threadCustomAgentId,
    threadRoomAgents, isRedo, webHubEnabled, locale, origin, cookieHeader, deadlineRef, modelPref
  } = input;

  // ── CHAT DI GRUPPO ────────────────────────────────────────────────────────────────────────
  // Se il thread è una stanza, l'agente del turno NON è quello del thread: è chi lo smistatore
  // sceglie per QUESTO messaggio (`roomBeat`). Gira qui, prima di prompt e tool, perché sono già
  // per-agente e devono nascere addosso a chi parla.
  // Il testo dell'ultimo messaggio si legge presto e a mano: quello del turno (`textContent`)
  // arriva molto più sotto, dopo la history, e allo smistatore serve adesso.
  // ponytail: sul `redo` la stanza non si rismista — si rigenera con l'agente del thread. Redo su
  // una room è raro e reinterrogare il router costerebbe un giro per cambiare voce a metà.
  const roomPlan = isRedo
    ? null
    : await roomBeat(supabase, {
        thread: { id: threadId, room_agents: threadRoomAgents },
        brandId: brand.id,
        userId: userId,
        userMessage: lastUserText(body.messages as ModelMessage[] | undefined),
        locale
      });
  const roomSpeaker: RoomMember | null = roomPlan?.speakers[0] ?? null;

  // Selector sends the current agent each turn (model-style): authoritative for this run,
  // and we persist a switch so resume/background runs agree. Falls back to thread agent, then null.
  // Web agent is coerced off unpaid brands (same lock as the sidebar hub).
  const bodyAgent = resolveAgentForPlan(body.agent, webHubEnabled);
  const agentId = roomSpeaker
    ? resolveAgentForPlan(roomSpeaker.agent, webHubEnabled)
    : (bodyAgent ?? resolveAgentForPlan(threadAgent, webHubEnabled));
  if (!roomSpeaker && bodyAgent && bodyAgent !== threadAgent) {
    await setThreadAgent(supabase, threadId, brand.id, userId, bodyAgent);
  }

  // A thread can be pointed at one of the user's custom agents: its brief rides along as the
  // persona, and the pick is remembered on the thread so background turns agree.
  const bodyCustomAgent =
    typeof body.customAgentId === 'string' && body.customAgentId ? body.customAgentId : null;
  const customAgentId = roomSpeaker
    ? roomSpeaker.customAgentId
    : body.customAgentId === null
      ? null
      : (bodyCustomAgent ?? threadCustomAgentId);
  // In una stanza NON si scrive niente sul thread: l'agente e il persona cambiano a ogni battuta,
  // e inciderli sulla riga vorrebbe dire che l'ultimo che ha parlato diventa il padrone del thread.
  if (!roomSpeaker && customAgentId !== threadCustomAgentId) {
    await setThreadCustomAgent(supabase, threadId, brand.id, userId, customAgentId);
  }
  // Un agente custom è un'identità a sé anche per la memoria: `custom:<uuid>`, la stessa
  // grammatica di agent-owners.ts.
  const memoryAgentKey = customAgentId ? `custom:${customAgentId}` : agentId;
  const persona = customAgentId
    ? await getCustomAgentPersona(supabase, brand.id, customAgentId)
    : null;

  let systemPrompt = await buildSystemPrompt(supabase, brand, locale, agentId, {
    memoryAgent: memoryAgentKey,
    webHubEnabled,
    threadId,
    userId: userId
  });
  if (persona) {
    systemPrompt += customAgentSystemBlock(persona, locale);
    void touchThreadAgentRun(supabase, {
      brandId: brand.id,
      threadId,
      scheduleId: persona.id
    });
  }
  // Dove sei, con chi, e che gli altri leggono. Senza, l'agente scrive come se fosse solo.
  if (roomPlan && roomSpeaker) {
    systemPrompt += roomSystemBlock(roomPlan.members, roomSpeaker.key, locale);
  }
  const lang = bilingualNoticeLocale(locale) === 'it' ? 'Italian' : 'English';
  const mode: ChatMode = isChatMode(body.mode) ? body.mode : 'agent';
  systemPrompt += `\n\n${modeSystemBlock(mode, lang)}`;

  // Client sends the live workbench (active tab + open tabs) so the model always knows what the user sees.
  const wb = body.workbench as
    | { activeHref?: string; activeLabel?: string; tabs?: Array<{ href?: string; label?: string }> }
    | undefined;
  if (wb && typeof wb.activeHref === 'string' && wb.activeHref) {
    const tabLines = Array.isArray(wb.tabs)
      ? wb.tabs
          .filter((t) => t && typeof t.href === 'string')
          .map((t) => `- ${t.label ?? t.href} (${t.href})`)
          .join('\n')
      : '';
    systemPrompt += `\n\n## LIVE WORKBENCH (what the user sees right now)
Active tab: ${typeof wb.activeLabel === 'string' && wb.activeLabel ? wb.activeLabel : '(unknown)'} — ${wb.activeHref}
Open tabs:
${tabLines || '(none listed)'}
This is the UI state for THIS turn only — ground truth for "what am I looking at / where am I / what's on screen".
When the user asks that (or similar), answer with the active tab label + a one-line plain-language description of that page. Do not invent a different screen. Prefer propose_open_tab when you want them to switch — never assume they already switched.`;
  }

  const commandTool = typeof body.command === 'string' ? body.command.trim() : '';
  if (commandTool) {
    systemPrompt += `\n\n## USER-SELECTED COMMAND
The user picked the in-chat command that maps to tool "${commandTool}". Prioritize calling that tool this turn when it fits their message.`;
  }

  const refUrls = isRedo ? [] : await resolveChatAttachments(supabase, brand.id, body.attachments);
  const turnDocuments: ChatDocument[] = isRedo
    ? []
    : await hydrateChatDocuments(supabase, userId, brand.id, parseChatDocuments(body.documents));
  if (refUrls.length) {
    systemPrompt += `\n\n## ATTACHED REFERENCE IMAGES
The user attached ${refUrls.length} image(s) for THIS turn (also visible as multimodal parts on their message). Use them as visual reference when relevant.`;
  }
  if (turnDocuments.length) {
    systemPrompt += `\n\n## ATTACHED DOCUMENTS
The user attached ${turnDocuments.length} file(s) converted to markdown for THIS turn. Small files are inlined in the user message. Large files: summarize_attachment → grep_attachment → read_attachment (start_from = heading @index, max_chars ≤ 12000) — do not dump the whole file, do not guess unread pages. They are NOT brand knowledge yet. Only call add_document if the user asks to save them, or it clearly belongs in the corpus — pass from_attachment with the filename so the FULL text is stored.`;
  }

  // Cosa ha già consegnato in questa conversazione. Senza, al terzo turno l'agente ripubblica lo
  // stesso report con un altro nome e l'utente si ritrova tre card che dicono la stessa cosa.
  if (threadId) {
    const published = await listThreadArtifacts(supabase, threadId, brand.id, 20).catch(() => []);
    const block = formatArtifactsForPrompt(published);
    if (block) systemPrompt += `\n\n${block}`;
  }

  // Il budget di tempo del turno nasce più in basso (chatTurnDeadline), ma i tool si costruiscono
  // qui: questo è il ponte, così una delega o un render MP4 non partono quando al turno restano
  // pochi secondi. Dichiarato PRIMA di createChatTools perché anche i tool della chat (il render
  // motion) devono poter leggere il tempo rimasto via closure.
  const customTools = createChatTools(
    supabase,
    brand.id,
    brand.timezone ?? 'Europe/Rome',
    userId,
    origin,
    locale,
    threadId,
    cookieHeader,
    // What the user attached this turn goes to the renderer as a real reference image, not as a
    // description in the prompt — the whole point of attaching a photo.
    refUrls,
    turnDocuments,
    // Chi risponde in QUESTO turno, per firmare gli sticker di set_expression: la UI lo leggeva
    // dal picker aperto in quel momento, e cambiare agente ricolorava lo scrollback.
    agentStickerColor(agentId ?? '', persona?.color),
    // Senza questo, render_motion_video in chat apriva un lease da 900s dentro un turno da 300.
    () => deadlineRef.current?.remainingMs() ?? Number.POSITIVE_INFINITY,
    // Sotto quale identità legge e scrive la memoria di mestiere (brand-memory.ts).
    memoryAgentKey
  );

  // Le chiavi dei membri della stanza, se questo thread è una stanza: servono a due filtri.
  let delegableRoomKeys: string[] = [];
  // Specialty ∩ mode ∩ plan: agent scopes competence, mode gates writes, unpaid strips Web/blog.
  let tools = filterToolsForMode(pickTools({ ...customTools }, agentId), mode) as typeof customTools;
  if (!webHubEnabled) tools = stripWebHubTools(tools) as typeof customTools;
  // In una stanza i colleghi non si consultano in privato: parlano loro, dopo di te. I membri
  // spariscono quindi dai destinatari possibili, qui dove i tool si montano. Vedi stripRoomPeerTools.
  if (roomPlan) {
    const keys = roomPlan.members.map((m) => m.key);
    tools = stripRoomPeerTools(tools, keys) as typeof customTools;
    delegableRoomKeys = keys;
  }
  // Quello che l'agente poteva fare PRIMA della restrizione per hub: è il tetto dei sotto-agenti.
  // Modalità e piano ci sono già passati sopra — una delega non riapre una porta chiusa qui.
  let delegable = filterToolsForMode({ ...customTools }, mode) as typeof customTools;
  if (!webHubEnabled) delegable = stripWebHubTools(delegable) as typeof customTools;
  if (delegableRoomKeys.length) delegable = stripRoomPeerTools(delegable, delegableRoomKeys) as typeof customTools;

  // Attachments become multimodal image parts when the resolved model can see them (Gemini / kie).
  // DeepSeek Fast cannot — those turns strip pixels and note it in the system prompt.
  // `userText` alimenta la scalata Auto→Pro (vedi isHeavyProductionAsk): sul redo il testo arriva
  // solo più avanti dalla history, e un redo riparte col tier di prima — niente scalata lì.
  const escalationText = !isRedo && userMessages?.length
    ? (() => {
        const lm = userMessages[userMessages.length - 1];
        return typeof lm.content === 'string'
          ? lm.content
          : Array.isArray(lm.content)
            ? (lm.content as Array<{ type?: string; text?: string }>)
                .filter((p) => p.type === 'text')
                .map((p) => p.text ?? '')
                .join('\n')
            : '';
      })()
    : '';
  const chatModel = resolveChatModel(body.tier, body.reasoning, {
    vision: refUrls.length > 0,
    userText: escalationText,
    // Su Auto: motion → Grok, altri specialisti / generalista → Luna (catalogo + AgentSpec.model).
    agentId,
    model: modelPref
  });
  // La delega arriva dopo il modello, perché un sotto-agente gira sul modello del turno.
  tools = withSubagentTools(tools, {
    supabase,
    brandId: brand.id,
    tools: delegable,
    model: chatModel,
    locale,
    userId,
    threadId,
    webHubEnabled,
    defaultAgent: agentId,
    origin,
    remainingMs: () => deadlineRef.current?.remainingMs() ?? Number.POSITIVE_INFINITY
  });
  // La macchina in mano a chi parla, non solo al sotto-agente `sandbox`: due comandi al volo non
  // devono costare una delega intera. `compute` — chi deve navigare continua a delegare.
  const sandboxMount = withSandboxTools(tools, {
    supabase,
    brandId: brand.id,
    userId,
    threadId,
    agentId: computerOwner(customAgentId, agentId),
    webHubEnabled,
    remainingMs: () => deadlineRef.current?.remainingMs() ?? Number.POSITIVE_INFINITY
  });
  tools = sandboxMount.tools;

  const canSeeImages = modelSeesImages(chatModel);
  const canSeeVideo = modelSeesVideo(chatModel);
  const historyMedia: HistoryMedia = !canSeeImages ? 'none' : canSeeVideo ? 'images+video' : 'images';
  if (refUrls.length && !canSeeImages) {
    systemPrompt += `\n\nThe attached image(s) could NOT be passed to this model — say so plainly if the user's request depends on seeing them, and suggest switching model, instead of guessing at their content.`;
  }

  return {
    roomPlan, roomSpeaker, agentId, customAgentId, memoryAgentKey, persona, systemPrompt, mode,
    refUrls, turnDocuments, customTools, tools, delegable, sandboxMount, chatModel,
    canSeeImages, canSeeVideo, historyMedia, escalationText
  };
}

type BuiltMessages = {
  ok: true;
  regeneratedFrom: string | undefined;
  history: ModelMessage[];
  lastUserMsg: ModelMessage;
  messages: ModelMessage[];
  textContent: string;
};

/**
 * Cronologia + battuta dell'utente, redo compreso. Risponde con la Response d'errore originale
 * quando la richiesta non è riparabile, altrimenti con i pezzi che il turno consuma.
 */
export async function buildTurnMessages(input: {
  supabase: SupabaseClient;
  brand: {
    id: string;
    plan?: string | null;
    status?: string | null;
    timezone?: string | null;
    activated_at?: string | null;
  };
  userId: string;
  threadId: string;
  body: Record<string, unknown>;
  userMessages: ModelMessage[] | undefined;
  isRedo: boolean;
  historyMedia: HistoryMedia;
  canSeeImages: boolean;
  canSeeVideo: boolean;
  refUrls: string[];
  turnDocuments: ChatDocument[];
  locale?: string;
}): Promise<{ response: Response } | BuiltMessages> {
  const { supabase, brand, userId, threadId, body, userMessages, isRedo, historyMedia, canSeeImages, canSeeVideo, refUrls, turnDocuments, locale } = input;

  // ── History + user turn ──────────────────────────────────────────────
  // redo: supersede the assistant reply (+ everything after), regenerate from the prior user msg.
  // truncate_from_message_id: supersede that row (+ after) before saving a new user turn
  //   (resend / edit — same server-side truncate the client used to fake with slice).
  let regeneratedFrom: string | undefined;
  let history: ModelMessage[];
  let lastUserMsg: ModelMessage;
  let messages: ModelMessage[];
  let textContent: string;

  if (isRedo) {
    const messageId = typeof body.message_id === 'string' ? body.message_id : '';
    if (!messageId) return { response: new Response('message_id required', { status: 400 }) };

    const target = await supersedeFromMessage(supabase, brand.id, userId, threadId, messageId);
    if (!target) return { response: new Response('Message not found', { status: 404 }) };
    if (target.role !== 'assistant') {
      return { response: new Response('redo requires an assistant message', { status: 400 }) };
    }

    regeneratedFrom = target.id;
    history = await loadHistory(supabase, brand.id, userId, threadId, 50, historyMedia);
    const priorUser = [...history].reverse().find((m) => m.role === 'user');
    if (!priorUser) return { response: new Response('No user message to redo', { status: 400 }) };

    lastUserMsg = priorUser;
    // A turn with attachments now carries array content, so reading only the string case recorded an
    // empty user_message on the redo job.
    textContent =
      typeof priorUser.content === 'string'
        ? priorUser.content
        : (priorUser.content ?? [])
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('');
    // History already ends at the user turn — do not append or re-save it.
    messages = history;
  } else {
    const truncateFrom =
      typeof body.truncate_from_message_id === 'string' ? body.truncate_from_message_id : '';
    if (truncateFrom) {
      const cut = await supersedeFromMessage(supabase, brand.id, userId, threadId, truncateFrom);
      if (!cut) return { response: new Response('truncate_from_message_id not found', { status: 404 }) };
    }

    history = await loadHistory(supabase, brand.id, userId, threadId, 50, historyMedia);
    lastUserMsg = userMessages![userMessages!.length - 1];

    textContent =
      typeof lastUserMsg.content === 'string'
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg.content)
          ? (lastUserMsg.content as Array<{ type?: string; text?: string }>)
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('\n')
          : '';

    const persistText =
      (textContent + formatAttachedDocsBlock(turnDocuments, CHAT_HISTORY_DOC_CAP)).trim() ||
      (refUrls.length ? `[${refUrls.length} image(s) attached]` : '');
    const modelText = textContent + formatAttachedDocsForModel(turnDocuments);

    const persistMsg: ModelMessage = {
      role: 'user',
      content: refUrls.length ? `${persistText}\n[${refUrls.length} image(s) attached]` : persistText
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelUserMsg: any =
      refUrls.length > 0 && canSeeImages
        ? {
            role: 'user',
            content: [
              { type: 'text', text: modelText || textContent },
              // A clip has to ride as a file part — labelling it an image makes the model blind to
              // it — but only where the provider accepts video at all.
              ...(canSeeVideo
                ? attachmentParts(refUrls)
                : withoutVideo(attachmentParts(refUrls)))
            ]
          }
        : { role: 'user', content: modelText || textContent };

    // Retry of a turn that saved its user message and then died before any reply:
    // the row is already there, so reuse it instead of inserting a twin. Nothing else
    // can leave a trailing user turn — a normal turn always ends on the assistant.
    const tail = history[history.length - 1];
    const isRetryOfDeadTurn = tail?.role === 'user' && tail.content === persistMsg.content;
    if (isRetryOfDeadTurn) history = history.slice(0, -1);

    messages = [...history, modelUserMsg];

    // Save the user message immediately so it's never lost — with its images, kept in the bucket
    // so the bubble can still show them on every future reload.
    if (!isRetryOfDeadTurn) {
      const attachments = refUrls.length ? await persistChatAttachments(supabase, userId, refUrls) : [];
      await saveMessages(supabase, brand.id, userId, [persistMsg], threadId, {
        ...(attachments.length ? { attachments } : {})
      });
    }
  }

  await attachTurnVolatile(supabase, brand, locale ?? 'en', messages);

  return { ok: true, regeneratedFrom, history, lastUserMsg, messages, textContent };
}

/**
 * La busta volatile del turno (crediti, orologio, notifiche) viaggia SUL messaggio che stimola il
 * modello, mai nel system prompt né nella persistenza: il prefisso comune fra turni consecutivi
 * resta intatto e i provider cachano tutta la storia.
 */
async function attachTurnVolatile(
  supabase: SupabaseClient,
  brand: Parameters<typeof buildTurnVolatileBlock>[1],
  locale: string,
  messages: ModelMessage[]
): Promise<void> {
  const block = await buildTurnVolatileBlock(supabase, brand, locale).catch(() => '');
  if (!block) return;
  const idx = messages.findLastIndex((m) => m.role === 'user');
  if (idx >= 0) messages[idx] = wrapTurnMessage(block, messages[idx]);
}

/**
 * `/goal <testo>`: l'obiettivo lo detta la persona. Si applica QUI e non nel client perché un
 * comando che vive solo nel browser non è un comando — dalla CLI, da un incarico ricorrente o da
 * un'altra superficie sarebbe testo normale. Le due forme che non meritano un turno di modello
 * (guardarlo, chiuderlo) hanno la loro scorciatoia più in alto: qui arriva quello che il modello
 * deve davvero eseguire.
 */
export async function applyGoalCommand(input: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId: string;
  textContent: string;
  locale: string;
  goalModeActive: boolean;
}): Promise<ReturnType<typeof parseGoalCommand>> {
  const { supabase, brandId, userId, threadId, textContent, locale, goalModeActive } = input;

  // PRIMA del ramo kit, non dopo: sui thread degli specialisti il comando cadeva nel vuoto perché
  // il turno se n'era già andato. La riga in `chat_goals` è la stessa per i due motori, e il kit la
  // ritrova da sé nel briefing del prompt.
  const goalCmd = parseGoalCommand(textContent);
  if (goalCmd?.kind === 'set' && goalModeActive) {
    // Nasce senza criteri: la meta è dell'utente, scomporla in fatti verificabili è il primo
    // lavoro dell'agente. La riga esiste comunque, così il comando ha un effetto anche se il
    // modello sbaglia il primo passo — e il turno dopo se lo ritrova davanti.
    await setThreadGoal(supabase, {
      brandId,
      userId,
      threadId,
      statement: goalCmd.statement,
      criteria: [],
      source: 'user'
    }).catch((e) => {
      console.error('[Chat] /goal set failed:', e);
      return null;
    });
  } else if (goalCmd?.kind === 'stop') {
    const current = await loadOpenGoal(supabase, threadId).catch(() => null);
    if (current) {
      await closeGoal(
        supabase,
        current.id,
        'abandoned',
        bilingualNoticeLocale(locale) === 'en' ? 'Closed by the user.' : "Chiuso dall'utente."
      ).catch(() => null);
    }
  }
  return goalCmd;
}

/**
 * Schermata AI Act e briefing obiettivo attaccati al prompt di sistema. Gira DOPO il ramo kit
 * (che esce prima), quindi riceve e ridà il prompt aggiornato insieme allo stato di partenza.
 */
export async function applyTurnBriefings(input: {
  supabase: SupabaseClient;
  brand: { id: string };
  threadId: string;
  textContent: string;
  locale: string;
  goalModeActive: boolean;
  goalCmd: ReturnType<typeof parseGoalCommand>;
  systemPrompt: string;
}): Promise<{
  aiActHits: PracticeHit[];
  systemPrompt: string;
  goalAtStart: Awaited<ReturnType<typeof loadOpenGoal>>;
}> {
  const { supabase, brand, threadId, textContent, locale, goalModeActive, goalCmd, systemPrompt } = input;

  // ── AI Act screen (Art. 5 blacklist) ─────────────────────────────────
  // Both sides have to know: the model gets the matched practice so it can refuse the right part
  // and name the article, and the user gets a notice in the transcript so a refusal is never just
  // the assistant being unhelpful. The screen is a heuristic and says so — it informs, it never
  // blocks the turn.
  const aiActHits: PracticeHit[] = screenForProhibitedPractice(textContent, locale);
  let prompt = systemPrompt;
  if (aiActHits.length) {
    prompt += `\n\n${aiActTurnBriefing(aiActHits)}`;
    console.log(
      `[AI Act] blacklist screen matched ${aiActHits.map((h) => h.id).join(', ')} brand=${brand.id} thread=${threadId}`
    );
  }

  // ── Obiettivo del thread ─────────────────────────────────────────────
  // Un obiettivo aperto sopravvive al turno che lo ha aperto: rientra nel prompt a ogni giro, o al
  // secondo turno l'agente non saprebbe più di averlo. Lo stato di PARTENZA resta in mano al turno
  // perché a fine corsa serve la differenza — quanti criteri si sono chiusi qui dentro — e non
  // basta lo stato finale per saperlo.
  const goalAtStart = goalModeActive ? await loadOpenGoal(supabase, threadId).catch(() => null) : null;
  if (goalAtStart) {
    prompt += `\n\n${goalBriefing(goalAtStart, locale)}`;
  } else if (goalModeActive && goalWorthyRequest(textContent)) {
    prompt += `\n\n${goalNudge(locale)}`;
  }
  if (goalCmd) {
    prompt += goalModeActive
      ? `\n\n${goalCommandInstruction(goalCmd, locale)}`
      : `\n\n${
          bilingualNoticeLocale(locale) === 'en'
            ? 'The user tried to set a goal, but this chat is in ASK mode, which has no tools to work on one. Say so in one line and suggest switching to Agent or Plan.'
            : "L'utente ha provato a fissare un obiettivo, ma questa chat è in modalità ASK, che non ha i tool per portarlo avanti. Dillo in una riga e proponi di passare ad Agent o Plan."
        }`;
  }
  return { aiActHits, systemPrompt: prompt, goalAtStart };
}
