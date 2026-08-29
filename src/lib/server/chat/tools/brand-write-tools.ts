import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { normalizeHashtags, normalizeWebsite } from '$lib/brand-fields';
import { publishApprovedPost, noAccountNotice, type ApprovablePost } from '$lib/server/publish';
import { EDITOR_POST_COLS, requireZernioCancellation } from '$lib/server/post-editing';
import { formatInZone } from '$lib/server/schedule';
import { resolveScheduleInput } from '$lib/server/clock';
import { withBrandContext } from '$lib/server/ai-log';
import { toolFromContract, type ToolFailure } from '$lib/contracts/tool-contract';
import { APPROVABLE_STATUSES, type CrossPostResult, RESCHEDULABLE_STATUSES, approvePostContract, crossPostContract, rejectPostContract, reschedulePostContract, updatePostContract } from '$lib/contracts/post-tools';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';
import { requireFreshRead } from '../read-guards';
import { refreshPostReceipt } from '../post-editor-tools';

// ── WRITE tools ─────────────────────────────────────────────────────────

export function brandWriteTools(ctx: ChatToolCtx) {
  const { supabase, brandId, tz } = ctx;
  return {
    update_brand_kit: tool({
      description:
        'Update the Brand Studio identity: about, audience, category, pillars, style, site type, website, post language, the platforms the brand posts on, the visual style brief and the graphic typography. Only the fields you pass change. Everything here is validated exactly like the Studio form — a value the form would reject is refused here too.',
      inputSchema: z.object({
        about: z.string().optional().describe('Brand description / about text'),
        target_audience: z.string().optional().describe('Target audience description'),
        category: z.string().optional().describe('Brand category (e.g. "Restaurant", "SaaS", "Fashion")'),
        content_pillars: z.array(z.string()).optional().describe('Content pillars / themes'),
        brand_style: z.string().optional().describe('Brand style description'),
        site_type: z.string().optional().describe('Type of website (e.g. "ecommerce", "blog", "portfolio")'),
        website: z.string().optional().describe('Brand website. A bare domain is fine — it is normalised to https://. Empty string clears it.'),
        language: z.string().optional().describe('Language captions and articles are written in (e.g. "Italian"). Empty string clears the override.'),
        target_platforms: z
          .array(z.string())
          .optional()
          .describe('The social platforms this brand posts on (instagram, tiktok, linkedin, facebook, x, youtube, threads…). REPLACES the list; [] means no restriction.'),
        visual_style: z
          .string()
          .optional()
          .describe('The visual brief every image render follows. 20-2000 characters. Setting it LOCKS it so the nightly context rebuild stops overwriting it.'),
        graphic_style: z
          .object({
            display_font: z.string().describe('Google Fonts family for headlines'),
            body_font: z.string().describe('Google Fonts family for body text'),
            instructions: z.string().optional().describe('Art direction for composed graphics (max 1200 chars)')
          })
          .optional()
          .describe('Typography for composed graphics. Both families are checked against Google Fonts before saving — an unavailable name is refused, not silently rendered as Inter.')
      }),
      execute: async (input: Record<string, unknown>, opts: ToolExecutionOptions<unknown>) => {
        const patch: AnyRec = {};
        const brandPatch: AnyRec = {};
        const updated: string[] = [];

        for (const k of ['about', 'target_audience', 'category', 'content_pillars', 'brand_style', 'site_type']) {
          if (input[k] !== undefined) { patch[k] = input[k]; updated.push(k); }
        }

        // Il sito sta in due posti (brand_kit.source_url e brands.website) e il form li scrive
        // tutti e due: scriverne uno solo lascia la coppia incoerente, e i lettori pescano ora
        // dall'uno ora dall'altro (vedi resolveDfsSite qui sopra).
        if (input.website !== undefined) {
          const site = normalizeWebsite(String(input.website ?? ''));
          patch.source_url = site;
          brandPatch.website = site;
          updated.push('website');
        }

        if (input.visual_style !== undefined) {
          const text = String(input.visual_style ?? '').trim();
          // Stessi limiti del form: sotto le 20 battute non è un brief, sopra le 2000 il prompt
          // di render non lo regge.
          if (text.length < 20) return { error: 'visual_style is too short (min 20 characters).' };
          if (text.length > 2000) return { error: 'visual_style is too long (max 2000 characters).' };
          patch.visual_style = text;
          // Come il form: scriverlo significa bloccarlo, o il prossimo rebuild del contesto lo
          // riscrive e l'utente vede tornare il brief di prima senza spiegazioni.
          patch.visual_style_locked = true;
          updated.push('visual_style');
        }

        if (input.graphic_style !== undefined) {
          const gs = input.graphic_style as AnyRec;
          const display = String(gs?.display_font ?? '').trim();
          const body = String(gs?.body_font ?? '').trim();
          if (!display || !body) return { error: 'graphic_style needs both display_font and body_font.' };
          // La stessa verifica del form, e per la stessa ragione: un font che Google Fonts non
          // serve viene renderizzato come Inter SENZA dire niente — cioè il modo peggiore di
          // sbagliare, perché sembra funzionare.
          const { fontIsAvailable } = await import('$lib/server/design-typography');
          const [okDisplay, okBody] = await Promise.all([fontIsAvailable(display), fontIsAvailable(body)]);
          const missing = [!okDisplay ? display : null, !okBody ? body : null].filter(Boolean);
          if (missing.length) {
            return { error: `Google Fonts does not serve ${missing.join(' and ')}. Pick another family — graphics would silently render in Inter.` };
          }
          patch.graphic_style = {
            display_font: display,
            body_font: body,
            instructions: String(gs?.instructions ?? '').trim().slice(0, 1200)
          };
          updated.push('graphic_style');
        }

        if (input.target_platforms !== undefined) {
          const { PLATFORM_KEYS } = await import('$lib/components/platform-meta');
          const KNOWN = new Set<string>(PLATFORM_KEYS);
          // Stessa normalizzazione del form, alias `twitter` → `x` compreso: una chiave ignota
          // salvata qui avvelena il planner (playbook, formati, cross-post) senza errori.
          const wanted = (input.target_platforms as unknown[]).map((pf) => {
            const k = String(pf).toLowerCase().trim();
            return k === 'twitter' ? 'x' : k;
          });
          const platforms = [...new Set(wanted.filter((k) => KNOWN.has(k)))];
          const rejected = [...new Set(wanted.filter((k) => !KNOWN.has(k)))];
          if (rejected.length && !platforms.length) {
            return { error: `Unknown platforms: ${rejected.join(', ')}. Known: ${[...KNOWN].join(', ')}.` };
          }
          brandPatch.target_platforms = platforms.length ? platforms : null;
          updated.push('target_platforms');
        }

        if (input.language !== undefined) {
          const { data: brand } = await supabase.from('brands').select('content_prefs').eq('id', brandId).maybeSingle();
          const prefs = { ...((brand?.content_prefs as AnyRec) ?? {}) };
          const lang = String(input.language ?? '').trim();
          if (lang) prefs.language = lang;
          else delete prefs.language;
          brandPatch.content_prefs = prefs;
          updated.push('language');
        }

        if (!updated.length) return { error: 'No changes specified' };

        if (Object.keys(patch).length) {
          // Upsert: a brand created straight through the onboarding may not have a brand_kit row yet,
          // and a plain UPDATE would silently save nothing.
          const { error } = await supabase.from('brand_kit').upsert({ brand_id: brandId, ...patch }, { onConflict: 'brand_id' });
          if (error) return { error: error.message };
        }
        if (Object.keys(brandPatch).length) {
          const { error } = await supabase.from('brands').update(brandPatch).eq('id', brandId);
          if (error) return { error: error.message };
        }

        // Substantive identity write → auto-approve Studio so strategy can follow without a permission ask.
        const identityKeys = ['about', 'target_audience', 'category', 'content_pillars', 'brand_style'];
        let studio: { approved?: boolean; already?: boolean } | undefined;
        if (identityKeys.some((k) => input[k] != null && String(input[k]).trim() !== '')) {
          const { approveStudioIfNeeded } = await import('$lib/server/onboarding');
          studio = await approveStudioIfNeeded(supabase, brandId);
        }
        return {
          success: true,
          updated_fields: updated,
          studio_approved: studio?.approved === true || studio?.already === true,
          instruction:
            studio?.approved
              ? 'Studio auto-approved. Call generate_strategy next (then generate_editorial_plan). Do not ask the user for permission.'
              : undefined
        };
      }
    }),

    update_editorial_plan: tool({
      description: 'Update the active editorial plan: voice, cadence, platform mix, or individual week themes/briefs.',
      inputSchema: z.object({
        voice: z.object({
          mood: z.string().optional(),
          tone: z.string().optional(),
          goal: z.string().optional(),
          personality: z.string().optional()
        }).optional().describe('Update the voice framework'),
        cadence: z.string().optional().describe('Posting cadence: "3/week", "5/week", or "daily"'),
        platform_mix: z.array(z.object({
          platform: z.string(),
          share: z.string(),
          role: z.string()
        })).optional().describe('Platform mix entries'),
        week_index: z.number().int().min(0).max(11).optional().describe('0-based index of the week to update. Valid range depends on the plan length (same 0-11 ceiling as produce_week); an index past the plan\'s last week is an error.'),
        week_theme: z.string().optional().describe('New theme for the specified week'),
        week_brief: z.string().optional().describe('User brief for the specified week (drives replanning)')
      }),
      execute: async ({ voice, cadence, platform_mix, week_index, week_theme, week_brief }: AnyRec, opts: ToolExecutionOptions<unknown>) => {
        const { data: plan } = await supabase.from('editorial_plans').select('id, voice, cadence, platform_mix, weeks').eq('brand_id', brandId).eq('status', 'active').maybeSingle();
        if (!plan) return { error: 'No active editorial plan found' };

        const patch: AnyRec = {};
        if (voice) patch.voice = { ...(plan.voice as AnyRec), ...voice };
        if (cadence) patch.cadence = cadence;
        if (platform_mix) patch.platform_mix = platform_mix;
        if (week_index != null && (week_theme || week_brief)) {
          const weeks = [...(plan.weeks as AnyRec[])];
          // Un indice fuori range prima veniva IGNORATO: il tool rispondeva success e il piano
          // restava identico — il modello confermava all'utente un tema mai scritto.
          if (!weeks[week_index]) {
            return { error: `week_index ${week_index} is out of range — this plan has ${weeks.length} week(s) (valid: 0-${weeks.length - 1}).` };
          }
          if (week_theme) weeks[week_index].theme = week_theme;
          if (week_brief) weeks[week_index].brief = week_brief;
          patch.weeks = weeks;
        }

        if (Object.keys(patch).length === 0) return { error: 'No changes specified' };
        const { error } = await supabase.from('editorial_plans').update(patch).eq('id', plan.id);
        if (error) return { error: error.message };
        return { success: true, updated_fields: Object.keys(patch) };
      }
    }),

    update_gtm_plan: tool({
      description: 'Update the active GTM plan: objective, current phase details, platform weights, or pillars.',
      inputSchema: z.object({
        objective: z.string().optional().describe('Overall GTM objective'),
        phase_index: z.number().optional().describe('Index of the phase to update'),
        phase_name: z.string().optional(),
        phase_objective: z.string().optional(),
        platform_weights: z.array(z.object({
          platform: z.string(),
          percent: z.number()
        })).optional().describe('Updated platform weights for the phase'),
        pillars: z.array(z.string()).optional().describe('Updated pillars for the phase')
      }),
      execute: async ({ objective, phase_index, phase_name, phase_objective, platform_weights, pillars }: AnyRec, opts: ToolExecutionOptions<unknown>) => {
        const { data: plan } = await supabase.from('gtm_plans').select('id, objective, phases').eq('brand_id', brandId).eq('status', 'active').maybeSingle();
        if (!plan) return { error: 'No active GTM plan found' };

        const patch: AnyRec = {};
        if (objective) patch.objective = objective;
        if (phase_index != null) {
          const phases = [...(plan.phases as AnyRec[])];
          // Stessa regola di update_editorial_plan: fuori range è un errore esplicito col range
          // valido, non un success con zero modifiche.
          if (!phases[phase_index]) {
            return { error: `phase_index ${phase_index} is out of range — this plan has ${phases.length} phase(s) (valid: 0-${phases.length - 1}).` };
          }
          if (phase_name) phases[phase_index].name = phase_name;
          if (phase_objective) phases[phase_index].objective = phase_objective;
          if (platform_weights) phases[phase_index].platform_weights = platform_weights;
          if (pillars) phases[phase_index].pillars = pillars;
          patch.phases = phases;
        }

        if (Object.keys(patch).length === 0) return { error: 'No changes specified' };
        const { error } = await supabase.from('gtm_plans').update(patch).eq('id', plan.id);
        if (error) return { error: error.message };
        return { success: true, updated_fields: Object.keys(patch) };
      }
    }),

    update_voice: tool({
      description:
        'Update the brand voice framework (mood, tone, register, emotion, character, syntax), the per-platform caption rules, the preferred hashtags per platform, and the voice examples — the real past posts the AI copies the writing style from.',
      inputSchema: z.object({
        mood: z.string().optional().describe('Mood of communication'),
        tone: z.string().optional().describe('Tone (friendly/neutral/authoritative)'),
        register: z.number().min(0).max(100).optional().describe('Formality register 0-100'),
        emotion: z.string().optional().describe('Emotion to leave behind'),
        character: z.string().optional().describe('Communication character'),
        syntax: z.string().optional().describe('Syntax style (short/mixed/long)'),
        platform_instructions: z.record(z.string(), z.string()).optional().describe('Per-platform instruction overrides (key=platform, value=instructions)'),
        platform_hashtags: z
          .record(z.string(), z.string())
          .optional()
          .describe('Preferred hashtags per platform (key=platform, value=free-typed list). When set, generation uses ONLY these and never invents new ones. An empty string clears that platform.'),
        voice_examples: z
          .array(z.string())
          .optional()
          .describe('Real past posts of this brand, one per entry, used as writing-style references. REPLACES the list; [] clears it.')
      }),
      execute: async (patch: Record<string, unknown>, opts: ToolExecutionOptions<unknown>) => {
        // I sei campi voce vivono sul piano editoriale attivo. Senza piano NON si perdono in
        // silenzio: prima il tool rispondeva success anche quando li aveva scartati tutti, e il
        // modello raccontava all'utente una voce mai salvata.
        const voiceTouched = ['mood', 'tone', 'register', 'emotion', 'character', 'syntax'].filter(
          (k) => patch[k] !== undefined && patch[k] !== null && patch[k] !== ''
        );
        const { data: plan } = await supabase.from('editorial_plans').select('id, voice').eq('brand_id', brandId).eq('status', 'active').maybeSingle();
        if (plan && voiceTouched.length) {
          const voice = { ...(plan.voice as AnyRec) };
          if (patch.mood) voice.mood = patch.mood;
          if (patch.tone) voice.tone = patch.tone;
          if (patch.register != null) voice.register = patch.register;
          if (patch.emotion) voice.emotion = patch.emotion;
          if (patch.character) voice.character = patch.character;
          if (patch.syntax) voice.syntax = patch.syntax;
          const { error } = await supabase.from('editorial_plans').update({ voice }).eq('id', plan.id);
          if (error) return { error: error.message };
        }

        // Le tre cose che vivono su content_prefs si leggono e si riscrivono UNA volta sola: tre
        // update separati sullo stesso JSON si sovrascrivono a vicenda, e l'ultimo vince.
        const touchesPrefs =
          patch.platform_instructions !== undefined ||
          patch.platform_hashtags !== undefined ||
          patch.voice_examples !== undefined;
        if (touchesPrefs) {
          const { data: brand } = await supabase.from('brands').select('content_prefs').eq('id', brandId).maybeSingle();
          const prefs = { ...((brand?.content_prefs as AnyRec) ?? {}) };

          if (patch.platform_instructions) {
            prefs.platformInstructions = { ...(prefs.platformInstructions ?? {}), ...patch.platform_instructions };
          }

          if (patch.platform_hashtags !== undefined) {
            // Stesso normalizzatore del form: gli hashtag non possono contenere spazi o
            // punteggiatura, e la lista ha un tetto. Un tag salvato "a mano" dall'agente finirebbe
            // in ogni caption esattamente com'è stato scritto, sbagliato compreso.
            const map: Record<string, string[]> = { ...((prefs.platformHashtags as AnyRec) ?? {}) };
            for (const [pf, raw] of Object.entries(patch.platform_hashtags as Record<string, string>)) {
              const key = String(pf).toLowerCase().trim();
              if (!key) continue;
              const tags = normalizeHashtags(String(raw ?? ''));
              if (tags.length) map[key] = tags;
              else delete map[key];
            }
            if (Object.keys(map).length) prefs.platformHashtags = map;
            else delete prefs.platformHashtags;
          }

          if (patch.voice_examples !== undefined) {
            const examples = (patch.voice_examples as unknown[]).map((e) => String(e ?? '').trim()).filter(Boolean);
            if (examples.length) prefs.voiceExamples = examples;
            else delete prefs.voiceExamples;
          }

          const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brandId);
          if (error) return { error: error.message };
        }

        if (!plan && voiceTouched.length) {
          if (!touchesPrefs) {
            return {
              error: `No active editorial plan — ${voiceTouched.join(', ')} were NOT saved anywhere. Generate an editorial plan first (generate_editorial_plan), then retry.`
            };
          }
          return {
            success: true,
            saved: ['platform instructions/hashtags/examples → brand content prefs'],
            voice_not_applied: voiceTouched,
            warning: `No active editorial plan — ${voiceTouched.join(', ')} were NOT saved (the voice framework lives on the plan). The per-platform prefs WERE saved on the brand. Tell the user which fields did not land.`
          };
        }
        return { success: true };
      }
    }),

    // Schema, description e tipo di risposta vivono nel contratto (contracts/post-tools.ts):
    // i valori di content_type sono interpolati dalla costante POST_CONTENT_TYPES e ora lo
    // schema è z.enum — "carousel" non arriva più in DB, torna un errore di validazione.
    update_post: toolFromContract(updatePostContract, async ({ post_id, ...patch }: AnyRec, opts: ToolExecutionOptions<unknown>) => {
        const clean: AnyRec = {};
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) return { error: 'No changes specified' };

        // Check current status before updating
        const { data: current } = await supabase.from('posts').select('status, updated_at').eq('id', post_id).eq('brand_id', brandId).maybeSingle();
        if (!current) return { error: 'Post not found' };
        const stale = requireFreshRead('post', String(post_id), current.updated_at, 'This post', 'read_posts (find this id in the list)');
        if (stale) return stale;

        const { error } = await supabase.from('posts').update(clean).eq('id', post_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        await refreshPostReceipt(supabase, brandId, String(post_id));

        // For scheduled posts: cancel old Zernio schedule and re-publish to keep 1:1 sync
        if (current.status === 'scheduled') {
          await requireZernioCancellation(supabase, post_id);
          const { data: updated } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', post_id).maybeSingle();
          if (updated) {
            try {
              const res = await publishApprovedPost(supabase, updated as ApprovablePost, tz);
              return { success: true, updated_fields: Object.keys(clean), rescheduled: true, noAccount: res.noAccount, ...(res.noAccount ? { message: noAccountNotice((updated as AnyRec).platforms?.length ? (updated as AnyRec).platforms : [(updated as AnyRec).platform]) } : {}) };
            } catch (e) {
              return { success: true, updated_fields: Object.keys(clean), zernio_error: String(e) };
            }
          }
        }

        return { success: true, updated_fields: Object.keys(clean) };
    }),

    review_video: tool({
      description:
        'Review a FINISHED video against organic UGC or paid-ads standards (Gemini watches the clip). Scores hook / doomscroll stop, 2s sound-off, hold, authenticity, structure, CTA/offer. Use before approving a reel, after creating a video, or on a competitor ad URL. Credits only — does not spend the monthly video budget.',
      inputSchema: z.object({
        standard: z
          .enum(['organic', 'ads'])
          .describe('organic = Reels/TikTok UGC. ads = Meta/paid UGC ad (proof, offer, uniqueness, claims).'),
        url: z.string().optional().describe('Public https URL of the mp4. Omit when post_id is set.'),
        post_id: z.string().optional().describe('Brand post id — uses its video media_url.'),
        product: z.string().optional(),
        caption: z.string().optional(),
        script: z.string().optional().describe('Intended spoken line, if known.')
      }),
      execute: async (
        {
          standard,
          url,
          post_id,
          product,
          caption,
          script
        }: {
          standard: 'organic' | 'ads';
          url?: string;
          post_id?: string;
          product?: string;
          caption?: string;
          script?: string;
        },
        opts: ToolExecutionOptions<unknown>
      ) => {
        return withBrandContext(brandId, async () => {
          const { extraReviewOpts, parseVideoStandard, resolveReviewVideoUrl, reviewVideo } = await import('$lib/server/video-review');
          const resolved = await resolveReviewVideoUrl(supabase, brandId, { url, postId: post_id });
          if ('error' in resolved) return { error: resolved.error };
          const { data: brand } = await supabase
            .from('brands')
            .select('name, content_prefs')
            .eq('id', brandId)
            .maybeSingle();
          const language = (brand?.content_prefs as AnyRec)?.language
            ? String((brand!.content_prefs as AnyRec).language)
            : null;
          try {
            const result = await reviewVideo(resolved.url, {
              standard: parseVideoStandard(standard) ?? 'organic',
              brandName: brand?.name,
              product: product?.trim() || resolved.product || null,
              caption: caption?.trim() || resolved.caption || null,
              script: script?.trim() || null,
              language,
              // reviewVideo has always accepted this and always been handed undefined: the clip
              // download plus the agent loop is one of the longest steps a turn can take.
              abortSignal: opts.abortSignal,
              ...extraReviewOpts(resolved)
            });
            if (!result.ok) return { error: result.error };
            const { persistReadyReview } = await import('$lib/server/video-review-store');
            await persistReadyReview(supabase, {
              brandId,
              url: resolved.url,
              postId: post_id ?? null,
              standard: parseVideoStandard(standard) ?? 'organic',
              review: result.review,
              kind: extraReviewOpts(resolved).kind
            });
            return { ok: true, ...result.review };
          } catch (e) {
            if (e instanceof Error && e.name === 'CreditsExhaustedError') {
              return { error: 'credits_exhausted', action: 'offer_upgrade' };
            }
            return { error: e instanceof Error ? e.message : String(e) };
          }
        });
      }
    }),

    // Il ponte fra un URL `inspect_only` e una generazione: entra un mp4 di terzi, esce TESTO.
    // Senza questo tool, in chat, `research_meta_ads` restituiva un video del competitor e l'unica
    // strada per usarlo era quella sbagliata (passarlo come reference). Il video non viene mai
    // ri-hostato né allegato a un modello generativo: si scarica, si smonta, si butta.
    breakdown_reference_video: tool({
      description:
        'Turn a reference video into a written shot brief (subject / camera / audio / second-by-second beats). This is the ONLY thing to do with a competitor clip: an inspect_only url goes in, text comes out, and that text becomes the creative direction for create_post / a generated video shot with OUR product and OUR people. Never pass the source url itself to a generation. Free — no video budget.',
      inputSchema: z.object({
        url: z.string().describe('Public video URL — e.g. an ads[].urls entry with use=inspect_only.'),
        script: z.string().optional().describe('Our spoken line, replacing the reference dialogue.')
      }),
      execute: async ({ url, script }: { url: string; script?: string }) => {
        return withBrandContext(brandId, async () => {
          try {
            const { breakdownReferenceVideo, shotBriefPromptFromBreakdown } = await import(
              '$lib/server/video-breakdown'
            );
            const target = url?.trim();
            if (!target) return { error: 'Pass a video url.' };
            const breakdown = await breakdownReferenceVideo(target);
            if (!breakdown) {
              return { error: 'Breakdown failed (fetch/ffmpeg/model). Write the shot brief yourself.' };
            }
            return {
              ok: true,
              prompt: shotBriefPromptFromBreakdown(breakdown, { script }),
              dialogue_summary: breakdown.dialogueSummary,
              duration_seconds: breakdown.durationSeconds,
              subject: breakdown.brief.subject,
              camera: breakdown.brief.camera,
              audio: breakdown.brief.audio,
              hint: 'Use `prompt` as the creative direction. Cast, product and brand must be ours — use brand_reference_urls (use=reference), never the source url.'
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        });
      }
    }),

    approve_post: toolFromContract(approvePostContract(tz), async ({ post_id, scheduled_for }: { post_id: string; scheduled_for?: string }, opts: ToolExecutionOptions<unknown>) => {
        // Prima il guard di stato, POI la scrittura: qui scheduled_for veniva salvato prima del
        // check, così un approve rifiutato aveva comunque già spostato l'orario di un post
        // scheduled/published — una mutazione senza riga di risposta che la ammetta.
        let when: string | null = null;
        if (scheduled_for) {
          const parsed = resolveScheduleInput(scheduled_for, tz);
          if ('error' in parsed) return parsed;
          when = parsed.utc;
        }
        const { data: post } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', post_id).eq('brand_id', brandId).maybeSingle();
        if (!post) return { error: 'Post not found' };
        if (!(APPROVABLE_STATUSES as readonly string[]).includes(post.status)) {
          return { error: `Post is already ${post.status}, can only approve ${APPROVABLE_STATUSES.join('/')} posts` };
        }
        if (when) {
          const { error: schedErr } = await supabase.from('posts').update({ scheduled_for: when }).eq('id', post_id).eq('brand_id', brandId);
          if (schedErr) return { error: schedErr.message };
          (post as AnyRec).scheduled_for = when;
        }
        // media_url still holds the cover while a clip renders out-of-band. Approving now would
        // schedule a photo against a post the user was promised as a video.
        //
        // Read on its own rather than through EDITOR_POST_COLS: that list is deliberately narrow
        // because an unmigrated column there breaks every post read in the app (see its comment).
        // Scoped here, a missing migration 0180 costs this one guard and nothing else.
        const { data: renderState } = await supabase
          .from('posts')
          .select('video_render_status')
          .eq('id', post_id)
          .maybeSingle();
        if ((renderState as { video_render_status?: string | null } | null)?.video_render_status === 'rendering') {
          return {
            error: 'video_still_rendering',
            message:
              'The clip for this post has not landed yet — approving now would publish the cover frame instead of the video. Tell the user to wait; you will be notified when the render finishes.'
          };
        }
        try {
          const res = await publishApprovedPost(supabase, post as ApprovablePost, tz);
          if (res.scheduled === 0 && res.failed > 0) {
            return { error: res.error ?? 'Could not schedule — the post did not meet platform requirements.' };
          }
          // `noAccount: true` accanto a `success: true` è stato letto come "programmato" per giri
          // interi: qui il post resta approvato e NON esce. Si dice, non si lascia dedurre.
          if (res.noAccount) {
            return {
              success: false,
              approved: true,
              scheduled: false,
              noAccount: true,
              message: noAccountNotice((post as AnyRec).platforms?.length ? (post as AnyRec).platforms : [(post as AnyRec).platform])
            };
          }
          return {
            success: true,
            noAccount: false,
            ...(when ? { scheduled_for: when, scheduled_for_local: `${formatInZone(when, tz)} (${tz})` } : {})
          };
        } catch (e) {
          return { error: String(e) };
        }
    }),

    reject_post: toolFromContract(rejectPostContract, async ({ post_id, confirm }: { post_id: string; confirm: boolean }, opts: ToolExecutionOptions<unknown>) => {
        if (!confirm) return { error: 'Deletion not confirmed' };
        const { data: post } = await supabase.from('posts').select('id, status').eq('id', post_id).eq('brand_id', brandId).maybeSingle();
        if (!post) return { error: 'Post not found' };
        if (post.status === 'published') {
          return { error: 'Post is already published — deleting the row cannot un-publish it. Nothing was deleted.' };
        }
        // Cancellare la riga senza revocare Zernio lasciava la schedulazione VIVA: il post spariva
        // dall'app e usciva lo stesso (stessa classe dell'incidente scheduling di luglio 2026).
        // Se la revoca fallisce, la riga resta — meglio un post visibile che uno fantasma live.
        // RESCHEDULABLE_STATUSES == gli stati con una schedulazione Zernio potenzialmente viva.
        if ((RESCHEDULABLE_STATUSES as readonly string[]).includes(post.status)) {
          try {
            await requireZernioCancellation(supabase, post_id);
          } catch (e) {
            return { error: `Zernio schedule could not be cancelled — post NOT deleted: ${e instanceof Error ? e.message : String(e)}` };
          }
        }
        const { error } = await supabase.from('posts').delete().eq('id', post_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, deleted: post_id };
    }),

    reschedule_post: toolFromContract(reschedulePostContract(tz), async ({ post_id, scheduled_for }: { post_id: string; scheduled_for: string }, opts: ToolExecutionOptions<unknown>) => {
        // Validate BEFORE touching Zernio: a rejected time must leave the existing schedule intact.
        const parsed = resolveScheduleInput(scheduled_for, tz);
        if ('error' in parsed) return parsed;
        // Solo post già approvati/schedulati: publishApprovedPost NON controlla lo status, quindi
        // "rischedulare" un draft lo avrebbe approvato e mandato a Zernio di fatto — lo stesso
        // bypass dell'approvazione dell'incidente scheduling di luglio 2026.
        const { data: current } = await supabase.from('posts').select('id, status').eq('id', post_id).eq('brand_id', brandId).maybeSingle();
        if (!current) return { error: 'Post not found' };
        if (!(RESCHEDULABLE_STATUSES as readonly string[]).includes(current.status)) {
          return {
            error: `Post is ${current.status}, not ${RESCHEDULABLE_STATUSES.join('/')} — rescheduling it would publish it without approval. For a pending_user draft use approve_post (optionally with scheduled_for) instead.`
          };
        }
        // Cancel existing Zernio schedule FIRST to avoid duplicates
        await requireZernioCancellation(supabase, post_id);
        await supabase.from('posts').update({ scheduled_for: parsed.utc }).eq('id', post_id).eq('brand_id', brandId);
        const { data: post } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', post_id).eq('brand_id', brandId).maybeSingle();
        if (!post) return { error: 'Post not found' };
        try {
          const res = await publishApprovedPost(supabase, post as ApprovablePost, tz);
          return { success: true, new_time: parsed.utc, new_time_local: parsed.local, noAccount: res.noAccount, ...(res.noAccount ? { message: noAccountNotice((post as AnyRec).platforms?.length ? (post as AnyRec).platforms : [(post as AnyRec).platform]) } : {}) };
        } catch (e) {
          return { error: String(e) };
        }
    }),

    // L'annotazione esplicita del ritorno fa il narrowing dei literal di `status` contro
    // PostStatus — senza, TS li allarga a string e il contratto non combacia.
    cross_post: toolFromContract(crossPostContract, async ({ post_id, platforms }: { post_id: string; platforms: string[] }, opts: ToolExecutionOptions<unknown>): Promise<CrossPostResult | ToolFailure> => {
        if (!platforms?.length) return { error: 'Specifica almeno una piattaforma' };

        const { data: post } = await supabase
          .from('posts')
          .select(`${EDITOR_POST_COLS}, first_comment`)
          .eq('id', post_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!post) return { error: 'Post not found' };

        const newPlatforms = platforms.map((p) => p.toLowerCase().trim());
        const existingPlatforms = (post.platforms && post.platforms.length ? post.platforms : [post.platform]).filter(Boolean);
        const mergedPlatforms = Array.from(new Set([...existingPlatforms, ...newPlatforms]));

        // Pending: just update the platforms field
        if (post.status === 'pending_user') {
          const { error } = await supabase.from('posts').update({ platforms: mergedPlatforms }).eq('id', post_id);
          if (error) return { error: error.message };
          return { success: true, post_id, platforms: mergedPlatforms, status: 'pending_user' };
        }

        // Scheduled: cancel old schedule, update platforms, re-schedule
        if (post.status === 'scheduled') {
          await requireZernioCancellation(supabase, post_id);
          await supabase.from('posts').update({ platforms: mergedPlatforms }).eq('id', post_id);
          const { data: updated } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', post_id).maybeSingle();
          if (updated) {
            try {
              const res = await publishApprovedPost(supabase, updated as ApprovablePost, tz);
              return { success: true, post_id, platforms: mergedPlatforms, status: 'scheduled', noAccount: res.noAccount, ...(res.noAccount ? { message: noAccountNotice(mergedPlatforms as string[]) } : {}) };
            } catch (e) {
              return { error: String(e) };
            }
          }
          return { success: true, post_id, platforms: mergedPlatforms, status: 'scheduled' };
        }

        // Published: clone the post for new platforms only
        if (post.status === 'published') {
          const onlyNew = newPlatforms.filter((p) => !existingPlatforms.includes(p));
          if (!onlyNew.length) return { error: 'Il post è già pubblicato su tutte queste piattaforme' };

          // Il clone porta TUTTO il set media/contenuto che il publish legge (mediaUrlsForPublish,
          // captionFor, title/link/subreddit — vedi publish.ts): copiare solo media_url faceva
          // uscire un carosello come singola immagine, e perdeva first_comment e i tagli X/Threads.
          const { data: clone, error: cloneErr } = await supabase
            .from('posts')
            .insert({
              brand_id: brandId,
              platform: onlyNew[0],
              platforms: onlyNew.length > 1 ? onlyNew : null,
              caption: post.caption,
              platform_captions: post.platform_captions,
              title: post.title,
              link_url: post.link_url,
              subreddit: post.subreddit,
              first_comment: (post as AnyRec).first_comment ?? null,
              image_prompt: post.image_prompt,
              image_prompts: post.image_prompts,
              media_url: post.media_url,
              media_urls: post.media_urls,
              video_thumbnail_url: post.video_thumbnail_url,
              youtube_thumbnail_url: post.youtube_thumbnail_url,
              product_name: post.product_name,
              content_type: post.content_type,
              format: post.format,
              source: 'cross_post',
              status: 'approved'
            })
            .select('id')
            .single();
          if (cloneErr || !clone) return { error: cloneErr?.message ?? 'clone_failed' };

          // Publish immediately
          const { data: cloneFull } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', clone.id).maybeSingle();
          if (cloneFull) {
            try {
              const res = await publishApprovedPost(supabase, cloneFull as ApprovablePost, tz, { now: true });
              return {
                success: true,
                original_post_id: post_id,
                clone_post_id: clone.id,
                platforms: onlyNew,
                status: 'published',
                noAccount: res.noAccount
              };
            } catch (e) {
              // success:true + publish_error era ambiguo: il modello raccontava un cross-post
              // riuscito mentre il clone era fermo in approved. Il fallimento deve essere netto.
              return {
                success: false,
                error: `Clone created (${clone.id}, status approved) but publishing FAILED — nothing went out: ${String(e)}`,
                clone_post_id: clone.id,
                platforms: onlyNew,
                status: 'approved'
              };
            }
          }
          return { success: true, clone_post_id: clone.id, platforms: onlyNew, status: 'approved' };
        }

        return { error: `Stato post non gestito: ${post.status}` };
    }),
  };
}
