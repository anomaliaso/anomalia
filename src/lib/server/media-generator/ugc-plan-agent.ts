/**
 * UGC Creator planning agent — brand-read tools before writing spoken scripts.
 *
 * The batch renderer stays deterministic; only the SCRIPT plan is agentic so the model can
 * inspect Studio (kit/products/people) and Media library (screenshots) instead of inventing
 * off-brand Life-Force drama from the prompt alone.
 */
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, hasToolCall } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { llmLanguageModel } from '$lib/server/llm';
import { IMAGE_AGENT_MODEL } from '$lib/server/image-agent';
import { readMediaForAgent } from '$lib/server/strategy-agent-reads';
import {
  brandContextPromptSection,
  createBrandContextTools
} from '$lib/server/brand-context-tools';
import { resolveBrandImageIds } from '$lib/server/brand-media';
import { logAiCall } from '$lib/server/ai-log';
import type { UgcBrandGrounding } from '$lib/server/media-generator/brand-grounding';
import { formatUgcBrandGrounding } from '$lib/server/media-generator/brand-grounding';
import {
  UGC_FORMAT_IDS,
  isUgcFormatId,
  ugcFormatBrief,
  ugcPlatformBrief,
  type UgcFormatId,
  type UgcPlatformId
} from '$lib/ugc-formats';
import { UGC_CAPTURE_RULES } from '$lib/server/ugc';
import { CONTRAST_DEVICE_IDS, disruptiveBriefSection, isContrastDeviceId } from '$lib/disruptive';
import { trendingWallDigestSection } from '$lib/server/wall-digest';
import { createDisruptiveIdeaTools } from '$lib/server/disruptive-ideas';

export const UGC_PLAN_MAX_STEPS = 8;

export type PlannedUgcClip = {
  hook: string;
  body: string;
  cta: string;
  setting: string;
  /** Optional feature/offering name spotlighted in this clip. */
  feature?: string;
  /** The ad format this clip runs in — decides the on-screen timeline, not just the tone. */
  format?: UgcFormatId;
  /**
   * What is physically HAPPENING in second one. The spoken hook only gets heard if the frame buys
   * the second, and the planner is the only place that knows what this clip is about — leaving it
   * to the renderer produced ten clips that all opened on the same annoyed face.
   */
  hookVisual?: string;
  /** The contrast lever, when the clip is the disruptive one of the batch. */
  contrastDevice?: string;
};

export type UgcPlanAgentResult = {
  clips: PlannedUgcClip[];
  /** Signed image URLs from media_ids the planner picked (screenshots etc.). */
  mediaUrls: string[];
  toolsUsed: string[];
};

export type UgcPlanAgentOpts = {
  supabase: SupabaseClient;
  brandId: string;
  userId?: string;
  prompt: string;
  count: number;
  /** One line per clip slot (product/model assignments). */
  assignmentLines: string;
  brand?: UgcBrandGrounding | null;
  /** Where the batch is going — decides which formats are native and how long the clip should be. */
  platform?: UgcPlatformId | null;
  /** Format per slot: the toolbar pick repeated, or the rotation that keeps a batch from cloning. */
  formatPlan?: UgcFormatId[];
  /** Clip length the scripts must fit. */
  seconds?: number;
  threadId?: string | null;
  abortSignal?: AbortSignal;
  /** Live UI chips — fired when a tool STARTS (so the chip appears while it runs). */
  onToolStart?: (info: { toolCallId: string; toolName: string }) => void;
  /** Live UI chips — fired when a tool finishes. */
  onTool?: (info: {
    toolCallId: string;
    toolName: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  }) => void;
};

function clipRow(raw: {
  hook?: string;
  body?: string;
  cta?: string;
  setting?: string;
  feature?: string;
  format?: string;
  hook_visual?: string;
  contrast_device?: string;
}): PlannedUgcClip {
  return {
    hook: String(raw.hook ?? '').trim(),
    body: String(raw.body ?? '').trim(),
    cta: String(raw.cta ?? '').trim(),
    setting: String(raw.setting ?? '').trim() || 'a lived-in room at home',
    feature: String(raw.feature ?? '').trim() || undefined,
    format: isUgcFormatId(raw.format) ? raw.format : undefined,
    hookVisual: String(raw.hook_visual ?? '').trim() || undefined,
    contrastDevice: isContrastDeviceId(raw.contrast_device) ? raw.contrast_device : undefined
  };
}

export function buildUgcPlanAgentSystem(opts: {
  count: number;
  brandName: string;
  language?: string;
  platform?: UgcPlatformId | null;
  /** Format suggested per slot (toolbar pick, or the batch rotation). */
  formatPlan?: UgcFormatId[];
  seconds?: number;
}): string {
  const lang = opts.language?.trim()
    ? `Write every spoken line in ${opts.language!.trim()} (natural spoken register).`
    : `Match the user brief's language (Italian brief → Italian scripts).`;
  const seconds = opts.seconds ?? 15;
  const words = Math.round(seconds * 3.3 * 0.92);
  const rotation = opts.formatPlan?.length
    ? `\nSuggested format per slot (change one only with a reason, and never make them all the same): ${opts.formatPlan
        .map((f, i) => `#${i + 1} ${f}`)
        .join(', ')}.`
    : '';
  return `You are Anomalia's UGC script planner for brand "${opts.brandName}".

Workflow (mandatory):
1. Call read_brand_studio FIRST — learn what the brand is, sells, and how it talks.
2. Call read_disruptive_ideas — the brand's idea bank. If a saved idea fits this brief, USE it for one of the clips instead of inventing a near-copy, then call mark_idea_used on it: an unmarked idea keeps coming back as if it were still to shoot.
3. If the brief mentions screenshots, UI, media library, features to show on camera, or product demos → call read_media (query for screenshot/UI/mobile as needed).
4. Optionally read_knowledge if notes/docs would clarify features.
5. Call submit_ugc_scripts with exactly ${opts.count} DISTINCT clips. Do not finish without submit_ugc_scripts.

Script craft (≤${seconds}s each, ~${words} spoken words total per clip):
- Structure follows the clip's FORMAT (see below), not one fixed arc. Whatever the format, the brand or assigned product is named once with ONE concrete feature/mechanic, and the CTA lands as an afterthought.
- Pain MUST be this brand's category / job-to-be-done. FORBIDDEN unless the brand category is that domain: medical/health, family crises, relationship/dating, mortality, random grocery spending stress.
- Full spoken sentences — not telegram fragments or slogans.
- ${lang}
- When read_media returns useful screenshots, pass their ids in media_ids so the renderer can show real UI on camera.
- Each clip = a different feature/angle/setting — not paraphrases.
- hook_visual is REQUIRED on every clip: what is physically HAPPENING in second one. It must carry something the spoken hook does not already say — otherwise every clip in the batch opens on the same annoyed face.

${UGC_CAPTURE_RULES}
${ugcFormatBrief({ platform: opts.platform })}${rotation}

${ugcPlatformBrief(opts.platform)}

${disruptiveBriefSection()}
Look for the clip in this batch that breaks the category's expectation and set contrast_device on it. A batch where every clip is safe and interchangeable is a weak batch, however correct — this is the yardstick for the work, not an extra deliverable. If a new one that passes the three tests comes to you while working, save it with save_disruptive_idea — that is how a side idea outlives this batch. There is no quota: a batch that produced none is fine, and an idea invented to fill the bank is worth less than nothing.`;
}

export function buildUgcPlanAgentPrompt(opts: {
  prompt: string;
  count: number;
  assignmentLines: string;
  brand?: UgcBrandGrounding | null;
}): string {
  const grounding = opts.brand ? `\n${formatUgcBrandGrounding(opts.brand)}\n` : '';
  return `Plan ${opts.count} UGC talking-head scripts.

User brief (topic bible):
${opts.prompt.trim()}
${grounding}
Clip assignments:
${opts.assignmentLines}

Start with read_brand_studio, then read_media if the brief needs screenshots/features from the library, then submit_ugc_scripts.

${brandContextPromptSection()}`;
}

/**
 * Run the tool-using planner. Best-effort — returns empty clips on total failure
 * so the caller can fall back to a one-shot structured plan.
 */
export async function planUgcClipsWithTools(opts: UgcPlanAgentOpts): Promise<UgcPlanAgentResult> {
  const count = Math.max(1, Math.min(20, Math.floor(opts.count)));
  const brandName = opts.brand?.name?.trim() || 'Brand';
  const toolsUsed: string[] = [];
  const state: { clips: PlannedUgcClip[] | null; mediaIds: string[] } = {
    clips: null,
    mediaIds: []
  };

  const live = async <T>(toolName: string, run: () => Promise<T>): Promise<T> => {
    const toolCallId = `ugc-plan-${toolName}-${crypto.randomUUID()}`;
    opts.onToolStart?.({ toolCallId, toolName });
    try {
      const output = await run();
      toolsUsed.push(toolName);
      opts.onTool?.({ toolCallId, toolName, output });
      return output;
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      opts.onTool?.({ toolCallId, toolName, errorText });
      throw e;
    }
  };

  const tools = {
    // Same four reads every maker agent gets now, wrapped in `live` so each one still streams its
    // chip. read_brand_studio and read_knowledge used to be declared here by hand.
    ...createBrandContextTools({
      supabase: opts.supabase,
      brandId: opts.brandId,
      wrap: live
    }),
    // Il banco idee: si legge PRIMA di inventare e ci si salva dentro l'idea laterale che nasce
    // mentre si scrive il batch — è esattamente il punto in cui, senza banco, andava persa.
    ...createDisruptiveIdeaTools({
      supabase: opts.supabase,
      brandId: opts.brandId,
      userId: opts.userId ?? null,
      threadId: opts.threadId ?? null,
      surface: 'ugc',
      agent: 'ugc',
      wrap: live
    }),
    read_media: tool({
      description:
        'Search the brand Media library (screenshots, UI, product photos). Use when the brief mentions screenshots/media/features to show.',
      inputSchema: z.object({
        query: z.string().optional().describe('e.g. screenshot, mobile UI, dashboard'),
        kind: z.enum(['image', 'video']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async (input) =>
        live('read_media', () => readMediaForAgent(opts.supabase, opts.brandId, input))
    }),
    submit_ugc_scripts: tool({
      description: `Submit exactly ${count} PAS spoken scripts and optional media_ids from read_media. Ends the planning loop.`,
      inputSchema: z.object({
        clips: z
          .array(
            z.object({
              hook: z
                .string()
                .describe('Opening spoken line (~8–12 words), mid-conversation — what the FORMAT calls for'),
              body: z
                .string()
                .describe(
                  'The middle of the clip (~18–28 words): what the format needs, ending on the brand/feature + one proof.'
                ),
              cta: z.string().describe('Soft CTA (~6–10 words), afterthought'),
              setting: z.string().describe('Real room (desk, kitchen, parked car…)'),
              format: z
                .enum(UGC_FORMAT_IDS)
                .describe('The ad format this clip runs in — it decides the on-screen timeline'),
              hook_visual: z
                .string()
                .describe(
                  'What is physically HAPPENING in second one. Must say something the spoken hook does not.'
                ),
              feature: z
                .string()
                .optional()
                .describe('Feature/offering name spotlighted in this clip'),
              contrast_device: z
                .enum(CONTRAST_DEVICE_IDS)
                .optional()
                .describe('Set on the disruptive clip of the batch — the contrast lever it is built on')
            })
          )
          .min(count)
          .max(count),
        media_ids: z
          .array(z.string())
          .max(6)
          .optional()
          .describe('Media library ids (screenshots/UI) to show on camera')
      }),
      execute: async ({ clips, media_ids }) =>
        live('submit_ugc_scripts', async () => {
          state.clips = clips.map(clipRow).slice(0, count);
          state.mediaIds = (media_ids ?? [])
            .filter((id) => typeof id === 'string' && id.trim())
            .slice(0, 6);
          return {
            ok: true,
            planned: state.clips.length,
            media_ids: state.mediaIds
          };
        })
    })
  };

  // Pavimento ambientale dal wall /trending (settimanale, già distillato — nessuna chiamata AI
  // qui): le meccaniche di hook del raccolto virale corrente. Stantio o assente ⇒ stringa vuota.
  const trendFloor = await trendingWallDigestSection();
  const system =
    buildUgcPlanAgentSystem({
      count,
      brandName,
      language: opts.brand?.language,
      platform: opts.platform,
      formatPlan: opts.formatPlan,
      seconds: opts.seconds
    }) + trendFloor;
  const prompt = buildUgcPlanAgentPrompt({
    prompt: opts.prompt,
    count,
    assignmentLines: opts.assignmentLines,
    brand: opts.brand
  });

  const t0 = Date.now();
  let ok = false;
  try {
    await harnessGenerateText({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'ugc_plan',
      mode: String(count),
      model: IMAGE_AGENT_MODEL(),
      provider: 'llm',
      surface: 'batch'
    }, {
      model: llmLanguageModel(IMAGE_AGENT_MODEL()),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      system,
      prompt,
      tools,
      stopWhen: [hasToolCall('submit_ugc_scripts'), stepCountIs(UGC_PLAN_MAX_STEPS)],
      temperature: 0.7,
      abortSignal: opts.abortSignal
    });
    ok = !!(state.clips && state.clips.length);
  } catch (e) {
    console.error('[ugc-plan-agent] failed', e);
  }

  let mediaUrls: string[] = [];
  if (state.mediaIds.length) {
    try {
      mediaUrls = await resolveBrandImageIds(opts.supabase, opts.brandId, state.mediaIds);
    } catch (e) {
      console.error('[ugc-plan-agent] resolve media_ids failed', e);
    }
  }

  logAiCall({
    label: 'ugc-plan-agent',
    provider: 'llm',
    model: IMAGE_AGENT_MODEL(),
    ms: Date.now() - t0,
    ok,
    brandId: opts.brandId,
    userId: opts.userId,
    context: `ugc-plan:n${count}:tools${toolsUsed.join(',') || 'none'}:clips${state.clips?.length ?? 0}:media${mediaUrls.length}`
  });

  return {
    clips: state.clips ?? [],
    mediaUrls,
    toolsUsed
  };
}
