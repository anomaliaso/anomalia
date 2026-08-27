/**
 * UGC script judge panel — Pass 1.6.
 *
 * Seedance (and every other video model) renders a weak script as beautifully as a strong one.
 * That is the trap: generation craft cannot save writing that fails the scroll-stop test. So every
 * video seed's spoken hook/body/cta runs through this panel BEFORE any frame is generated.
 *
 * Four jobs, one structured call (same shape as reviewCaptions — batch rewrite-in-place, best-
 * effort, never throws):
 *   - pacing: fits the clip word budget; CTA is not the part that gets cut
 *   - vocab: sounds SAID, not written — fillers ok, slogans die
 *   - ideas: hook is a claim someone would argue with; next line makes them wait
 *   - structure: hook → body → CTA-as-afterthought; batch variety across seeds
 *
 * Deterministic prefilter uses scriptFits / scriptWordBudget so the model is not asked to invent
 * a word count the renderer already enforces.
 */
import type { GoogleGenAI } from '@google/genai';
import { structured } from '$lib/server/research';
import {
  scriptFits,
  scriptWordBudget,
  scriptMinWords,
  looksLikeTelegramScript,
  type UgcScript
} from '$lib/server/ugc';
import { UGC_ORGANIC_MAX_DURATION, UGC_AD_DURATION } from '$lib/server/video';
import { judgeThinkingLevel } from '$lib/server/gemini';

export type UgcScriptSeed = {
  format?: string;
  ugc?: boolean;
  ugc_ad?: boolean;
  ugcAd?: boolean;
  hook?: string;
  body?: string;
  cta?: string;
  person?: string;
  product?: string;
  setting?: string;
  angle?: string;
};

const SCRIPT_REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    fixes: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const, description: '0-based index of the seed to rewrite.' },
          reason: {
            type: 'string' as const,
            description: 'Which judge(s) killed it and why (one short sentence).'
          },
          pacing: {
            type: 'string' as const,
            enum: ['pass', 'fail'] as const,
            description: 'pass if word budget + CTA survival are fine.'
          },
          vocab: {
            type: 'string' as const,
            enum: ['pass', 'fail'] as const,
            description: 'pass if it sounds said, not written / ad-copy.'
          },
          ideas: {
            type: 'string' as const,
            enum: ['pass', 'fail'] as const,
            description: 'pass if the hook is a claim worth arguing and the next line makes the viewer wait.'
          },
          structure: {
            type: 'string' as const,
            enum: ['pass', 'fail'] as const,
            description: 'pass if hook→body→CTA-as-afterthought holds and it is not a batch clone.'
          },
          hook: { type: 'string' as const, description: 'FULL rewritten hook (spoken, not a diff).' },
          body: { type: 'string' as const, description: 'FULL rewritten body.' },
          cta: {
            type: 'string' as const,
            description: 'FULL rewritten CTA — afterthought energy, never a slogan. Keep SHORT so it survives the word budget.'
          }
        },
        required: ['index', 'reason', 'pacing', 'vocab', 'ideas', 'structure', 'hook', 'body', 'cta']
      }
    }
  },
  required: ['fixes']
};

function clipSecondsForSeed(seed: UgcScriptSeed): number {
  const isAd = seed.ugc_ad === true || seed.ugcAd === true;
  return isAd ? UGC_AD_DURATION : UGC_ORGANIC_MAX_DURATION;
}

/** True when a seed is a talking UGC reel that needs a spoken script. */
export function isUgcTalkingSeed(seed: UgcScriptSeed): boolean {
  if (String(seed.format ?? '') !== 'video') return false;
  // Video defaults to UGC; only an explicit false opts out.
  if (seed.ugc === false) return false;
  return true;
}

/**
 * Run the four-judge panel over video UGC scripts. Mutates matching seeds in place.
 * Returns the same array reference. Best-effort — on any failure returns seeds unchanged.
 */
export async function reviewUgcScripts<T extends UgcScriptSeed>(
  ai: GoogleGenAI,
  seeds: T[],
  opts: { brandName?: string; language?: string; theme?: string } = {}
): Promise<T[]> {
  try {
    const talking = seeds
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => isUgcTalkingSeed(s));
    if (!talking.length) return seeds;

    const list = talking
      .map(({ s, i }) => {
        const seconds = clipSecondsForSeed(s);
        const budget = scriptWordBudget(seconds);
        const script: UgcScript = {
          hook: String(s.hook ?? '').trim(),
          body: String(s.body ?? '').trim(),
          cta: String(s.cta ?? '').trim()
        };
        const words = [script.hook, script.body, script.cta].join(' ').trim().split(/\s+/).filter(Boolean)
          .length;
        const fit = scriptFits(script, seconds);
        const min = scriptMinWords(seconds);
        const sparse = looksLikeTelegramScript(script) || words < min;
        return [
          `SEED ${i} (${seconds}s clip, budget ≤${budget} words, min ≥${min} words, currently ${words} words, fits=${fit}, sparse=${sparse}):`,
          `  angle: ${String(s.angle ?? '').slice(0, 160)}`,
          `  person: ${s.person || '(none)'} | product: ${s.product || '(none)'} | setting: ${s.setting || '(none)'}`,
          `  hook: ${script.hook || '(EMPTY)'}`,
          `  body: ${script.body || '(EMPTY)'}`,
          `  cta: ${script.cta || '(EMPTY)'}`
        ].join('\n');
      })
      .join('\n\n');

    const lang = opts.language?.trim()
      ? `LANGUAGE: rewrite entirely in ${opts.language!.trim()} — natural spoken ${opts.language!.trim()}, not translated ad copy.`
      : 'LANGUAGE: keep each script in the language it already uses — natural spoken register of that language.';

    const prompt = `You are a four-person UGC script judge panel reviewing spoken scripts BEFORE any video is generated. Seedance will render a weak script just as beautifully as a strong one — that is the trap. Kill anything that would not stop a real scroll.

Brand: ${opts.brandName ?? '(unknown)'}
Batch theme: ${opts.theme ?? '(none)'}
${lang}

THE FOUR JUDGES (any FAIL → rewrite that seed):
1. PACING — organic ≤15s (~40–48 words); ugc_ad true → 22s (~55–66 words). Spoken words must fit the clip budget (~3.3 words/sec). Target ≥ the min word count; sparse=true or under min is FAIL — expand into full spoken sentences (do NOT pad). FAIL if fits=false (over budget): shorten to a concise Hook→Problem→Demo→Proof→CTA without telegram fragments — never drop demo/proof.
2. VOCAB — must sound SAID out loud: continuous spoken sentences, personal and emotional, light slang OK. KILL telegram / headline fragments, slogans, ad-copy cadence, "introducing", and long rants.
3. IDEAS — PAIN MOMENT must be a problem THIS brand's audience has in THIS brand's category (from angle/product/theme/brand name). Desire underneath is brand-work related (less chaos, look competent, get the job done) — NOT generic Life-Force drama. FAIL and rewrite if the hook invents medical/health, family crises, relationship/dating, mortality, or unrelated grocery/household spending stress unless the brand category is literally that domain. Soft, vague, or "let me tell you about…" FAIL. Product in the first line FAIL. Solution beat must name the brand or product from the seed.
4. STRUCTURE — Hook → Problem → Demo → Proof → CTA, CONCISE: hook = call-out pain (one sentence) → body = cost + mechanic out loud + one proof → CTA = qualify + soft action (never a 2–4 word slogan). FAIL product-first. FAIL clones. Batch variety of person/room/light.

When you rewrite: keep the seed's angle/product/person intent. Do not invent product claims the angle does not support. Prefer shorter, sharper sentences that still fit the budget — lead with a brand-relevant pain moment. Return FULL replacement hook/body/cta strings, never diffs.

Only list seeds that need a rewrite. Good scripts stay out of "fixes".

SCRIPTS:
${list}

Return JSON.`;

    const parsed = await structured(ai, prompt, SCRIPT_REVIEW_SCHEMA, undefined, {
      label: 'reviewUgcScripts',
      thinkingLevel: judgeThinkingLevel()
    });
    const fixes: Array<Record<string, unknown>> = Array.isArray((parsed as { fixes?: unknown }).fixes)
      ? ((parsed as { fixes: Array<Record<string, unknown>> }).fixes)
      : [];

    for (const fix of fixes) {
      const i = Number(fix?.index);
      const seed = seeds[i];
      if (!seed || !isUgcTalkingSeed(seed)) continue;
      const hook = String(fix?.hook ?? '').trim();
      const body = String(fix?.body ?? '').trim();
      const cta = String(fix?.cta ?? '').trim();
      if (!hook && !body && !cta) continue;
      const seconds = clipSecondsForSeed(seed);
      let next: UgcScript = {
        hook: hook || String(seed.hook ?? '').trim(),
        body: body || String(seed.body ?? '').trim(),
        cta: cta || String(seed.cta ?? '').trim()
      };
      // Deterministic last pass: if the rewrite still overruns, trim CTA then body on word boundaries.
      if (!scriptFits(next, seconds)) {
        next = trimScriptToBudget(next, seconds);
      }
      seed.hook = next.hook;
      seed.body = next.body;
      seed.cta = next.cta;
      console.warn(
        `[reviewUgcScripts] rewrote seed ${i} [${fix?.pacing}/${fix?.vocab}/${fix?.ideas}/${fix?.structure}]: ${String(fix?.reason ?? '')}`
      );
    }

    // Deterministic safety net even when the panel returned no fix: over-budget scripts lose CTA at
    // render time, so trim them here while we still have structure.
    for (const { s } of talking) {
      const seconds = clipSecondsForSeed(s);
      const script: UgcScript = {
        hook: String(s.hook ?? '').trim(),
        body: String(s.body ?? '').trim(),
        cta: String(s.cta ?? '').trim()
      };
      if (!script.hook && !script.body && !script.cta) continue;
      if (!scriptFits(script, seconds)) {
        const trimmed = trimScriptToBudget(script, seconds);
        s.hook = trimmed.hook;
        s.body = trimmed.body;
        s.cta = trimmed.cta;
        console.warn(`[reviewUgcScripts] trimmed over-budget seed to ${scriptWordBudget(seconds)} words`);
      }
    }

    return seeds;
  } catch (e) {
    console.error(`[reviewUgcScripts] failed: ${e instanceof Error ? e.message : String(e)}`);
    return seeds;
  }
}

/**
 * Prefer cutting CTA length, then front of body (problem/agitate), never the DEMO/PROOF tail
 * and never the HOOK — so a ≤15s trim still lands the mechanic + proof.
 */
export function trimScriptToBudget(script: UgcScript, seconds: number): UgcScript {
  const budget = scriptWordBudget(seconds);
  const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean);
  let hook = wordsOf(script.hook);
  let body = wordsOf(script.body);
  let cta = wordsOf(script.cta);
  const total = () => hook.length + body.length + cta.length;
  // Soft CTA: keep a short afterthought.
  while (total() > budget && cta.length > 6) cta = cta.slice(0, -1);
  while (total() > budget && cta.length) cta = cta.slice(0, -1);
  // Body = agitate → solution. Drop from the FRONT so the solution pivot survives.
  while (total() > budget && body.length > 8) body = body.slice(1);
  while (total() > budget && body.length) body = body.slice(1);
  while (total() > budget && hook.length > 1) hook = hook.slice(0, -1);
  return { hook: hook.join(' '), body: body.join(' '), cta: cta.join(' ') };
}
