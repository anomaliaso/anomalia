import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { isUrlSafe } from '$lib/server/brand-analysis';
import { normalizeWebsite } from '$lib/brand-fields';
import { listCalendarConflicts, formatInZone } from '$lib/server/schedule';
import { resolveScheduleInput } from '$lib/server/clock';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';
import { noteRead, requireFreshRead } from '../read-guards';

export function catalogTools(ctx: ChatToolCtx) {
  const { supabase, brandId, tz, userId, origin } = ctx;

  async function blogAdmin() {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const admin = createAdminClient();
    const { data: brand } = await admin.from('brands').select('*').eq('id', brandId).maybeSingle();
    return { admin, brand: brand as AnyRec };
  }

  return {
    list_calendar_conflicts: tool({
      description:
        'List calendar double-bookings: groups of 2+ live posts (pending_user / approved / scheduled) landing on the same minute. Call this FIRST when the user asks to fix overlaps / riorganizza orari / calendario sovrapposto. Then reschedule_post the approved/scheduled extras (pending_user drafts are only reported — they need approve_post first) and call again to verify zero conflicts remain.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await supabase
          .from('posts')
          .select('id, platform, caption, status, scheduled_for, slot')
          .eq('brand_id', brandId)
          .in('status', ['pending_user', 'approved', 'scheduled'])
          .limit(200);
        const conflicts = listCalendarConflicts(
          (data ?? []) as {
            id: string;
            scheduled_for: string | null;
            status: string;
            slot: string | null;
            platform: string | null;
            caption: string | null;
          }[],
          tz
        );
        // I draft pending_user vanno SEPARATI dai post rischedulabili: l'hint di prima diceva
        // "reschedule_post the others" anche per i draft, e reschedule_post li avrebbe pubblicati
        // senza approvazione (vedi il guard lì). Qui il modello legge quale azione tocca a chi.
        const annotated = conflicts.map((c) => ({
          ...c,
          posts: c.posts.map((p) =>
            p.status === 'pending_user'
              ? { ...p, pending_approval: true, note: 'pending draft — needs approve_post first; reschedule_post will refuse it' }
              : p
          )
        }));
        const pendingCount = annotated.reduce(
          (n, c) => n + c.posts.filter((p) => p.status === 'pending_user').length,
          0
        );
        return {
          conflict_count: annotated.length,
          conflicts: annotated,
          hint:
            annotated.length === 0
              ? 'No overlaps. Tell the user the calendar is clear.'
              : `Keep one post per conflict.at; reschedule_post the approved/scheduled extras to free times.${pendingCount ? ` ${pendingCount} conflicting post(s) are pending_user drafts: report them as "pending, needs approval first" — approve_post (with a free scheduled_for) only if the user wants them out, never reschedule_post them.` : ''} Call list_calendar_conflicts again to verify.`
        };
      }
    }),

    list_articles: tool({
      description:
        'List the brand\'s blog articles with status and schedule. Statuses: draft (written, awaiting review), planned (title-only placeholder, body not written yet), approved (scheduled — auto-publishes at scheduled_for), published.',
      inputSchema: z.object({
        status: z.enum(['draft', 'planned', 'approved', 'published']).optional().describe('Filter by status')
      }),
      execute: async ({ status }: { status?: string }, opts: ToolExecutionOptions) => {
        let q = supabase.from('brand_articles').select('id, title, status, scheduled_for, created_at').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(50);
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        // scheduled_for is stored in UTC; carry the brand's wall clock alongside it so the model
        // repeats the time the user sees on the calendar.
        const articles = (data ?? []).map((a) => ({
          ...a,
          scheduled_for_local: a.scheduled_for ? `${formatInZone(a.scheduled_for, tz)} (${tz})` : null
        }));
        return { articles };
      }
    }),

    read_article: tool({
      description: 'Read a blog article in full: title, meta title/description, markdown body, status, schedule, cover image. Use before editing or optimizing.',
      inputSchema: z.object({
        article_id: z.string().describe('The article ID to read')
      }),
      execute: async ({ article_id }: { article_id: string }, opts: ToolExecutionOptions) => {
        const { data, error } = await supabase.from('brand_articles')
          .select('id, slug, title, meta_title, meta_description, body_md, status, scheduled_for, cover_image, language, created_at')
          .eq('id', article_id).eq('brand_id', brandId).maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: 'Article not found' };
        return {
          article: {
            ...data,
            scheduled_for_local: data.scheduled_for ? `${formatInZone(data.scheduled_for, tz)} (${tz})` : null
          }
        };
      }
    }),

    schedule_article: tool({
      description:
        'Schedule, reschedule or unschedule a blog article. With a datetime: sets scheduled_for and marks the article approved — it auto-publishes on the blog at that time (a "planned" placeholder only moves its slot; its body is written later by write_planned_article or the autopilot). Without a datetime: clears the schedule back to a plain draft. Scheduling means the article WILL go live — do it only on the user\'s request or explicit go-ahead.',
      inputSchema: z.object({
        article_id: z.string().describe('The article ID'),
        scheduled_for: z.string().optional().describe(`Future datetime to publish at, in the BRAND's local time (${tz}) — e.g. "2026-07-15T10:00". Add a Z/offset only for a real UTC instant. Omit to unschedule.`)
      }),
      execute: async ({ article_id, scheduled_for }: { article_id: string; scheduled_for?: string }, opts: ToolExecutionOptions) => {
        const { admin } = await blogAdmin();
        const { data: art } = await admin.from('brand_articles').select('id, title, status').eq('id', article_id).eq('brand_id', brandId).maybeSingle();
        if (!art) return { error: 'Article not found' };
        if (art.status === 'published') return { error: 'Article is already published' };
        let patch: AnyRec;
        let when: string | null = null;
        if (!scheduled_for) {
          // A month-plan placeholder without a date would never get written — refuse to clear it.
          if (art.status === 'planned') return { error: 'Planned placeholders need a slot — reschedule it instead, or delete it from the Site page.' };
          patch = { scheduled_for: null, status: 'draft' };
        } else {
          const parsed = resolveScheduleInput(scheduled_for, tz);
          if ('error' in parsed) return parsed;
          when = parsed.utc;
          // Placeholders only move their slot — 'approved' (auto-publish) is reserved for real drafts.
          patch = art.status === 'planned' ? { scheduled_for: when } : { scheduled_for: when, status: 'approved' };
        }
        const { error } = await admin.from('brand_articles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', article_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return {
          success: true,
          title: art.title,
          scheduled_for: when,
          scheduled_for_local: when ? `${formatInZone(when, tz)} (${tz})` : null
        };
      }
    }),

    update_article: tool({
      description: 'Edit a blog article: title, meta title, meta description, and/or the full markdown body. Read the article first, apply the requested changes, and pass only the fields you changed.',
      inputSchema: z.object({
        article_id: z.string().describe('The article ID to update'),
        title: z.string().optional(),
        meta_title: z.string().optional(),
        meta_description: z.string().optional(),
        body_md: z.string().optional().describe('The COMPLETE new markdown body (replaces the old one entirely)')
      }),
      execute: async ({ article_id, ...patch }: AnyRec, opts: ToolExecutionOptions) => {
        const clean: AnyRec = {};
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
        if (!Object.keys(clean).length) return { error: 'No changes specified' };
        const { admin } = await blogAdmin();
        const { data: art } = await admin.from('brand_articles').select('id, status').eq('id', article_id).eq('brand_id', brandId).maybeSingle();
        if (!art) return { error: 'Article not found' };
        const { error } = await admin.from('brand_articles').update({ ...clean, updated_at: new Date().toISOString() }).eq('id', article_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, updated_fields: Object.keys(clean) };
      }
    }),

    optimize_article: tool({
      description:
        'Run the quality-optimization pass on a blog article (same as the Site page "Optimize"): web-grounds real sources and statistics, weaves in internal links, tightens structure and meta, and adds on-brand images. Takes ~1-2 min. No-op if the article already scores >= 90.',
      inputSchema: z.object({
        article_id: z.string().describe('The article ID to optimize')
      }),
      execute: async ({ article_id }: { article_id: string }, opts: ToolExecutionOptions) => {
        const { admin, brand } = await blogAdmin();
        if (!brand) return { error: 'Brand not found' };
        const { optimizeArticleForScore } = await import('$lib/server/blog-generate');
        try {
          await optimizeArticleForScore(admin, brand, article_id, { withImages: true });
          return { success: true };
        } catch (e) {
          return { error: String(e) };
        }
      }
    }),

    generate_article_cover: tool({
      description: 'Generate a new on-brand AI cover image for a blog article (same aesthetic as the social posts) and set it as the article cover. Takes ~30s.',
      inputSchema: z.object({
        article_id: z.string().describe('The article ID')
      }),
      execute: async ({ article_id }: { article_id: string }, opts: ToolExecutionOptions) => {
        const { admin, brand } = await blogAdmin();
        if (!brand) return { error: 'Brand not found' };
        const { data: art } = await admin.from('brand_articles').select('title, meta_description').eq('id', article_id).eq('brand_id', brandId).maybeSingle();
        if (!art) return { error: 'Article not found' };
        const { generateArticleCover } = await import('$lib/server/content-preview');
        const url = await generateArticleCover(admin, brand, { title: art.title, summary: art.meta_description ?? undefined });
        if (!url) return { error: 'Cover generation failed' };
        const { error } = await admin.from('brand_articles').update({ cover_image: url }).eq('id', article_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, cover_image: url };
      }
    }),

    generate_article_images: tool({
      description: 'Generate a few on-brand images and splice them into a blog article\'s body as in-article illustrations (same as the Site page). Takes ~1 min.',
      inputSchema: z.object({
        article_id: z.string().describe('The article ID')
      }),
      execute: async ({ article_id }: { article_id: string }, opts: ToolExecutionOptions) => {
        const { admin, brand } = await blogAdmin();
        if (!brand) return { error: 'Brand not found' };
        const { data: art } = await admin.from('brand_articles').select('title, body_md').eq('id', article_id).eq('brand_id', brandId).maybeSingle();
        if (!art) return { error: 'Article not found' };
        const { generateArticleImages } = await import('$lib/server/content-preview');
        const newBody = await generateArticleImages(admin, brand, { title: art.title, bodyMd: art.body_md ?? '', max: 3 });
        if (newBody === (art.body_md ?? '')) return { error: 'Image generation failed' };
        const { error } = await admin.from('brand_articles').update({ body_md: newBody, updated_at: new Date().toISOString() }).eq('id', article_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true };
      }
    }),

    write_planned_article: tool({
      description:
        'Write the full article for a "planned" placeholder (title-only slot from the month plan), keeping its calendar slot — same as the Site page "Genera ora". Takes ~1-2 min. The result is a draft the user can review, schedule or edit.',
      inputSchema: z.object({
        article_id: z.string().describe('The planned placeholder\'s article ID')
      }),
      execute: async ({ article_id }: { article_id: string }, opts: ToolExecutionOptions) => {
        const { admin, brand } = await blogAdmin();
        if (!brand) return { error: 'Brand not found' };
        const { generatePlannedArticle } = await import('$lib/server/blog-generate');
        const newId = await generatePlannedArticle(admin, brand, article_id, { skipNotify: true });
        if (!newId) return { error: 'Not a planned placeholder, or generation failed' };
        return { success: true, article_id: newId };
      }
    }),

    update_product: tool({
      description: 'Update a product or service in the brand catalog, or delete it with remove=true.',
      inputSchema: z.object({
        product_id: z.string().describe('The product ID to update'),
        title: z.string().optional(),
        description: z.string().optional(),
        pricing: z.string().optional(),
        featured: z.boolean().optional(),
        url: z.string().optional().describe('Product page URL on the brand site (https)'),
        remove: z.boolean().optional().describe('true to delete this product from the catalog')
      }),
      execute: async ({ product_id, remove, ...patch }: AnyRec, opts: ToolExecutionOptions) => {
        if (remove) {
          const { error } = await supabase.from('products').delete().eq('id', product_id).eq('brand_id', brandId);
          if (error) return { error: error.message };
          return { success: true, removed: true, product_id };
        }
        // Il titolo è obbligatorio anche qui: il form rifiuta di salvare un prodotto senza nome,
        // e un prodotto senza titolo esce nei post come una riga vuota.
        if (patch.title !== undefined && !String(patch.title).trim()) return { error: 'title cannot be empty' };
        const clean: AnyRec = {};
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) clean[k] = v;
        }
        if (clean.url != null) {
          const u = String(clean.url).trim();
          if (u && !/^https?:\/\//i.test(u)) return { error: 'url must be an http(s) URL' };
          clean.url = u || null;
        }
        if (Object.keys(clean).length === 0) return { error: 'No changes specified' };
        const { error } = await supabase.from('products').update(clean).eq('id', product_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, updated_fields: Object.keys(clean) };
      }
    }),

    update_person: tool({
      description:
        'Update a team member or AI persona, delete them with remove=true, or record the owner\'s consent for a real person with consent=true. Until consent is recorded, that face is withheld from every generator.',
      inputSchema: z.object({
        person_id: z.string().describe('The person ID to update'),
        name: z.string().optional(),
        role: z.string().optional(),
        description: z.string().optional(),
        attributes: z.record(z.string(), z.unknown()).optional().describe('Additional attributes (e.g. personality traits, expertise). MERGED into the existing attributes — pass only the keys to change.'),
        consent: z
          .literal(true)
          .optional()
          .describe('Only pass this when the USER has just stated, in their own words, that they have this person\'s consent. Never infer it.'),
        remove: z.boolean().optional().describe('true to delete this person and their photos')
      }),
      execute: async ({ person_id, consent, remove, ...patch }: AnyRec, opts: ToolExecutionOptions) => {
        if (remove) {
          // Come deletePerson nel form: prima i file, poi la riga. Lasciare le foto nel bucket
          // significa tenere il volto di una persona reale dopo che è stata cancellata.
          const { data: person } = await supabase
            .from('people').select('images').eq('id', person_id).eq('brand_id', brandId).maybeSingle();
          const paths = ((person?.images as AnyRec[]) ?? []).map((i) => i?.path).filter(Boolean) as string[];
          if (paths.length) await supabase.storage.from('brand-knowledge').remove(paths);
          const { error } = await supabase.from('people').delete().eq('id', person_id).eq('brand_id', brandId);
          if (error) return { error: error.message };
          return { success: true, removed: true, person_id };
        }

        const clean: AnyRec = {};
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) clean[k] = v;
        }
        // `attributes` si FONDE con l'esistente invece di sostituirlo: rimpiazzare l'oggetto
        // intero cancellava gender/ageRange, e ogni render successivo tirava a indovinare
        // l'aspetto della persona.
        if (clean.attributes) {
          const { data: existing } = await supabase
            .from('people').select('attributes').eq('id', person_id).eq('brand_id', brandId).maybeSingle();
          clean.attributes = { ...((existing?.attributes as AnyRec) ?? {}), ...(clean.attributes as AnyRec) };
        }
        // Il consenso di una persona reale è un ATTO del titolare, non un default: si scrive
        // solo insieme a chi l'ha attestato e quando, esattamente come attestPersonConsent.
        // `z.literal(true)` è deliberato — non esiste un modo di TOGLIERE il consenso da qui,
        // perché non esiste nemmeno nel form.
        if (consent === true) {
          clean.consent = true;
          clean.consent_at = new Date().toISOString();
          clean.consent_source = 'owner_attested';
        }
        if (Object.keys(clean).length === 0) return { error: 'No changes specified' };
        const { error } = await supabase.from('people').update(clean).eq('id', person_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, updated_fields: Object.keys(clean) };
      }
    }),

    update_competitor: tool({
      description:
        'Add, edit or delete a competitor. Omit competitor_id to ADD one; pass it to edit; pass it with remove=true to delete. Same shape as the Competitors page — the strategy and market-reference jobs read this list.',
      inputSchema: z.object({
        competitor_id: z.string().optional().describe('Existing competitor id. Omit to add a new one.'),
        name: z.string().optional().describe('Competitor name. Required when adding.'),
        website: z.string().optional().describe('Their website. A bare domain is fine — normalised to https://.'),
        kind: z.enum(['direct', 'indirect']).optional().describe('direct (default) or indirect'),
        rationale: z.string().optional().describe('Why they are a competitor'),
        remove: z.boolean().optional().describe('true to delete this competitor')
      }),
      execute: async ({ competitor_id, name, website, kind, rationale, remove }: AnyRec, _opts: ToolExecutionOptions) => {
        if (remove) {
          if (!competitor_id) return { error: 'competitor_id is required to remove a competitor' };
          const { error } = await supabase.from('competitors').delete().eq('id', competitor_id).eq('brand_id', brandId);
          if (error) return { error: error.message };
          return { success: true, removed: true, competitor_id };
        }

        // `kind` fuori dai due valori noti ricade su 'direct', come il form: la colonna è letta da
        // chi costruisce la strategia, e un terzo valore la farebbe ragionare su una categoria
        // che non esiste.
        const safeKind = kind === 'indirect' ? 'indirect' : 'direct';

        if (!competitor_id) {
          const label = String(name ?? '').trim();
          if (!label) return { error: 'name is required to add a competitor' };
          const { data, error } = await supabase
            .from('competitors')
            .insert({
              brand_id: brandId,
              name: label,
              website: normalizeWebsite(String(website ?? '')),
              kind: safeKind,
              rationale: String(rationale ?? '').trim() || null,
              // `source: 'user'` perché è una scelta di chi possiede il brand, fatta parlando con
              // te: distinguerla da quelle scoperte da noi è ciò che rende sensato ri-scoprire.
              source: 'user'
            })
            .select('id')
            .maybeSingle();
          if (error) return { error: error.message };
          return { success: true, added: true, competitor_id: data?.id };
        }

        const patch: AnyRec = {};
        if (name !== undefined) {
          const label = String(name).trim();
          if (!label) return { error: 'name cannot be empty' };
          patch.name = label;
        }
        if (website !== undefined) patch.website = normalizeWebsite(String(website ?? ''));
        if (kind !== undefined) patch.kind = safeKind;
        if (rationale !== undefined) patch.rationale = String(rationale).trim() || null;
        if (!Object.keys(patch).length) return { error: 'No changes specified' };
        const { error } = await supabase.from('competitors').update(patch).eq('id', competitor_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        return { success: true, competitor_id, updated_fields: Object.keys(patch) };
      }
    }),

    update_document: tool({
      description:
        'Edit a document already in brand knowledge: rename it, file it under a collection, replace its text, or delete it with remove=true. Use add_document to create one. Refused unless you read_document that id first — and refused again if the document changed since that read.',
      inputSchema: z.object({
        document_id: z.string().describe('Document id from read_documents / search_knowledge'),
        title: z.string().optional().describe('New title'),
        collection: z
          .enum(['brand', 'product', 'commercial', 'legal', 'operations', 'research'])
          .nullable()
          .optional()
          .describe('Which collection to file it under. null removes the filing.'),
        markdown: z.string().optional().describe('Replace the document text. It is re-chunked for search.'),
        remove: z.boolean().optional().describe('true to delete the document and its stored file')
      }),
      execute: async ({ document_id, title, collection, markdown, remove }: AnyRec, _opts: ToolExecutionOptions) => {
        const { data: doc } = await supabase
          .from('brand_documents')
          .select('id, file_url, kind, updated_at')
          .eq('id', document_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!doc) return { error: 'Document not found' };
        // Il form rifiuta esplicitamente le immagini su questa strada: un'immagine in
        // brand_documents è un riferimento di stile, non un documento, e si tocca da lì.
        if (doc.kind === 'image') return { error: 'That row is a mood reference image, not a document. Use update_mood_references.' };
        const stale = requireFreshRead(
          'document',
          String(document_id),
          doc.updated_at,
          'This document',
          'read_document({ id })'
        );
        if (stale) return stale;

        if (remove) {
          if (doc.file_url) await supabase.storage.from('brand-knowledge').remove([String(doc.file_url)]);
          const { error } = await supabase.from('brand_documents').delete().eq('id', document_id).eq('brand_id', brandId);
          if (error) return { error: error.message };
          return { success: true, removed: true, document_id };
        }

        const updated: string[] = [];
        const patch: AnyRec = {};
        if (title !== undefined) {
          const t = String(title).trim();
          if (!t) return { error: 'title cannot be empty' };
          patch.title = t;
          updated.push('title');
        }
        if (collection !== undefined) {
          const { COLLECTIONS } = await import('$lib/server/knowledge');
          patch.collection = collection && (COLLECTIONS as readonly string[]).includes(collection) ? collection : null;
          updated.push('collection');
        }
        let stampedAt: string | null = null;
        if (Object.keys(patch).length) {
          stampedAt = new Date().toISOString();
          patch.updated_at = stampedAt;
          const { error } = await supabase.from('brand_documents').update(patch).eq('id', document_id).eq('brand_id', brandId);
          if (error) return { error: error.message };
        }

        if (markdown !== undefined) {
          // Passa da saveDocumentMarkdown come il form: riscrivere solo `content_text` lascia i
          // chunk di ricerca fermi al testo di prima, e la ricerca continuerebbe a trovare la
          // versione vecchia senza che niente lo segnali.
          const { saveDocumentMarkdown, kickKnowledgeWork } = await import('$lib/server/knowledge');
          stampedAt = await saveDocumentMarkdown(supabase, brandId, String(document_id), String(markdown));
          if (origin) void kickKnowledgeWork(origin);
          updated.push('markdown');
        }

        if (!updated.length) return { error: 'No changes specified' };
        // La scrittura riuscita diventa il receipt nuovo: una seconda modifica di seguito non
        // deve obbligare a una rilettura del documento che l'agente ha appena scritto.
        noteRead('document', String(document_id), stampedAt);
        return { success: true, document_id, updated_fields: updated };
      }
    }),

    update_mood_references: tool({
      description:
        'Manage the brand mood references — the up-to-3 images every generated visual is steered by. Add one from an image URL or from one of the brand\'s own past posts, or remove one. Like the Studio grid, the image is copied into brand storage so it cannot expire.',
      inputSchema: z.object({
        image_url: z.string().optional().describe('Image URL to add as a reference'),
        history_post_id: z.string().optional().describe('Id of one of the brand\'s own past posts (from read_posts history) to use its image'),
        remove_id: z.string().optional().describe('brand_documents id of a reference to remove')
      }),
      execute: async ({ image_url, history_post_id, remove_id }: AnyRec, _opts: ToolExecutionOptions) => {
        if (remove_id) {
          const { data: doc } = await supabase
            .from('brand_documents').select('file_url, kind').eq('id', remove_id).eq('brand_id', brandId).maybeSingle();
          if (!doc || doc.kind !== 'image') return { error: 'That id is not a mood reference' };
          if (doc.file_url) await supabase.storage.from('brand-knowledge').remove([String(doc.file_url)]);
          const { error } = await supabase.from('brand_documents').delete().eq('id', remove_id).eq('brand_id', brandId);
          if (error) return { error: error.message };
          return { success: true, removed: true, reference_id: remove_id };
        }

        // Il tetto è quello che la UI dichiara (e che il renderer rispetta: attacca solo le 3 più
        // recenti). Senza, l'agente ne carica dieci e sette non le guarda nessuno.
        const { count } = await supabase
          .from('brand_documents').select('id', { count: 'exact', head: true })
          .eq('brand_id', brandId).eq('kind', 'image');
        if ((count ?? 0) >= 3) return { error: 'Max 3 reference images — remove one first with remove_id.' };

        let sourceUrl = String(image_url ?? '').trim();
        if (history_post_id) {
          const { data: h } = await supabase
            .from('social_post_history').select('thumbnail_path, thumbnail_url')
            .eq('id', history_post_id).eq('brand_id', brandId).maybeSingle();
          if (!h) return { error: 'Post not found in this brand history' };
          sourceUrl = String(h.thumbnail_url ?? '');
          if (h.thumbnail_path) {
            const { signKnowledgePaths } = await import('$lib/server/media-archive');
            const m = await signKnowledgePaths(supabase, [String(h.thumbnail_path)]);
            sourceUrl = m.get(String(h.thumbnail_path)) ?? sourceUrl;
          }
          if (!sourceUrl) return { error: 'That post has no usable image' };
        }
        if (!sourceUrl) return { error: 'Pass image_url, history_post_id, or remove_id.' };
        if (!sourceUrl.startsWith('http') || !isUrlSafe(sourceUrl)) return { error: 'That image URL is not fetchable.' };

        // archiveImageToBucket, la stessa del form: la miniatura di una CDN social è firmata e
        // scade in giorni. Salvarne il link invece del file è come non salvarla.
        const { archiveImageToBucket } = await import('$lib/server/media-archive');
        const path = `${userId}/${brandId}/mood/${crypto.randomUUID()}.jpg`;
        const stored = await archiveImageToBucket(supabase, path, sourceUrl);
        if (!stored) return { error: 'Could not save that image — try another one' };
        const { data, error } = await supabase.from('brand_documents').insert({
          brand_id: brandId, kind: 'image',
          title: history_post_id ? 'Post style reference' : 'Style reference',
          file_url: stored, file_name: 'style-reference.jpg', mime_type: 'image/jpeg'
        }).select('id').maybeSingle();
        if (error) return { error: error.message };
        return {
          success: true,
          reference_id: data?.id,
          references_now: (count ?? 0) + 1,
          notice: 'Mood references steer every image generated from now on.'
        };
      }
    }),
  };
}
