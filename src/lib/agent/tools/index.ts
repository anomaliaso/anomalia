import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnyRec, ChatToolCtx } from './shared';
import { readTools } from './read-tools';
import { integrationTools } from './integration-tools';
import { brandWriteTools } from './brand-write-tools';
import { catalogTools } from './catalog-tools';
import { pipelineTools } from './pipeline-tools';
import { createContentTools } from './create-content-tools';
import { expressionMemoryTools } from './expression-memory-tools';
import { createDataForSeoTools } from '$lib/server/dataforseo-tools';
import { createQueryTool } from '$lib/server/chat/query-tool';
import { createMediaLibraryTools } from '$lib/agent/tools/media-library-tools';
import { createNotifyTools } from '$lib/agent/tools/notify-tools';
import { createNotificationTools } from '$lib/agent/tools/notification-tools';
import { createOnboardingTools } from '$lib/agent/tools/onboarding-tools';
import { createConnectTools } from '$lib/agent/tools/connect-tools';
import { createAgentTeamTools } from '$lib/agent/tools/agent-team-tools';
import { createAgentDmTools } from '$lib/agent/tools/agent-dm-tools';
import { createAgentSessionTools } from '$lib/agent/tools/agent-session-tools';
import { createTeamActivityTools } from '$lib/agent/tools/team-activity-tools';
import { createBrandContextTools } from '$lib/agent/tools/brand-context-tools';
import { createDisruptiveIdeaTools } from '$lib/server/disruptive-ideas';
import { createArtifactTools } from '$lib/agent/tools/artifact-tools';
import { createGoalTools } from '$lib/agent/tools/goal-tools';
import { createFileTools, gateOnFileRead } from '$lib/server/chat/agent-files';
import { createAttachmentTools } from '$lib/agent/tools/attachment-tools';
import { createGraphicSourceEditTools } from '$lib/server/chat/graphic-source-edit';
import { createMotionVideoChatTools } from '$lib/agent/tools/motion-video-tools';
import { createMotionRenderTools, readSourceMeta } from '$lib/server/motion-video/render-tools';
import { getMotionVideo } from '$lib/server/motion-video/persist';
import { createMotionReferenceTools } from '$lib/server/motion-video/reference-tools';
import { createMotionOutputTools } from '$lib/server/motion-video/output-tools';
import { MOTION_FPS } from '$lib/motion-video/source';

/**
 * Create all chat tools scoped to a specific brand. The Supabase client is user-scoped (RLS applies).
 * @param userId - The current user's ID (needed for long-tool job tracking / cancel)
 * @param origin - App origin, used to kick the knowledge worker after add_document
 * @param cookieHeader - Unused (kept for call-site compatibility)
 */
export function createChatTools(
  supabase: SupabaseClient,
  brandId: string,
  tz: string = 'Europe/Rome',
  userId: string = '',
  origin: string = '',
  locale: string = 'en',
  threadId?: string,
  _cookieHeader: string = '',
  /** Images the user attached to THIS turn — always available to the renderer as references. */
  turnRefUrls: string[] = [],
  /** Files converted to markdown this turn — add_document can save the FULL text via from_attachment. */
  turnDocuments: Array<{ name: string; markdown: string; title?: string | null }> = [],
  /**
   * Il colore dell'agente che risponde in questo turno, per firmare gli sticker di
   * `set_expression`. Vuoto = sconosciuto: lo sticker si disegna in tinta col tema invece di
   * prendersi il colore che il composer aveva addosso quando qualcuno ha riletto il thread.
   */
  agentColor: string = '',
  /**
   * Quanto tempo resta al turno di chat. I tool si costruiscono PRIMA che la deadline esista, per
   * cui chi chiama passa una closure sul suo `turnDeadline` (stesso pattern di withSubagentTools).
   * Serve al render MP4: senza, `render_motion_video` in chat apriva un lease da 900s dentro un
   * turno da 300 e saltava la guardia sul tempo rimasto. (`abortSignal` non può viaggiare qui: il
   * controller del turno nasce dopo la costruzione dei tool.)
   */
  remainingMs?: () => number,
  /**
   * CHI risponde, come chiave della memoria di mestiere (brand-memory.ts): un id builtin
   * (`content`, `motion`, …) o `custom:<uuid>`. Vuoto ⇒ i tool di memoria vedono e scrivono solo
   * la memoria del BRAND — che è la scelta giusta per un chiamante che non sa chi sta parlando.
   */
  memoryAgent: string | null = null
) {
  /** Cap Exa search_web cost per turn in code ($0.005 × 5 = $0.025), not in the prompt. */

  // Lazy brand site for DataForSEO defaults (kit.source_url → brands.website).
  let cachedDfsSite: { url: string | null; language: string | null } | null = null;
  async function resolveDfsSite() {
    if (cachedDfsSite) return cachedDfsSite;
    const [{ data: brand }, { data: kit }] = await Promise.all([
      supabase.from('brands').select('website, content_prefs').eq('id', brandId).maybeSingle(),
      supabase.from('brand_kit').select('source_url').eq('brand_id', brandId).maybeSingle()
    ]);
    cachedDfsSite = {
      url: String(kit?.source_url || brand?.website || '').trim() || null,
      language: (brand?.content_prefs as AnyRec)?.language
        ? String((brand!.content_prefs as AnyRec).language)
        : null
    };
    return cachedDfsSite;
  }

  const dataForSeoTools = createDataForSeoTools({
    maxCalls: 8,
    allowHistory: false,
    resolveDefaultUrl: async () => (await resolveDfsSite()).url,
    resolveLanguage: async () => (await resolveDfsSite()).language
  });

  const ctx: ChatToolCtx = {
    supabase,
    brandId,
    tz,
    userId,
    origin,
    locale,
    threadId,
    turnRefUrls,
    turnDocuments,
    agentColor,
    remainingMs,
    memoryAgent
  };

  return {
    ...dataForSeoTools,
    ...createQueryTool({ supabase, brandId, userId, threadId }),
    ...readTools(ctx),
    ...integrationTools(ctx),
    ...createMediaLibraryTools({ supabase, brandId, userId }),
    // L'unico tool che parla all'utente quando la chat è chiusa: email a tutti gli invitati
    // del progetto + push su chi l'ha attivata. Vive fuori da qui perché ha i suoi freni.
    ...createNotifyTools({ brandId, userId, threadId, origin }),
    // La campanella della sidebar: gli agenti la leggono per intero e possono scriverci — con
    // dedup per topic, tetto per brand e mai severità 'error' (quella è dei fatti di sistema).
    ...createNotificationTools({ supabase, brandId, threadId }),
    ...createOnboardingTools(supabase, brandId),
    // Connettere un'app in chat (Connect Link Composio come card): il passo prima dei due sopra.
    ...createConnectTools({ supabase, brandId, userId, threadId, origin }),
    // Il team ricorrente: proponi, elenca, metti al lavoro, metti in pausa. La macchina
    // (custom_agent_schedules + il tick ogni 5 minuti) esisteva già ma viveva dietro una pagina di
    // impostazioni; da qui la conversazione può costruire il team senza che l'utente scriva prompt.
    // `threadId` serve a una cosa sola ma essenziale: sapere chi è `self` quando un agente si
    // assegna una routine (l'agente del turno sta sul thread, non nei parametri del tool).
    ...createAgentTeamTools({ supabase, brandId, userId, locale, timezone: tz, threadId }),
    // DM fra agenti (message_agent): thread privato persistente per coppia, il destinatario
    // risponde con un turno SUO in coda. Mai per i sotto-agenti; i turni schedulati sì.
    ...createAgentDmTools({ supabase, brandId, userId, threadId, origin, locale }),
    // User session (open_session_with_user): un agente apre il SUO thread utente e ci lavora,
    // quando il lavoro delegato ha bisogno della persona. Trasversale, come il DM.
    ...createAgentSessionTools({ supabase, brandId, userId, threadId, origin, locale }),
    // Gli occhi della squadra: ultimo report di ogni collega + DM in attesa. Senza questa lettura
    // «fai parte di un team» è una frase nel prompt: qui diventa un fatto che si può controllare.
    ...createTeamActivityTools({ supabase, brandId, userId, locale, memoryAgent }),
    // read_market_references and search_web were declared here; they are shared now so the maker
    // agents (Motion Video, Media Generator, UGC planner) get the same two, defined once.
    ...createBrandContextTools({
      supabase,
      brandId,
      include: ['read_market_references', 'search_web']
    }),
    // Banco idee dirompenti: leggilo prima di proporre, scrivici dentro appena un'idea passa i tre
    // test. Vale per ogni agente, quindi sta nei SHARED_TOOL_KEYS del registry.
    ...createDisruptiveIdeaTools({ supabase, brandId, userId, threadId, surface: 'chat' }),
    ...brandWriteTools(ctx),
    ...catalogTools(ctx),
    ...pipelineTools(ctx),
    ...createContentTools(ctx),

    ...expressionMemoryTools(ctx),
    // `remainingMs` DEVE passare: senza, il render MP4 apriva un lease da 900s dentro un turno da
    // 300 — la guardia sul tempo rimasto veniva semplicemente saltata su questa superficie.
    ...createMotionOutputTools({ supabase, brandId, userId, fps: () => MOTION_FPS, remainingMs, locale }),

    ...createGraphicSourceEditTools(
      async ({ post_id }) => {
        if (!post_id) return { error: 'post_id required' };
        const { data: post } = await supabase
          .from('posts')
          .select('id')
          .eq('id', post_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!post) return { error: 'Post not found' };
        const { loadEditorContext } = await import('$lib/agent/tools/post-editor-tools');
        const ctx = await loadEditorContext(supabase, brandId);
        return { supabase, brandId, postId: post_id, tz, userId, ctx, refUrls: turnRefUrls };
      },
      { requirePostId: true }
    ),

    // Il cancello "leggi prima di agire": create/write/replace del sorgente rifiutano finché
    // `how/MAKE-MOTION-VIDEO.md` non è stato letto in questo turno (agent-files.ts). NON copre
    // `render_motion_video`: rifiutare al render butterebbe via venti step di lavoro, e la pagina
    // /motion-video esclude queste tre ma non quello — le pretenderebbe la lettura di un testo
    // che il suo prompt contiene già per intero.
    ...gateOnFileRead(createMotionVideoChatTools({ supabase, brandId, userId })),
    /**
     * GLI OCCHI, anche in chat — e finora non li aveva.
     *
     * `render_stills` esisteva solo nell'agente della pagina `/motion-video`, che è deprecata. Il
     * Motion Specialist della chat, cioè la superficie che resta, poteva SOLO scrivere TSX e poi
     * renderizzare l'MP4: non ha mai visto un fotogramma prima di spendere il render, e il primo
     * giudizio visivo arrivava dalla QC di craft sul file finito. Un agente che scrive video e non
     * li ha mai visti è la definizione del problema.
     *
     * `resolveTarget` legge dal database perché in chat non c'è una selezione in memoria: il
     * video_id è obbligatorio e arriva da list_motion_videos / create_motion_video.
     */
    ...createMotionRenderTools({
      brandId,
      userId,
      supabase,
      threadId,
      remainingMs,
      resolveTarget: async (videoId?: string) => {
        if (!videoId) return null;
        const row = await getMotionVideo(supabase, brandId, videoId);
        const src = String((row as { source?: unknown } | null)?.source ?? '');
        if (!row || !src.trim()) return null;
        const meta = readSourceMeta(src, {
          fps: Number((row as { fps?: number }).fps) || MOTION_FPS,
          durationInFrames: Number((row as { duration_in_frames?: number }).duration_in_frames) || 180
        });
        return { id: videoId, title: String((row as { title?: string }).title ?? 'composition'), source: src, ...meta };
      }
    }),
    // The wall, on the chat's motion path too — WITH the pixels. attachMedia:false era il buco che
    // rendeva vero il sospetto "le reference non le valuta": la chat riceveva solo la spec testuale,
    // e il modello che scrive la TSX non aveva mai visto un frame. I frame viaggiano come
    // 'image-data', che è input_image sull'OpenAI-compat (Luna/Grok/GPT via kie — verificato in
    // image-agent.ts) e inlineData su Google. Il clip resta rifiutato (nessun modelId ⇒ solo frame).
    // ponytail: il tier deepseek-pro (senza visione) riceverebbe i part serializzati — si accetta:
    // è una scelta esplicita del picker, e il fix vero è passare il tier fin qui quando si
    // ritoccherà il runtime della chat.
    ...createMotionReferenceTools({ attachMedia: true }),
    ...createAttachmentTools(turnDocuments),
    // `read_file` + `ls`. L'indice che le rende utili sta nel prompt (filesIndexFor), e
    // l'allowlist è chiusa sul mestiere di chi chiama.
    // `threadId` e `userId` sono il perimetro delle TRACCE, non un extra: senza, `runs/<id>.md` si
    // rifiuta invece di allargarsi a tutto il brand (vedi RunCtx in agent-files.ts). Il contesto
    // però si passa sempre: `brand/studio.md` è un fatto del brand e non ha quel perimetro.
    ...createFileTools(memoryAgent, threadId, { supabase, brandId, threadId, userId }),
    ...createArtifactTools({ supabase, brandId, userId, threadId }),
    ...createGoalTools({ supabase, brandId, userId, threadId })
  };
}
