import { json } from '@sveltejs/kit';
import { hasToolCall, stepCountIs, type ModelMessage } from 'ai';
import { harnessStreamText } from '$lib/server/harness';
import { assistantContentFromSteps, createThread, getThread } from '$lib/server/chat/persistence';
import { resolveAgentForPlan } from '$lib/server/chat/agents';
import { dmAgents } from '$lib/chat-dm';
import { env } from '$env/dynamic/private';
import {
  applyChatStreamEvent,
  readSseEvents,
  emptyStreamState,
  toolsForMirror
} from '$lib/chat-stream-events';
import { maybeCompactThread } from '$lib/server/chat/compaction';
import {
  assistantContentFromPartial,
  contentFromFailedTurn,
  persistPartialAssistantReply,
  type ChatPartialSnapshot
} from '$lib/server/chat/partial-persist';
import { enqueueTurnContinuation, threadHasActiveChatResponse, threadHasActiveKitRun } from '$lib/server/chat/queue';
import { createMidTurnMailbox } from '$lib/server/chat/mid-turn-mailbox';
import {
  CHAT_HEARTBEAT_INTERVAL_MS,
  CHAT_TURN_ABORT_MS,
  chatTokenBudget,
  chatTurnDeadline
} from '$lib/server/chat/turn-limits';
import { benchAwarePrepareStep, createChatLoopGuard } from '$lib/server/chat/loop-guard';
import { hasWebHub } from '$lib/server/plans';
import { reportChatError, CHAT_USER_ERROR } from '$lib/server/chat/report-error';
import { withStepDeadline } from '$lib/server/chat/step-deadline';
import { getChatRateUsage, chatRateLimitResponse, chatCreditsBlocked } from '$lib/server/chat/rate-limits';
import { isChatTier } from '$lib/chat-tiers';
import { threadModelPreference } from '$lib/server/chat/model-preference';
import { withBrandContext } from '$lib/server/ai-log';
import { shouldUseKit, runKitTurn } from '$lib/agent/bridge/live';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { RequestHandler } from './$types';
import {
  isJobCancelled,
  jobAbortControllers,
  scheduleErrorReport,
  scheduleQueueKick,
  type Platform
} from './lib/jobs';
import { loadThreadState } from './lib/thread-load';
import { handlePostAction } from './lib/post-actions';
import { applyGoalCommand, applyTurnBriefings, buildTurnContext, buildTurnMessages, type DeadlineRef } from './lib/turn-prep';
import { finishSuccessfulTurn } from './lib/turn-finish';
import { createChatActionApproval } from '$lib/server/chat/action-approval';
import { decideApproval, isApprovalDecision } from '$lib/server/chat/agent-kit-approvals';

// Vercel extended max duration (Pro/Enterprise, nodejs22.x). Must stay in sync with
// CHAT_MAX_DURATION_MS — every budget in turn-limits.ts is carved out of this number.
export const config = { maxDuration: 1800 };

// GET: load conversation history (optionally for a specific thread) or check job status
export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
  return loadThreadState(supabase, safeGetSession, params.brand, url);
};

// POST: send a message — streams real-time AND saves server-side for background resilience
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession, locale: uiLocale }, platform }) => {
  const { user } = await safeGetSession();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, org_id, name, slug, website, timezone, onboarding_state, setup_completed_at, plan, status, activated_at, stripe_customer_id, stripe_subscription_id, content_prefs, brand_kit(*)')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return new Response('Brand not found', { status: 404 });

  const webHubEnabled = hasWebHub(brand.plan);
  const body = await request.json();
  const action = body.action as string | undefined;
  const isApprovalResponse = action === 'approval_response';
  let threadId: string;
  // Specialized agent bound to this thread scopes prompt + tools (multi-agent chat).
  let threadAgent: string | null = null;
  // Custom agent bound to this thread, if the user picked one in the composer.
  let threadCustomAgentId: string | null = null;
  // Chat di gruppo: le chiavi dei membri della stanza (array, 0209). null = thread a un agente.
  let threadRoomAgents: unknown = null;
  let threadModel: unknown = null;

  // Resolve or create thread
  if (body.thread_id) {
    threadId = body.thread_id as string;
    const thread = await getThread(supabase, threadId, brand.id, user.id);
    if (!thread) return new Response('Thread not found', { status: 404 });
    // Un DM fra agenti è in sola lettura per le persone — e il rifiuto sta QUI, sul server, non
    // nel composer nascosto: copre invio, enqueue, clear e ogni altra azione di questo POST.
    if (dmAgents(thread.room_agents)) return json({ error: 'dm_view_only' }, { status: 403 });
    threadAgent = thread.agent;
    threadCustomAgentId = thread.custom_agent_id ?? null;
    threadRoomAgents = thread.room_agents ?? null;
    threadModel = (thread as { model?: unknown }).model ?? null;
  } else {
    const thread = await createThread(
      supabase,
      brand.id,
      user.id,
      'Nuova chat',
      null,
      resolveAgentForPlan(body.agent, webHubEnabled)
    );
    if (!thread) return new Response('Failed to create thread', { status: 500 });
    threadId = thread.id;
    threadAgent = thread.agent;
    threadCustomAgentId = thread.custom_agent_id ?? null;
  }

  type ApprovalRecord = { id: string; run_id: string; status: string; tool_call_id: string; harness_approval_id: string };
  let approvalRecord: ApprovalRecord | null = null;
  if (isApprovalResponse) {
    const approvalId = typeof body.approval_id === 'string' ? body.approval_id : '';
    const decision = body.approval_decision;
    if (!approvalId || !isApprovalDecision(decision)) {
      return json({ error: 'invalid_approval_decision' }, { status: 400 });
    }
    const { data } = await supabase
      .from('agent_kit_approval_requests')
      .select('id, run_id, status, tool_call_id, harness_approval_id')
      .eq('id', approvalId)
      .eq('thread_id', threadId)
      .maybeSingle();
    approvalRecord = data as unknown as ApprovalRecord | null;
    if (!approvalRecord) return json({ error: 'approval_not_found' }, { status: 404 });
    if (approvalRecord.status !== 'pending') {
      if (approvalRecord.status !== decision) return json({ error: 'approval_already_decided' }, { status: 409 });

      const { data: waitingRun } = await supabase
        .from('agent_kit_runs')
        .select('id')
        .eq('id', approvalRecord.run_id)
        .eq('state', 'waiting_takeover')
        .maybeSingle();
      if (!waitingRun) return json({ approval_id: approvalRecord.id, status: approvalRecord.status });
    }
    if (approvalRecord.status === 'pending') {
      try {
        approvalRecord = await decideApproval(supabase, approvalId, decision, typeof body.approval_reason === 'string' ? body.approval_reason : undefined);
      } catch (e) {
        return json({ error: 'approval_already_decided', message: e instanceof Error ? e.message : String(e) }, { status: 409 });
      }
    }
    body.approval_harness_id = approvalRecord.harness_approval_id;
  }

  const handledAction = await handlePostAction({
    supabase,
    brand: brand as { id: string; plan: string | null },
    user,
    request,
    platform: platform as Platform,
    body,
    webHubEnabled,
    threadId,
    threadAgent,
    threadCustomAgentId,
    locale: uiLocale
  });
  if (handledAction) return handledAction;

  const isRedo = action === 'redo';
  const userMessages = body.messages as ModelMessage[] | undefined;
  if (!isRedo && !isApprovalResponse && !userMessages?.length) return new Response('No messages', { status: 400 });

  // Rolling chat windows (5h / week) — monthly credits still apply separately via tools / metering.
  {
    const rate = await getChatRateUsage(supabase, brand.id, brand.plan);
    if (!rate.ok) return chatRateLimitResponse(rate, bilingualNoticeLocale(uiLocale));
    // E il tetto mensile del piano, che è un freno diverso dalla finestra rotante e qui non c'era.
    if (await chatCreditsBlocked(brand.id)) {
      return json({ error: 'credits_exhausted' }, { status: 402 });
    }
  }

  // UN TURNO ALLA VOLTA PER THREAD — la guardia che il percorso interattivo non aveva: un
  // reinvio/retry dopo un refresh (o da una seconda tab) mentre il run vero è ancora vivo faceva
  // partire due run concorrenti. `chat_jobs` è cieco ai run kit (runKitTurn non scrive righe lì),
  // quindi servono ENTRAMBI i check. 409 e non enqueue automatico: il drain non sa far girare un
  // turno kit (processNextQueuedChatJob non chiama mai runKitTurn), e su 'busy' il client accoda
  // già da solo (enqueueChatMessage). Prima di saveMessages, così il retry non lascia doppioni.
  {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    if (!isApprovalResponse && (
      (await threadHasActiveChatResponse(supabase, { userId: user.id, threadId })) ||
      (await threadHasActiveKitRun(createAdminClient(), threadId))
    )) {
      return json({ error: 'busy' }, { status: 409 });
    }
  }

  return withBrandContext(brand.id, async () => {
  // Same locale as the page (`locals.locale` / pickLocale): default English, never Italian just
  // because Accept-Language omitted "en" (en-IN, Hindi-only, empty, `*`).
  const locale = uiLocale;
  const origin = new URL(request.url).origin;

  // Il budget di tempo del turno nasce più in basso (chatTurnDeadline), ma i tool si costruiscono
  // prima: questo holder è il ponte, così una delega o un render MP4 non partono quando al turno
  // restano pochi secondi.
  const deadlineRef: DeadlineRef = { current: null };

  // La preferenza salvata (0225): quella del thread vince, poi quella dell'agente custom legato.
  // Si risolve QUI perché la usano tutti e due i motori — il classico qui sotto e il ramo kit.
  const modelPref = await threadModelPreference(supabase, {
    brandId: brand.id,
    threadModel,
    customAgentId: threadCustomAgentId
  });

  let {
    roomPlan, roomSpeaker, agentId, systemPrompt, mode, refUrls, turnDocuments,
    customTools, tools, sandboxMount, chatModel, canSeeImages, canSeeVideo, historyMedia,
    escalationText
  } = await buildTurnContext({
    supabase,
    brand,
    userId: user.id,
    body,
    userMessages,
    threadId,
    threadAgent,
    threadCustomAgentId,
    threadRoomAgents,
    isRedo,
    webHubEnabled,
    locale,
    origin,
    cookieHeader: request.headers.get('cookie') ?? '',
    deadlineRef,
    modelPref
  });

  // Compact BEFORE loading history: compacting after the call would mean the turn that
  // overflowed the window has already failed. No-op until the thread is actually over budget.
  await maybeCompactThread(supabase, {
    threadId,
    brandId: brand.id,
    userId: user.id,
    modelId: chatModel.modelId,
    plan: brand.plan
  });

  const built = await buildTurnMessages({
    supabase,
    brand: brand as { id: string },
    userId: user.id,
    threadId,
    body,
    userMessages,
    isRedo,
    historyMedia,
    canSeeImages,
    canSeeVideo,
    refUrls,
    turnDocuments,
    locale
  });
  if ('response' in built) return built.response;
  const { regeneratedFrom, history, lastUserMsg, messages, textContent } = built;

  // In modalità ASK l'obiettivo si mette in pausa: non ci sono i tool per farlo avanzare (vedi
  // chat-modes), quindi ripetergli la checklist significherebbe chiedergli di chiamare tool che non
  // ha, e riprendere il lavoro in background significherebbe pagare un turno che non può chiudere
  // niente. Resta aperto e riparte quando l'utente torna in Agent o Plan.
  const goalModeActive = mode !== 'ask';

  const goalCmd = await applyGoalCommand({
    supabase,
    brandId: brand.id,
    userId: user.id,
    threadId,
    textContent,
    locale,
    goalModeActive
  });

  // --- AGENT_KIT (sistema nuovo, dietro flag) ---
  const kitSpec = shouldUseKit(env, agentId);
  if (kitSpec) {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    // Il tier scelto dall'utente, il reasoning e il testo che alimenta la scalata Auto→Pro
    // (isHeavyProductionAsk) sono gia' calcolati sopra per il percorso classico: il ramo kit li
    // buttava via e ricablava `resolveChatModel('auto', undefined, …)` dentro il bridge. Senza
    // `userText` la scalata NON scatta mai (model.ts: `if (!text) return false`), quindi ogni
    // specialista che non sia motion cadeva sul default `luna` — che kie.ts descrive come
    // "NOT a chat model": il motore delle sonde di citazione GEO, usato per scrivere caroselli.
    return await runKitTurn({
      supabase,
      admin: createAdminClient(),
      brand,
      user,
      threadId,
      spec: kitSpec,
      messages,
      locale: bilingualNoticeLocale(locale),
      mode,
      tier: body.tier,
      modelFamily: modelPref?.family,
      reasoning: body.reasoning,
      escalationText,
      // `origin` serve al bridge per risvegliare la coda a fine turno (kickChatQueueWork):
      // senza, un follow-up accodato su un thread kit resta fermo fino al cron (2 minuti) e poi
      // viene risposto dal motore CLASSICO invece che dallo specialista.
      origin,
      approval: createChatActionApproval({
        messages,
        brandId: brand.id,
        userId: user.id,
        threadId
      }),
      ...(isApprovalResponse
        ? {
            approvalResponse: {
              approvalId: approvalRecord?.harness_approval_id ?? String(body.approval_id ?? ''),
              approved: body.approval_decision === 'approved',
              toolCallId: approvalRecord?.tool_call_id,
              ...(typeof body.approval_reason === 'string' ? { reason: body.approval_reason } : {})
            }
          }
        : {}),
      waitUntil: (platform as Platform)?.context?.waitUntil
    });
  }
  // --- fine AGENT_KIT ---

  const briefings = await applyTurnBriefings({
    supabase,
    brand: brand as { id: string },
    threadId,
    textContent,
    locale,
    goalModeActive,
    goalCmd,
    systemPrompt
  });
  const aiActHits = briefings.aiActHits;
  const goalAtStart = briefings.goalAtStart;
  systemPrompt = briefings.systemPrompt;

  // How many times this line of work has already been auto-resumed after running out of clock.
  const continuationDepth = Math.max(0, Math.trunc(Number(body.continuation_depth)) || 0);

  // Create a job row for status tracking and fallback polling.
  // `partial.at` is seeded here, not at the first token: it is the heartbeat the reaper reads to
  // tell a live turn from a dead row, and a reasoning model can think for 30s before emitting
  // anything at all. A row with no heartbeat is indistinguishable from a crash.
  const { data: job } = await supabase.from('chat_jobs').insert({
    brand_id: brand.id,
    user_id: user.id,
    tool_name: 'chat_response',
    input_params: {
      user_message: textContent,
      mode,
      locale,
      ...(isChatTier(body.tier) ? { tier: body.tier } : {}),
      ...(typeof body.reasoning === 'string' ? { reasoning: body.reasoning } : {}),
      ...(continuationDepth ? { continuation_depth: continuationDepth } : {})
    },
    status: 'running',
    thread_id: threadId,
    partial: { text: '', tools: [], reasoning: '', at: Date.now() }
  }).select('id').maybeSingle();

  const jobId = job?.id as string | undefined;

  const abortController = new AbortController();
  if (jobId) jobAbortControllers.set(jobId, abortController);

  // Cross-instance cancel: poll DB until generation ends or status becomes cancelled
  let cancelWatcher: ReturnType<typeof setInterval> | null = null;
  if (jobId) {
    cancelWatcher = setInterval(() => {
      void (async () => {
        if (abortController.signal.aborted) return;
        if (await isJobCancelled(supabase, jobId)) {
          abortController.abort();
        }
      })();
    }, 800);
  }

  const chatT0 = Date.now();
  let streamFailed = false;
  let streamErrorMsg: string | null = null;
  let partialSaved = false;
  /** Live SSE mirror — promoted to chat_messages if the turn dies mid-stream. */
  let livePartial: ChatPartialSnapshot = { text: '', tools: [], reasoning: '' };

  /** Wall-clock budget: the turn stops itself before the platform can kill it mid-token. */
  const deadline = chatTurnDeadline(chatT0);
  deadlineRef.current = deadline;
  /** Independent of step/time caps — stop when the model is stuck repeating the same work. */
  const loopGuard = createChatLoopGuard();
  // Il tetto sui TOKEN, accanto a quello sul tempo: vedi turn-limits.ts per la soglia e per il
  // caveat (fra gli step, non dentro uno).
  const tokenBudget = chatTokenBudget();
  /** Set only when the hard timer fired — tells onAbort this was the clock, not the user. */
  let deadlineAborted = false;

  // The soft budget only gets a say between steps, so give each STEP the same ceiling: no single
  // tool call may outlive what the turn has left. Without this one hanging tool is enough to reach
  // the hard abort mid-step, which costs the clean finish path (and the reply with it).
  const guardedTools = withStepDeadline(tools, {
    remainingMs: deadline.remainingMs,
    onExpired: ({ tool, waitedMs, reason }) => {
      console.error(`[Chat] step deadline threadId=${threadId}, jobId=${jobId}, tool=${tool}, ${reason}, ${waitedMs}ms`);
    }
  });

  // Liveness beacon. The SSE mirror below only writes when the stream produces something, so a
  // three-minute tool call looks exactly like a crashed process. This ticks regardless, which is
  // what lets the reaper close a dead turn in ~90s instead of guessing from `created_at`.
  // ponytail: last write wins against an in-flight mirror flush, so a rewind of one 300ms text
  // slice is possible; the next flush repairs it and the client never moves text backwards.
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (jobId) {
    heartbeat = setInterval(() => {
      void supabase
        .from('chat_jobs')
        .update({ partial: { ...livePartial, at: Date.now() } })
        .eq('id', jobId)
        .eq('status', 'running')
        .then(undefined, () => {});
    }, CHAT_HEARTBEAT_INTERVAL_MS);
  }

  // `stopWhen` is only consulted BETWEEN steps, so one hanging tool call would sail past the soft
  // budget and take the whole turn down with the function. This is the floor under that.
  const hardStop = setTimeout(() => {
    deadlineAborted = true;
    abortController.abort();
  }, CHAT_TURN_ABORT_MS);

  const stopTurnTimers = () => {
    if (cancelWatcher) {
      clearInterval(cancelWatcher);
      cancelWatcher = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    clearTimeout(hardStop);
    if (jobId) jobAbortControllers.delete(jobId);
  };

  const errorCtx = {
    brandId: brand.id,
    brandSlug: params.brand,
    userId: user.id,
    threadId,
    jobId,
    tier: chatModel.tier,
    provider: chatModel.provider,
    model: chatModel.modelId
  };

  const persistFailedPartial = async (steps?: unknown, text?: string) => {
    if (partialSaved) return;
    const content = contentFromFailedTurn({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: steps as any[] | null,
      text,
      partial: livePartial
    });
    if (!content.length) {
      if (jobId) {
        await supabase
          .from('chat_jobs')
          .update({
            status: 'failed',
            error: (streamErrorMsg ?? 'stream failed').slice(0, 2000),
            completed_at: new Date().toISOString()
          })
          .eq('id', jobId)
          .in('status', ['pending', 'running']);
      }
      return;
    }
    await persistPartialAssistantReply(supabase, {
      brandId: brand.id,
      userId: user.id,
      threadId,
      content,
      jobId,
      model: chatModel.modelId,
      tier: chatModel.tier,
      durationMs: Date.now() - chatT0,
      error: streamErrorMsg ?? 'stream failed'
    });
    partialSaved = true;
    console.log(
      `[Chat] saved partial assistant on failure jobId=${jobId} parts=${content.length} textLen=${livePartial.text?.length ?? 0}`
    );
  };

  /** User hit Stop — keep text/tools already streamed (same salvage as failures). */
  const persistStoppedPartial = async (steps?: unknown, text?: string) => {
    if (partialSaved) return;
    const content = contentFromFailedTurn({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: steps as any[] | null,
      text,
      partial: livePartial
    });
    if (!content.length) {
      if (jobId) {
        await supabase
          .from('chat_jobs')
          .update({ status: 'cancelled', completed_at: new Date().toISOString() })
          .eq('id', jobId)
          .in('status', ['pending', 'running']);
      }
      return;
    }
    const savedId = await persistPartialAssistantReply(supabase, {
      brandId: brand.id,
      userId: user.id,
      threadId,
      content,
      jobId,
      model: chatModel.modelId,
      tier: chatModel.tier,
      durationMs: Date.now() - chatT0,
      finalStatus: 'cancelled',
      error: 'stopped by user'
    });
    partialSaved = true;
    console.log(
      `[Chat] saved partial assistant on stop jobId=${jobId} messageId=${savedId ?? 'claimed-elsewhere'} parts=${content.length} textLen=${livePartial.text?.length ?? 0}`
    );
  };

  // I messaggi scritti MENTRE questo turno gira entrano al prossimo confine di step (vedi
  // mid-turn-mailbox.ts) invece di aspettare la fine del turno in coda.
  const midTurnMailbox = createMidTurnMailbox(supabase, {
    brandId: brand.id,
    userId: user.id,
    threadId,
    jobId
  });

  const result = harnessStreamText({
    brandId: brand.id,
    userId: user.id,
    threadId,
    jobId,
    agent: 'chat',
    mode,
    model: chatModel.modelId,
    provider: chatModel.provider,
    surface: 'chat'
  }, {
    model: chatModel.model,
    system: systemPrompt,
    messages,
    prepareStep: benchAwarePrepareStep(loopGuard, Object.keys(guardedTools), midTurnMailbox.prepareStep),
    tools: guardedTools,
    // Four ceilings, whichever comes first — all end through the normal finish path. The fourth is
    // per-STEP and lives on the tools themselves (withStepDeadline), because the three below are
    // only ever consulted between steps.
    // Loop guard is independent of step/time: identical or oscillating tool steps → stop (no auto-continue).
    // E una quinta che non è un tetto ma un'attesa: una domanda all'utente chiude il turno lì.
    // Era solo una riga di prompt ("wait for their reply") e il modello tirava dritto rispondendosi
    // da solo; `hasToolCall` lo rende strutturale — lo step della domanda è l'ultimo, e il lavoro
    // riprende col messaggio di risposta (o di skip), che è un turno nuovo.
    stopWhen: [
      hasToolCall('ask_user_questions'),
      stepCountIs(75),
      deadline.reached,
      loopGuard.reached,
      tokenBudget.reached
    ],
    temperature: 0.4,
    abortSignal: abortController.signal,
    ...chatModel.callOptions,
    onStepFinish: ({ toolCalls, text, content }: { toolCalls?: Array<{ toolName: string; input?: unknown }>; text?: string; content?: unknown }) => {
      loopGuard.recordStep(
        toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined })),
        text
      );
      loopGuard.recordToolFailures(content);
    },
    onError: async ({ error }: { error: unknown }) => {
      if (abortController.signal.aborted) return;
      streamFailed = true;
      streamErrorMsg = error instanceof Error ? error.message : String(error);
      stopTurnTimers();
      await reportChatError(supabase, error, errorCtx);
      // reportChatError marks the job failed; still promote whatever we already streamed.
      try {
        await persistFailedPartial();
      } catch (e) {
        console.error('[Chat onError] partial persist failed:', e);
      }
      scheduleQueueKick(platform as Platform, origin);
    },
    onAbort: async () => {
      stopTurnTimers();

      // The hard timer fired, not the user. This is a failure, not a cancel: keep the work,
      // report it, and let the queue pick the job back up.
      if (deadlineAborted) {
        const secs = Math.round((Date.now() - chatT0) / 1000);
        const deadlineMsg = `chat turn hit the hard time limit mid-step after ${secs}s`;
        streamErrorMsg = deadlineMsg;
        console.error(`[Chat onAbort] deadline threadId=${threadId}, jobId=${jobId}, ${secs}s`);
        try {
          await persistFailedPartial();
        } catch (e) {
          console.error('[Chat onAbort] partial persist failed:', e);
          // Both salvage paths normally close the row themselves. If the persist threw, the row is
          // still `running` — and a running turn makes the drain skip this thread, so the
          // continuation queued below would sit until the reaper notices. Close it here instead.
          if (jobId) {
            await supabase
              .from('chat_jobs')
              .update({
                status: 'failed',
                error: deadlineMsg.slice(0, 2000),
                completed_at: new Date().toISOString()
              })
              .eq('id', jobId)
              .in('status', ['pending', 'running'])
              .then(undefined, () => {});
          }
        }
        // Recovery first, telemetry after — the order matters more than it looks. This branch runs
        // ~15s from the wall, and the report costs two external round trips. Awaiting it here means
        // the wall can land between the ops email and the continuation, which is the one outcome
        // nothing recovers from: the job is already `failed`, no continuation row was ever written,
        // and the queue cron only drains rows that are `pending` — the reaper closes dead rows, it
        // never creates new ones. The thread would just stop, mid-task, with a partial reply.
        await enqueueTurnContinuation(supabase, {
          brandId: brand.id,
          userId: user.id,
          threadId,
          origin,
          locale,
          mode,
          tier: isChatTier(body.tier) ? body.tier : undefined,
          reasoning: typeof body.reasoning === 'string' ? body.reasoning : undefined,
          depth: continuationDepth
        });
        scheduleQueueKick(platform as Platform, origin);
        scheduleErrorReport(platform as Platform, supabase, new Error(deadlineMsg), {
          ...errorCtx,
          kind: 'chat_turn_timeout',
          detail: 'a single step outlived the budget — check for a tool with no timeout of its own'
        });
        return;
      }

      // User Stop — keep whatever already arrived in chat (text + tools).
      try {
        await persistStoppedPartial();
      } catch (e) {
        console.error('[Chat onAbort] stop partial persist failed:', e);
      }
      if (jobId) {
        await supabase
          .from('chat_jobs')
          .update({ status: 'cancelled', completed_at: new Date().toISOString() })
          .eq('id', jobId)
          .in('status', ['pending', 'running']);
      }
      console.log(`[Chat onAbort] threadId=${threadId}, jobId=${jobId} — stopped, partial kept`);
      scheduleQueueKick(platform as Platform, origin);
    },
    onFinish: async ({ text, steps, totalUsage }: {
      text?: string;
      steps: Parameters<typeof assistantContentFromSteps>[0];
      totalUsage?: { inputTokens?: number; outputTokens?: number };
    }) => {
      // I file di questo turno se ne vanno con lui: la VM resta accesa per il brand, il workspace no.
      void sandboxMount.close().catch(() => undefined);
      stopTurnTimers();

      // Deadline abort already salvaged in onAbort.
      if (deadlineAborted) return;
      // User Stop — salvage any remaining output, then leave the job cancelled (not done).
      if (abortController.signal.aborted || (await isJobCancelled(supabase, jobId))) {
        console.log(`[Chat onFinish] cancelled — persisting partial jobId=${jobId}`);
        try {
          await persistStoppedPartial(steps, text);
        } catch (e) {
          console.error('[Chat onFinish] stop partial persist failed:', e);
        }
        if (jobId) {
          await supabase
            .from('chat_jobs')
            .update({ status: 'cancelled', completed_at: new Date().toISOString() })
            .eq('id', jobId)
            .in('status', ['pending', 'running']);
        }
        scheduleQueueKick(platform as Platform, origin);
        return;
      }

      // Provider / stream failure — keep whatever was written so retry sees the flow.
      if (streamFailed) {
        console.log(`[Chat onFinish] streamFailed — persisting partial jobId=${jobId}`);
        try {
          await persistFailedPartial(steps, text);
        } catch (e) {
          console.error('[Chat onFinish] partial persist failed:', e);
        }
        scheduleQueueKick(platform as Platform, origin);
        return;
      }

      try {
        await finishSuccessfulTurn({
          supabase,
          brand: brand as { id: string; slug: string | null },
          user,
          params,
          body,
          threadId,
          jobId,
          chatT0,
          origin,
          platform: platform as Platform,
          locale,
          mode,
          chatModel,
          textContent,
          history,
          lastUserMsg,
          regeneratedFrom,
          goalModeActive,
          goalAtStart,
          goalCmd,
          continuationDepth,
          loopGuard,
          tokenBudget,
          deadline,
          customTools,
          aiActHits,
          roomPlan,
          roomSpeaker,
          threadRoomAgents,
          persistStopped: persistStoppedPartial,
          steps,
          text,
          totalUsage
        });
      } catch (e) {
        console.error('[Chat onFinish] Failed post-stream tasks:', e);
        streamErrorMsg = e instanceof Error ? e.message : String(e);
        try {
          await persistFailedPartial(steps, text);
        } catch {
          if (jobId) {
            try {
              await supabase.from('chat_jobs').update({
                status: 'failed',
                error: streamErrorMsg.slice(0, 2000),
                completed_at: new Date().toISOString()
              }).eq('id', jobId).in('status', ['pending', 'running']);
            } catch { /* best-effort */ }
          }
        }
        await reportChatError(supabase, e, { ...errorCtx, tier: chatModel.tier });
        scheduleQueueKick(platform as Platform, origin);
      }
    }
  });

  console.log(`[Chat Stream Start] threadId=${threadId}, jobId=${jobId}, userId=${user.id}`);

  // IL LAVORO DI SFONDO VA DICHIARATO ALLA PIATTAFORMA, o non sopravvive alla Response: Vercel
  // considera finita l'invocazione appena la risposta è consegnata e uccide ciò che resta. Senza
  // questo, un turno lungo vive solo finché il client tiene aperto l'SSE — un reload o una rete
  // che cade a metà e onFinish non gira mai: risposta mai salvata, continuazione mai accodata, e
  // il reaper la chiude come failed lasciando solo il parziale (in produzione il 23/8: un run
  // morto a 107 secondi). Il fix era stato applicato solo al percorso kit (bridge/live.ts); qui
  // è lo stesso identico pattern. `consumeSseStream` qui sotto resta SOLO uno specchio del
  // parziale sulla riga del job — è questo consumo a far avanzare il turno.
  const consumed = result.consumeStream({
    onError: (e) => console.error('[Chat] consume error', e)
  });
  const keepAlive = (platform as Platform)?.context?.waitUntil;
  if (keepAlive) keepAlive(Promise.resolve(consumed));
  else void consumed;

  const response = result.toUIMessageStreamResponse({
    sendReasoning: true,
    // Never leak provider billing / raw API details to the client.
    onError: () => CHAT_USER_ERROR,
    async consumeSseStream({ stream }) {
      const reader = stream.getReader();
      // Mirror the stream onto the job row as it goes, so a client that reconnects can resume from
      // where it left off instead of watching a spinner until the turn ends. Throttled per interval,
      // never per token.
      // ponytail: one row rewritten every 300ms — a 2-minute answer is ~400 updates of a few KB,
      // which Postgres handles fine but does churn dead tuples. If chat volume grows, move to an
      // append-only chunk table (or Supabase Realtime broadcast) instead of raising this number.
      const PARTIAL_MS = 300;
      const state = emptyStreamState();
      let sseBuf = '';
      let lastWrite = 0;
      let dirty = false;
      let inFlight: Promise<void> | null = null;
      // Never awaited inside the read loop: draining the stream is what keeps the generation
      // flowing for the live client, so a slow UPDATE must not hold it up. One write at a time.
      const flush = () => {
        if (!jobId || !dirty || inFlight) return;
        dirty = false;
        lastWrite = Date.now();
        // Params e risultati dei tool stanno nella riga rispecchiata, sotto un tetto — toolsForMirror.
        const snapshot = {
          text: state.text,
          tools: toolsForMirror(state.tools),
          reasoning: state.reasoning,
          at: lastWrite
        };
        livePartial = snapshot;
        inFlight = (async () => {
          try {
            await supabase.from('chat_jobs').update({ partial: snapshot }).eq('id', jobId);
          } catch {
            /* best-effort: a lost snapshot only costs this poll tick */
          }
          inFlight = null;
        })();
      };
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (typeof value === 'string') sseBuf += value;
          else if (value) sseBuf += decoder.decode(value as Uint8Array, { stream: true });
          const { events, rest } = readSseEvents(sseBuf);
          sseBuf = rest;
          for (const evt of events) dirty = applyChatStreamEvent(state, evt) || dirty;
          if (Date.now() - lastWrite >= PARTIAL_MS) flush();
        }
        // Last state before the turn closes — awaited so a client polling at this instant sees the
        // whole answer even if `onFinish` hasn't saved the message row yet.
        await inFlight;
        dirty = true;
        flush();
        await inFlight;
      } catch {
        /* client-side cancel / teardown — generation may continue via abortSignal rules */
      }
    }
  });

  // Inject job_id into a response header so the client can poll as fallback
  if (jobId) {
    response.headers.set('X-Chat-Job-Id', jobId);
  }
  // CHI sta parlando in questa battuta, per la riga di caricamento. Un header e non un evento
  // nello stream: la riga di progresso compare PRIMA del primo token (un modello che ragiona può
  // pensare 30s), quindi l'identità deve essere già arrivata quando l'avatar si accende —
  // altrimenti la stanza mostra il volto del thread e poi salta a quello vero a metà turno.
  if (roomSpeaker) {
    response.headers.set('X-Chat-Speaker', roomSpeaker.key);
  }

  return response;
  });
};
