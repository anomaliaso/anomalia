import { requireSession } from '../lib/auth.ts';
import { api, type PostPatch, type PostState } from '../lib/api.ts';
import { c, ok, warn, info, fail, table } from '../lib/display.ts';
import { parseKeyValuePairs } from '../lib/select.ts';

type Opts = {
  action?: string;
  caption?: string; imagePrompt?: string; platforms?: string; contentType?: string;
  format?: string; slot?: string; product?: string; scheduledFor?: string;
  title?: string; link?: string; subreddit?: string; firstComment?: string;
  media?: string; platformCaption?: string[];
  instruction?: string; prompt?: string; index?: string; order?: string;
  duration?: string; script?: string; aspectRatio?: string;
};

export async function cmdPost(slug: string, postId: string, opts: Opts) {
  const { access_token: t } = await requireSession();
  const action = opts.action ?? 'show';

  switch (action) {
    case 'show': return showPost(t, slug, postId);
    case 'edit': return editPost(t, slug, postId, opts);
    case 'approve': return api.approvePost(t, slug, postId).then(() => ok('Post approvato e schedulato.'));
    case 'reject': return api.deletePost(t, slug, postId).then(() => ok('Post eliminato.'));
    case 'publish': return publishNow(t, slug, postId);
    case 'reschedule': return reschedulePost(t, slug, postId, opts.scheduledFor);
    case 'render': return renderImage(t, slug, postId);
    case 'regenerate': return regenerate(t, slug, postId, opts);
    case 'slide': return editSlide(t, slug, postId, opts);
    case 'reorder': return reorder(t, slug, postId, opts);
    case 'video': return makeVideo(t, slug, postId, opts);
    default:
      fail(`Azione sconosciuta: ${action}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
${c.bold('Azioni Post:')}

  ${c.green('show')}                    Dettaglio post — testo, media, slide del carosello

  ${c.green('edit')}                    Modifica i campi (nessun render, nessun credito)
    --caption "..."             Caption
    --title "..."               Titolo (Reddit, carosello, link post)
    --link "https://..."        URL del link post ("" per rimuoverlo)
    --subreddit "r/..."         Subreddit di destinazione
    --firstComment "..."        Primo commento (hashtag / CTA)
    --imagePrompt "..."         Prompt immagine
    --media "https://..."       Media URL ("" per renderlo text-only)
    --format carousel           single_image | carousel | text_post | link_post | video
    --platforms "ig,linkedin"   Piattaforme di cross-post
    --platformCaption x="..."   Caption dedicata a una piattaforma (ripetibile)
    --slot "2026-06-20T10:00"   Slot orario
    --product "Nome"            Prodotto associato

  ${c.green('regenerate')}              Rigenera l'immagine ${c.dim('(post a immagine singola — costa un render)')}
    --instruction "sfondo più caldo"
    --prompt "..."              Prompt completo sostitutivo (invece del refine)

  ${c.green('slide')}                   Rigenera UNA slide del carosello ${c.dim('(costa un render)')}
    --index 2                   Slide da modificare (0 = copertina)
    --instruction "..."         Cosa cambiare
    --prompt "..."              Prompt completo sostitutivo

  ${c.green('reorder')}                 Riordina / elimina slide ${c.dim('(nessun render)')}
    --order "0,2,1"             Nuovo ordine per indice; ometti un indice per eliminarlo

  ${c.green('video')}                   Anima la cover in un clip ${c.dim('(costa budget video del mese)')}
    --duration 6                Secondi (1-15, default dal brand)
    --script "..."              Battuta parlata/on-screen, tagliata sulla durata
    --instruction "..."         Direzione del clip (camera, movimento, mood)
    --aspectRatio 9:16          9:16 | 1:1 | 16:9 | 4:3 | 3:4 | 21:9
    ${c.dim('Funziona anche per riprovare un video fallito rimasto foto.')}

  ${c.green('render')}                  Genera l'immagine mancante dal prompt
  ${c.green('approve')}                 Approva e schedula
  ${c.green('publish')}                 Pubblica subito
  ${c.green('reject')}                  Elimina (solo pending)
  ${c.green('reschedule')}              Riprogramma  --scheduledFor "2026-06-20T10:00"
`);
}

async function showPost(t: string, slug: string, postId: string) {
  const s: PostState = await api.getPostMedia(t, slug, postId);

  const kind = s.is_carousel ? `carosello · ${s.slide_count} slide`
    : s.text_only ? (s.link_url ? 'link post' : 'text post')
    : s.format === 'video' ? 'video' : 'immagine singola';

  console.log(`
${c.bold('Post')} ${c.dim(postId)}  ${c.cyan(kind)}

  Status:      ${s.status}
  Platform:    ${s.platform ?? '—'}${s.platforms?.length ? c.dim(` (+ ${s.platforms.join(', ')})`) : ''}
  Format:      ${s.format ?? '—'}${s.content_type ? c.dim(` / ${s.content_type}`) : ''}`);

  if (s.title) console.log(`  Titolo:      ${s.title}`);
  if (s.link_url) console.log(`  Link:        ${s.link_url}`);
  if (s.subreddit) console.log(`  Subreddit:   ${s.subreddit}`);
  console.log(`  Caption:     ${s.caption ?? c.dim('—')}`);
  if (s.first_comment) console.log(`  1° commento: ${s.first_comment}`);
  if (!s.is_carousel) {
    console.log(`  Media:       ${s.media_url ?? c.dim('— (nessuna immagine)')}`);
    if (s.image_prompt) console.log(`  Prompt:      ${c.dim(s.image_prompt.slice(0, 120))}`);
  }
  console.log();

  if (s.slides?.length) {
    table(
      ['#', 'img', 'prompt'],
      s.slides.map((sl) => [
        sl.index === 0 ? `${sl.index} ${c.dim('(cover)')}` : String(sl.index),
        sl.has_image ? c.green('✓') : c.red('✗'),
        (sl.image_prompt ?? '—').slice(0, 60)
      ])
    );
    info(`\nModifica una slide: anomalia post ${slug} ${postId} slide --index 1 --instruction "..."`);
    info(`Riordina:           anomalia post ${slug} ${postId} reorder --order "0,2,1"\n`);
  }
}

async function editPost(t: string, slug: string, postId: string, opts: Opts) {
  const patch: PostPatch = {};
  if (opts.caption !== undefined) patch.caption = opts.caption;
  if (opts.title !== undefined) patch.title = opts.title;
  if (opts.imagePrompt !== undefined) patch.image_prompt = opts.imagePrompt;
  if (opts.contentType !== undefined) patch.content_type = opts.contentType;
  if (opts.format !== undefined) patch.format = opts.format;
  if (opts.slot !== undefined) patch.slot = opts.slot;
  if (opts.product !== undefined) patch.product_name = opts.product;
  if (opts.firstComment !== undefined) patch.first_comment = opts.firstComment;
  if (opts.subreddit !== undefined) patch.subreddit = opts.subreddit;
  if (opts.platforms !== undefined) patch.platforms = opts.platforms.split(',').map((s) => s.trim()).filter(Boolean);
  // Empty string is the explicit "clear it" signal for both — null makes the post text-only.
  if (opts.link !== undefined) patch.link_url = opts.link || null;
  if (opts.media !== undefined) patch.media_url = opts.media || null;

  // --platformCaption x="testo", repeatable. No pairs → don't touch the column.
  if (opts.platformCaption?.length) {
    const overrides = parseKeyValuePairs(opts.platformCaption);
    if (!overrides) { fail('--platformCaption vuole platform=testo (es. x="testo breve")'); process.exit(1); }
    patch.platform_captions = Object.keys(overrides).length ? overrides : null;
  }

  if (Object.keys(patch).length === 0) {
    fail('Specifica almeno un campo da modificare');
    printHelp();
    process.exit(1);
  }

  await api.updatePost(t, slug, postId, patch);
  ok(`Post aggiornato (${Object.keys(patch).join(', ')}).`);
}

async function regenerate(t: string, slug: string, postId: string, opts: Opts) {
  if (!opts.instruction && !opts.prompt) { fail('Serve --instruction "cosa cambiare" o --prompt "prompt completo"'); process.exit(1); }
  info('Rigenerazione immagine in corso…');
  const r = await api.postMedia(t, slug, postId, { action: 'regenerate', instruction: opts.instruction, prompt: opts.prompt });
  if (r.error) { fail(r.error); process.exit(1); }
  if (r.rendered) ok(`Immagine rigenerata: ${r.media_url}`);
  else warn('Nessuna immagine prodotta — il prompt è stato comunque salvato.');
  if (r.notes) info(r.notes);
}

async function editSlide(t: string, slug: string, postId: string, opts: Opts) {
  const index = Number(opts.index);
  if (!Number.isInteger(index) || index < 0) { fail('Serve --index <n> (0 = copertina)'); process.exit(1); }
  if (!opts.instruction && !opts.prompt) { fail('Serve --instruction o --prompt'); process.exit(1); }
  info(`Rigenerazione slide ${index} in corso…`);
  const r = await api.postMedia(t, slug, postId, { action: 'slide', index, instruction: opts.instruction, prompt: opts.prompt });
  if (r.error) { fail(r.error); process.exit(1); }
  ok(r.rendered ? `Slide ${index} rigenerata.` : `Slide ${index}: prompt aggiornato, nessuna immagine prodotta.`);
}

async function reorder(t: string, slug: string, postId: string, opts: Opts) {
  if (!opts.order) { fail('Serve --order "0,2,1" (ometti un indice per eliminare quella slide)'); process.exit(1); }
  const order = opts.order.split(',').map((s) => Number(s.trim()));
  if (order.some((n) => !Number.isInteger(n) || n < 0)) { fail('--order vuole indici interi separati da virgola'); process.exit(1); }
  const r = await api.postMedia(t, slug, postId, { action: 'restructure', order });
  if (r.error) { fail(r.error); process.exit(1); }
  ok(`Carosello riordinato — ${r.slide_count} slide.`);
}

async function makeVideo(t: string, slug: string, postId: string, opts: Opts) {
  const duration = opts.duration === undefined ? undefined : Number(opts.duration);
  if (duration !== undefined && (!Number.isInteger(duration) || duration < 1 || duration > 15)) {
    fail('--duration vuole un intero tra 1 e 15 secondi'); process.exit(1);
  }
  info('Rendering del clip in corso — è la chiamata più costosa del motore, può richiedere qualche minuto…');
  const r = await api.postMedia(t, slug, postId, {
    action: 'video', duration, script: opts.script,
    instruction: opts.instruction, aspectRatio: opts.aspectRatio
  });
  if (r.error) { fail(r.error); process.exit(1); }
  ok(`Clip da ${r.duration_seconds}s allegato: ${r.media_url}`);
  if (r.videos_left !== undefined) info(`Video rimasti questo mese: ${r.videos_left}`);
}

async function publishNow(t: string, slug: string, postId: string) {
  info('Pubblicazione in corso…');
  await api.publishPost(t, slug, postId);
  ok('Post pubblicato.');
}

async function reschedulePost(t: string, slug: string, postId: string, scheduledFor?: string) {
  if (!scheduledFor) { fail('--scheduledFor è obbligatorio (formato: 2026-06-20T10:00)'); process.exit(1); }
  await api.reschedulePost(t, slug, postId, scheduledFor);
  ok(`Post riprogrammato per ${scheduledFor}.`);
}

async function renderImage(t: string, slug: string, postId: string) {
  info('Generazione immagine in corso…');
  const result = await api.renderPost(t, slug, postId);
  if (result.url) ok(`Immagine generata: ${result.url}`);
  else if (result.error) warn(`Immagine non generata: ${result.error}`);
  else warn('Immagine non generata (potrebbe essere un post text-only).');
}
