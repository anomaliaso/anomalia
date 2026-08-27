import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { reviseArticleBody, reviseSelectedPassage, replaceSelectedPassage, commitVersion, navVersion, loadChatState, type ArticleRow } from '$lib/server/blog-chat';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');
  const { data: brand } = await supabase.from('brands').select('id, name, content_prefs').eq('slug', params.brand).maybeSingle();
  if (!brand) throw error(404, 'Brand not found');
  // RLS scopes the read to the owner's brands.
  const { data: a } = await supabase
    .from('brand_articles')
    .select('id, brand_id, title, meta_title, meta_description, body_md, version_seq, cover_image')
    .eq('id', params.id)
    .maybeSingle();
  if (!a || a.brand_id !== brand.id) throw error(404, 'Article not found');

  const article = a as ArticleRow & { cover_image?: string | null };
  const admin = createAdminClient();
  const payload = await request.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const language = ((brand.content_prefs as any)?.language as string) || 'Italian';
  const isIt = /^ital/i.test(language);

  if (payload.action === 'revise') {
    const instruction = String(payload.instruction ?? '').trim();
    if (!instruction) throw error(400, 'Empty instruction');
    const currentBodyMd = String(payload.bodyMd ?? article.body_md);
    const currentMetaTitle = String(article.meta_title ?? '');
    const currentMetaDescription = String(article.meta_description ?? '');
    const { reply, bodyMd, title, metaTitle, metaDescription } = await reviseArticleBody(admin, brand, { instruction, currentBodyMd, currentTitle: article.title, currentMetaTitle, currentMetaDescription, language });
    const seq = await commitVersion(admin, article, { baseBodyMd: currentBodyMd, newBodyMd: bodyMd, title, metaTitle, metaDescription, instruction, reply });
    return json({ reply, bodyMd, title, metaTitle, metaDescription, seq, ...(await loadChatState(admin, article.id, seq)) });
  }

  // Rewrite only a user-selected passage, then splice it back into the article markdown.
  if (payload.action === 'editSelection') {
    const instruction = String(payload.instruction ?? '').trim();
    const selectedText = String(payload.selectedText ?? '').trim();
    if (!instruction) throw error(400, 'Empty instruction');
    if (!selectedText) throw error(400, 'Empty selection');

    const currentBodyMd = String(payload.bodyMd ?? article.body_md);
    // Soft check — replaceSelectedPassage also does a whitespace-normalized match.
    const { reply, revisedText } = await reviseSelectedPassage(admin, brand, {
      instruction,
      selectedText,
      currentBodyMd,
      language
    });
    const newBodyMd = replaceSelectedPassage(currentBodyMd, selectedText, revisedText);
    if (newBodyMd == null) throw error(400, 'Selection not found in article');

    const loggedInstruction = isIt ? `[Testo] ${instruction}` : `[Text] ${instruction}`;
    const seq = await commitVersion(admin, article, {
      baseBodyMd: currentBodyMd,
      newBodyMd,
      title: article.title,
      metaTitle: String(article.meta_title ?? ''),
      metaDescription: String(article.meta_description ?? ''),
      instruction: loggedInstruction,
      reply
    });
    return json({
      reply,
      bodyMd: newBodyMd,
      revisedText,
      seq,
      ...(await loadChatState(admin, article.id, seq))
    });
  }

  // Edit a specific cover or body image with Nano Banana, then replace that image in place.
  if (payload.action === 'editImage') {
    const instruction = String(payload.instruction ?? '').trim();
    const imageUrl = String(payload.imageUrl ?? '').trim();
    const target = payload.target === 'cover' ? 'cover' : 'body';
    if (!instruction) throw error(400, 'Empty instruction');
    if (!imageUrl) throw error(400, 'Missing image');

    const currentBodyMd = String(payload.bodyMd ?? article.body_md);
    if (target === 'cover' && article.cover_image && article.cover_image !== imageUrl) {
      throw error(400, 'Cover mismatch');
    }
    if (target === 'body' && !currentBodyMd.includes(imageUrl)) {
      throw error(400, 'Image not found in article');
    }

    const { editArticleImage, replaceMarkdownImageUrl } = await import('$lib/server/content-preview');
    const newUrl = await editArticleImage(admin, brand, {
      baseImageUrl: imageUrl,
      feedback: instruction,
      title: article.title,
      summary: article.meta_description ?? undefined
    });
    if (!newUrl) throw error(502, 'Image edit failed');

    const label = target === 'cover' ? (isIt ? 'copertina' : 'cover') : (isIt ? 'immagine nel testo' : 'in-article image');
    const reply = isIt
      ? `Ho aggiornato la ${label} in base alla tua richiesta.`
      : `I updated the ${label} based on your request.`;
    const loggedInstruction = target === 'cover'
      ? (isIt ? `[Copertina] ${instruction}` : `[Cover] ${instruction}`)
      : (isIt ? `[Immagine] ${instruction}` : `[Image] ${instruction}`);

    if (target === 'cover') {
      const { error: upErr } = await admin
        .from('brand_articles')
        .update({ cover_image: newUrl, updated_at: new Date().toISOString() })
        .eq('id', article.id)
        .eq('brand_id', brand.id);
      if (upErr) throw error(500, upErr.message);
      // Persist the exchange in version history so the chat transcript survives reload.
      // Body content is unchanged; cover_image lives on the article row separately.
      const seq = await commitVersion(admin, article, {
        baseBodyMd: currentBodyMd,
        newBodyMd: currentBodyMd,
        title: article.title,
        metaTitle: String(article.meta_title ?? ''),
        metaDescription: String(article.meta_description ?? ''),
        instruction: loggedInstruction,
        reply
      });
      return json({
        reply,
        cover: newUrl,
        bodyMd: currentBodyMd,
        imageUrl: newUrl,
        previousImageUrl: imageUrl,
        target,
        seq,
        ...(await loadChatState(admin, article.id, seq))
      });
    }

    const newBodyMd = replaceMarkdownImageUrl(currentBodyMd, imageUrl, newUrl);
    const seq = await commitVersion(admin, article, {
      baseBodyMd: currentBodyMd,
      newBodyMd,
      title: article.title,
      metaTitle: String(article.meta_title ?? ''),
      metaDescription: String(article.meta_description ?? ''),
      instruction: loggedInstruction,
      reply
    });
    return json({
      reply,
      bodyMd: newBodyMd,
      imageUrl: newUrl,
      previousImageUrl: imageUrl,
      target,
      seq,
      ...(await loadChatState(admin, article.id, seq))
    });
  }

  if (payload.action === 'undo' || payload.action === 'redo') {
    const res = await navVersion(admin, article, payload.action);
    if (!res) return json({ noop: true });
    return json({ bodyMd: res.bodyMd, title: res.title, metaTitle: res.metaTitle, metaDescription: res.metaDescription, seq: res.seq, ...(await loadChatState(admin, article.id, res.seq)) });
  }

  throw error(400, 'Bad action');
};
