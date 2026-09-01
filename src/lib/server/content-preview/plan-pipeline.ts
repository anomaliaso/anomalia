import type { GoogleGenAI } from '@google/genai';
import { STORY_FAILURE_MODES, normalizeBeats, type AnyRec, type BrandProfile, type ContentPrefs, type ImagePart, MAX_COMPETITOR_MOOD_IMAGES, type PastWinner, type PostSeed, type PreviewPost, STRATEGY_SCHEMA, type WeeklyStrategy, carouselMaxSlides, clampCarousels, clampMediaCapabilities, enforceFaceBrandPeople, enforceHookComponents, faceBrandMode, peopleGuidanceBlock, peopleList, platformKey, platformPlaybook, primaryPersonName, resolveSeedWithRubrics, sanitizeSeed, strategySchemaWithRubrics } from './seed-model';
import sharp from 'sharp';
import { fetchImagePart } from '$lib/server/brand-context';
import { logAiCall, extractGeminiUsage } from '$lib/server/ai-log';
import { geminiFlash } from '$lib/server/gemini';
import { structured } from '$lib/server/research';
import { upcomingTimelyHooks } from '$lib/server/thematic-calendar';
import { normalizeContentFormat } from '$lib/content-formats';
import { ladderBrief, type LadderContext } from '$lib/server/production-ladder';
import { guardrailsBlock } from '$lib/server/brand-guardrails';
import { rubricsBrief, type Rubric } from '$lib/server/rubrics';
import { knownSubredditsBlock } from '$lib/server/platform-hygiene';

/** Dummy: structured()/testo ignorano il client; le immagini Google le costruisce images.ts. */
export function client(): GoogleGenAI {
  return null as unknown as GoogleGenAI;
}

// Ritenta su 429/503 con backoff esponenziale + jitter: la generazione immagini fa fan-out
// (batch × QC × retry) e sotto carico un post partirebbe senza immagine. Gli errori non transitori
// rilanciano subito, e tre tentativi tengono veloce il fallimento di una chiamata davvero morta.
export async function genWithRetry<T>(fn: () => Promise<T>, label = 'gemini', context?: { brandId?: string; userId?: string; threadId?: string; context?: string; model?: string }): Promise<T> {
  const MAX = 3;
  const t0 = Date.now();
  // La colonna `model` guida il prezzo in ai-log.ts: non deve mai restare null.
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const out = await fn();
      const usage = extractGeminiUsage(out);
      logAiCall({ label, provider: 'gemini', model: geminiFlash(), ms: Date.now() - t0, ok: true, ...usage, ...context });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /\b(429|503|rate.?limit|quota|overloaded|unavailable|resource.?exhausted)\b/i.test(msg);
      if (!transient || attempt === MAX - 1) {
        logAiCall({ label, provider: 'gemini', model: geminiFlash(), ms: Date.now() - t0, ok: false, error: msg, ...context });
        throw e;
      }
      const delay = Math.min(2000 * 2 ** attempt, 10000) + Math.random() * 1000;
      console.warn(`[${label}] transient error (attempt ${attempt + 1}/${MAX}), retrying in ${Math.round(delay)}ms: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label}: exhausted retries`);
}

// Frammenti condivisi dai DUE passaggi: le regole di precedenza sono sottili e duplicarle
// significa vederle divergere.
export function brandLines(profile: BrandProfile, prefs: ContentPrefs) {
  const char = profile?.ai_character ?? {};
  // User-chosen preferences take priority over what we inferred from the site.
  const moodLine = prefs.mood ? `Brand mood (user-chosen, lead with this): ${prefs.mood}` : '';
  const toneLine = prefs.tone
    ? `Tone of voice (user-chosen, lead with this): ${prefs.tone}`
    : `Tone of voice: ${char.tone ?? ''} ${char.speaking_style ?? ''}`;
  const personalityLine = prefs.personality?.trim()
    ? `Brand personality (from the approved editorial plan — LEAD with this; do not flatten into a generic agency voice): ${prefs.personality.trim()}`
    : '';
  const goalLine = prefs.goal ? `Primary goal (optimise every post for this): ${prefs.goal}` : '';
  // Caption language: user choice wins, else the language detected from the site, else infer.
  const language = (prefs.language || profile?.language || '').trim();
  const languageLine = language
    ? `LANGUAGE: write EVERY caption, hashtag and any on-image text in ${language}. Do not mix languages.`
    : `LANGUAGE: write captions in the brand's OWN primary language — infer it from the brand context/about above. Never default to English unless the brand clearly communicates in English.`;
  // La metà NEGATIVA del contesto, portata in testa: in fondo a 500 parole i vincoli si saltano, e
  // un modello che salta "cosa NON facciamo" riempie il vuoto con capacità plausibili che non
  // abbiamo.
  const guardrails = guardrailsBlock(profile?.ai_context);
  const contextBlock = profile?.ai_context
    ? `\nBRAND CONTEXT & HISTORY (authoritative — follow this voice, themes and what performs):\n${profile.ai_context}\n`
    : '';
  const visualStyleBlock = profile?.visual_style
    ? `\nVISUAL STYLE (the brand's existing look — every image_prompt must match it):\n${profile.visual_style}\n`
    : '';
  // Brand-banned words/phrases (operational strategy) — a hard rule for the copywriter.
  const avoid = (prefs.avoid ?? []).map((w) => String(w).trim()).filter(Boolean);
  const avoidLine = avoid.length
    ? `BANNED WORDS/PHRASES (the brand forbids these — never use them in any caption, hashtag or on-image text): ${avoid.join('; ')}.`
    : '';
  // Post reali passati: ritmo, tono e struttura delle frasi da imitare, mai da copiare.
  const examples = (prefs.voiceExamples ?? [])
    .map((e) => String(e ?? '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((e) => e.slice(0, 400));
  const voiceExamplesBlock = examples.length
    ? `\nWRITING VOICE EXAMPLES (match the rhythm, tone and sentence structure of these REAL past posts — learn the voice, do NOT copy them verbatim):\n${examples.map((e) => `- ${e}`).join('\n')}\n`
    : '';
  // The structured voice framework (Strategia operativa) — injected only in 'manual' mode;
  // 'auto' keeps today's behaviour (voice read from the Studio's ai_context/ai_character).
  const vf = prefs.voiceMode === 'manual' ? prefs.voiceFramework : undefined;
  const vfLines = vf
    ? [
        vf.purpose?.trim() ? `Purpose of the communication: ${vf.purpose.trim()}` : '',
        vf.audience?.trim() ? `Audience: ${vf.audience.trim()}` : '',
        vf.tone?.trim() ? `Base tone: ${vf.tone.trim()}` : '',
        typeof vf.register === 'number' ? `Register: ${vf.register}/100 on the informal→formal scale` : '',
        vf.emotion?.trim() ? `Emotion to convey: ${vf.emotion.trim()}` : '',
        vf.character?.trim() ? `Character/personality: ${vf.character.trim()}` : '',
        vf.syntax?.trim() ? `Sentence style: ${vf.syntax.trim()}` : '',
        vf.terminology?.trim() ? `Language & terminology: ${vf.terminology.trim()}` : ''
      ].filter(Boolean)
    : [];
  const voiceBlock = vfLines.length
    ? `\nVOICE FRAMEWORK (the brand's style manual — apply it to every caption):\n${vfLines.map((l) => `- ${l}`).join('\n')}\n`
    : '';
  return { moodLine, toneLine, personalityLine, goalLine, languageLine, contextBlock, guardrails, visualStyleBlock, avoidLine, voiceExamplesBlock, voiceBlock };
}

// PASS 1 — decide the batch's editorial angle and break it into `count` distinct post seeds,
// grounded in the brand's voice (ai_context) and, when available, its real top-performing posts.
export async function planStrategy(
  ai: GoogleGenAI,
  profile: BrandProfile,
  platforms: string[],
  count: number,
  prefs: ContentPrefs = {},
  // Internal video guardrail: AT MOST this many of the `count` seeds may use a video format.
  maxVideos = 0,
  // Vincitori reali (caption + metriche), più engagement per primo.
  topPosts: PastWinner[] = [],
  // Optional competitive/strategy brief (white-space + recommended angles) from the research
  // pipeline. Steers the batch toward market openings; '' when no research was run.
  strategyBrief = '',
  // ANTI-moodboard: lo stratega VEDE com'è fatto il campo e se ne differenzia, non lo imita.
  competitorThumbUrls: string[] = [],
  // undefined → si calcola qui (una chiamata Gemini); una stringa, anche '' → si riusa, così chi
  // li ha già calcolati non paga (né diverge su) una seconda lettura del calendario.
  calendarHooks?: string,
  // Carousel cost guardrail: AT MOST this many of the `count` seeds may be carousels (0 = none).
  maxCarousels = 0,
  // Vuoto (il default) → nessun blocco di prompt, nessun cambio di schema, nessuna risoluzione.
  rubrics: Rubric[] = [],
  // Weekly market format/hook brief (formatMarketBrief). Empty when no refresh yet.
  marketBrief = '',
  // Radar / brand_news_sources kind=subreddit — inject into Reddit seed guidance.
  knownSubreddits: string[] = [],
  // Quali angoli si sono guadagnati la spesa di produzione, dallo storico del brand.
  ladder?: LadderContext
): Promise<WeeklyStrategy> {
  // Solo ciò che possiamo rappresentare FEDELMENTE: un prodotto fisico senza foto costringerebbe
  // il generatore a inventarlo. Servizi/progetti/feature non hanno bisogno di una foto e restano.
  const offerings = (Array.isArray(profile?.products) ? profile.products : [])
    .filter((p: AnyRec) => String(p?.kind ?? 'product') !== 'product' || (Array.isArray(p?.images) && p.images.length > 0))
    .slice(0, 8);
  const plats = platforms.length ? platforms : ['instagram'];
  const { moodLine, toneLine, personalityLine, goalLine, languageLine, contextBlock, guardrails } = brandLines(profile, prefs);

  const siteType = String(profile?.site_type ?? 'generic');
  const pillars = Array.isArray(profile?.content_pillars) ? profile.content_pillars.filter(Boolean) : [];

  // 'offering' generalizza il prodotto a servizi/progetti/feature, per i brand non ecommerce.
  const offeringLines =
    offerings
      .map((p: BrandProfile) => {
        const name = p?.name ?? p?.title;
        if (!name) return '';
        const kind = String(p?.kind ?? 'product');
        const desc = String(p?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        // Nome PRIMA — è ciò che finisce verbatim nel campo "product" — categoria fra parentesi in
        // coda, così il planner non copia "[Categoria] Nome".
        return `- ${name} (category: ${kind})${desc ? ` — ${desc}` : ''}`;
      })
      .filter(Boolean)
      .join('\n') || 'n/a';

  // Archetype-appropriate editorial pillars (from analysis) for the batch to rotate through.
  const pillarsBlock = pillars.length
    ? `\nCONTENT PILLARS (rotate the batch across these recurring themes — don't cram every post into one):\n${pillars.map((p: string) => `- ${p}`).join('\n')}\n`
    : '';

  const subredditBlock = plats.some((p) => platformKey(p) === 'reddit')
    ? knownSubredditsBlock(knownSubreddits)
    : '';

  // Annunci reali recenti, quando il sito li espone.
  const announcements = Array.isArray(profile?.announcements) ? profile.announcements.slice(0, 6) : [];
  const announcementsBlock = announcements.length
    ? `\nRECENT ANNOUNCEMENTS (real releases/news from the brand — turn the timely ones into "what's new / feature launch" posts where it fits; don't force all of them):\n${announcements
        .map((a: AnyRec) => `- ${a?.title}${a?.date ? ` (${a.date})` : ''}${a?.summary ? `: ${String(a.summary).slice(0, 140)}` : ''}`)
        .filter(Boolean)
        .join('\n')}\n`
    : '';

  // Gli UNICI URL che un link post può usare: `link_url` si copia verbatim da qui, o si spedisce un
  // link allucinato. Le pagine meno usate di recente vengono per prime.
  const pages = Array.isArray(profile?.pages) ? profile.pages.slice(0, 12) : [];
  const pagesBlock = pages.length
    ? `\nLINKABLE PAGES (the brand's own site — the ONLY URLs you may put in a seed's link_url, copied VERBATIM. Use them to DRIVE TRAFFIC: a Reddit link post, OR an X/Threads/LinkedIn/Facebook post whose caption references the page (never on Instagram/TikTok — links aren't clickable). Attach a link only when a page genuinely fits the angle; don't force it):\n${pages
        .map((p: AnyRec) => `- ${p?.url}${p?.title ? ` — ${String(p.title).slice(0, 90)}` : ''}${Array.isArray(p?.topics) && p.topics.length ? ` [${(p.topics as string[]).slice(0, 4).join(', ')}]` : ''}`)
        .join('\n')}\n`
    : '';

  // Momenti di calendario su cui il brand può postare autenticamente, così il batch è
  // contemporaneo e non generato nel vuoto. '' quando non c'è niente o al fallimento.
  const hooks =
    calendarHooks !== undefined
      ? calendarHooks
      : await upcomingTimelyHooks({
          category: profile?.category,
          archetype: siteType,
          language: profile?.language
        });
  const calendarBlock = hooks ? `\n${hooks}\n` : '';

  // Le loro foto diventano riferimenti per il generatore, così un post person-led mostra sempre la
  // stessa faccia vera. I brand 'face' ricevono una guida più stretta.
  const peopleBlock = peopleGuidanceBlock(profile);

  // Asset caricati dall'utente: da preferire alla generazione da zero.
  const libraryRows = Array.isArray(profile?.libraryMedia) ? (profile.libraryMedia as AnyRec[]) : [];
  const { formatMediaDigestForPlanner } = await import('$lib/server/brand-media');
  const mediaDigest = formatMediaDigestForPlanner(libraryRows as import('$lib/server/brand-media').BrandMediaRow[]);
  const mediaLibraryBlock = mediaDigest
    ? `\nMEDIA LIBRARY (real assets the brand uploaded — PREFER these over inventing a new AI scene. Copy the FULL id= UUID into media_id when one fits; set media_mode to use_as_is for photos/product/person shots, or composite when the asset is a logo/graphic or needs a branded frame):\n${mediaDigest}\n`
    : '';

  // Caption concrete + metriche, NON il brief distillato.
  const winnersBlock = topPosts.length
    ? `\nWHAT ACTUALLY WORKED (real past posts, highest engagement first — mine these for the angles, hooks and formats that perform here):\n` +
      topPosts
        .slice(0, 8)
        .map((p) => {
          const er = p.metrics?.engagementRate;
          const likes = p.metrics?.likes;
          const stat = [likes != null ? `${likes} likes` : '', er != null ? `${er}% eng.` : ''].filter(Boolean).join(', ');
          return `- [${p.platform ?? '?'}${stat ? ` · ${stat}` : ''}] ${String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 200)}`;
        })
        .join('\n') +
      '\n'
    : '';

  // La scala come vincolo VISIBILE e non solo come clamp muto: clampare salva il budget dopo che
  // il modello ha già speso l'attenzione sui seed sbagliati.
  const ladderBlock = ladder ? `\n${ladderBrief(ladder)}\n` : '';

  // Il video è il formato che VOGLIAMO: l'istruzione è un obiettivo da centrare, non un tetto da
  // evitare. Formulata come limite ("AT MOST n"), il planner ne produce zero.
  const videoTarget = Math.min(maxVideos, Math.max(1, Math.round(count * 0.4)));
  const videoLine =
    maxVideos > 0
      ? `VIDEO FIRST — this is the most important instruction in this brief: aim for ${videoTarget} of the ${count} seeds to be the "video" format (never more than ${maxVideos}). Short-form video is what actually travels; a batch that is all stills is a weak batch. Every video seed MUST be shot as UGC (ugc: true) unless there is a concrete reason not to, and MUST carry a spoken hook + body + cta. YouTube is video-only: every YouTube seed MUST be format "video" (Shorts vs long-form is auto-detected from duration + 9:16 vs 16:9 — never a separate platform).

SCRIPT CRAFT (Hook → Problem → Demo → Proof → CTA):
- ABSOLUTE PRIORITY: every hook is a concrete PAIN MOMENT with a Life-Force desire underneath (comfort, respect, less fear, looking after people you love, being better than peers…). Feature lists are forbidden in the opener.
- Structure EVERY video script as: HOOK call-out → body = PROBLEM + DEMO + PROOF → CTA. Product never leads; product must not appear before ~8s of speech.
- LENGTH SWITCH — ugc_ad:
  - ugc_ad false/omit (organic, DEFAULT for most seeds): ≤15s, ~40–48 spoken words TOTAL.
  - ugc_ad true (paid ad creatives only, few per batch): 22s on Seedance 2.5, ~55–66 spoken words — more room for DEMO mechanic + PROOF. Set ugc_ad true only when the seed is clearly meant as an ad/boost creative.
- CONCISE but personal/emotional — one tight spoken beat per stage. Direct, first-person, imperfect. Not a rant, not a telegram slogan.
- FULL SPOKEN SENTENCES only. Never fragments like "Calendar chaos? Resolve it. Try Anomalia."
- Hook (~8–14 words): pain moment mid-conversation (label / yes-question / if-then / ridiculous result). GOOD: "I was still writing captions at midnight and nothing had posted."
- Body: cost of the pain, THEN give away the mechanic out loud, THEN one proof. Organic ~18–28 words; ads ~28–42 words.
- CTA (~6–12 words): qualify + soft action. GOOD: "Anyway if you're done guessing, try it and tell me I'm wrong."
- Fit ~3.3 words/sec for the clip length above (≥~70% of budget, never over).
- Batch variety: different people/rooms/lighting; never clone the same hook pattern.
- Prefer writing ~${Math.max(videoTarget, Math.min(maxVideos, videoTarget + 2))} video scripts even if you later drop one.
- If a script makes a claim the product/angle cannot back, rewrite to what the offering actually does.

Straight talking-head UGC only — no surreal gimmicks. EXPRESSIVE face (pain = brows knit / lean in; proof = relief / softer eyes) — not deadpan, not constant hype. No on-screen subtitles ever. The remaining seeds use single_image, text_post or link_post — never a story.`
      : `VIDEO CONSTRAINT: this brand has no video budget left this month, so do NOT use the "video" format — EXCEPT YouTube, which is video-only (Shorts vs long-form is auto-detected from duration + 9:16 vs 16:9; never a separate platform). Every YouTube seed MUST still be format "video". Every other seed must be single_image, carousel, text_post or link_post — never a reel, short, video or story.`;
  const carouselLine =
    maxCarousels > 0
      ? `CAROUSEL CONSTRAINT: AT MOST ${maxCarousels} of the ${count} seeds may use the "carousel" format, ONLY on Instagram, Facebook or LinkedIn, with a slide_count of 3-${carouselMaxSlides()}. Use a carousel ONLY when the angle genuinely sustains that many DISTINCT slides (a list, a step-by-step process, a comparison, a story arc) — never to pad a single visual idea across slides.
CAROUSEL BEATS (hard): every carousel seed MUST arrive with "beats" filled — one concrete beat per slide, in order, exactly slide_count of them. A beat is what THAT slide says or shows in one sentence (a moment, a turn, a line someone says, a step), never a topic label like "introduzione" or "il problema". Read together they must form a real arc: a situation, something that changes, a landing that earns the last slide. A carousel that arrives without beats is a topic, not a story, and the producer will improvise ${carouselMaxSlides()} unrelated images from one line of angle.
${STORY_FAILURE_MODES}`
      : `CAROUSEL CONSTRAINT: do NOT use the "carousel" format in this batch.`;

  // I piani APPROVATI dall'utente e/o il brief di ricerca: autoritativi su DOVE mirare — il batch
  // li esegue, non li tratta come ispirazione.
  const strategyBlock = strategyBrief.trim()
    ? `\nSTRATEGY DIRECTIVES (authoritative — the user approved these plans; this batch EXECUTES them. Follow the week's theme, bias the platform mix toward any stated weights, and anchor the stated pillars/CTAs):\n${strategyBrief.trim()}\n`
    : '';

  // Approved rubrics (recurring series): '' for brands without them — prompt stays identical.
  const rubricsBlock = rubricsBrief(rubrics);
  const rubricsSection = rubricsBlock ? `\n${rubricsBlock}\n` : '';

  // Anti-moodboard: lo stratega si differenzia a VISTA, non solo dall'analisi testuale. Sono URL
  // CDN scrapati che possono essere scaduti — un fetch fallito significa solo meno immagini.
  const competitorParts = competitorThumbUrls.length
    ? ((await Promise.all(competitorThumbUrls.slice(0, MAX_COMPETITOR_MOOD_IMAGES).map(fetchImagePart))).filter(Boolean) as ImagePart[])
    : [];
  const competitorBlock = competitorParts.length
    ? `\nCOMPETITOR VISUAL FIELD (the ${competitorParts.length} attached image(s) are top-performing posts from this brand's COMPETITORS — an ANTI-moodboard): read the visual clichés this field repeats (subjects, compositions, backdrops, styling, on-image text) and make every seed's SUBJECT/SETTING deliberately DIFFERENT from them — claim the visual white space. NEVER imitate or echo these images' style, layouts or ideas.\n`
    : '';

  const marketBlock = marketBrief.trim() ? `\n${marketBrief.trim()}\n` : '';

  const prompt = `You are a senior social media strategist at an agency. Design the editorial strategy for ONE batch of ${count} posts for this brand, then break it into exactly ${count} concrete post seeds.

Brand: ${profile?.name ?? ''}
About: ${profile?.about ?? ''}
Category: ${profile?.category ?? ''}
Brand archetype: ${siteType}
${moodLine}
${toneLine}
${personalityLine}
${goalLine}
Target audience: ${profile?.target_audience ?? ''}
Offerings (choose which to feature and why — you do NOT have to use them all; for non-ecommerce brands these are services/projects/features, NOT products to "buy"). ONLY ever feature an offering that appears in THIS list, copying its name verbatim into the seed's "product" field — never invent or rename one, and never feature a product that isn't listed here:
${offeringLines}
${pillarsBlock}${announcementsBlock}${pagesBlock}${calendarBlock}${peopleBlock}${mediaLibraryBlock}${contextBlock}${guardrails}${winnersBlock}${strategyBlock}${rubricsSection}${competitorBlock}${marketBlock}${subredditBlock ? `\n${subredditBlock}` : ''}
ONLY use these platforms: ${plats.join(', ')}.
${platformPlaybook(plats, prefs)}${ladderBlock}${videoLine}
${carouselLine}
FACT DISCIPLINE — no invented assets: the THEME, RATIONALE and every seed's ANGLE may reference ONLY blog articles, guides, pages or resources that appear in the lists above (LINKABLE PAGES / RECENT ANNOUNCEMENTS), cited by their exact titles. If nothing listed fits — or no such list is present — make the point WITHOUT citing an article or resource. Inventing a title or asset (e.g. a blog post that does not exist) is a hard failure.
MEDIA LIBRARY FIRST — when MEDIA LIBRARY is present above, prefer reusing those real uploaded assets over inventing a new AI scene. For each image seed that a library asset fits, set media_id to that asset's FULL UUID and media_mode to "use_as_is" (pixel-perfect post media) or "composite" (integrate the asset into a branded generated frame). Never invent a media_id. Leave media_id/media_mode empty only when no library asset fits and a new visual is truly needed. Do NOT assign the same media_id to two seeds in the same batch. ROTATE: prefer unused or least-recently-used assets (used=N last=date on each line) — do not keep assigning the same hero photo.

Produce:
1) THEME — a single clear editorial angle/hook that makes these ${count} posts feel like a deliberate batch, not a random mix.
2) RATIONALE — why this theme now, grounded in the brand's voice, what has performed, and the market strategy above. Reference concrete patterns, not generic marketing advice.
3) DO/DON'T — 2-4 sharp, brand-specific guardrails for the copywriter.
4) SEEDS — exactly ${count} posts. SPREAD them across the allowed platforms, across the CONTENT PILLARS above, and across DIFFERENT offerings and angles: no two seeds may be the same idea. PRODUCT VARIETY (important): when the offerings span multiple categories (see the "category:" hint on each), the batch must feature DIFFERENT categories — do NOT make every post about the same product type. The theme is a narrative lens, not a category filter: you can tell a "sensory / sound / texture" story about a monitor (reflections, sharpness), a desk (wood grain, stability) or a chair just as well as a keyboard. A batch where every post is the same kind of object is a failure even if each post is on-theme. For each seed choose platform, the best native format, media ("video" for a reel, "image" for a still, "text" only for X/Threads), day, time, the EXACT offering name from the list (or "" if the post isn't about a specific offering), a one-line ANGLE describing what THAT post says or shows, and concrete visual directives — SUBJECT (main focus), SETTING (location/environment) and PROPS (supporting styling) — so the image is grounded, not generic. When a MEDIA LIBRARY asset fits, also set media_id + media_mode (see MEDIA LIBRARY FIRST). YOUTUBE: video-only — every YouTube seed MUST be format "video" (we shoot short vertical UGC; YouTube auto-classifies ≤3 min + 9:16 as a Short — do not invent a separate Shorts platform). SCENE VARIETY (important): the brand's visual style fixes the MOOD and palette, but every seed must have a DISTINCT setting, camera distance and composition — do NOT reuse the same backdrop (e.g. "dark textured stone/asphalt") or the same extreme macro crop for every post. Vary it deliberately: a real desk setup in use, a bright minimal studio surface, a lifestyle context, a wide hero shot vs a close detail. Large products (monitors, desks, chairs) must be shown WHOLE in a believable environment, never as an isolated macro fragment. Three posts that share one identical background and framing are a failure.
5) ART DIRECTION — leave "art_direction" empty on a seed that belongs in the brand's default visual style. Fill it when THIS post needs a different MEDIUM to work: a first-person story that a stock-looking photo would flatten, an idea that only lands drawn, printed or typeset. When the seed belongs to a rubric that declares an art direction, copy that rubric's art direction VERBATIM — an episode is recognisable because it looks like its series. Name the medium, the page grammar (panels, gutters, lettering) and the palette; never an aspect ratio.
6) CROSS-POSTING — for each seed, fill "cross_platforms" with the OTHER allowed platforms where that exact post (same visual, same caption) works natively, so total distribution grows without growing the batch. Natural pairs: Instagram ↔ Facebook, X ↔ Threads. Never pair clashing registers (long-form LinkedIn never cross-posts to X). Single-platform posts get an empty array.
Return JSON.`;

  // Il campo rubrica entra nello schema SOLO se esistono rubriche approvate.
  const schema = rubrics.length ? strategySchemaWithRubrics(rubrics.map((r) => r.name)) : STRATEGY_SCHEMA;
  const parsed: AnyRec = await structured(ai, prompt, schema,
    'You are an expert performance-marketing strategist. Be specific and on-brand; make every post earn its place. Vary offerings, content pillars and angles deliberately — never collapse the batch into near-identical posts.',
    { label: 'planStrategy', images: competitorParts });
  const rawSeeds = Array.isArray(parsed.seeds) ? parsed.seeds : [];
  // Le voci di cross-post fuori dal set richiesto vengono scartate.
  const allowed = new Set(plats.map((p) => platformKey(p)));
  const seeds: PostSeed[] = rawSeeds.slice(0, count).map((s: AnyRec) => {
    const primary = platformKey(String(s?.platform ?? ''));
    const cross = (Array.isArray(s?.cross_platforms) ? s.cross_platforms : [])
      .map((p: unknown) => platformKey(String(p ?? '')))
      .filter((p: string) => p && p !== primary && allowed.has(p));
    // NOME rubrica → id + format/media autoritativi, poi i clamp di capacità: un episodio di
    // rubrica carosello che atterra su X si degrada comunque, e viene loggato.
    return resolveSeedWithRubrics({
      platform: String(s?.platform ?? ''),
      platforms: [primary, ...new Set(cross)].filter(Boolean),
      pillar: String(s?.pillar ?? ''),
      format: normalizeContentFormat(s?.format),
      week: Number.isFinite(Number(s?.week)) ? Math.max(0, Math.floor(Number(s.week))) : undefined,
      slide_count: Number(s?.slide_count) || undefined,
      beats: normalizeBeats(s?.beats),
      art_direction: String(s?.art_direction ?? '').trim() || undefined,
      sourced_from: String(s?.sourced_from ?? '').trim() || undefined,
      ...(rubrics.length ? { rubric: String(s?.rubric ?? '') } : {}),
      // Derivato dal FORMAT e non preso dal modello: il renderer segue il format, quindi un
      // disaccordo fra i due consegna uno still a un seed che chiedeva un reel.
      media:
        normalizeContentFormat(s?.format) === 'video'
          ? ('video' as const)
          : s?.media === 'text'
            ? ('text' as const)
            : s?.media === 'link'
              ? ('link' as const)
              : ('image' as const),
      // UGC è il DEFAULT per il video: solo un false esplicito esce.
      ...(normalizeContentFormat(s?.format) === 'video'
        ? {
            ugc: s?.ugc !== false,
            ugc_ad: s?.ugc_ad === true,
            hook: String(s?.hook ?? '').trim(),
            hook_visual: String(s?.hook_visual ?? '').trim(),
            hook_text: String(s?.hook_text ?? '').trim(),
            body: String(s?.body ?? '').trim(),
            cta: String(s?.cta ?? '').trim()
          }
        : {}),
      day: String(s?.day ?? ''),
      time: String(s?.time ?? ''),
      title: String(s?.title ?? ''),
      link_url: String(s?.link_url ?? ''),
      subreddit: String(s?.subreddit ?? ''),
      product: String(s?.product ?? ''),
      person: String(s?.person ?? ''),
      angle: String(s?.angle ?? ''),
      subject: String(s?.subject ?? ''),
      setting: String(s?.setting ?? ''),
      props: String(s?.props ?? ''),
      media_id: String(s?.media_id ?? '').trim(),
      media_mode: s?.media_mode === 'composite' ? 'composite' : s?.media_mode === 'use_as_is' ? 'use_as_is' : ''
    }, rubrics);
  });
  // Il prompt sopra è una guida; questa è la legge.
  clampCarousels(seeds, maxCarousels);

  // Sanitise deterministico: via le persone inventate, i prodotti visivi fuori dal text-only.
  const knownPeople = new Set<string>(
    (Array.isArray(profile?.people) ? profile.people : [])
      .map((p: AnyRec) => String(p?.name ?? '').toLowerCase().trim())
      .filter(Boolean)
  );
  const knownMediaIds = new Set(
    (Array.isArray(profile?.libraryMedia) ? profile.libraryMedia : [])
      .map((m: AnyRec) => String(m?.id ?? '').trim())
      .filter(Boolean)
  );
  const usedMediaIds = new Set<string>();
  const hasProductCatalog = offerings.length > 0;
  for (const seed of seeds) {
    sanitizeSeed(seed, knownPeople, hasProductCatalog);
    // Via i media_id allucinati o duplicati.
    if (seed.media_id) {
      if (!knownMediaIds.has(seed.media_id) || usedMediaIds.has(seed.media_id) || seed.media === 'text' || seed.media === 'link') {
        seed.media_id = '';
        seed.media_mode = '';
      } else {
        usedMediaIds.add(seed.media_id);
        if (seed.media_mode !== 'composite') seed.media_mode = 'use_as_is';
      }
    } else {
      seed.media_mode = '';
    }
  }
  // Brand 'face': la persona primaria sui seed immagine lasciati vuoti dal modello.
  enforceFaceBrandPeople(seeds, profile);

  const strategy: WeeklyStrategy = {
    theme: String(parsed.theme ?? ''),
    rationale: String(parsed.rationale ?? ''),
    doDont: String(parsed.do_dont ?? ''),
    seeds
  };

  // Pass 1.5: un secondo modello riscrive in loco i seed deboli. Best-effort.
  const reviewed = await reviewSeeds(ai, profile, strategy, plats, rubrics);
  // Pass 1.6 — panel sui copioni UGC PRIMA di spendere un frame: il renderer rende bellissimi
  // anche i copioni deboli, ed è esattamente la trappola. Best-effort.
  const { reviewUgcScripts } = await import('$lib/server/ugc-script-review');
  await reviewUgcScripts(ai, reviewed.seeds, {
    brandName: String(profile?.name ?? ''),
    language: String(prefs.language ?? profile?.language ?? ''),
    theme: reviewed.theme
  });
  // Tre componenti, tre carichi diversi: un modello a cui si chiedono hook parlato e riga a
  // schermo restituisce volentieri la stessa frase due volte.
  enforceHookComponents(reviewed.seeds);
  // Il reviewer può PROMUOVERE un seed a carosello: si ri-clampa, o il tetto del batch salta.
  clampCarousels(reviewed.seeds, maxCarousels);
  enforceFaceBrandPeople(reviewed.seeds, profile);
  return reviewed;
}

// Compact verdict the seed reviewer returns per seed it wants to change.
const SEED_REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    fixes: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const, description: '0-based index of the seed to fix.' },
          reason: { type: 'string' as const, description: 'Short why (e.g. "product marked text-only", "angle promises a sound a monitor cannot make", "two seeds are the same category").' },
          product: { type: 'string' as const, description: 'Corrected EXACT product name from the catalog, or "" to keep. Only use names that appear in the offerings list.' },
          // Gemini rifiuta '' dentro un enum (400 INVALID_ARGUMENT) e disabiliterebbe in silenzio
          // tutto questo pass: 'keep' è il no-op esplicito (l'applier agisce solo su image/text).
          media: { type: 'string' as const, enum: ['image', 'text', 'keep'] as const, description: '"image" or "text" to override, "keep" to leave unchanged.' },
          format: { type: 'string' as const, enum: ['single_image', 'carousel', 'keep'] as const, description: '"single_image" to demote a carousel whose angle cannot sustain distinct slides (or vice versa, "carousel" only if the angle clearly is a list/process/comparison); "keep" to leave unchanged.' },
          angle: { type: 'string' as const, description: 'Rewritten one-line angle, or "" to keep.' },
          subject: { type: 'string' as const, description: 'Rewritten visual subject, or "" to keep.' },
          beats: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                shows: { type: 'string' as const, description: 'What is seen in that panel, one concrete sentence.' },
                thinks: { type: 'string' as const, description: 'The inner line, first person, six words or fewer. Empty on a guide panel that has no protagonist.' },
                says: { type: 'string' as const, description: 'Spoken words with WHO says them, or "" when nobody speaks.' }
              },
              required: ['shows', 'thinks', 'says']
            },
            description:
              'ONLY to repair a CAROUSEL that arrived without its story: write one beat per slide, in order, exactly slide_count of them. Prefer this over demoting — a series whose format is a carousel must stay one. Empty array for every other fix.'
          }
        },
        required: ['index', 'reason', 'product', 'media', 'format', 'angle', 'subject', 'beats']
      }
    }
  },
  required: ['fixes']
};

// PASS 1.5 — un secondo modello confronta i seed col contesto REALE del brand (catalogo vero,
// lista People vera) e col batch nel suo insieme, e riscrive solo le righe deboli: prodotto visivo
// lasciato text-only, angolo che promette ciò che il prodotto non fa, batch collassato su una
// categoria. Non lancia mai — al fallimento restano i seed sanificati.
// Un fix del pass 1.5 applicato al seed. Puro ed esportato perché qui si è persa un'invariante che
// altrove è legge: il formato della RUBRICA è autoritativo, e il revisore lo scavalcava in silenzio
// declassando a immagine singola l'unico episodio narrativo del batch. resolveSeedWithRubrics
// ristabilisce rubrica + capacità di piattaforma, e logga la degradazione quando è fisica.
export function applySeedFix<T extends PostSeed>(
  seed: T,
  fix: AnyRec,
  validProducts: Set<string>,
  rubrics: Rubric[]
): T {
  const newProduct = String(fix?.product ?? '').trim();
  if (newProduct && validProducts.has(newProduct.toLowerCase())) seed.product = newProduct;
  else if (newProduct) seed.product = '';
  if (fix?.media === 'image' || fix?.media === 'text' || fix?.media === 'link') seed.media = fix.media;
  if (fix?.format === 'single_image' || fix?.format === 'carousel') seed.format = fix.format;
  if (String(fix?.angle ?? '').trim()) seed.angle = String(fix.angle).trim();
  if (String(fix?.subject ?? '').trim()) seed.subject = String(fix.subject).trim();
  // Un carosello senza storia si RIPARA scrivendola, non declassando: declassare era il modo in cui
  // l'unica rubrica narrativa del batch spariva ogni settimana.
  const written = normalizeBeats(fix?.beats);
  if (written) seed.beats = written;
  return resolveSeedWithRubrics(seed, rubrics) as T;
}

async function reviewSeeds(
  ai: GoogleGenAI,
  profile: BrandProfile,
  strategy: WeeklyStrategy,
  plats: string[],
  rubrics: Rubric[]
): Promise<WeeklyStrategy> {
  try {
    if (!strategy.seeds.length) return strategy;

    // La verità di riferimento contro cui il reviewer misura.
    const offerings = (Array.isArray(profile?.products) ? profile.products : [])
      .filter((p: AnyRec) => String(p?.kind ?? 'product') !== 'product' || (Array.isArray(p?.images) && p.images.length > 0))
      .slice(0, 40);
    const offeringList = offerings
      .map((p: AnyRec) => `- ${p?.name ?? p?.title} (category: ${p?.kind ?? 'product'})`)
      .filter(Boolean)
      .join('\n') || '(no products)';
    const peopleList = (Array.isArray(profile?.people) ? profile.people : [])
      .map((p: AnyRec) => {
        const meta = [p?.role].filter(Boolean).join(', ');
        return `- ${p?.name}${meta ? ` (${meta})` : ''}`;
      })
      .filter(Boolean)
      .join('\n') || '(no people — do NOT feature any named person)';

    const faceMode = faceBrandMode(profile);
    const face = primaryPersonName(profile);
    const faceReviewLine =
      faceMode === 'face' && face
        ? `\nFACE BRAND MODE: this brand IS ${face}. Do NOT strip or blank their person field on image seeds. Do NOT rewrite person-led angles into anonymous lifestyle. If an image seed has no person, set the angle/subject so ${face} is the human subject (you cannot write person in the fix schema — leave person-led seeds alone unless the angle invents a stranger).\n`
        : '';

    const seedList = strategy.seeds
      .map((s, i) => `${i}. platform:${s.platform} format:${s.format}${s.format === 'carousel' ? `(${s.slide_count ?? 5} slides)` : ''} media:${s.media} product:"${s.product || ''}" person:"${s.person || ''}" angle:"${s.angle}"${(s.beats ?? []).length ? `\n   story: ${(s.beats ?? []).map((b) => b.shows).join(' → ')}` : ''}`)
      .join('\n');

    const prompt = `You are a strict senior creative director reviewing the post plan a junior strategist proposed for this brand. Audit each seed against the REAL brand facts below and list ONLY the seeds that need fixing.

Brand: ${profile?.name ?? ''}
Theme of this batch: ${strategy.theme}
${faceReviewLine}
REAL PRODUCTS available (with their category) — a seed's product MUST be one of these, copied verbatim:
${offeringList}

REAL PEOPLE available (the ONLY humans that may appear — never invent others; do NOT invent gender/age from the name):
${peopleList}

PROPOSED SEEDS:
${seedList}

Flag and fix a seed when:
- It is about a real, photographable PRODUCT but media is "text" — a buyable product must be SHOWN (set media "image"). When you flip a seed to "image", you MUST also provide a concrete "subject" (what the photo shows) so it isn't left blank, and rewrite the angle so it no longer says "text-only".
- Its "product" is empty, not in the product list, or paraphrased — set the correct exact name.
- Its ANGLE promises something the product can't deliver (e.g. a "thock"/sound/typing-feel angle on a MONITOR, DESK or CHAIR) — rewrite the angle to fit what that product actually is.
- It names a PERSON not in the People list — the person should already be blank; if the angle leans on that person, rewrite it to be product/lifestyle instead.
- The batch is monotonous (multiple seeds on the same product category) when other categories are available — rewrite one seed's product/angle to a different category.
- It is a CAROUSEL whose angle cannot genuinely sustain that many DISTINCT slides (no list, process, comparison or story arc — just one visual idea padded out) — set format "single_image". A carousel must promise a sequence, not stretch a single shot. A seed that shows a "story:" line already HAS its sequence, one beat per slide: judge those beats, and never demote it for lacking a list. And a carousel with NO "story:" line is repaired by WRITING one — fill "beats", one per slide — not by demoting it; demote only when the angle genuinely has no sequence in it at all.
- A "story:" seed you cannot FOLLOW. Read its beats as someone who knows nothing about this brand or this subject: by the last panel you must be able to say what happened, to whom, and why it mattered — from the panels alone, with the caption covered. If you have to already know the topic to understand it, the story is not written yet: rewrite the beats so the situation explains itself as it goes. The commonest way this fails is a line of dialogue that only makes sense to someone inside it — a rule quoted, a form named, an objection raised — with nothing in the panel showing what it means for the person in front of it.
Leave good seeds out of "fixes". Return JSON.`;

    const parsed: AnyRec = await structured(ai, prompt, SEED_REVIEW_SCHEMA, undefined, { label: 'reviewSeeds' });
    const fixes: AnyRec[] = Array.isArray(parsed.fixes) ? parsed.fixes : [];
    if (!fixes.length) return strategy;

    const validProducts = new Set(offerings.map((p: AnyRec) => String(p?.name ?? p?.title ?? '').toLowerCase().trim()));
    for (const fix of fixes) {
      const i = Number(fix?.index);
      const seed = strategy.seeds[i];
      if (!seed) continue;
      applySeedFix(seed, fix, validProducts, rubrics);
      console.warn(`[reviewSeeds] fixed seed ${i}: ${String(fix?.reason ?? '')}`);
    }
    return strategy;
  } catch (e) {
    console.error(`[reviewSeeds] failed: ${e instanceof Error ? e.message : String(e)}`);
    return strategy;
  }
}

// Seed → scheletro di PreviewPost (caption/image_prompt li riempie il pass 2).
export function seedToPost(seed: PostSeed): PreviewPost {
  const format = normalizeContentFormat(seed.format);
  const isVideo = format === 'video';
  return {
    platform: seed.platform ?? '',
    ...(Array.isArray(seed.platforms) && seed.platforms.length > 1 ? { platforms: seed.platforms } : {}),
    pillar: seed.pillar ?? '',
    // La provenienza passa da questo unico mapping seed→post.
    angle: seed.angle ?? '',
    planRowId: seed.id,
    ...(seed.rubric_id ? { rubricId: seed.rubric_id } : {}),
    format,
    media: isVideo ? 'video' : seed.media === 'image' ? 'image' : seed.media,
    day: seed.day ?? '',
    time: seed.time ?? '',
    caption: '',
    image_prompt: '',
    title: seed.title ?? '',
    link_url: seed.link_url ?? '',
    subreddit: seed.subreddit ?? '',
    product: seed.product ?? '',
    person: seed.person ?? '',
    setting: seed.setting ?? '',
    // generate/+server.ts li legge per ugcSpokenLine: perderli qui produce clip mute anche quando
    // il Pass 1 ha scritto un hook/body/cta completo.
    ...(isVideo
      ? {
          ugc: seed.ugc !== false,
          ugc_ad: seed.ugc_ad === true,
          hook: seed.hook ?? '',
          hook_visual: seed.hook_visual ?? '',
          hook_text: seed.hook_text ?? '',
          body: seed.body ?? '',
          cta: seed.cta ?? ''
        }
      : {}),
    ...(seed.media_id
      ? {
          mediaId: seed.media_id,
          mediaMode: (seed.media_mode === 'composite' ? 'composite' : 'use_as_is') as 'use_as_is' | 'composite'
        }
      : {})
  };
}

// L'argine tecnico al collasso ("N scatti prodotto quasi identici") ora che la scena è consultiva:
// confronta le APERTURE degli image_prompt (le prime parole fissano soggetto e inquadratura) e
// ritorna il cluster più grande di scene quasi uguali. Deve accendere una spia, non giudicare.
// ponytail: euristica naive sulle prime 15 parole; se dà falsi positivi reali il passo dopo è
// confrontare l'intero prompt, non costruire un judge.
export function detectSceneCollapse(prompts: string[], minCluster = 3, threshold = 0.6): number[] {
  const tokens = prompts.map(
    (p) =>
      new Set(
        String(p ?? '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 15)
      )
  );
  const jaccard = (a: Set<string>, b: Set<string>) => {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
  };
  let best: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].size) continue;
    const cluster = [i];
    for (let j = 0; j < tokens.length; j++) {
      if (j !== i && jaccard(tokens[i], tokens[j]) >= threshold) cluster.push(j);
    }
    if (cluster.length > best.length) best = [...cluster].sort((a, b) => a - b);
  }
  return best.length >= minCluster ? best : [];
}

// Spia, non blocco: il batch si consegna comunque, ma nei log si vede se la libertà consultiva
// sta ricreando il collasso.
export function warnOnSceneCollapse(posts: PreviewPost[]): PreviewPost[] {
  const prompts = posts.map((p) => (p.media === 'text' || p.media === 'link' ? '' : (p.image_prompt ?? '')));
  const idx = detectSceneCollapse(prompts);
  if (idx.length) {
    console.warn(
      `[executeWeekStrategy] scene collapse: ${idx.length}/${posts.length} posts share a near-identical scene (indexes ${idx.join(', ')}) — the one-shot failure the two-tier contract must not reintroduce`
    );
  }
  // Il check sopra scatta da 3 in su, ma il feed è fatto di cover: già una COPPIA fotocopia si
  // nota. Soglia più alta (0.75) perché su una coppia il falso positivo costa più che su un cluster.
  const covers = detectSceneCollapse(prompts, 2, 0.75);
  if (covers.length && covers.length < 3) {
    console.warn(
      `[executeWeekStrategy] cover collapse: posts ${covers.join(', ')} open on near-identical covers — the feed the owner sees repeats itself`
    );
  }
  return posts;
}

// I tell di una caption scritta da un LLM hanno una firma MISURABILE: si contano in codice e si
// passano al copy chief già calcolati, così il judge non può "non accorgersene" — il suo
// fallimento storico è giudicare il contenuto e perdonare la cadenza.
