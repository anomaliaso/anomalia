import { swallow } from '$lib/server/swallow';
import { type AnyRec, type ImagePart, guidanceFor } from './seed-model';
import { BLOG_IMAGE_MODEL, PRODUCT_REF_IMAGES, aspectRatioFor, brandVisualDirective, distinctiveTokens, extractVisualPlaybook, loadBrandLogoImagePart, loadBrandMoodImageUrls, loadMoodRefs, renderBrandImage, loadProductRefs, normalizeOfferingName, renderPostImage, uploadPostImage } from './images';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchImagePart } from '$lib/server/brand-context';
import { structured } from '$lib/server/research';

// Perché le cover del blog restino fedeli a prodotti VERI invece di inventarli.
async function pickArticleProductRefs(
  admin: SupabaseClient,
  brandId: string,
  query: string,
  limit = 2
): Promise<{ name: string; images: string[] }[]> {
  const tokens = distinctiveTokens(query);
  if (!tokens.size) {
    // Senza parole distintive nella query, qualunque prodotto fotografato.
    const { data } = await admin.from('products').select('title, images').eq('brand_id', brandId).limit(40);
    return (data ?? [])
      .map((p) => ({
        name: String(p.title ?? '').trim(),
        images: Array.isArray(p.images) ? p.images.map(String).filter(Boolean) : []
      }))
      .filter((p) => p.name && p.images.length)
      .slice(0, limit);
  }

  // Pool ampio di soli titoli, punteggio in memoria: il catalogo può essere enorme.
  const { data } = await admin.from('products').select('title, images').eq('brand_id', brandId).limit(400);
  const scored = (data ?? [])
    .map((p) => {
      const name = String(p.title ?? '').trim();
      const images = Array.isArray(p.images) ? p.images.map(String).filter(Boolean) : [];
      if (!name || !images.length) return null;
      const ot = distinctiveTokens(name);
      const overlap = [...ot].filter((w) => tokens.has(w)).length;
      // Spinta morbida sui termini comuni a query e titolo.
      const soft = ['polo', 'patch', 'felpa', 'giubb', 'softshell', 'cappell', 'ricam', 'lavoro', 'tshirt', 'shirt']
        .filter((w) => normalizeOfferingName(query).includes(w) && normalizeOfferingName(name).includes(w)).length;
      const score = overlap * 3 + soft;
      return score > 0 ? { name, images, score } : null;
    })
    .filter(Boolean) as { name: string; images: string[]; score: number }[];
  scored.sort((a, b) => b.score - a.score);
  if (scored.length) return scored.slice(0, limit).map(({ name, images }) => ({ name, images }));

  // Nessun hit → un paio di foto vere lo stesso, così non si inventano prodotti.
  const { data: anyProds } = await admin.from('products').select('title, images').eq('brand_id', brandId).limit(40);
  return (anyProds ?? [])
    .map((p) => ({
      name: String(p.title ?? '').trim(),
      images: Array.isArray(p.images) ? p.images.map(String).filter(Boolean) : []
    }))
    .filter((p) => p.name && p.images.length)
    .slice(0, limit);
}

// Cover 16:9 per un articolo. Stesso ESATTO contesto di brand della pipeline dei post (stile,
// playbook, palette, mood), o le cover del blog non somiglierebbero ai post social. Col catalogo,
// le foto vere dei prodotti come riferimento invece di capi inventati.
export async function generateArticleCover(
  admin: SupabaseClient, brand: AnyRec, opts: { title: string; summary?: string }
): Promise<string | null> {
  const { data: kit } = await admin.from('brand_kit')
    .select('visual_style, ai_context, brand_colors, fonts').eq('brand_id', brand.id).maybeSingle();
  const moodUrls = await loadBrandMoodImageUrls(admin, brand.id).catch((error) => { swallow('load mood image urls', error); return []; });
  const products = await pickArticleProductRefs(admin, brand.id, `${opts.title} ${opts.summary ?? ''}`, 2).catch((error) => { swallow('pick product references', error); return []; });
  const [moodImages, referenceImages] = await Promise.all([
    loadMoodRefs(moodUrls),
    loadProductRefs(products.flatMap((p) => p.images).slice(0, PRODUCT_REF_IMAGES))
  ]);
  const fontNames = (Array.isArray(kit?.fonts) ? (kit!.fonts as AnyRec[]) : []).map((f) => f?.name).filter(Boolean) as string[];
  const productHint = products.length
    ? ` Feature the brand's REAL product(s) from the attached reference photo(s): ${products.map((p) => p.name).join(', ')}. Keep each product pixel-faithful (shape, colour, materials) — restyle only the scene/lighting.`
    : '';

  const prompt = `A striking editorial COVER / hero image for a blog article titled "${opts.title}".${opts.summary ? ` The article is about: ${String(opts.summary).slice(0, 220)}.` : ''}${productHint} Evocative, magazine-quality, a clear focal point with room to breathe. Absolutely NO text, letters, words, captions or logos anywhere in the image.`;
  const dataUrl = await renderPostImage(prompt, {
    aspectRatio: '16:9',
    model: BLOG_IMAGE_MODEL,
    visualStyle: (kit?.visual_style as string | undefined) || undefined,
    visualPlaybook: extractVisualPlaybook(kit?.ai_context) || undefined,
    brandLook: brandVisualDirective(kit?.brand_colors as string[] | null, fontNames) || undefined,
    moodImages,
    referenceImages,
    referenceMode: referenceImages?.length ? 'product' : undefined
  }).catch((error) => { swallow('render article cover', error); return undefined; });
  if (!dataUrl) return null;
  return (await uploadPostImage(admin, brand.id, dataUrl, '16:9')) ?? null;
}

/**
 * L'immagine attuale entra come `baseImage`, così il modello la rifinisce invece di inventare una
 * scena nuova — lo stesso percorso di fedeltà delle rigenerazioni dei post.
 */
export async function editArticleImage(
  admin: SupabaseClient,
  brand: AnyRec,
  opts: { baseImageUrl: string; feedback: string; title?: string; summary?: string }
): Promise<string | null> {
  const feedback = String(opts.feedback ?? '').trim();
  if (!feedback || !opts.baseImageUrl) return null;

  const { data: kit } = await admin.from('brand_kit')
    .select('visual_style, ai_context, brand_colors, fonts').eq('brand_id', brand.id).maybeSingle();
  const moodUrls = await loadBrandMoodImageUrls(admin, brand.id).catch((error) => { swallow('load mood image urls', error); return []; });
  const [moodImages, baseImage] = await Promise.all([
    loadMoodRefs(moodUrls),
    fetchImagePart(opts.baseImageUrl)
  ]);
  if (!baseImage) return null;

  const fontNames = (Array.isArray(kit?.fonts) ? (kit!.fonts as AnyRec[]) : []).map((f) => f?.name).filter(Boolean) as string[];
  const prompt = `Edit this blog article image based on the user's request. Keep the same subject, composition, framing and overall style — change ONLY what the feedback asks for.
Article title: "${opts.title ?? ''}"${opts.summary ? ` About: ${String(opts.summary).slice(0, 180)}.` : ''}
User request: ${feedback}
Absolutely NO text, letters, words, captions or logos anywhere in the image.`;

  // Nessun override: `baseImage` seleziona da sé il modello di fedeltà in buildImageRequest.
  const dataUrl = await renderPostImage(prompt, {
    aspectRatio: '16:9',
    visualStyle: (kit?.visual_style as string | undefined) || undefined,
    visualPlaybook: extractVisualPlaybook(kit?.ai_context) || undefined,
    brandLook: brandVisualDirective(kit?.brand_colors as string[] | null, fontNames) || undefined,
    moodImages,
    baseImage
  }).catch((error) => { swallow('render edited cover', error); return undefined; });
  if (!dataUrl) return null;
  return (await uploadPostImage(admin, brand.id, dataUrl, '16:9')) ?? null;
}

/** Replace every occurrence of an image URL inside article markdown (body illustrations). */
export function replaceMarkdownImageUrl(bodyMd: string, oldUrl: string, newUrl: string): string {
  if (!oldUrl || !newUrl || oldUrl === newUrl) return bodyMd;
  return bodyMd.split(oldUrl).join(newUrl);
}

/**
 * Le sezioni H2 da illustrare. Condivisa dal renderer sincrono e dal costruttore delle richieste
 * batch: se scegliessero diversamente, un articolo batch tornerebbe con le immagini sotto titoli
 * che nessuno aveva riservato.
 */
function articleImageTargets(bodyMd: string, max: number): { line: number; heading: string }[] {
  const lines = bodyMd.split('\n');
  const targets: { line: number; heading: string }[] = [];
  for (let i = 0; i < lines.length && targets.length < max; i++) {
    const m = /^##\s+(.+)$/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && /^!\[/.test(lines[j].trim())) continue; // section already has an image
    targets.push({ line: i, heading: m[1].trim() });
  }
  return targets;
}

// Immagini nel corpo, innestate dopo le prime sezioni H2 (saltando quelle che ne hanno già).
// Ancorate a un prodotto VERO del catalogo quando c'è. Alt text = il titolo della sezione, il che
// soddisfa anche il check alt-text del punteggio di qualità.
export async function generateArticleImages(
  admin: SupabaseClient,
  brand: AnyRec,
  opts: { title: string; bodyMd: string; max?: number; replaceExisting?: boolean }
): Promise<string> {
  const max = Math.max(1, Math.min(opts.max ?? 3, 4));
  let bodyMd = opts.bodyMd;
  // Via le immagini precedenti, per rigenerare con scatti fedeli al prodotto.
  if (opts.replaceExisting) {
    bodyMd = bodyMd
      .replace(/\n*!\[([^\]]*)\]\(([^)]+)\)\n*/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n');
  }
  const lines = bodyMd.split('\n');
  const targets = articleImageTargets(bodyMd, max);
  if (targets.length === 0) return opts.bodyMd;

  const { data: kit } = await admin.from('brand_kit')
    .select('visual_style, ai_context, brand_colors, fonts').eq('brand_id', brand.id).maybeSingle();
  const moodUrls = await loadBrandMoodImageUrls(admin, brand.id).catch((error) => { swallow('load mood image urls', error); return []; });
  const [moodImages] = await Promise.all([loadMoodRefs(moodUrls)]);
  const fontNames = (Array.isArray(kit?.fonts) ? (kit!.fonts as AnyRec[]) : []).map((f) => f?.name).filter(Boolean) as string[];
  const baseOpts = {
    aspectRatio: '16:9' as const,
    model: BLOG_IMAGE_MODEL,
    visualStyle: (kit?.visual_style as string | undefined) || undefined,
    visualPlaybook: extractVisualPlaybook(kit?.ai_context) || undefined,
    brandLook: brandVisualDirective(kit?.brand_colors as string[] | null, fontNames) || undefined,
    moodImages
  };

  const rendered = await Promise.all(
    targets.map(async (t) => {
      const products = await pickArticleProductRefs(admin, brand.id, `${opts.title} ${t.heading}`, 1).catch((error) => { swallow('pick product references', error); return []; });
      const referenceImages = await loadProductRefs(products.flatMap((p) => p.images).slice(0, PRODUCT_REF_IMAGES));
      const productHint = products.length
        ? ` Show the brand's REAL product from the attached reference: ${products.map((p) => p.name).join(', ')}. Keep it pixel-faithful — restyle only scene/lighting.`
        : '';
      const prompt = `An editorial image illustrating the section "${t.heading}" of a blog article titled "${opts.title}".${productHint} Evocative, magazine-quality, a clear focal point. Absolutely NO text, letters, words, captions or logos anywhere in the image.`;
      const dataUrl = await renderPostImage(prompt, {
        ...baseOpts,
        referenceImages,
        referenceMode: referenceImages?.length ? 'product' : undefined
      }).catch((error) => { swallow('render section image', error); return undefined; });
      if (!dataUrl) return null;
      const url = await uploadPostImage(admin, brand.id, dataUrl, '16:9');
      return url ? { line: t.line, md: `\n![${t.heading}](${url})\n` } : null;
    })
  );

  // Dal basso verso l'alto, o gli indici di riga precedenti si invalidano.
  const inserts = (rendered.filter(Boolean) as { line: number; md: string }[]).sort((a, b) => b.line - a.line);
  if (!inserts.length) return opts.bodyMd;
  for (const ins of inserts) lines.splice(ins.line + 1, 0, ins.md);
  return lines.join('\n');
}

// Qui vivevano `ArticleImageDest`, `buildArticleImageRequests` e `spliceImageUnderHeading`: il
// manifesto della Batch API di Google e il collettore che rimappava la risposta N sul suo articolo.
// Sono usciti con la Batch, che non ha mai renderizzato un'immagine in produzione. Il percorso in
// linea qui sopra ha il suo inserimento (`lines.splice`), e non e` mai passato di li`.

const REGEN_SCHEMA = {
  type: 'object' as const,
  properties: {
    caption: { type: 'string' as const, description: 'Revised on-brand caption with 2-3 hashtags' },
    image_prompt: { type: 'string' as const, description: 'Revised image description; empty string for text-only posts' }
  },
  required: ['caption', 'image_prompt']
};

// Rigenera un post dal feedback: caption (+ image_prompt) e poi l'immagine, se non è text-only.
// Best-effort sull'immagine: al fallimento `imageUrl` resta undefined e il chiamante tiene la vecchia.
export async function regeneratePost(opts: {
  supabase: SupabaseClient;
  userId: string;
  platform: string | null;
  caption: string | null;
  imagePrompt: string | null;
  feedback: string;
  textOnly: boolean;

  visualStyle?: string | null;
  // Nome + categoria del prodotto, così il QC può giudicare fedeltà e scala.
  productName?: string;
  productKind?: string;
  productImageUrls?: string[];
  // Gli scatti di riferimento del brand come ancore di stile, come nel batch.
  moodImageUrls?: string[];
  // Aperti: è il testo del feedback a decidere cosa prenderne. Ignorati sui post text-only.
  userReferenceImageUrls?: string[];
  // Palette + font, stessa direttiva del render di batch.
  brandColors?: string[] | null;
  brandFonts?: string[] | null;
  // Caption language (English name, e.g. "Italian"); empty = keep the current caption's language.
  language?: string | null;
  // Optional brand-authored per-platform instructions (content_prefs.platformInstructions), so a
  // regenerated caption respects the same length/voice rules as a freshly generated one.
  platformInstructions?: Record<string, string> | null;
  // Brand-approved hashtag set per platform (content_prefs.platformHashtags) — same constraint the
  // batch planner applies: only these hashtags, never invented ones.
  platformHashtags?: Record<string, string[]> | null;
  // The post's CURRENT image URL. When present, it's fed to the renderer as the BASE to edit, so the
  // feedback refines the existing image in place rather than producing an unrelated new one.
  baseImageUrl?: string | null;
  brandId?: string;
}): Promise<{ caption: string; imagePrompt: string; imageUrl?: string; notes?: string; costUsd?: number; credits?: number }> {
  const langLine = opts.language?.trim()
    ? `Write the caption in ${opts.language.trim()}.`
    : 'Keep the caption in the same language as the current caption.';
  // Per-platform length/register guidance (default + any brand override) so a regenerated LinkedIn
  // post stays long-form, an X post stays tight, etc.
  const guide = guidanceFor(opts.platform ?? '', { platformInstructions: opts.platformInstructions ?? undefined, platformHashtags: opts.platformHashtags ?? undefined });
  const guideLine = guide ? `\nPLATFORM GUIDANCE (write the caption to fit this): ${guide}` : '';
  // When we have the current image to edit, the image_prompt must describe the SAME image with the
  // feedback applied (not an unrelated new scene) — the renderer is handed the current image as the
  // base. Without a base image, ask for a full fresh description as before.
  const imagePromptInstruction = opts.textOnly
    ? ' and an empty "image_prompt"'
    : opts.baseImageUrl
      ? ' and a revised "image_prompt" that describes the CURRENT image with the user\'s feedback applied: keep the same subject, composition and style, and change ONLY what the feedback asks for (don\'t specify an aspect ratio — the renderer sizes it to the platform)'
      : ' and a revised "image_prompt" describing a photorealistic, scroll-stopping image (don\'t specify an aspect ratio — the renderer sizes it to the platform)';
  const prompt = `Revise this single social media post based on the user's feedback. Keep it on-brand and native to the platform.
Platform: ${opts.platform ?? ''}
Current caption: ${opts.caption ?? ''}
Current image description: ${opts.imagePrompt ?? '(none)'}
User feedback: ${opts.feedback}
${langLine}${guideLine}
Return JSON with the improved "caption"${imagePromptInstruction}.`;

  const parsed: AnyRec = await structured(prompt, REGEN_SCHEMA,
    'You are an expert performance-marketing content planner. Apply the feedback precisely; keep it on-brand.',
    { label: 'regeneratePost', brandId: opts.brandId, userId: opts.userId, context: 'regenerate_post' });
  const caption = (parsed.caption as string) || opts.caption || '';
  let imagePrompt = opts.textOnly ? '' : ((parsed.image_prompt as string) || opts.imagePrompt || '');

  let imageUrl: string | undefined;
  let notes: string | undefined;
  let costUsd: number | undefined;
  let credits: number | undefined;
  if (!opts.textOnly && imagePrompt) {
    // Always attach the official brand-kit logo when present — same as generateStandaloneImage /
    // design_graphic. The render prompt already says candid photos may omit on-image branding.
    let logoImage: ImagePart | undefined;
    if (opts.brandId) {
      const { data: logoKit } = await opts.supabase
        .from('brand_kit')
        .select('logos')
        .eq('brand_id', opts.brandId)
        .maybeSingle();
      logoImage = (await loadBrandLogoImagePart(logoKit?.logos)) ?? undefined;
    }

    // Fetch product refs, the current image (the edit base) and the brand mood refs together;
    // all are best-effort.
    const [refs, baseImage, moodImages, userRefs] = await Promise.all([
      Promise.all((opts.productImageUrls ?? []).slice(0, PRODUCT_REF_IMAGES).map(fetchImagePart)).then(
        (parts) => parts.filter(Boolean) as ImagePart[]
      ),
      opts.baseImageUrl ? fetchImagePart(opts.baseImageUrl) : Promise.resolve(null),
      loadMoodRefs(opts.moodImageUrls),
      Promise.all((opts.userReferenceImageUrls ?? []).slice(0, 4).map(fetchImagePart)).then(
        (parts) => parts.filter(Boolean) as ImagePart[]
      )
    ]);
    const renderOpts = {
      referenceImages: refs.length ? refs : undefined,
      baseImage: baseImage ?? undefined,
      moodImages,
      userRefImages: userRefs.length ? userRefs : undefined,
      logoImage,
      visualStyle: opts.visualStyle ?? undefined,
      brandLook: brandVisualDirective(opts.brandColors, opts.brandFonts) || undefined,
      aspectRatio: aspectRatioFor(opts.platform)
    };
    // Un render, come ovunque: niente critico e niente anello che ridisegna.
    const dataUrl = await renderBrandImage(imagePrompt, renderOpts);
    if (dataUrl) imageUrl = await uploadPostImage(opts.supabase, opts.userId, dataUrl, aspectRatioFor(opts.platform));
  }
  return { caption, imagePrompt, imageUrl, notes, costUsd, credits };
}
