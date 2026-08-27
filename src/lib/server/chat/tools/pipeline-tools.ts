import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { sanitizeBrandColors } from '$lib/brand-fields';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';

export function pipelineTools(ctx: ChatToolCtx) {
  const { supabase, brandId, tz, userId, origin, locale, threadId, turnDocuments } = ctx;
  return {
    propose_plan: tool({
      description:
        'Propose a full plan as a markdown document. USE THIS whenever the user asks for something ' +
        'large or multi-step (a launch, a repositioning, a quarter of content, a migration, an audit) ' +
        'instead of writing the plan inline in the chat. The chat shows a card; clicking it opens the ' +
        'plan on its own page. Write real markdown: headings, ordered steps, tables, checklists.',
      inputSchema: z.object({
        title: z.string().describe('Short plan title, e.g. "Lancio linea autunno"'),
        markdown: z
          .string()
          .min(200)
          .describe('The whole plan in markdown. Headings, numbered phases, owners, deliverables.'),
        summary: z.string().optional().describe('One line the card shows under the title')
      }),
      execute: async (
        { title, markdown, summary }: { title: string; markdown: string; summary?: string },
        opts: ToolExecutionOptions
      ) => {
        const { data, error } = await supabase
          .from('brand_documents')
          .insert({
            brand_id: brandId,
            kind: 'plan',
            collection: 'plan',
            title,
            markdown,
            // content_text stays populated: the pre-0111 readers still use it.
            content_text: markdown,
            summary: summary ?? null,
            // 'pending' hands the plan to the knowledge worker (cron), which chunks and embeds
            // markdown it already has — the plan becomes searchable with no extra code.
            status: 'pending',
            source_type: 'chat'
          })
          .select('id')
          .maybeSingle();
        if (error) return { error: error.message };
        // No href: the client composes it from plan_id — threading the brand slug through the
        // tool factory just to build a link the page already knows how to build isn't worth it.
        return { success: true, plan_id: data?.id, title, summary: summary ?? null };
      }
    }),

    add_document: tool({
      description:
        'Save a note or document into brand knowledge (chunked + searchable). Attached files this turn are already converted to markdown — they are NOT knowledge until you call this. Prefer from_attachment with the filename so the FULL converted text is stored; do not paste truncated attachment content into content_text.',
      inputSchema: z.object({
        title: z.string().describe('Document title'),
        content_text: z
          .string()
          .optional()
          .describe('Document content. Omit when from_attachment is set.'),
        kind: z.enum(['note', 'document']).optional().describe('Document type (default: note)'),
        from_attachment: z
          .string()
          .optional()
          .describe('Filename of a file the user attached this turn (exact or unique suffix).')
      }),
      execute: async (
        {
          title,
          content_text,
          kind = 'note',
          from_attachment
        }: {
          title: string;
          content_text?: string;
          kind?: string;
          from_attachment?: string;
        },
        _opts: ToolExecutionOptions
      ) => {
        const { ingestDocument, kickKnowledgeWork } = await import('$lib/server/knowledge');
        const { matchTurnDocument } = await import('$lib/chat-documents');

        let body = (content_text ?? '').trim();
        let docTitle = title.trim();
        if (from_attachment) {
          const attached = matchTurnDocument(turnDocuments, from_attachment);
          if (!attached) {
            const names = turnDocuments.map((d) => d.name);
            return {
              error: names.length
                ? `No attached file matching "${from_attachment}". Available: ${names.join(', ')}`
                : 'No files were attached this turn. Pass content_text instead.'
            };
          }
          body = attached.markdown.trim();
          if (!docTitle) docTitle = (attached.title || attached.name).trim();
        }
        if (!body) return { error: 'Empty document' };

        try {
          const { data: brand } = await supabase.from('brands').select('plan').eq('id', brandId).maybeSingle();
          const saved = await ingestDocument(supabase, brandId, userId, {
            title: docTitle || 'Note',
            text: body,
            kind: kind === 'document' ? 'document' : 'note',
            sourceType: from_attachment ? 'chat' : 'note',
            plan: brand?.plan
          });
          if (origin) void kickKnowledgeWork(origin);
          return { success: true, document_id: saved.id, deduped: saved.deduped };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    update_media: tool({
      description:
        'Update Media library catalog fields (title, description, tags, usage guidance) for an uploaded asset. Does not upload files.',
      inputSchema: z.object({
        media_id: z.string().describe('brand_media id from read_media'),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        suggested_use: z.string().optional(),
        when_to_use: z.string().optional(),
        how_to_use: z.string().optional(),
        where_to_use: z.string().optional()
      }),
      execute: async (
        {
          media_id,
          title,
          description,
          tags,
          suggested_use,
          when_to_use,
          how_to_use,
          where_to_use
        }: AnyRec,
        _opts: ToolExecutionOptions
      ) => {
        const patch: AnyRec = { updated_at: new Date().toISOString() };
        if (title != null) patch.title = String(title).trim() || null;
        if (description != null) patch.description = String(description).trim() || null;
        if (tags != null) patch.tags = (tags as string[]).map(String).filter(Boolean).slice(0, 20);
        if (suggested_use != null) patch.suggested_use = String(suggested_use).trim() || null;
        if (when_to_use != null) patch.when_to_use = String(when_to_use).trim() || null;
        if (how_to_use != null) patch.how_to_use = String(how_to_use).trim() || null;
        if (where_to_use != null) patch.where_to_use = String(where_to_use).trim() || null;
        if (Object.keys(patch).length <= 1) return { error: 'No changes specified' };
        const { error } = await supabase
          .from('brand_media')
          .update(patch)
          .eq('id', media_id)
          .eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, media_id, updated_fields: Object.keys(patch).filter((k) => k !== 'updated_at') };
      }
    }),

    // ── ONBOARDING REGIA ───────────────────────────────────────────────────

    set_section_status: tool({
      description:
        'ONBOARDING — Rarely needed. Studio is auto-approved when the brand kit is updated or when generate_strategy runs. Prefer those paths. Use status="approved" only as a manual fallback; do NOT ask the user for permission and do NOT use waiting_review.',
      inputSchema: z.object({
        section: z.enum(['studio']),
        status: z.enum(['waiting_review', 'needs_revision', 'draft', 'approved'])
      }),
      execute: async ({ section, status }: { section: 'studio'; status: 'waiting_review' | 'needs_revision' | 'draft' | 'approved' }) => {
        const { saveOnboardingState, getOnboardingState, SECTION_REVIEW_PHASE, approveStudioIfNeeded } = await import('$lib/server/onboarding');
        if (section === 'studio' && status === 'approved') {
          const studio = await approveStudioIfNeeded(supabase, brandId);
          return {
            success: true,
            section,
            status: 'approved',
            already_approved: studio.already,
            phase: studio.state.phase,
            instruction: 'Studio approved. Immediately call generate_strategy (then generate_editorial_plan). Do not ask the user for permission — summarize briefly and keep going.'
          };
        }
        const { data: b } = await supabase.from('brands').select('onboarding_state').eq('id', brandId).maybeSingle();
        const cur = getOnboardingState(b?.onboarding_state);
        if (cur.sections[section] === 'approved') {
          return { success: false, already_approved: true, message: `${section} is already approved — do NOT ask to approve it again; move straight to the next phase (generate_strategy).` };
        }
        const patch: AnyRec = { sections: { [section]: status } };
        if (status === 'waiting_review') patch.phase = SECTION_REVIEW_PHASE[section];
        const next = await saveOnboardingState(supabase, brandId, patch);
        return { success: true, section, status, phase: next.phase };
      }
    }),

    generate_strategy: tool({
      description:
        'Generate (and auto-activate) the brand STRATEGY — a phased GTM roadmap (90-day + 6-month). Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Onboarding: only after Studio is approved; the result is activated immediately — do not ask the user to approve. Pass `objective` if the user stated a clear goal. When the result lands, briefly summarize it and call generate_editorial_plan.',
      inputSchema: z.object({
        objective: z.string().optional().describe("The user's stated objective/goal for the coming months, if any")
      }),
      execute: async ({ objective }: { objective?: string }, opts: ToolExecutionOptions) => {
        return startLongToolJob(
          supabase,
          brandId,
          userId,
          'generate_strategy',
          { objective: objective ?? '', locale, tz },
          threadId,
          opts.abortSignal,
          origin,
          locale
        );
      }
    }),

    generate_editorial_plan: tool({
      description:
        'Generate (and auto-activate) the EDITORIAL PLAN — a 4-week plan with voice, cadence, platform mix and weekly themes. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Onboarding: only after Strategy exists; the plan is activated immediately — do not ask the user to approve. When the result lands, briefly summarize it; only then ask about photos/videos before first-week content.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions) => {
        return startLongToolJob(
          supabase,
          brandId,
          userId,
          'generate_editorial_plan',
          { locale, tz },
          threadId,
          opts.abortSignal,
          origin,
          locale
        );
      }
    }),

    generate_content: tool({
      description:
        'ONBOARDING: generate the FIRST WEEK of draft posts (captions + images together) from the approved editorial plan. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Only AFTER the editorial plan is approved AND you have already asked about photos/videos. Prefer produce_week for later weeks. When the result lands, confirm the drafts are ready with images.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions) => {
        return startLongToolJob(
          supabase,
          brandId,
          userId,
          'generate_content',
          { week: 0, onboarding: true, tz },
          threadId,
          opts.abortSignal,
          origin,
          locale
        );
      }
    }),

    produce_week: tool({
      description:
        'Produce draft posts for a week of the active editorial plan — captions AND images in one pass. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Pass week index 0-based (0 = first week). Omit week to use the current week. When the result lands, confirm the drafts are ready with images.',
      inputSchema: z.object({
        week: z.number().int().min(0).max(11).optional().describe('0-based week index in the editorial plan. Omit for the current week.')
      }),
      execute: async ({ week }: { week?: number }, opts: ToolExecutionOptions) => {
        return startLongToolJob(
          supabase,
          brandId,
          userId,
          'produce_week',
          { week, onboarding: false, tz },
          threadId,
          opts.abortSignal,
          origin,
          locale
        );
      }
    }),

    create_campaign: tool({
      description:
        'Create an event campaign: 5 linked posts (announcement → countdown → spotlight → day-of → recap) with images. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Requires event name, date (YYYY-MM-DD), and a short brief. When the result lands, summarize the campaign for the user.',
      inputSchema: z.object({
        name: z.string().describe('Event / campaign name'),
        event_date: z.string().describe('Event date as YYYY-MM-DD'),
        brief: z.string().describe('Short description of the event and what makes it special'),
        platform: z.string().optional().describe('Target platform (default: brand primary)')
      }),
      execute: async (
        { name, event_date, brief, platform }: { name: string; event_date: string; brief: string; platform?: string },
        opts: ToolExecutionOptions
      ) => {
        return startLongToolJob(
          supabase,
          brandId,
          userId,
          'create_campaign',
          { name, event_date, brief, platform, tz },
          threadId,
          opts.abortSignal,
          origin,
          locale
        );
      }
    }),

    // ── ONBOARDING-LEVEL tools ─────────────────────────────────────────────

    discover_competitors: tool({
      description: 'Discover competitors via web search, scrape their social posts, benchmark performance, and persist results. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn.',
      inputSchema: z.object({
        platforms: z.array(z.string()).optional().describe('Platforms to focus on (e.g. ["instagram", "tiktok"]). Omit to use brand\'s target_platforms.')
      }),
      execute: async ({ platforms: inputPlatforms }: { platforms?: string[] }, opts: ToolExecutionOptions) => {
        return startLongToolJob(supabase, brandId, userId, 'discover_competitors', { platforms: inputPlatforms }, threadId, opts.abortSignal, origin, locale);
      }
    }),

    sync_social_history: tool({
      description: 'Sync the brand\'s social post history from connected platforms. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn.',
      inputSchema: z.object({
        platform: z.string().optional().describe('Specific platform to sync (e.g. "instagram"). Omit to sync all connected platforms.')
      }),
      execute: async ({ platform }: { platform?: string }, opts: ToolExecutionOptions) => {
        return startLongToolJob(supabase, brandId, userId, 'sync_social_history', { platform }, threadId, opts.abortSignal, origin, locale);
      }
    }),

    run_analytics_review: tool({
      description:
        'Run the analytics review agent: reads social/blog/SEO performance, proposes GTM + editorial plan revisions for owner approval, and can rewrite pending/scheduled social posts and draft blog articles. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Pass optional guidance (e.g. "focus on LinkedIn", "drop carousels"). When the result lands, summarize notes + actions for the user; link /gtm and /plan if proposals were created.',
      inputSchema: z.object({
        guidance: z
          .string()
          .optional()
          .describe('Optional owner focus for this review (platform, format, goal).')
      }),
      execute: async ({ guidance }: { guidance?: string }, opts: ToolExecutionOptions) => {
        return startLongToolJob(
          supabase,
          brandId,
          userId,
          'analytics_review',
          { guidance: guidance ?? '' },
          threadId,
          opts.abortSignal,
          origin,
          locale
        );
      }
    }),

    analyze_post_people: tool({
      description: 'Analyze the brand\'s post history to detect recurring people, best posting times, top formats, and engagement patterns. Use when the user wants to understand what works in their content.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions) => {
        const { analyzePostHistory, historyInsightsDigest } = await import('$lib/server/post-history-insights');
        const { data: posts } = await supabase.from('social_post_history')
          .select('content, media_type, published_at, metrics, platform')
          .eq('brand_id', brandId)
          .eq('source', 'zernio')
          .order('published_at', { ascending: false })
          .limit(200);
        if (!posts?.length) return { error: 'No post history found. Sync social accounts first.' };

        const insights = analyzePostHistory(
          posts.map((p) => ({ content: p.content, mediaType: p.media_type, publishedAt: p.published_at, metrics: p.metrics }))
        );
        const digest = historyInsightsDigest(insights);

        return {
          total_posts: posts.length,
          insights: digest,
          best_times: insights.bestTimes ?? null,
          top_formats: insights.topFormats ?? null,
          cadence: insights.cadence ?? null
        };
      }
    }),

    generate_person: tool({
      description: 'Create a brand person from user-provided photos OR generate an AI avatar. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn.',
      inputSchema: z.object({
        name: z.string().describe('Name for the person'),
        role: z.string().optional().describe('Role (e.g. "Founder", "Content Creator", "Brand Ambassador")'),
        description: z.string().optional().describe('Description or personality traits'),
        photo_urls: z.array(z.string()).optional().describe('URLs of photos to use. If provided, these are stored directly instead of generating AI images.'),
        gender: z.string().optional().describe('Gender (for AI generation only)'),
        age_range: z.string().optional().describe('Age range (for AI generation only)')
      }),
      execute: async ({ name, role, description, photo_urls, gender, age_range }: AnyRec, opts: ToolExecutionOptions) => {
        return startLongToolJob(supabase, brandId, userId, 'generate_person', { name, role, description, photo_urls, gender, age_range }, threadId, opts.abortSignal, origin, locale);
      }
    }),

    reanalyze_brand: tool({
      description: 'Re-analyze the brand\'s website to refresh brand kit data. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn.',
      inputSchema: z.object({
        url: z.string().optional().describe('Website URL to analyze. Omit to use the brand\'s existing website.')
      }),
      execute: async ({ url: inputUrl }: { url?: string }, opts: ToolExecutionOptions) => {
        return startLongToolJob(supabase, brandId, userId, 'reanalyze_brand', { url: inputUrl }, threadId, opts.abortSignal, origin, locale);
      }
    }),

    extract_colors: tool({
      description: 'Extract dominant colors from an image URL and set them as the brand\'s color palette. Use when the user provides a logo or reference image and wants to set brand colors from it.',
      inputSchema: z.object({
        image_url: z.string().describe('URL of the image to extract colors from')
      }),
      execute: async ({ image_url }: { image_url: string }, opts: ToolExecutionOptions) => {
        const { extractColorsFromImage } = await import('$lib/server/brand-analysis');
        // Anche qui il filtro del form: l'estrattore è un modello, e un modello che torna
        // "rgb(12,30,44)" o dieci colori scriverebbe una palette che la UI non accetterebbe mai.
        const colors = sanitizeBrandColors(await extractColorsFromImage(image_url));
        if (!colors.length) return { error: 'Could not extract colors from image' };

        const { data: before } = await supabase.from('brand_kit').select('brand_colors').eq('brand_id', brandId).maybeSingle();
        // Upsert come update_brand_kit, e per la stessa ragione: un brand appena creato può non
        // avere ancora la riga brand_kit, e un UPDATE su zero righe "riesce" senza salvare niente.
        const { error } = await supabase.from('brand_kit').upsert({ brand_id: brandId, brand_colors: colors }, { onConflict: 'brand_id' });
        if (error) return { error: error.message };
        return {
          success: true,
          colors,
          previous_colors: (before?.brand_colors as string[] | null) ?? [],
          message: 'Brand colors updated from image. Tell the user what the palette was before.'
        };
      }
    }),

    update_brand_colors: tool({
      description:
        'Set the brand\'s color palette from hex values (max 8, same as the Studio swatch editor). This REPLACES the whole palette and re-skins every image generated afterwards, so read_brand_kit first and tell the user which colours you replaced.',
      inputSchema: z.object({
        colors: z.array(z.string()).describe('Array of hex color values (e.g. ["#FF5733", "#33FF57", "#000000"])')
      }),
      execute: async ({ colors }: { colors: string[] }, opts: ToolExecutionOptions) => {
        // Stesso filtro del form (sanitizeBrandColors), non una regex scritta qui: un tool più
        // permesso del form scrive una palette che la UI non potrebbe produrre, e il colore
        // sbagliato non fallisce da nessuna parte — esce stampato.
        const valid = sanitizeBrandColors(colors);
        if (!valid.length) return { error: 'No valid hex colors provided. Use format #RGB or #RRGGBB (max 8 colours).' };

        // Il valore di prima torna nel risultato: è la scia che rende reversibile una scrittura
        // altrimenti distruttiva — l'agente può rimetterla com'era senza chiedere niente a nessuno.
        const { data: before } = await supabase.from('brand_kit').select('brand_colors').eq('brand_id', brandId).maybeSingle();
        // Upsert come update_brand_kit: senza riga brand_kit l'UPDATE su zero righe "riusciva"
        // senza scrivere nulla, e la palette confermata all'utente non esisteva da nessuna parte.
        const { error } = await supabase.from('brand_kit').upsert({ brand_id: brandId, brand_colors: valid }, { onConflict: 'brand_id' });
        if (error) return { error: error.message };
        return {
          success: true,
          colors: valid,
          previous_colors: (before?.brand_colors as string[] | null) ?? [],
          dropped: colors.length - valid.length,
          notice: 'The palette drives every image generated from now on. Tell the user what it was before, in case they want it back.'
        };
      }
    }),

    update_logo: tool({
      description:
        'Replace (or clear) the brand logo or favicon. The logo is ONE slot, exactly like Studio: a new one REPLACES the old one, and it re-skins every asset generated afterwards. The image is copied into the brand\'s own storage, so pass any image URL you can see (an attachment, a media library asset, the site\'s own logo). Read read_brand_kit first and tell the user what you replaced.',
      inputSchema: z.object({
        image_url: z.string().optional().describe('URL of the new logo image. Omit together with remove=true to clear the slot.'),
        type: z.enum(['logo', 'favicon']).optional().describe('Type: "logo" for main logo, "favicon" for favicon (default: logo)'),
        remove: z.boolean().optional().describe('true to empty the slot instead of setting an image')
      }),
      execute: async (
        { image_url, type = 'logo', remove }: { image_url?: string; type?: string; remove?: boolean },
        opts: ToolExecutionOptions
      ) => {
        const { data: kit } = await supabase.from('brand_kit').select('logos, favicon_url').eq('brand_id', brandId).maybeSingle();
        const previous =
          type === 'favicon'
            ? ((kit?.favicon_url as string | null) ?? null)
            : (((kit?.logos as AnyRec[]) ?? [])[0]?.url as string | undefined) ?? null;

        if (remove) {
          // Upsert come update_brand_kit: su un brand senza riga brand_kit l'UPDATE colpiva zero
          // righe e "riusciva" — lo slot confermato vuoto/pieno in chat restava com'era.
          const patch = type === 'favicon' ? { favicon_url: null } : { logos: [] };
          const { error } = await supabase.from('brand_kit').upsert({ brand_id: brandId, ...patch }, { onConflict: 'brand_id' });
          if (error) return { error: error.message };
          return { success: true, updated: type, removed: true, previous_url: previous };
        }

        if (!image_url) return { error: 'Pass image_url, or remove=true to clear the slot.' };

        // L'immagine viene COPIATA nel bucket pubblico come fa l'upload umano. Salvare l'URL
        // remoto com'era è il bug che questo sostituisce: un link scaduto in `logos` fa uscire
        // ogni render senza logo, e non fallisce niente, quindi non lo scopre nessuno.
        const { storeBrandLogoFromUrl } = await import('$lib/server/studio-actions');
        const stored = await storeBrandLogoFromUrl(supabase, { userId, imageUrl: image_url });
        if ('error' in stored) return { error: stored.error };

        // UNO slot, non una lista che cresce: il form umano fa `logos: [{...}]`, e il renderer
        // legge il primo. Accodando, il logo "nuovo" finiva in fondo e non lo vedeva nessuno.
        const patch =
          type === 'favicon'
            ? { favicon_url: stored.url }
            : { logos: [{ url: stored.url, type: 'uploaded' }] };
        // Upsert, stessa ragione del ramo remove qui sopra: zero righe non è un successo.
        const { error } = await supabase.from('brand_kit').upsert({ brand_id: brandId, ...patch }, { onConflict: 'brand_id' });
        if (error) return { error: error.message };
        return {
          success: true,
          updated: type,
          url: stored.url,
          previous_url: previous,
          notice:
            'This replaced the brand mark on every asset generated from now on. Say what it was before — calling update_logo with previous_url puts it back.'
        };
      }
    }),

    sync_products: tool({
      description: 'Sync products from the brand\'s e-commerce platform (Shopify/WooCommerce). Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions) => {
        return startLongToolJob(supabase, brandId, userId, 'sync_products', {}, threadId, opts.abortSignal, origin, locale);
      }
    }),

    check_job_status: tool({
      description: 'Check the status of a long tool job by id. Use it ONLY when the user asks what happened to a job. NEVER poll it after starting one: background jobs deliver their result to you as a new message on their own, and waiting here just burns the turn.',
      inputSchema: z.object({
        job_id: z.string().describe('The job ID returned when the async tool was launched')
      }),
      execute: async ({ job_id }: { job_id: string }, opts: ToolExecutionOptions) => {
        const { data: job } = await supabase.from('chat_jobs')
          .select('id, tool_name, status, result, error, created_at, completed_at')
          .eq('id', job_id)
          .eq('brand_id', brandId)
          .maybeSingle();

        if (!job) return { error: 'Job not found' };
        return {
          job_id: job.id,
          tool_name: job.tool_name,
          status: job.status,
          result: job.status === 'done' ? job.result : null,
          error: job.status === 'failed' ? job.error : null,
          created_at: job.created_at,
          completed_at: job.completed_at
        };
      }
    }),
  };
}
