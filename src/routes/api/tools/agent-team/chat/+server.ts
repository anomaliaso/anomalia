import { streamText, type ModelMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { geminiFlash } from '$lib/server/gemini';
import { extractSdkUsage, logAiCall } from '$lib/server/ai-log';
import { guardTool } from '$lib/server/tool-guard';
import { readSiteForAgent } from '$lib/server/agent-team-public';
import {
  MAX_STEPS,
  buildSystemPrompt,
  createAgentTeamChatTools,
  sanitizeGoal,
  sanitizeTranscript,
  toModelMessages
} from '$lib/server/agent-team-chat';
import { createAdminClient } from '$lib/server/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

// A turn can read three or four pages before it starts writing. Well under the brand chat's wall,
// because nothing here is allowed to take minutes: a stranger with a tab open does not wait.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY });

/**
 * The free agent-team tool, as a conversation.
 *
 * Anonymous by construction: no session, no thread, no row. The browser posts the site and the
 * transcript so far, `sanitizeTranscript` bounds what comes back in, and the answer streams out in
 * the same SSE shape the brand chats use — so the client reuses `applyChatStreamEvent` instead of
 * inventing a second reader.
 *
 * Every message counts against the per-IP daily cap. Metering per MESSAGE and not per conversation
 * is the whole difference between a free tool and a free model: a conversation has no natural end.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return json({ error: 'A website URL is required' }, { status: 400 });

  const messages = sanitizeTranscript(body?.messages);
  if (!messages.length) return json({ error: 'Say something to start' }, { status: 400 });

  // The goal has no row to live in, so it rides with the conversation and is re-validated here.
  const goal = sanitizeGoal(body?.goal);

  const guard = await guardTool('agent-team', getClientAddress());
  if (!guard.ok) return guard.response;

  let site;
  try {
    site = await readSiteForAgent(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const known = /not reachable|too large|timed out|redirects|resolve|http\(s\)|enough content/i.test(msg);
    if (!known) console.error('[agent-team-chat] site read', e);
    return json(
      { error: known ? msg : 'Could not read that site. Check the URL and try again.' },
      { status: 400 }
    );
  }

  // The library is decoration: without it the agent simply proposes agents that match nothing.
  let supabase: SupabaseClient | undefined;
  try {
    supabase = createAdminClient();
  } catch (e) {
    console.warn('[agent-team-chat] agent library unavailable:', e);
  }

  const model = geminiFlash();
  const t0 = Date.now();
  const result = streamText({
    model: google(model),
    maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    system: buildSystemPrompt(site, goal),
    allowSystemInMessages: true,
    messages: toModelMessages(messages) as ModelMessage[],
    tools: createAgentTeamChatTools({ site, supabase, goal }),
    stopWhen: [({ steps }) => steps.length >= MAX_STEPS],
    temperature: 0.4,
    onFinish: ({ totalUsage }) => {
      // No brand to bill: this is a marketing surface. Logged anyway so the tool's real spend is
      // visible in the same timeline as everything else — a free tool nobody meters is a leak.
      logAiCall({
        label: 'tool:agent-team-chat',
        provider: 'gemini',
        model,
        ms: Date.now() - t0,
        ok: true,
        ...extractSdkUsage(totalUsage),
        context: 'tools/agent-team'
      });
    }
  });

  return result.toUIMessageStreamResponse({ sendReasoning: false });
};
