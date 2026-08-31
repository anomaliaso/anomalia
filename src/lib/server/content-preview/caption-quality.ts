import type { GoogleGenAI } from '@google/genai';
import { scrubPersonAppearance } from './images';
import { brandLines, detectSceneCollapse, seedToPost } from './plan-pipeline';
import { type AnyRec, type BrandProfile, CAPTION_LINK_PLATFORMS, CAROUSEL_MIN_SLIDES, type ContentPrefs, EXEC_SCHEMA, type PastWinner, type PreviewPost, type Progress, type WeeklyStrategy, carouselMaxSlides, faceBrandMode, platformKey, platformPlaybook, primaryPersonName } from './seed-model';
import { aiActCopyGuardrail } from '$lib/ai-act';
import { designWallDigestSection } from '$lib/server/wall-digest';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { env } from '$env/dynamic/private';
import { judgeThinkingLevel } from '$lib/server/gemini';
import { structured } from '$lib/server/research';
import { aiStructured, AI_PROVIDER, XIAOMI_ULTRASPEED_MODEL } from '$lib/server/xiaomi';
import { PROOF_DISCIPLINE_RULE } from '$lib/server/proof-discipline';
import { COPY_PANEL_MAX_ROUNDS, COPY_PANEL_SCHEMA, bandOfScore, bestOf, normalizeVerdict, panelSummary, stripJudgeScaffolding, toIterate, toReplace, type PanelVerdict } from '$lib/server/copy-panel';
import { PLATFORM_CHAR_LIMITS, ensureShortNetworkCuts } from '$lib/platform-limits';
import { assertHashtagPrefs, assertRedditCraft, reachChasingHashtags, stripDisallowedHashtags, stripReachChasingHashtags, winningPatternsBlock } from '$lib/server/platform-hygiene';

// ponytail: Extended_Pictographic sovraconta le emoji composte via ZWJ; per una soglia va bene.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Tell in UNA caption, come etichette `nome:valore`. Soglie numeriche, non aggettivi. */
export function detectCaptionTells(caption: string, platform?: string): string[] {
  const text = String(caption ?? '').trim();
  if (!text) return [];
  const tells: string[] = [];
  const plat = platformKey(platform);

  // La cadenza "frase — battuta" ripetuta: il tell più riconoscibile.
  const emDashes = (text.match(/—/g) ?? []).length;
  if (emDashes > 1) tells.push(`em_dash:${emDashes}`);

  // Emoji come decorazione: 2 è il tetto, 0 sui network professionali.
  const emoji = (text.match(EMOJI_RE) ?? []).length;
  const emojiCap = plat === 'linkedin' || plat === 'x' || plat === 'reddit' ? 0 : 2;
  if (emoji > emojiCap) tells.push(`emoji:${emoji}`);

  // Hook che non guadagna lo stop: apertura da template, o prima riga che divaga.
  const firstLine = text.split('\n')[0].trim();
  if (/^(scopri|discover|immagina|imagine|in un mondo|in a world|benvenut)/i.test(firstLine)) {
    tells.push('banned_opener');
  }
  const firstSegment = firstLine.split(/[.!?:]/)[0].trim();
  const hookWords = firstSegment.split(/\s+/).filter(Boolean).length;
  if (hookWords > 10) tells.push(`long_first_line:${hookWords}`);

  // Chiusa a tricolon ("Non X. Non Y. Solo Z."): tre frasi finali cortissime di fila.
  const sentences = text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^#/.test(s)); // le righe di soli hashtag non sono frasi
  if (sentences.length >= 3) {
    const lastThree = sentences.slice(-3);
    if (lastThree.every((s) => s.split(/\s+/).filter(Boolean).length <= 5)) tells.push('tricolon_ending');
  }

  return tells;
}

/**
 * CTA fotocopia nel BATCH: stessa Jaccard di detectSceneCollapse sulle righe di CHIUSURA, ma
 * minCluster=2 — già DUE post che chiudono con la stessa formula sanno di serie. Spia, non blocco.
 */
export function detectCtaEcho(captions: string[]): number[] {
  const closers = captions.map((c) => {
    const lines = String(c ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^#[\p{L}0-9_]/u.test(l)); // la coda di hashtag non è la CTA
    return lines.at(-1) ?? '';
  });
  return detectSceneCollapse(closers, 2, 0.5);
}

/**
 * Post che dopo i judge hanno una caption IDENTICA a un altro ma diversa dalla propria pre-judge:
 * il segno di una riscrittura applicata all'INDICE SBAGLIATO. reviewCaptions li ripristina.
 */
export function findJudgeDuplicates(captions: string[], originals: string[]): number[] {
  const seen = new Map<string, number>();
  const out: number[] = [];
  for (let i = 0; i < captions.length; i++) {
    const key = String(captions[i] ?? '').trim();
    if (!key) continue;
    const orig = String(originals[i] ?? '').trim();
    if (seen.has(key) && orig && orig !== key) out.push(i);
    else if (!seen.has(key)) seen.set(key, i);
  }
  return out;
}

// I fallimenti nominati al WRITER prima che scriva: regole dure, numerate, con numeri al posto
// degli aggettivi. Ogni regola chiude un tell che detectCaptionTells / detectCtaEcho misurano, e
// chief e panel citano questa stessa lista — writer e judge condividono cosa vuol dire "sbagliato".
export const CAPTION_FAILURE_MODES = `CAPTION FAILURE MODES (hard, numbered — each of these marks a caption as AI-written; any one of them is a rewrite):
1. WEAK HOOK: the first line must earn the stop in ≤6 words before any pause — a number, a stake, a tension. Never open with the brand name, "Scopri/Discover…", "Immagina/Imagine…", or scene-setting preamble.
2. EM-DASH CADENCE: at most ONE em-dash (—) per caption. The "clause — punchline" rhythm used twice is the single strongest AI tell.
3. TRICOLON ENDING: never close on a three-beat list ("Non X. Non Y. Solo Z." / "No X. No Y. Just Z."). Say it once.
4. EMPTY SUPERLATIVES: every superlative or big adjective must sit NEXT TO its proof (a number, a named fact) in the same sentence — no proof, cut the adjective and keep the fact.
5. EMOJI SPRAY: max 2 emoji per caption, 0 on LinkedIn/X/Reddit, never as list decoration. (An explicit brand personality may raise this — never the default.)
6. CTA SAMENESS: across THIS batch, no two captions may close on the same CTA formula ("link in bio", "che ne pensi?", "tell me in the comments"). Vary the ask — a question, a save-this, or no ask at all.
7. HASHTAG SPAM: obey the platform hashtag prefs when given; otherwise ≤3 niche tags, 0 on Reddit. Never reach-chasing tags.
8. REGISTER DRIFT: the caption must sound like the brand's own voice examples above, not like a copywriter's default register — reread one voice example before each caption.`;

// Un jsonb scritto da altri percorsi non deve gonfiare né rompere il prompt del writer: solo
// coppie valide, ultime 3, troncate.
export function ownerCaptionEditPairs(prefs: ContentPrefs = {}): Array<{ before: string; after: string }> {
  const raw = Array.isArray(prefs.captionEditPairs) ? prefs.captionEditPairs : [];
  return raw
    .filter((p) => p && typeof p === 'object' && typeof p.before === 'string' && typeof p.after === 'string' && p.before.trim() && p.after.trim())
    .slice(-3)
    .map((p) => ({ before: String(p.before).slice(0, 600), after: String(p.after).slice(0, 600) }));
}

// Le riscritture vere dell'owner come esempi prima→dopo: si assorbe la DIFFERENZA, mai le parole
// (appartengono ad altri post). '' con zero coppie.
export function ownerEditPairsBlock(prefs: ContentPrefs = {}): string {
  const pairs = ownerCaptionEditPairs(prefs);
  if (!pairs.length) return '';
  return `\nHOW THE OWNER REWRITES YOUR CAPTIONS (real before → after edits on this brand's recent posts — absorb the DIFFERENCE: what they cut, the length, the tone. Apply the same taste to every caption below; never reuse their wording, it belongs to other posts):\n${pairs
    .map((p) => `- BEFORE: ${p.before}\n  AFTER: ${p.after}`)
    .join('\n')}\n`;
}

// Un solo punto di fusione, così ogni insert persiste la nota allo stesso modo — sulla colonna qc
// ESISTENTE: mai una colonna nuova, le migration non girano al deploy.
export function postQcPayload(post: PreviewPost): Record<string, unknown> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = ((post as any).__qc as Record<string, unknown> | null | undefined) ?? null;
  const dev = post.sceneDeviation?.trim();
  if (!dev) return base;
  return { ...(base ?? {}), scene_deviation: dev };
}

// Pavimento di qualità su ogni caption. Quando il brand ha una personalità approvata, quella
// GUIDA: un unico registro d'agenzia per tutti appiattisce i feed in cloni.
const HOUSE_BAR = `HOUSE BAR — quality floor only (never change the LANGUAGE or any facts):
Kill every marketing cliché and hype word ("unlock", "elevate", "game-changer", "level up", "dive in", "in today's fast-paced world", "we're thrilled/excited to", "say goodbye to"). If a line could run verbatim on any other brand's feed, rewrite it sharper and more specific to THIS brand. Stay kind toward the customer — never smug or mean. Prefer concrete detail over abstract claims.
HASHTAG: solo tag di nicchia in cui il brand compete davvero. Mai tag acchiappa-reach (#viral, #fyp, #perte, #explorepage, #instagood, #followforfollow): portano un pubblico che non ha nessun rapporto con il brand e sulle piattaforme attuali sono un segnale di spam, non di distribuzione. Meglio tre tag specifici che dieci generici.

${PROOF_DISCIPLINE_RULE}`;

const HOUSE_VOICE_DEFAULT = `HOUSE VOICE — apply on top of the brand's voice when no explicit personality is set (never change the LANGUAGE or any facts):
write with a fairly cynical, faintly world-weary edge and a genuinely original point of view. Wit is bone-dry and ALWAYS subtle — deadpan understatement and clever turns, never puns, slapstick, emoji-spam or exclamation-mark hype. Be confident and a little unimpressed by the usual noise, but never smug or mean toward the customer.
${HOUSE_BAR}`;

/** Prefer brand personality over the default dry house register. */
export function houseVoiceFor(prefs: ContentPrefs = {}): string {
  const personality = prefs.personality?.trim();
  if (personality) {
    return `BRAND PERSONALITY (authoritative — this is how the brand sounds; do NOT overwrite it with a generic agency cynicism): ${personality}
${HOUSE_BAR}
Wit and register must follow the personality above — only use dry/cynical edge when that personality asks for it.`;
  }
  return HOUSE_VOICE_DEFAULT;
}

/** Best-effort retrieval for caption prompts. Never throws — empty when unavailable. */
export async function loadCaptionKnowledge(
  supabase: SupabaseClient | undefined,
  brandId: string | undefined,
  query: string
): Promise<{ block: string; chunkIds: string[] }> {
  const q = query.trim();
  if (!supabase || !brandId || !q) return { block: '', chunkIds: [] };
  try {
    const { searchKnowledge } = await import('$lib/server/knowledge');
    const { selectChunksForPrompt } = await import('$lib/server/knowledge-prompt');
    const hits = await searchKnowledge(supabase, brandId, q.slice(0, 500), { limit: 3 });
    const sel = selectChunksForPrompt(
      hits.map((h) => ({
        chunkId: h.chunkId,
        title: h.title,
        headingPath: h.headingPath,
        content: h.content
      }))
    );
    return { block: sel.block, chunkIds: sel.chunkIds };
  } catch (e) {
    console.warn('[caption-knowledge]', e instanceof Error ? e.message : e);
    return { block: '', chunkIds: [] };
  }
}

export type CaptionKnowledgeCtx = {
  supabase?: SupabaseClient;
  brandId?: string;
  /** Required for produce-agent render+review loop. */
  userId?: string;
  onProgress?: Progress;
  timezone?: string;
  strategyBrief?: string;
  /** Past winners for caption pass 2 / produce preload. */
  topPosts?: PastWinner[];
};

// PASS 2 — caption + image_prompt per ogni seed. I campi strutturali del seed sono autoritativi:
// il mestiere del modello si ricuce sopra per INDICE, così la spread deliberata sopravvive.
// Il renderer riempie da solo qualunque testo debba inventare, e lo inventa in inglese: una
// didascalia chiesta e non scritta torna come una frase estranea impressa nell'immagine. La regola
// («o citi la stringa esatta, o l'immagine non ha testo») viveva solo nel prompt, dove si salta —
// qui è deterministica: nessuna stringa fra virgolette, nessun testo. La frase è la stessa del
// percorso articoli, non una seconda formulazione che diverge alla prima modifica.
const NO_TEXT_SEAL = 'Absolutely NO text, letters, words, captions or logos anywhere in the image.';

export function sealOnImageText(prompt: string): string {
  const p = String(prompt ?? '').trim();
  if (!p || p.includes(NO_TEXT_SEAL)) return prompt;
  return /"[^"]+"/.test(p) ? prompt : `${p} ${NO_TEXT_SEAL}`;
}

export async function executePlan(
  ai: GoogleGenAI,
  profile: BrandProfile,
  strategy: WeeklyStrategy,
  prefs: ContentPrefs = {},
  knowledge?: CaptionKnowledgeCtx
): Promise<PreviewPost[]> {
  if (!strategy.seeds.length) return [];
  const { languageLine, contextBlock, visualStyleBlock, avoidLine, voiceExamplesBlock, voiceBlock, personalityLine } = brandLines(profile, prefs);
  // Il pavimento di gusto distillato dal wall; il soffitto resta lo studio per-brief dei
  // riferimenti — wall-digest.ts spiega perché sono due.
  const wallFloor = await designWallDigestSection();
  const playbook = platformPlaybook(strategy.seeds.map((s) => s.platform), prefs);

  // L'identità viene dalle FOTO al render, mai da testo su genere/età nell'image_prompt: un nome
  // androgino come "Andrea" viene sessuato male appena si chiede all'LLM di descrivere il fisico.
  const seedLines = strategy.seeds
    .map((s, i) => {
      const personLabel = s.person ? `person: ${s.person}` : '';
      // Solo dove il link è cliccabile: su Reddit l'URL È il post, non sta nella caption.
      const linkNote = s.link_url && CAPTION_LINK_PLATFORMS.has(platformKey(s.platform)) ? `link: ${s.link_url}` : '';
      const meta = [s.platform, s.format === 'carousel' ? `carousel of ${s.slide_count ?? 5} slides` : s.format, s.rubric ? `rubric: "${s.rubric}" (write this post as an EPISODE of that series — recognisable, consistent with its promise)` : '', [s.day, s.time].filter(Boolean).join(' '), s.product ? `product: ${s.product}` : 'no product', personLabel, `media: ${s.media}`, s.media_id ? `library_media: ${s.media_id} (${s.media_mode || 'use_as_is'})` : '', linkNote, s.pillar ? `pillar: ${s.pillar}` : '']
        .filter(Boolean)
        .join(' · ');
      const scene = [s.subject ? `subject: ${s.subject}` : '', s.setting ? `setting: ${s.setting}` : '', s.props ? `props: ${s.props}` : '']
        .filter(Boolean)
        .join(' · ');
      const beats = (s.beats ?? []).length
        ? `\n   STORY BEATS (binding — one slide each, in this order):\n${(s.beats ?? []).map((b, n) => `     ${n + 1}. ${b}`).join('\n')}`
        : '';
      const art = s.art_direction ? `\n   ART DIRECTION (binding — this post's medium, it OVERRIDES the brand visual style): ${s.art_direction}` : '';
      return `${i + 1}. [${meta}] angle: ${s.angle}${scene ? `\n   proposed scene → ${scene}` : ''}${beats}${art}`;
    })
    .join('\n');

  // Shared retrieval for the batch (theme + pillars/angles), capped ~600 tokens — docs/23 §11.
  const knowledgeQuery = [
    strategy.theme,
    ...strategy.seeds.map((s) => [s.pillar, s.angle].filter(Boolean).join(' '))
  ]
    .filter(Boolean)
    .join('\n');
  const { block: knowledgeBlock, chunkIds: knowledgeChunkIds } = await loadCaptionKnowledge(
    knowledge?.supabase,
    knowledge?.brandId,
    knowledgeQuery
  );

  const winnersForCaptions = winningPatternsBlock(knowledge?.topPosts ?? [], { limit: 5 });

  const faceMode = faceBrandMode(profile);
  const faceLine =
    faceMode === 'face' && primaryPersonName(profile)
      ? `\nFACE BRAND: every image that depicts a human MUST show ${primaryPersonName(profile)} (the seed's person field). Never invent other faces, stock models, or anonymous protagonists.\n`
      : faceMode === 'ensemble'
        ? `\nENSEMBLE BRAND: if an image depicts a human, they MUST be one of the brand's People named in the seed. Never invent strangers.\n`
        : `\nNo brand people on file — do NOT invent human protagonists; keep scenes product/lifestyle/graphic without identifiable strangers.\n`;

  const prompt = `You are an expert performance-marketing copywriter and art director. Write the final ${strategy.seeds.length} posts for this brand, executing the strategy below EXACTLY.

Brand: ${profile?.name ?? ''}
About: ${profile?.about ?? ''}
${contextBlock}${visualStyleBlock}${wallFloor}${voiceExamplesBlock}${voiceBlock}
${personalityLine}
${languageLine}
${avoidLine}
${aiActCopyGuardrail()}
${faceLine}
STRATEGY THEME: ${strategy.theme}
WHY: ${strategy.rationale}
DO/DON'T: ${strategy.doDont}
${houseVoiceFor(prefs)}
${playbook}
${CAPTION_FAILURE_MODES}
${ownerEditPairsBlock(prefs)}${winnersForCaptions ? `\n${winnersForCaptions}\nEcho winning hook patterns (angles, specificity, formats) — never copy captions verbatim.\n` : ''}
Below are ${strategy.seeds.length} post seeds, in order. Produce EXACTLY one post per seed, in the SAME ORDER. For each:
- Write a scroll-stopping, on-brand caption that delivers that seed's ANGLE within the theme. Match the PLATFORM PLAYBOOK above for THAT seed's platform — especially its length and hashtag count (e.g. a LinkedIn post is long-form with several short paragraphs, an X post is one tight line). Never pad a short-form network or truncate a long-form one.
- Write an "image_prompt" describing a scroll-stopping image (for video/reel/short formats describe a strong cover frame) that matches the VISUAL STYLE above. The seed's "proposed scene" (subject/setting/props) is the strategist's PROPOSAL, not an order: use it as your default, but when you have a genuinely STRONGER scene for that seed's ANGLE, shoot yours instead — then fill "scene_deviation" with ONE line explaining why yours serves the angle better (empty string when you follow the proposal). A deviation changes the staging, never the point: it must still deliver the seed's angle and pillar and respect the DO/DON'T, and must stay DISTINCT from every other seed's scene — never converge multiple posts onto the same shot. MEDIUM: honour the visual style's GRAPHIC LANGUAGE — if the brand's style is an illustrated/graphic medium (e.g. painterly digital illustration, editorial graphics, collage), the image_prompt MUST describe an image in THAT exact medium and never a photograph; describe a photorealistic photo only when the brand's style is photographic or no style is given. Never switch a graphic-language brand to lifestyle photography for "variety" — vary subject, composition and palette within its medium instead. Do NOT specify an aspect ratio or framing like "square" — the renderer sizes the image to the platform. When the seed names a "person": describe ONLY the scene, pose energy, expression vibe, lighting, camera angle, environment and WARDROBE (clothes/accessories). CRITICAL — do NOT describe gender, age, body type, face, hair, skin, ethnicity or any physical appearance (androgenous names must never be guessed as male/female in the prompt). Identity is locked later from reference photos. EXCEPTION: when the seed's media is "text", leave "image_prompt" as an empty string. Never invent a different human than the named person; if the seed has no person, do not invent an anonymous model either — keep the scene without a stranger's face.
- IMAGE CRAFT (single images): pick ONE focal subject and compose around it — leave roughly a third of the frame as calm negative space (sky, wall, clean surface) on one side, so the image breathes in the feed and a headline has somewhere to live. Never fill the frame edge-to-edge with competing elements.
- ON-IMAGE TEXT: the renderer garbles any text it has to invent — this is its classic failure. If (and only if) the design needs words in the image, use AT MOST 4 words and put the EXACT string in double quotes inside the image_prompt (e.g. …with the headline "MENO SPRECHI" in bold brand type). No quoted string in the prompt = state that the image contains NO text. EXCEPTION — a seed whose ART DIRECTION is a lettered medium (comic panels, poster, editorial typography): words are part of the form, so one short lettered line per panel is allowed. The obligation is the SAME and it is absolute: name the balloon or caption box ONLY together with its exact words in double quotes, in the brand's language, short enough to letter (a line, never a paragraph). Asking for "a hand-lettered caption box" without the words in it is the WORST case, not a lighter one — the renderer fills the empty box with invented English.
- LIBRARY MEDIA: when a seed carries "library_media: <uuid> (use_as_is)", the user's real photo WILL be published as the post image — set "image_prompt" to a short note like "Use library asset as-is" (it will not be rendered by AI). When mode is "(composite)", write an image_prompt that INTEGRATES that exact uploaded asset pixel-faithfully into a branded social frame (keep the subject identical; only add layout/branding around it) — never invent a replacement subject.
- STORY BEATS: when a seed carries them, they are BINDING and they are the post. Slide k renders beat k — same order, same count, nothing merged, nothing added, nothing reordered. You write how each beat is SHOWN (framing, gesture, what is in the panel, the words lettered in it); you never rewrite what it says. The caption serves the story, it does not repeat it slide by slide.
- LETTERING CARRIES THE STORY: on a seed that has STORY BEATS in a drawn or lettered medium, the words are not decoration — they are how the beat is told. Every slide letters its own beat as ONE short line inside the panel, quoted VERBATIM in the brand's language, SIX WORDS OR FEWER — past that the renderer stutters and repeats a word, which is how a panel came back reading "come se fosse normale. normale." A slide that renders the beat mutely and leaves the words to the caption is a picture, not a panel: the reader scrolls the images and understands nothing.
- WHO SPEAKS: a line inside a balloon belongs to whoever says it out loud, and the prompt must NAME them and say the tail points at them ("balloon from the barber, tail pointing at the barber, reading \"…\""). Unsaid, the renderer hangs every balloon on the protagonist, and a question someone asks HER comes back as her own words — the meaning inverts. A line she only thinks is never a balloon: it is a rectangular caption box, and the prompt says so.
- THE CAST STAYS THE SAME PERSON: when the ART DIRECTION names a recurring protagonist, copy that description VERBATIM into EVERY slide prompt of the post, word for word, before describing what happens in that slide. It is the only thing keeping the same character across the series — paraphrase it and slide three comes back a different person in a different place. One exception, and only this one: when a BEAT changes something the description fixes (the haircut happens, the coat comes off), the beat wins from that slide on, and the rest of the description still holds word for word.
- ART DIRECTION: when a seed carries one, it OVERRIDES the brand's VISUAL STYLE for that post — medium, page grammar and palette come from there. A seed drawn as comic panels comes back as comic panels: never a photograph, never "photorealistic", and never softened back toward the brand's default look for consistency. Repeat the medium words verbatim in EVERY slide prompt of that post, or the renderer drifts to a photo by slide three.
- CAROUSEL seeds (meta says "carousel of N slides"): fill "slide_prompts" with EXACTLY N prompts forming one coherent visual series — same medium, palette, lighting and art direction across all slides, grounded in the scene you chose (the seed's proposal, or your justified deviation); slide 1 is the hook/cover, each later slide advances the angle one concrete step, and every prompt describes its slide standalone. CAROUSEL CRAFT (hard): the COVER must read at THUMBNAIL size — one subject, large simple shapes, high contrast, at most 4 quoted words of text; each later slide carries exactly ONE idea (a slide that needs two sentences to describe is two slides); and repeat the SAME 2-3 continuity tokens (palette words, recurring motif, lighting phrase) verbatim in EVERY slide prompt so the rendered series reads as one object, not N unrelated images. Set "image_prompt" to the slide-1 prompt. Non-carousel seeds get an empty "slide_prompts" array.
- Add complementary copy: 1-2 "alt_captions" (a different angle on the same post), a "first_comment" (extra hashtags or a CTA/question; empty string if not useful), and 1-2 "hook_variants" (alternative opening lines).
- SHORT-NETWORK CUTS: also write "x_caption" (the same post, max 280 characters, one tight line, 0-2 hashtags) and "threads_caption" (the same post, max 500 characters, conversational) so the post can be cross-posted without being cut off. Same angle and facts as the main caption — compress, never invent. If the seed's own platform IS X (or Threads), leave that field empty. When the seed carries a link, keep the EXACT url in these cuts too and count it in the character budget.
- LINK: when a seed carries a "link: <url>", weave that EXACT url into the caption naturally (a short lead-in like "more here:" or in-line where it fits the flow) — it's a real page on the brand's site and clickable on that platform. Use the url verbatim, never alter or shorten it, and include it in the alt_captions too. Seeds with NO link get no url.
Do not reorder, merge or drop seeds.
${knowledgeBlock ? `\n${knowledgeBlock}\nUse facts from the brand material only when they strengthen the angle; never invent citations.\n` : ''}
SEEDS:
${seedLines}

Return JSON with a "posts" array in the SAME ORDER as the seeds.`;

  // MiMo ultraspeed quando il provider è Xiaomi.
  const fastModel = AI_PROVIDER === 'xiaomi' ? XIAOMI_ULTRASPEED_MODEL : undefined;
  const parsed: AnyRec = await aiStructured(
    ai,
    prompt,
    EXEC_SCHEMA,
    prefs.personality?.trim()
      ? 'You are an expert performance-marketing copywriter. Honour the brand personality above all; be specific, on-brand, visual and original. Zero marketing clichés. One post per seed, same order.'
      : 'You are an expert performance-marketing copywriter with a sharp, original voice. Apply the strategy precisely; be specific, on-brand and visual. Default to a fairly cynical, dry register with ALWAYS-subtle wit and zero marketing clichés or hype. One post per seed, same order.',
    'executePlan',
    { model: fastModel }
  );
  const out: Array<{ caption?: string; title?: string; image_prompt?: string; slide_prompts?: string[]; alt_captions?: string[]; x_caption?: string; threads_caption?: string; first_comment?: string; hook_variants?: string[]; scene_deviation?: string }> =
    Array.isArray(parsed.posts) ? parsed.posts : [];
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const posts = strategy.seeds.map((seed, i) => {
    const post = seedToPost(seed);
    post.caption = String(out[i]?.caption ?? '');
    // image_prompt solo per i post immagine, mai per text o link.
    if (out[i]?.title) post.title = String(out[i].title);
    post.image_prompt = post.media === 'text' || post.media === 'link' ? '' : sealOnImageText(String(out[i]?.image_prompt ?? ''));
    // Mai fisico sessuato in un prompt person-led: il renderer segue il testo più dei riferimenti.
    if (post.person && post.image_prompt) post.image_prompt = scrubPersonAppearance(post.image_prompt);
    // Un post immagine DEVE avere un image_prompt: il copywriter a volte lo lascia vuoto quando
    // l'angolo del seed diceva "text-only" prima che il reviewer girasse media a image, e resta un
    // post immagine senza niente da renderizzare.
    if (post.media === 'image' && !post.image_prompt.trim()) {
      const scene = [seed.subject, seed.setting, seed.props].map((s) => String(s ?? '').trim()).filter(Boolean).join(', ');
      const productBit = seed.product ? `the product "${seed.product}"` : 'the subject';
      const medium = seed.art_direction?.trim() ? seed.art_direction.trim() : 'Photorealistic, scroll-stopping product photo';
      post.image_prompt = `${medium}${medium.endsWith('.') ? '' : '.'} Subject: ${productBit}${scene ? `: ${scene}` : ''}. ${seed.angle ? `Convey: ${seed.angle}.` : ''}`.trim();
    }
    // Cover = slide 1. Un carosello con meno di 2 slide usabili non è un carosello: si degrada a
    // immagine singola, non si spedisce mezza serie.
    if (post.format === 'carousel') {
      const want = Math.max(CAROUSEL_MIN_SLIDES, Math.min(carouselMaxSlides(), seed.slide_count ?? 5));
      let slides = strArr(out[i]?.slide_prompts).slice(0, want).map(sealOnImageText);
      if (post.person) slides = slides.map(scrubPersonAppearance);
      if (slides.length >= 2) {
        post.image_prompts = slides;
        post.image_prompt = post.image_prompt.trim() || slides[0];
      } else {
        post.format = 'single_image';
      }
    }
    post.alt_captions = strArr(out[i]?.alt_captions);
    // Tenuti solo se davvero usabili: entro il limite, diversi dalla caption principale e non
    // per la piattaforma del post stesso.
    // ponytail: the copy chief (PASS 2.5) may later rewrite the main caption without touching these
    // cuts — same angle, so they stay valid; re-cut them there if the rewrites ever drift on facts.
    const cuts: Record<string, string> = {};
    for (const [key, field] of [['x', out[i]?.x_caption], ['threads', out[i]?.threads_caption]] as const) {
      const text = String(field ?? '').trim();
      const limit = PLATFORM_CHAR_LIMITS[key];
      if (text && text !== post.caption.trim() && text.length <= limit && post.platform !== key) cuts[key] = text;
    }
    if (Object.keys(cuts).length) post.platform_captions = cuts;
    post.first_comment = String(out[i]?.first_comment ?? '');
    post.hook_variants = strArr(out[i]?.hook_variants);
    // La deviazione dichiarata viaggia fino a posts.qc.scene_deviation, così la review mostra
    // perché il produttore non ha seguito il seed.
    const dev = String(out[i]?.scene_deviation ?? '').trim();
    if (dev) post.sceneDeviation = dev;
    if (knowledgeChunkIds.length) post.knowledgeChunkIds = knowledgeChunkIds;
    return post;
  });

  // PASS 2.5. L'angolo di ogni seed viaggia come i fatti ammessi di QUEL post: un seed Radar
  // porta lì i fatti della fonte, e il chief non deve togliere ciò che la fonte sostiene.
  const seedBriefs = strategy.seeds.map((s, i) => `${i}. ${String(s.angle ?? '').slice(0, 500)}`).join('\n');
  return reviewCaptions(ai, profile, posts, prefs, seedBriefs);
}

// Compact verdict the copy chief returns per caption it wants to rewrite.
const CAPTION_REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    fixes: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const, description: '0-based index of the post to fix.' },
          reason: { type: 'string' as const, description: 'Short why (e.g. "invents free shipping", "LinkedIn caption is two lines", "same hook as post 1", "wrong language").' },
          caption: { type: 'string' as const, description: 'The FULL rewritten caption (never a diff or an instruction).' }
        },
        required: ['index', 'reason', 'caption']
      }
    }
  },
  required: ['fixes']
};

// PASS 2.5 — il COPY CHIEF, l'unico che vede il batch INTERO (executePlan non lo rilegge mai) e
// coglie i fallimenti che un writer one-shot non può cogliersi da solo: fatti inventati, registro
// o lunghezza sbagliati per la piattaforma, lingua mista, cliché, e monotonia di batch (due
// caption che aprono con lo stesso pattern). Riscrive solo ciò che segnala, in loco, e non lancia
// mai — una review mancante è meglio di un batch perso.
async function reviewCaptions(
  ai: GoogleGenAI,
  profile: BrandProfile,
  posts: PreviewPost[],
  prefs: ContentPrefs = {},
  // Allineati per indice: ciò che il brief del singolo post sostiene è legittimo per quel post
  // anche se assente dai fatti del brand.
  seedBriefs = ''
): Promise<PreviewPost[]> {
  try {
    const withCaptions = posts.filter((p) => p.caption?.trim());
    if (withCaptions.length === 0) return posts;
    // Serve alla guardia anti-duplicato: un rewrite finito sull'indice sbagliato si ripara solo
    // tornando alla caption che quel post aveva davvero.
    const originalCaptions = posts.map((p) => String(p.caption ?? ''));

    // La verità contro cui si verificano le affermazioni: prodotti CON prezzo, e gli annunci.
    const products = (Array.isArray(profile?.products) ? profile.products : []).slice(0, 20);
    const factLines = [
      profile?.about ? `About: ${String(profile.about).slice(0, 400)}` : '',
      products.length
        ? `Offerings (the ONLY products/services that exist, with their real pricing):\n${products
            .map((p: AnyRec) => `- ${p?.name ?? p?.title}${p?.pricing ? ` (${p.pricing})` : ' (no public price)'}`)
            .join('\n')}`
        : 'Offerings: none — captions must not name or price any specific product.',
      Array.isArray(profile?.announcements) && profile.announcements.length
        ? `Real recent announcements:\n${profile.announcements.slice(0, 6).map((a: AnyRec) => `- ${a?.title}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n');

    const language = (prefs.language || profile?.language || '').trim();
    const playbook = platformPlaybook(posts.map((p) => p.platform), prefs);
    const captionList = posts
      .map((p, i) => {
        const reddit =
          platformKey(p.platform) === 'reddit'
            ? ` | subreddit: r/${p.subreddit || '(MISSING)'} | title: ${p.title || '(MISSING)'}`
            : '';
        const tags = [...String(p.caption ?? '').matchAll(/#[\p{L}0-9_]+/gu)].map((m) => m[0]);
        return `${i}. [${platformKey(p.platform)}${p.person ? ` · person: ${p.person}` : ''}${p.product ? ` · product: ${p.product}` : ''}${reddit}]\nHASHTAGS: ${tags.length ? tags.join(' ') : '(none)'}\n${p.caption || '(no caption)'}`;
      })
      .join('\n\n');

    const hashtagGate = Object.entries(prefs.platformHashtags ?? {})
      .filter(([, tags]) => Array.isArray(tags) && tags.some(Boolean))
      .map(([plat, tags]) => `- ${plat}: ONLY ${(tags as string[]).filter(Boolean).join(' ')} (or no hashtags)`)
      .join('\n');

    // I tell si contano in codice e il chief li riceve già calcolati: un flag non è un'opinione —
    // o si riscrive, o il chief deve dire perché il flag è sbagliato.
    const tellLines = posts
      .map((p, i) => {
        const tells = detectCaptionTells(p.caption ?? '', p.platform);
        return tells.length ? `- caption ${i}: ${tells.join(', ')}` : '';
      })
      .filter(Boolean);
    const ctaEcho = detectCtaEcho(posts.map((p) => p.caption ?? ''));
    if (ctaEcho.length) tellLines.push(`- CTA echo: captions ${ctaEcho.join(', ')} close on the same CTA formula — vary all but one.`);
    if (tellLines.length) console.warn(`[reviewCaptions] AI-tell flags:\n${tellLines.join('\n')}`);
    const tellBlock = tellLines.length
      ? `\nDETERMINISTIC FLAGS (computed in code, not opinions — legend: em_dash = >1 em-dash, emoji:N = over the platform cap, banned_opener = template opening ("Scopri…"/"Immagina…"), long_first_line:N = first line takes N words to say something, tricolon_ending = closes on a three-beat list, CTA echo = same closing formula across the batch). A flagged caption MUST appear in "fixes" with that tell removed, unless the flag is plainly a false positive:\n${tellLines.join('\n')}\n`
      : '';

    const prompt = `You are a strict copy chief reviewing the ${posts.length} social captions a copywriter just wrote for this brand, BEFORE they ship. Audit the batch and list ONLY the captions that must be rewritten, each with its full replacement.

Brand: ${profile?.name ?? ''}
BRAND FACTS (claims a caption may always make):
${factLines}
${seedBriefs ? `PER-POST SEED BRIEFS (index-aligned; facts carried by a post's OWN brief — e.g. a news source it reacts to — are LEGITIMATE for that post and must be KEPT, not stripped):\n${seedBriefs}\n` : ''}${language ? `LANGUAGE: every caption must be entirely in ${language}.` : 'LANGUAGE: each caption must be in the brand\'s own language, never mixed.'}
${playbook}
${houseVoiceFor(prefs)}
${hashtagGate ? `HASHTAG PREFS (hard):\n${hashtagGate}\n` : ''}
CAPTIONS:
${captionList}
${tellBlock}
Rewrite a caption when:
- It states a FACT supported by NEITHER the brand facts NOR the post's own seed brief — an invented price, discount, "free shipping", feature, award or claim. Rewrites must drop the invented claim, never replace it with another invention. Facts from the post's seed brief are fine and should stay specific — never genericise a news reference the seed supports.
- It violates its platform's register/length (see playbook — e.g. a LinkedIn post of one or two lines, an X post over 280 characters).
- It is in the wrong language or mixes languages.
- It leans on marketing clichés or hype the house bar bans.
- It carries an AI TELL by name (see the deterministic flags above): weak hook (first line does not earn the stop in ≤6 words, or opens on "Scopri/Discover/Immagina"), em-dash cadence (more than one —), a tricolon ending, an empty superlative with no proof in the same sentence, or emoji spray (>2, or any on LinkedIn/X/Reddit). The rewrite removes the tell without flattening the voice.
- It ignores an explicit brand personality in favour of generic dry-agency cynicism.
- It opens with the same hook pattern as another caption in this batch — vary the weaker one. Same for CTA SAMENESS: two captions closing on the same ask formula → vary all but the strongest.
- HASHTAGS: it uses tags outside the brand-approved set for that platform (when a set exists) — rewrite with only approved tags or none.
- REDDIT: missing title/subreddit, marketing tone, hashtags, or self-promo + URL spam risk — rewrite as a community-native member post (keep title/subreddit fields intact via the caption body only; title/subreddit are structural).
Keep good captions out of "fixes". A rewrite keeps the post's angle and platform register; it never changes which product/person the post is about. Return JSON.`;

    const parsed: AnyRec = await structured(ai, prompt, CAPTION_REVIEW_SCHEMA, undefined, {
      label: 'reviewCaptions',
      // Chiamata di verdetto, non prosa da leggere: lasciata libera ragionava 9x l'output che
      // produceva, e il thinking si paga a tariffa output.
      thinkingLevel: judgeThinkingLevel()
    });
    const fixes: AnyRec[] = Array.isArray(parsed.fixes) ? parsed.fixes : [];
    for (const fix of fixes) {
      const i = Number(fix?.index);
      const post = posts[i];
      // Il chief vede l'header di lista e a volte lo ricopia: l'impalcatura si strappa in codice.
      const caption = stripJudgeScaffolding(String(fix?.caption ?? ''));
      if (!post || !caption) continue;
      console.warn(`[reviewCaptions] rewrote caption ${i}: ${String(fix?.reason ?? '')}`);
      post.caption = caption;
      // I tagli corti restano in sincrono quando il chief supera i limiti di X/Threads.
      const plats = Array.isArray(post.platforms) && post.platforms.length
        ? post.platforms
        : [post.platform];
      const cuts = ensureShortNetworkCuts(post.caption, plats, post.platform_captions ?? null);
      if (cuts) post.platform_captions = cuts;
    }

    // PASS 2.6 — il PANEL. Il chief è binario (segnalata o spedita) e lascia intatta tutta la
    // fascia competente-e-dimenticabile: il panel la itera su un'obiezione specifica per giro.
    await runCopyPanel(ai, posts, { profile, prefs, factLines, language, playbook });

    // Un judge può restituire una riscrittura con l'INDICE sbagliato, e due post escono con la
    // stessa identica caption — peggio di qualsiasi caption mediocre. Il duplicato torna alla SUA
    // caption pre-judge, mai a quella di un altro post; se erano già identiche dal writer, tocca
    // al chief accorgersene.
    for (const i of findJudgeDuplicates(posts.map((p) => String(p.caption ?? '')), originalCaptions)) {
      console.warn(`[reviewCaptions] duplicate caption after judges on ${i} — restored its pre-judge caption`);
      posts[i].caption = originalCaptions[i];
      const plats = Array.isArray(posts[i].platforms) && posts[i].platforms!.length ? posts[i].platforms! : [posts[i].platform];
      const cuts = ensureShortNetworkCuts(posts[i].caption, plats, posts[i].platform_captions ?? null);
      if (cuts) posts[i].platform_captions = cuts;
    }

    // Igiene deterministica (hashtag + Reddit): fail-open.
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!post?.caption?.trim()) continue;
      // I tag acchiappa-reach cadono comunque: un set approvato riguarda i tag DEL BRAND, e
      // nessuno approva #fyp di proposito.
      const deTagged = stripReachChasingHashtags(post.caption);
      if (deTagged !== post.caption) {
        console.warn(`[reviewCaptions] stripped reach-chasing hashtags on ${i}: ${reachChasingHashtags(post.caption).join(' ')}`);
        post.caption = deTagged;
      }
      const tagCheck = assertHashtagPrefs(post.caption, post.platform, prefs);
      if (!tagCheck.ok) {
        const cleaned = stripDisallowedHashtags(post.caption, post.platform, prefs);
        console.warn(
          `[reviewCaptions] stripped disallowed hashtags on ${i}: ${tagCheck.bad.join(' ')}`
        );
        post.caption = cleaned;
        const plats = Array.isArray(post.platforms) && post.platforms.length ? post.platforms : [post.platform];
        const cuts = ensureShortNetworkCuts(post.caption, plats, post.platform_captions ?? null);
        if (cuts) post.platform_captions = cuts;
      }
      if (platformKey(post.platform) === 'reddit') {
        const reddit = assertRedditCraft({
          subreddit: post.subreddit,
          title: post.title,
          caption: post.caption
        });
        if (!reddit.ok) {
          console.warn(`[reviewCaptions] reddit hygiene flags on ${i}: ${reddit.errors.join('; ')}`);
          (post as AnyRec).__attention = [
            (post as AnyRec).__attention,
            `Reddit hygiene: ${reddit.errors.join('; ')}`
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 300);
        }
      }
    }
    return posts;
  } catch (e) {
    console.error(`[reviewCaptions] failed: ${e instanceof Error ? e.message : String(e)}`);
    return posts;
  }
}

/**
 * Muta `posts[i].caption` in loco tenendo il tentativo col punteggio MIGLIORE, non l'ultimo: una
 * iterazione può risolvere l'obiezione e rompere qualcosa che il panel aveva già promosso, e
 * spedire l'ultimo tentativo farebbe di un passo di qualità un lancio di moneta. Best-effort.
 */
async function runCopyPanel(
  ai: GoogleGenAI,
  posts: PreviewPost[],
  ctx: { profile: BrandProfile; prefs: ContentPrefs; factLines: string; language: string; playbook: string }
): Promise<void> {
  if (env.COPY_PANEL_ENABLED === 'false') return;
  const best = new Map<number, PanelVerdict>();

  try {
    for (let round = 1; round <= COPY_PANEL_MAX_ROUNDS; round++) {
      // Il giro 1 giudica tutto; i successivi solo ciò che è ancora nella fascia di mezzo.
      const targets =
        round === 1
          ? posts.map((p, i) => i).filter((i) => posts[i]?.caption?.trim())
          : toIterate([...best.values()], round - 1).map((v) => v.index);
      if (!targets.length) break;

      const list = targets
        .map((i) => {
          const objection = round > 1 ? best.get(i)?.objection : '';
          return `${i}. [${platformKey(posts[i].platform)}]${objection ? `\nOBIEZIONE DA RISOLVERE IN QUESTO GIRO (una sola, non riaprire il resto): ${objection}` : ''}\n${posts[i].caption}`;
        })
        .join('\n\n');

      const prompt = `Sei un panel di cinque lettori che giudica le caption social di questo brand PRIMA che escano. Ogni prospettiva assegna 0-20; il totale fa 100.

Brand: ${ctx.profile?.name ?? ''}
FATTI DEL BRAND (l'unica base per qualunque claim):
${ctx.factLines}
${ctx.language ? `LINGUA: ogni caption deve restare interamente in ${ctx.language}.` : ''}
${ctx.playbook}
${houseVoiceFor(ctx.prefs)}

LE CINQUE PROSPETTIVE
- Lo scettico (0-20): un lettore sveglio, occupato e diffidente ci crederebbe? Affonda su superlativi non sostenuti e claim senza prova accanto.
- L'estraneo (0-20): letta a freddo, senza il resto del feed, arriva in tre secondi? Affonda se serve contesto per avere senso.
- Il concorrente (0-20): un rivale potrebbe incollarci sopra il proprio logo senza cambiare una parola? Se sì il voto è basso: non è posizionamento, è decorazione. È il test più affilato dei cinque, applicalo davvero.
- Il buyer (0-20): parla di ciò che preoccupa lui, o di ciò di cui il brand è orgoglioso? Affonda sul secondo.
- L'editor (0-20): ogni parola porta un carico? Affonda su avverbi, esitazioni, preamboli, riempitivi — e sui TELL DA AI: più di un trattino em (—), chiusa a tricolon ("Non X. Non Y. Solo Z."), aperture da template ("Scopri…", "Immagina…"), superlativi senza prova nella stessa frase, pioggia di emoji. Un testo che si riconosce come scritto da un'AI non supera l'editor, per quanto pulito.

REGOLE
- Sotto 70 la caption si riscrive dall'angolo, non si lucida.
- Fra 70 e 84 è una candidata alla RISCRITTURA su UNA sola obiezione: quella più forte. Non aprirne cinque.
- Da 85 in su è pronta: restituisci caption vuota e non toccarla.
- Una riscrittura mantiene angolo, piattaforma, lingua e fatti. Non introduce MAI un fatto nuovo.
${round > 1 ? '- Questo è un giro di iterazione: risolvi SOLO l\'obiezione indicata sopra ogni caption, poi rivota tutte e cinque le prospettive sul risultato.' : ''}

CAPTION:
${list}

Restituisci JSON.`;

      const parsed: AnyRec = await structured(ai, prompt, COPY_PANEL_SCHEMA, undefined, {
        label: `copyPanel:r${round}`,
        thinkingLevel: judgeThinkingLevel()
      });
      const verdicts = (Array.isArray(parsed.verdicts) ? parsed.verdicts : [])
        .map(normalizeVerdict)
        .filter((v): v is PanelVerdict => !!v && !!posts[v.index]?.caption);
      if (!verdicts.length) break;

      for (const v of verdicts) {
        const merged = bestOf(best.get(v.index), v);
        best.set(v.index, merged);
        // Una riscrittura atterra solo se il tentativo che l'ha prodotta è il migliore finora.
        if (merged === v && v.caption && bandOfScore(v.total) !== 'ship') {
          posts[v.index].caption = v.caption;
          const plats = Array.isArray(posts[v.index].platforms) && posts[v.index].platforms!.length
            ? posts[v.index].platforms!
            : [posts[v.index].platform];
          const cuts = ensureShortNetworkCuts(posts[v.index].caption, plats, posts[v.index].platform_captions ?? null);
          if (cuts) posts[v.index].platform_captions = cuts;
        }
      }

      // Ciò che il panel voleva uccidere prende la riscrittura anche all'ultimo giro: una caption
      // sotto 70 spedita intatta è l'unico esito peggiore di una riscrittura imperfetta.
      for (const v of toReplace(verdicts)) {
        if (v.caption) posts[v.index].caption = v.caption;
      }
    }

    if (best.size) console.warn(`[copyPanel] ${panelSummary([...best.values()])}`);
  } catch (e) {
    console.error(`[copyPanel] failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
