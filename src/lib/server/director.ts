import { KIE_GROK_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import { tool, stepCountIs, hasToolCall, type LanguageModel } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { llmConfigured, llmDefaultModel, llmLanguageModel } from '$lib/server/llm';
import { groundedText } from './research';
import {
  renderPreviewImages,
  platformPlaybook,
  collectBatchReviewImages,
  type PreviewPost
} from './content-preview';
import { extractSdkUsage, logAiCall, withBrandContext } from './ai-log';
import { KIE_GROK_NO_STORE, KIE_MODEL, kieFetch } from './kie';

// ── The Director: an autonomous agent-in-the-loop over a finished batch ─────────────────────────
//
// The pipeline's reviewers each inspect ONE station in isolation. The Director is the account
// director who looks at the WHOLE deliverable before it reaches the client: it SEES the captions
// and the rendered images together (multimodal), knows the brief, and has a CLOSED set of tools —
// verify a claim on the live web, rewrite a caption, re-render an image with a note, or flag a
// post for the owner's eyes. Hard budgets everywhere: this is judgment on top of the rules, never
// a replacement for the deterministic guards. It can NEVER publish. Best-effort by design: any
// failure returns a partial log and the batch ships exactly as the pipeline produced it.
//
// Model: Grok 4.5 via kie — vision verified live 2026-07-31 (reads colours, shapes and on-image
// text), ~3× cheaper input and 5× cheaper output than Gemini Flash. Gemini only when kie has
// no key: DeepSeek is NOT an option here, its API rejects image input entirely.
// The agent loop is the AI SDK's (same machinery the Pro chat tier already runs on Grok), which
// is why this file no longer hand-rolls tool turns.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type DirectorLog = {
  steps: Array<{ tool: string; args: AnyRec; note?: string }>;
  summary: string;
};

const MAX_STEPS = 8;
const BUDGETS: Record<string, number> = { search_web: 2, rewrite_caption: 3, rerender_image: 2 };

const SYSTEM = `You are Anomalia's Director — the senior account director doing the FINAL review of a batch of social posts before they reach the client's approval queue. You see everything together: captions, rendered images, the brief. Judge the batch as a whole: factual claims, coherence between caption and image, batch-level monotony, tone risks, timeliness. Act ONLY where a change clearly improves the deliverable — a good batch needs zero interventions and an immediate finish. Never nitpick style the brand's voice already covers. You cannot publish; flag_for_user is how you escalate. Always end with finish().`;

/** Grok 4.5 via kie when configured, else the LLM gateway. Both see images; DeepSeek cannot. */
function kieModel(): { model: LanguageModel; provider: 'kie'; modelId: string } | null {
  if (!env.KIE_API_KEY) return null;
  const kie = createOpenAI({
    baseURL: 'https://api.kie.ai/grok/v1',
    apiKey: env.KIE_API_KEY,
    name: 'kie',
    fetch: kieFetch()
  });
  return { model: kie.responses(KIE_MODEL), provider: 'kie', modelId: KIE_MODEL };
}

function geminiModel(): { model: LanguageModel; provider: 'llm'; modelId: string } {
  const modelId = llmDefaultModel();
  return { model: llmLanguageModel(modelId), provider: 'llm', modelId };
}

// Rewrite one caption per the Director's instruction (single cheap call, register-aware).
async function rewriteCaption(post: PreviewPost, instruction: string, language: string): Promise<string | null> {
  try {
    const { structured } = await import('./research');
    const parsed = await structured<{ caption?: string }>(
      null as never,
      `Rewrite this ${post.platform} caption applying the review instruction EXACTLY, keeping the platform's register and length${language ? ` and the ${language} language` : ''}.\n${platformPlaybook([post.platform], {})}\nCURRENT CAPTION:\n${post.caption}\n\nINSTRUCTION: ${instruction}\n\nReturn JSON.`,
      { type: 'object', properties: { caption: { type: 'string' } }, required: ['caption'] },
      undefined,
      { label: 'directorRewrite' }
    );
    // Text-only → aiStructured lo manda su Gemini Flash (vedi xiaomi.ts).
    return typeof parsed?.caption === 'string' && parsed.caption.trim() ? parsed.caption.trim() : null;
  } catch {
    return null;
  }
}

export async function runDirector(opts: {
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  profile: AnyRec;
  posts: PreviewPost[];
  brief?: string;
}): Promise<DirectorLog> {
  return withBrandContext(opts.brandId, async () => {
    const log: DirectorLog = { steps: [], summary: '' };
    const t0 = Date.now();
    let { model, provider, modelId } = kieModel() ?? geminiModel();
    try {
      if (!opts.posts.length) return { steps: [], summary: '(empty batch)' };
      const language = String(opts.profile?.language ?? '');

      // The batch, laid out for the model — plus each rendered image attached IN ORDER after the text.
      const postLines = opts.posts.map((p, i) => {
        const qc = (p as AnyRec).__qc;
        return `POST ${i} [${p.platform} · ${p.format} · media:${p.media}${p.person ? ` · person:${p.person}` : ''}${p.product ? ` · product:${p.product}` : ''}]${qc ? ` (image QC: ${qc.pass ? 'pass' : 'FAIL'} ${qc.score}/10${qc.issues?.length ? ` — ${qc.issues.join('; ')}` : ''})` : ''}\nCAPTION: ${p.caption}\n${p.image_prompt ? `IMAGE BRIEF: ${p.image_prompt.slice(0, 220)}` : '(text-only)'}`;
      }).join('\n\n');

      const imageParts = await collectBatchReviewImages(opts.posts);

      const intro = `Review this batch of ${opts.posts.length} post(s) for the brand "${opts.profile?.name ?? ''}".
${opts.brief ? `BATCH BRIEF: ${opts.brief}\n` : ''}${opts.profile?.visual_style ? `BRAND VISUAL BRIEF (images must match it):\n${String(opts.profile.visual_style).slice(0, 900)}\n` : ''}
${postLines}

Generated images follow (cover + carousel slides when present). Labels mark POST i / POST i slide j. Review, act only where needed, then finish().`;

      const used: Record<string, number> = {};
      /** Budget gate — over budget the tool refuses and the loop continues toward finish(). */
      const spend = (name: string): string | null => {
        used[name] = (used[name] ?? 0) + 1;
        return BUDGETS[name] != null && used[name] > BUDGETS[name]
          ? `budget exhausted for ${name} — wrap up with finish()`
          : null;
      };
      const record = (toolName: string, args: AnyRec, result: AnyRec) => {
        log.steps.push({ tool: toolName, args, note: JSON.stringify(result).slice(0, 200) });
        return result;
      };

      const tools = {
        search_web: tool({
          description:
            'Search the live web to verify a factual claim in a caption, check whether a news item was corrected/denied, or fill missing context. Returns a short grounded answer with sources.',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }: { query: string }) => {
            const over = spend('search_web');
            if (over) return record('search_web', { query }, { error: over });
            const g = await groundedText(null as never, query, 'Answer concisely with verifiable facts and dates.');
            return record('search_web', { query }, {
              answer: g.text.slice(0, 1200),
              sources: g.citations.slice(0, 4).map((c) => c.uri)
            });
          }
        }),
        rewrite_caption: tool({
          description:
            "Rewrite ONE post's caption with a targeted instruction (keep platform register and language). Use only when the caption has a real problem you can name.",
          inputSchema: z.object({ index: z.number().int(), instruction: z.string() }),
          execute: async ({ index, instruction }: { index: number; instruction: string }) => {
            const args = { index, instruction };
            const over = spend('rewrite_caption');
            if (over) return record('rewrite_caption', args, { error: over });
            const post = opts.posts[index];
            if (!post) return record('rewrite_caption', args, { error: 'bad index' });
            const next = await rewriteCaption(post, instruction, language);
            if (next) post.caption = next;
            return record('rewrite_caption', args, next
              ? { ok: true, caption: next.slice(0, 300) }
              : { error: 'rewrite failed — caption unchanged' });
          }
        }),
        rerender_image: tool({
          description:
            "Re-render ONE post's image with an art-director note appended to its prompt (goes through the full QC pipeline again). Expensive — use only for a clearly broken or off-brand image.",
          inputSchema: z.object({ index: z.number().int(), note: z.string() }),
          execute: async ({ index, note }: { index: number; note: string }) => {
            const args = { index, note };
            const over = spend('rerender_image');
            if (over) return record('rerender_image', args, { error: over });
            const post = opts.posts[index];
            if (!post || post.media === 'text') return record('rerender_image', args, { error: 'bad index or text-only post' });
            post.image_prompt = `${post.image_prompt}\n\nART DIRECTOR NOTE (apply this): ${note}`;
            await renderPreviewImages(opts.profile, [post], {
              supabase: opts.supabase,
              userId: opts.userId,
              onProgress: () => {},
              onPost: () => {}
            });
            return record('rerender_image', args, { ok: !!post.imageUrl, qc: (post as AnyRec).__qc ?? null });
          }
        }),
        flag_for_user: tool({
          description:
            'Mark ONE post "needs the owner\'s attention" with a short reason (time-sensitive, borderline claim, tone risk). The post still ships to the approval queue — this makes it surface first.',
          inputSchema: z.object({ index: z.number().int(), reason: z.string() }),
          execute: async ({ index, reason }: { index: number; reason: string }) => {
            const args = { index, reason };
            const post = opts.posts[index];
            if (!post) return record('flag_for_user', args, { error: 'bad index' });
            (post as AnyRec).__attention = reason.slice(0, 300);
            return record('flag_for_user', args, { ok: true });
          }
        }),
        finish: tool({
          description: 'End the review with a 1-3 sentence summary of what you checked and changed. ALWAYS call this to finish.',
          inputSchema: z.object({ summary: z.string() }),
          execute: async ({ summary }: { summary: string }) => {
            log.summary = summary.trim() || 'Review complete.';
            return record('finish', { summary }, { ok: true });
          }
        })
      };

      const run = (m: LanguageModel, runProvider: string, runModelId: string) => {
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [
          { type: 'text', text: intro }
        ];
        for (const p of imageParts) {
          content.push({ type: 'text', text: `[${p.label}]` });
          content.push({
            type: 'image',
            image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
          });
        }
        return harnessGenerateText(
          {
            brandId: opts.brandId,
            userId: opts.userId,
            agent: 'director',
            mode: runProvider,
            model: runModelId,
            provider: runProvider,
            surface: 'batch'
          },
          {
            model: m,
            // Runs on either kie Grok or the Gemini fallback — 64k on both.
            maxOutputTokens: KIE_GROK_MAX_OUTPUT_TOKENS,
            system: SYSTEM,
            messages: [{ role: 'user', content }],
            tools,
            // kie has no server-side item store — without this every step after the first replays
            // `item_reference` and dies. `forceReasoning` è l'altra metà: senza, l'SDK butta le
            // reasoning part fra uno step e l'altro perché non riconosce `grok-*` dal nome, e su 8
            // step il Director rivaluta il batch da capo ogni volta. Ignorato dal ripiego Gemini.
            providerOptions: { openai: { ...KIE_GROK_NO_STORE } },
            // finish() is the intended exit; the step cap is the backstop when the model rambles.
            stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('finish')]
          }
        );
      };

      // The Director is the LAST gate before the approval queue. Losing it because kie is out of
      // credits (or rate-limited) is worse than running the review on Gemini, so a kie failure
      // retries once on Gemini instead of shipping the batch unreviewed.
      let res;
      try {
        res = await run(model, provider, modelId);
      } catch (kieErr) {
        if (provider !== 'kie' || !llmConfigured()) throw kieErr;
        console.warn('[director] kie failed, retrying on llm:', kieErr);
        log.steps = [];
        log.summary = '';
        ({ model, provider, modelId } = geminiModel());
        res = await run(model, provider, modelId);
      }

      // No finish() call: fall back to whatever prose the model ended on, exactly as before.
      if (!log.summary) log.summary = res.text.trim() || 'Review ended at step budget.';

      logAiCall({
        label: 'director',
        provider,
        model: modelId,
        ms: Date.now() - t0,
        ok: true,
        ...extractSdkUsage(res.usage),
        brandId: opts.brandId
      });
      return log;
    } catch (e) {
      logAiCall({
        label: 'director',
        provider,
        model: modelId,
        ms: Date.now() - t0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        brandId: opts.brandId
      });
      return { steps: log.steps, summary: `(director failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'})` };
    }
  });
}
