import type { ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { judgeTurnShadow } from '$lib/server/chat/controller';
import {
  assistantContentFromSteps,
  getThread,
  renameThread,
  saveMessages
} from '$lib/server/chat/persistence';
import { extractMemoryFromChat } from '$lib/server/brand-memory';
import { extractSdkUsage, logAiCall } from '$lib/server/ai-log';
import { resolveChatModel } from '$lib/server/chat/model';
import { sourcesFromSteps } from '$lib/chat-sources';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import {
  goalTurnNotice,
  loadOpenGoal,
  refusedToolNames,
  settleGoalForTurn,
  succeededToolNames,
  trackGoalSettlement,
  type TurnStep
} from '$lib/server/chat/goal';
import { GOAL_TOOL_KEYS } from '$lib/agent/tools/goal-tools';
import {
  MOTION_MAX_CONTINUATIONS,
  decideMotionContinuation,
  motionUnfinishedNotice
} from '$lib/server/motion-video/unfinished';
import { enqueueTurnContinuation } from '$lib/server/chat/queue';
import { roomContinue, type RoomMember } from '$lib/server/chat/room';
import {
  CHAT_MAX_CONTINUATIONS,
  chatTokenBudget,
  chatTurnDeadline,
  turnTokenBudgetNotice,
  turnTruncatedNotice
} from '$lib/server/chat/turn-limits';
import { turnLoopNotice } from '$lib/server/chat/loop-guard';
import type { createChatLoopGuard } from '$lib/server/chat/loop-guard';
import type { createChatTools } from '$lib/agent/tools/index';
import type { ChatMode } from '$lib/chat-modes';
import { isChatTier } from '$lib/chat-tiers';
import { unverifiedProductionClaim, recentPostsProbe } from '$lib/server/chat/production-claim';
import { parseGoalCommand } from '$lib/goal-command';
import { aiActUserNotice, type PracticeHit } from '$lib/ai-act';
import { isJobCancelled, scheduleQueueKick, type Platform } from './jobs';

type FinishUsage = { inputTokens?: number; outputTokens?: number } | undefined;
type FinishModel = ReturnType<typeof resolveChatModel>;
type FinishLoopGuard = ReturnType<typeof createChatLoopGuard>;
type FinishBudget = ReturnType<typeof chatTokenBudget>;
type FinishDeadline = ReturnType<typeof chatTurnDeadline>;
type FinishTools = ReturnType<typeof createChatTools>;
type FinishSteps = Parameters<typeof assistantContentFromSteps>[0];

/**
 * Il percorso felice di fine turno, dal log d'apertura al kick della coda. Riceve tutto per
 * argomento e non riscrive nulla del chiamante: il catch che la circonda resta nel percorso
 * principale, con il suo salvataggio di parziale e il report operativo.
 */
export async function finishSuccessfulTurn(input: {
  supabase: SupabaseClient;
  brand: { id: string; slug: string | null };
  user: { id: string };
  params: { brand: string };
  body: Record<string, unknown>;
  threadId: string;
  jobId: string | undefined;
  chatT0: number;
  origin: string;
  platform: Platform;
  locale: string;
  mode: ChatMode;
  chatModel: FinishModel;
  textContent: string;
  history: ModelMessage[];
  lastUserMsg: ModelMessage;
  regeneratedFrom: string | undefined;
  goalModeActive: boolean;
  goalAtStart: Awaited<ReturnType<typeof loadOpenGoal>>;
  goalCmd: ReturnType<typeof parseGoalCommand>;
  continuationDepth: number;
  loopGuard: FinishLoopGuard;
  tokenBudget: FinishBudget;
  deadline: FinishDeadline;
  customTools: FinishTools;
  aiActHits: PracticeHit[];
  roomPlan: unknown;
  roomSpeaker: RoomMember | null;
  threadRoomAgents: unknown;
  persistStopped: (steps?: unknown, text?: string) => Promise<void>;
  steps: FinishSteps;
  text: string | undefined;
  totalUsage: FinishUsage;
}): Promise<void> {
  const {
    supabase, brand, user, params, body, threadId, jobId, chatT0, origin, platform, locale, mode,
    chatModel, textContent, history, lastUserMsg, regeneratedFrom, goalModeActive, goalAtStart,
    goalCmd, continuationDepth, loopGuard, tokenBudget, deadline, customTools, aiActHits,
    roomPlan, roomSpeaker, threadRoomAgents, persistStopped, steps, text, totalUsage
  } = input;

  console.log(`[Chat onFinish] threadId=${threadId}, jobId=${jobId}, textLen=${text?.length ?? 0}, usage=${JSON.stringify(totalUsage)}`);
  const costUsd = totalUsage?.inputTokens != null || totalUsage?.outputTokens != null ? 'has-tokens' : 'NO-TOKENS';
  console.log(`[Chat onFinish] brandId=${brand.id}, tier=${chatModel.tier}, provider=${chatModel.provider}, model=${chatModel.modelId}, tokens=${costUsd}`);
  // One aggregated row per user message (usage summed across all tool-calling steps),
  // mirroring how director.ts logs its multi-call runs.
  logAiCall({
    label: 'chat',
    provider: chatModel.provider,
    model: chatModel.modelId,
    ms: Date.now() - chatT0,
    ok: true,
    ...extractSdkUsage(totalUsage),
    brandId: brand.id,
    userId: user.id,
    threadId,
    // Effort rides in the context so a slow or pricey turn is explainable after the fact.
    context: `chat:${chatModel.tier}:${chatModel.reasoning}`
  });
  // ── Obiettivo: il turno è finito, il lavoro può non esserlo ──────────────────
  // Si regola PRIMA di comporre la risposta, e la ripresa si mette in coda prima di salvare
  // il messaggio, per una ragione sola: la riga di chiusura deve dire la verità su cosa
  // succede dopo. "Riprendo in background" scritto e poi non fatto è peggio del silenzio.
  // Il turno si è fermato sulla domanda (hasToolCall in stopWhen): nessuna ripresa automatica,
  // per nessuna ragione. Una continuazione qui risponderebbe alla domanda al posto dell'utente.
  const awaitingAnswer = (steps ?? []).some((st: { toolCalls?: Array<{ toolName: string }> }) =>
    st.toolCalls?.some((tc) => tc.toolName === 'ask_user_questions')
  );
  // Il turno ha lavorato, o ha solo raccontato? Serve a `settleGoalForTurn` per decidere se
  // una chiusura scritta in prosa («c1 chiuso») vale come chiusura vera. Vedi goal.ts —
  // e conta il RISULTATO: due tool che tornano entrambi `error` non sono lavoro.
  const succeededTools = succeededToolNames(steps as TurnStep[], GOAL_TOOL_KEYS);
  const refusedTools = refusedToolNames(steps as TurnStep[], GOAL_TOOL_KEYS);
  void judgeTurnShadow({
    brandId: brand.id,
    userId: user.id,
    threadId,
    userAsk: textContent,
    replyText: text ?? '',
    succeededTools
  }).catch(() => undefined);
  const goalSettled = !goalModeActive
    ? null
    : await settleGoalForTurn(supabase, {
        threadId,
        goalAtStart,
        awaitingAnswer,
        turnText: text ?? '',
        succeededTools,
        refusedTools,
        knownTools: Object.keys(customTools),
        timeRanOut: deadline.expired && !loopGuard.stalled,
        loopStalled: loopGuard.stalled,
        aborted: false,
        failed: false,
        depth: continuationDepth,
        maxDepth: CHAT_MAX_CONTINUATIONS,
        locale
      }).catch((e) => {
        console.error('[Chat onFinish] goal settle failed:', e);
        return null;
      });
  // Il lavoro non è finito: riprendi da solo invece di lasciare mezzo batch fatto e nessun
  // segnale. Due ragioni per farlo — il tempo scaduto (come prima degli obiettivi) e i criteri
  // ancora aperti (la novità) — e mai dopo uno stallo, che riprenderebbe lo stesso ciclo.
  // Senza obiettivo (modalità ASK, o un errore nel calcolo) resta esattamente la regola di
  // prima: una funzione nuova non deve togliere una ripresa che questo progetto faceva già.
  /**
   * IL VIDEO NON FINITO. Questa superficie non ha un `finish` come la pagina
   * `/motion-video`, quindi finora si fermava quando il modello smetteva di parlare: con una
   * mediana di 26 secondi su un budget di 1735, la ripresa per tempo scaduto non si armava
   * mai. Vedi motion-video/unfinished.ts per la definizione di «finito» e i tre freni.
   */
  const motionUnfinished =
    awaitingAnswer || loopGuard.stalled
      ? null
      : await decideMotionContinuation(supabase, {
          brandId: brand.id,
          threadId,
          depth: continuationDepth,
          steps: steps as never,
          locale
        }).catch((e) => {
          console.error('[Chat onFinish] motion continuation check failed:', e);
          return null;
        });
  // Un turno fermato dal tetto sui token NON si riprende da solo: riprenderlo è il modo più
  // diretto di raddoppiare la spesa che il tetto è lì per fermare. Stessa regola dello stallo.
  const shouldContinue =
    !awaitingAnswer &&
    !tokenBudget.exceeded &&
    (motionUnfinished?.continue === true ||
      (goalSettled ? goalSettled.decision.continue : deadline.expired && !loopGuard.stalled));
  let continuationJobId: string | null = null;
  if (shouldContinue) {
    continuationJobId = await enqueueTurnContinuation(supabase, {
      brandId: brand.id,
      userId: user.id,
      threadId,
      origin,
      locale,
      mode,
      tier: isChatTier(body.tier) ? body.tier : undefined,
      reasoning: typeof body.reasoning === 'string' ? body.reasoning : undefined,
      depth: continuationDepth,
      // Un video da finire ne chiede 24 come la pagina; una conversazione resta a 9.
      ...(motionUnfinished?.continue ? { maxDepth: MOTION_MAX_CONTINUATIONS } : {}),
      ...(goalSettled?.continuationPrompt
        ? { prompt: goalSettled.continuationPrompt }
        : motionUnfinished?.prompt
          ? { prompt: motionUnfinished.prompt }
          : {})
    });
  }

  if (goalSettled) {
    trackGoalSettlement(supabase, goalSettled, {
      brandId: brand.id,
      userId: user.id,
      threadId,
      depth: continuationDepth,
      queued: !!continuationJobId
    });
  }

  const content = assistantContentFromSteps(steps, text);
  // The AI Act notice leads the reply: what the model says about a flagged request is its
  // own wording, but the user is entitled to the practice, the article and the reason from
  // us, in the transcript, every time the screen fires.
  if (aiActHits.length) {
    content.unshift({ type: 'text', text: aiActUserNotice(aiActHits, locale) });
  }
  // Stopped on the clock, not on the answer. Say so in the transcript — otherwise a turn cut
  // off after 6 of 10 articles reads as a finished, and wrong, report.
  if (tokenBudget.exceeded) {
    console.warn(
      `[Chat] token budget stop threadId=${threadId}, jobId=${jobId}, used=${tokenBudget.usedTokens}, budget=${tokenBudget.budget}, steps=${steps.length}`
    );
    content.push({
      type: 'text',
      text: turnTokenBudgetNotice(locale, tokenBudget.usedTokens, tokenBudget.budget)
    });
  } else if (loopGuard.stalled) {
    content.push({ type: 'text', text: turnLoopNotice(locale) });
  } else if (deadline.expired) {
    // `willContinue` è ora un fatto, non una previsione: la ripresa è già in coda o non c'è.
    content.push({ type: 'text', text: turnTruncatedNotice(locale, !!continuationJobId) });
  }
  // Il giro sul video si è fermato senza consegnare: si dice, con il motivo. Un ciclo che si
  // chiude in silenzio è indistinguibile da un lavoro finito.
  {
    const line = motionUnfinishedNotice(motionUnfinished, locale);
    if (line) content.push({ type: 'text', text: line });
  }
  // E sotto, quando c'è un obiettivo, cosa manca davvero — con i nomi dei criteri, perché
  // "non ho finito" senza la lista è esattamente ciò che costringe l'utente ad andare a
  // controllare a mano.
  if (goalSettled) {
    const goalLine = goalTurnNotice(
      goalSettled.goal,
      goalSettled.decision,
      locale,
      !!continuationJobId,
      goalSettled.closedNow
    );
    if (goalLine) content.push({ type: 'text', text: goalLine });
  }
  // Lavoro dichiarato e mai fatto: se il turno dice di aver PRODOTTO contenuti e nessun tool
  // ha restituito un artefatto (né il database ne ha di freschi), si chiude con la
  // correzione onesta invece che con la bugia. Vedi production-claim.ts.
  const claimFix = await unverifiedProductionClaim({
    content,
    locale,
    goalOpen: !!goalSettled?.goal,
    hasRecentArtifacts: recentPostsProbe(supabase, brand.id)
  });
  if (claimFix) content.push({ type: 'text', text: claimFix });
  const sources = sourcesFromSteps(steps, brand.slug ?? params.brand);
  /** Row the memory→message `derived_from` edge points at. */
  let assistantMessageId: string | undefined;

  // Save assistant message server-side (survives client disconnect)
  if (content.length > 0) {
    // Race with Stop: still keep the reply, just mark the job cancelled.
    if (await isJobCancelled(supabase, jobId)) {
      console.log(`[Chat onFinish] race with stop — salvaging jobId=${jobId}`);
      try {
        await persistStopped(steps, text);
      } catch (e) {
        console.error('[Chat onFinish] stop race persist failed:', e);
      }
      scheduleQueueKick(platform as Platform, origin);
      return;
    }
    const [savedId] = await saveMessages(
      supabase,
      brand.id,
      user.id,
      [{ role: 'assistant', content } as unknown as ModelMessage],
      threadId,
      {
        ...(regeneratedFrom ? { regeneratedFrom } : {}),
        durationMs: Date.now() - chatT0,
        model: chatModel.modelId,
        tier: chatModel.tier,
        inputTokens: totalUsage?.inputTokens,
        outputTokens: totalUsage?.outputTokens,
        ...(sources.length ? { sources } : {}),
        // Chat di gruppo: la battuta è firmata col membro che parla (chat_messages.name),
        // che è quello che permette alla UI di metterci sopra nome e volto giusti.
        ...(roomSpeaker ? { speaker: roomSpeaker.key } : {})
      }
    );
    assistantMessageId = savedId;
    console.log(`[Chat onFinish] Saved assistant message to DB`);
  }

  // ── La battuta continua? ───────────────────────────────────────────────────────────────
  // Non c'è più un piano di N voci deciso prima del turno: si decide UNA voce alla volta,
  // ogni volta guardando quello che è appena stato detto (`roomContinue`). Il router costa
  // ~1/700 di una voce, quindi chiedere di nuovo è gratis e la risposta normale è "nessuno".
  //
  // Sta QUI, dopo il salvataggio e prima della chiusura del job, e l'ordine è il
  // meccanismo: in questa finestra il job è ancora `running`, quindi il drenaggio salta il
  // thread (`threadHasActiveChatResponse`) e la voce accodata non può partire sopra questa.
  // Invertire queste due scritture farebbe parlare due agenti insieme.
  //
  // STOP FERMA LA CATENA: se l'utente ha premuto Stop non si accoda niente. Un utente che
  // preme Stop e vede arrivare altre due voci non pensa "si sta fermando", pensa che il
  // prodotto non gli obbedisce.
  if (roomPlan && !(await isJobCancelled(supabase, jobId))) {
    await roomContinue(supabase, {
      thread: { id: threadId, room_agents: threadRoomAgents },
      brandId: brand.id,
      userId: user.id,
      userMessage: textContent,
      locale,
      origin,
      mode,
      tier: isChatTier(body.tier) ? body.tier : undefined
    });
  }

  // Update job status to done
  if (jobId) {
    // Anche da 'failed': se siamo QUI il turno ha finito davvero — il reaper lo aveva dato
    // per morto (heartbeat in stallo: event loop bloccato, laptop in sleep, dev server
    // sotto carico) e può aver già promosso il partial come messaggio. Quel salvataggio ora
    // è un doppione della risposta piena appena salvata: si supersede e la riga torna done.
    const { data: jobNow } = await supabase
      .from('chat_jobs')
      .select('status, result')
      .eq('id', jobId)
      .maybeSingle();
    const salvagedId = (jobNow?.result as { salvaged_message_id?: string } | null)
      ?.salvaged_message_id;
    // Solo se una risposta piena è stata salvata DAVVERO: senza, il salvataggio del reaper
    // resta l'unica traccia del turno e non va toccato.
    if (jobNow?.status === 'failed' && salvagedId && assistantMessageId) {
      await supabase
        .from('chat_messages')
        .update({ superseded: true })
        .eq('id', salvagedId)
        .eq('thread_id', threadId)
        .then(undefined, () => {});
    }
    await supabase.from('chat_jobs').update({
      status: 'done',
      error: null,
      // The saved message is the record now — drop the live snapshot.
      partial: null,
      result: { text_length: text?.length ?? 0 },
      completed_at: new Date().toISOString()
    }).eq('id', jobId).in('status', ['pending', 'running', 'failed']);
  }

  // Web Push when the user opted in (best-effort; no-op without VAPID / subscriptions)
  try {
    const { sendPushToUser } = await import('$lib/server/web-push');
    const readyBody =
      bilingualNoticeLocale(locale) === 'en' ? 'Your AI reply is ready' : "L'AI ha finito di rispondere";
    await sendPushToUser(supabase, user.id, {
      title: 'Anomalia',
      body: readyBody,
      url: `/app/${params.brand}/chat/${threadId}`,
      tag: 'chat-ai-ready',
      skipIfFocused: true
    });
  } catch {
    /* never fail the chat turn on push */
  }

  // Auto-name the thread if it's still the default title
  if (history.length === 0) {
    const thread = await getThread(supabase, threadId, brand.id, user.id);
    if (thread && (thread.title === 'Nuova chat' || thread.title === 'New chat')) {
      const userText = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '';
      if (userText) {
        const title = userText.length > 50 ? userText.slice(0, 50) + '…' : userText;
        await renameThread(supabase, threadId, brand.id, user.id, title);
      }
    }
  }

  // Extract memory-worthy facts into session layer (fire-and-forget)
  const userText = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '';
  const assistantText = text ?? '';
  void extractMemoryFromChat(supabase, brand.id, userText, assistantText, {
    threadId,
    // The id straight from the insert. Re-reading "newest assistant row" would pick the
    // wrong one whenever a background tool job wrote a row in between.
    messageId: assistantMessageId
  }).catch(() => {});

  scheduleQueueKick(platform as Platform, origin);
}
