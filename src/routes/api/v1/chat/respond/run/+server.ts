import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import { hasToolCall, stepCountIs, type ModelMessage } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { buildSystemPrompt, buildTurnVolatileBlock, wrapTurnContext } from '$lib/server/chat/system-prompt';
import { createChatTools } from '$lib/agent/tools/index';
import { resolveAgentForPlan, pickTools, stripWebHubTools } from '$lib/server/chat/agents';
import { saveMessages, loadHistory, getThread, renameThread, assistantContentFromSteps } from '$lib/server/chat/persistence';
import { agentStickerColor } from '$lib/chat-expression';
import { maybeCompactThread } from '$lib/server/chat/compaction';
import { sourcesFromSteps } from '$lib/chat-sources';
import { extractMemoryFromChat } from '$lib/server/brand-memory';
import { extractSdkUsage, logAiCall, withBrandContext } from '$lib/server/ai-log';
import { resolveChatModel } from '$lib/server/chat/model';
import { hasWebHub } from '$lib/server/plans';
import { createChatLoopGuard, turnLoopNotice } from '$lib/server/chat/loop-guard';
import { chatMaxTurns, chatTokenBudget, chatTurnDeadline, turnTokenBudgetNotice } from '$lib/server/chat/turn-limits';
import { withStepDeadline } from '$lib/server/chat/step-deadline';
import {
  formatAttachedDocsForModel,
  parseChatDocuments,
  stripAttachedDocsForDisplay
} from '$lib/chat-documents';
import { hydrateChatDocuments } from '$lib/server/hydrate-chat-documents';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { RequestHandler } from './$types';

// Matches the chat route — this path runs a full turn too.
export const config = { maxDuration: 1800 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// Background runner for full chat responses.
// Receives a job_id, loads the thread history, runs the AI model,
// saves the assistant message, and updates the job status.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { job_id } = (await request.json()) as { job_id: string };
  if (!job_id) return json({ error: 'Missing job_id' }, { status: 400 });

  // Load the job
  const { data: job } = await supabase
    .from('chat_jobs')
    .select('*')
    .eq('id', job_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!job) return json({ error: 'Job not found' }, { status: 404 });
  if (job.status !== 'pending') return json({ error: 'Job already processed' }, { status: 400 });

  const threadId = job.thread_id as string;
  const params = (job.input_params ?? {}) as AnyRec;
  const userMessageContent = params.user_message as string;
  if (!userMessageContent) return json({ error: 'Missing user_message in params' }, { status: 400 });

  // Mark as running
  await supabase.from('chat_jobs').update({ status: 'running' }).eq('id', job_id);

  try {
    // Load brand
    const { data: brand } = await supabase
      .from('brands')
      .select('id, org_id, name, slug, website, timezone, onboarding_state, setup_completed_at, plan, status, activated_at, stripe_customer_id, stripe_subscription_id, organizations(plan, stripe_customer_id, stripe_subscription_id), brand_kit(*)')
      .eq('id', job.brand_id)
      .maybeSingle();

    if (!brand) throw new Error('Brand not found');

    // Scope prompt + tools to the thread's specialized agent (null → full set, legacy/onboarding).
    // agentId prima del modello: su Auto la famiglia la decide lo spec (motion → Grok).
    const locale = params.locale ?? 'en';
    const origin = params.origin ?? '';
    const webHubEnabled = hasWebHub(brand.plan);
    const threadRow = await getThread(supabase, threadId, brand.id, user.id);
    const agentId = resolveAgentForPlan(threadRow?.agent, webHubEnabled);

    const chatModel = resolveChatModel(params.tier, params.reasoning, { agentId });
    await maybeCompactThread(supabase, {
      threadId,
      brandId: brand.id,
      userId: user.id,
      modelId: chatModel.modelId,
      plan: brand.plan
    });

    // Load existing history
    const history = await loadHistory(supabase, brand.id, user.id, threadId);
    const turnDocuments = await hydrateChatDocuments(
      supabase,
      user.id,
      brand.id,
      parseChatDocuments(params.documents)
    );
    const modelUserContent = turnDocuments.length
      ? stripAttachedDocsForDisplay(userMessageContent) + formatAttachedDocsForModel(turnDocuments)
      : userMessageContent;
    const systemPrompt = await buildSystemPrompt(supabase, brand, locale, agentId, {
      webHubEnabled,
      threadId,
      userId: user.id
    });
    const turnVolatileP = buildTurnVolatileBlock(supabase, brand, locale).catch(() => '');
    let customTools = pickTools(
      createChatTools(
        supabase,
        brand.id,
        brand.timezone ?? 'Europe/Rome',
        user.id,
        origin,
        locale,
        threadId,
        '',
        [],
        turnDocuments,
        agentStickerColor(agentId),
        undefined,
        // Percorso legacy di ripresa: nessun agente custom qui, l'identità è quella del thread.
        agentId
      ),
      agentId
    );
    if (!webHubEnabled) customTools = stripWebHubTools(customTools);

    return withBrandContext(brand.id, async () => {
      const turnVolatile = await turnVolatileP;
      const messages: ModelMessage[] = [
        ...history,
        { role: 'user', content: wrapTurnContext(turnVolatile, modelUserContent) }
      ];

    const chatT0 = Date.now();
    // This legacy resume path had no wall-clock ceiling at all: only a step count and the loop
    // guard, both of which a single slow tool walks straight past into the 300s function wall.
    const deadline = chatTurnDeadline(chatT0);
    const loopGuard = createChatLoopGuard();
    // Stesso tetto sui token degli altri motori — vedi turn-limits.ts.
    const tokenBudget = chatTokenBudget();
    const result = await harnessGenerateText({
      brandId: brand.id,
      userId: user.id,
      threadId,
      jobId: job_id,
      agent: 'chat_cli',
      mode: agentId,
      model: chatModel.modelId,
      provider: chatModel.provider,
      surface: 'chat'
    }, {
      model: chatModel.model,
      system: systemPrompt,
      messages,
      tools: withStepDeadline(customTools, {
        remainingMs: deadline.remainingMs,
        onExpired: ({ tool, waitedMs, reason }) => {
          console.error(`[Chat Run] step deadline threadId=${threadId}, tool=${tool}, ${reason}, ${waitedMs}ms`);
        }
      }),
      // Una domanda all'utente chiude il turno anche qui (CLI/MCP): la risposta arriva come
      // messaggio successivo, non come uno step in più di questo giro.
      stopWhen: [
        hasToolCall('ask_user_questions'),
        stepCountIs(chatMaxTurns()),
        deadline.reached,
        loopGuard.reached,
        tokenBudget.reached
      ],
      temperature: 0.4,
      ...chatModel.callOptions,
      onStepFinish: ({ toolCalls, text }) => {
        loopGuard.recordStep(
          toolCalls
            ?.filter((tc): tc is NonNullable<typeof tc> => Boolean(tc))
            .map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined })),
          text
        );
      }
    });
    // One aggregated row per background chat job (usage summed across all tool-calling steps).
    logAiCall({
      label: 'chat',
      provider: chatModel.provider,
      model: chatModel.modelId,
      ms: Date.now() - chatT0,
      ok: true,
      ...extractSdkUsage(result.totalUsage),
      brandId: brand.id,
      userId: user.id,
      threadId,
      context: 'chat_job'
    });

    const content = assistantContentFromSteps(result.steps, result.text);
    if (tokenBudget.exceeded) {
      console.warn(
        `[Chat Run] token budget stop threadId=${threadId}, used=${tokenBudget.usedTokens}, budget=${tokenBudget.budget}`
      );
      content.push({
        type: 'text',
        text: turnTokenBudgetNotice(bilingualNoticeLocale(locale), tokenBudget.usedTokens, tokenBudget.budget)
      });
    } else if (loopGuard.stalled) {
      content.push({ type: 'text', text: turnLoopNotice(bilingualNoticeLocale(locale)) });
    }
    const sources = sourcesFromSteps(result.steps, brand.slug ?? '');

    // Save assistant message
    if (content.length > 0) {
      await saveMessages(
        supabase,
        brand.id,
        user.id,
        [{ role: 'assistant', content } as unknown as ModelMessage],
        threadId,
        {
          durationMs: Date.now() - chatT0,
          model: chatModel.modelId,
          tier: chatModel.tier,
          inputTokens: result.totalUsage?.inputTokens,
          outputTokens: result.totalUsage?.outputTokens,
          ...(sources.length ? { sources } : {})
        }
      );
    }

    // Auto-name thread if it's the first message
    try {
      if (history.length === 0) {
        const thread = await getThread(supabase, threadId, brand.id, user.id);
        if (thread && (thread.title === 'Nuova chat' || thread.title === 'New chat')) {
          const title = userMessageContent.length > 50 ? userMessageContent.slice(0, 50) + '…' : userMessageContent;
          await renameThread(supabase, threadId, brand.id, user.id, title);
        }
      }

      // Extract memory-worthy facts into session layer (fire-and-forget)
      void (async () => {
        try {
          const { data: lastAssistant } = await supabase
            .from('chat_messages')
            .select('id')
            .eq('thread_id', threadId)
            .eq('brand_id', brand.id)
            .eq('role', 'assistant')
            .eq('superseded', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          await extractMemoryFromChat(supabase, brand.id, userMessageContent, result.text ?? '', {
            threadId,
            messageId: (lastAssistant?.id as string) ?? undefined
          });
        } catch (error) { swallow('extract memory from chat', error); }
      })();
    } catch (e) {
      console.error('Failed post-response tasks:', e);
    }

    // Update job status
    await supabase.from('chat_jobs').update({
      status: 'done',
      result: { text_length: result.text?.length ?? 0 },
      completed_at: new Date().toISOString()
    }).eq('id', job_id);

    try {
      const { sendPushToUser } = await import('$lib/server/web-push');
      const { data: brandRow } = await supabase
        .from('brands')
        .select('slug')
        .eq('id', job.brand_id)
        .maybeSingle();
      const slug = (brandRow?.slug as string) || '';
      await sendPushToUser(supabase, job.user_id as string, {
        title: 'Anomalia',
        body: 'Your AI reply is ready',
        url: slug && threadId ? `/app/${slug}/chat/${threadId}` : '/',
        tag: 'chat-ai-ready',
        skipIfFocused: true
      });
    } catch (error) { swallow('send ready push', error); }

    console.log(`[Chat Respond] Done: job=${job_id}, thread=${threadId}, textLen=${result.text?.length ?? 0}`);
    return json({ success: true, job_id });
    }); // closes the withBrandContext async callback opened above
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Chat Respond] Failed: job=${job_id}`, errorMsg);

    // Write error to chat_messages as an assistant message
    await supabase.from('chat_messages').insert({
      brand_id: job.brand_id,
      user_id: job.user_id,
      thread_id: threadId,
      role: 'assistant',
      content: `❌ Errore durante la generazione della risposta: ${errorMsg}`
    });

    // Update job status
    await supabase.from('chat_jobs').update({
      status: 'failed',
      error: errorMsg,
      completed_at: new Date().toISOString()
    }).eq('id', job_id);

    return json({ success: false, error: errorMsg });
  }
};
