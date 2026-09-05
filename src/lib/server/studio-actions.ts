import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { rebuildBrandContext } from '$lib/server/brand-context';
import { invalidateBrandNav } from '$lib/server/nav-cache';
import { discoverCompetitors } from '$lib/server/research';
import { localeLanguageName } from '$lib/i18n/locale';
import { withBrandContext } from '$lib/server/ai-log';
import { syncBrandPostHistoryFromSocials, type ScrapeSyncResult } from '$lib/server/scrapecreators';
import { signKnowledgePaths, archiveImageToBucket } from '$lib/server/media-archive';
import { safeFetchBytes, SafeFetchError, type SafeFetchReason } from '$lib/server/tool-guard';
import { extractText, isSupportedDoc } from '$lib/server/documents';
import { personConsentColumns, CONSENT_NOT_ATTESTED } from '$lib/server/people-consent';
import {
  uploadPersonFile,
  uploadPersonDataUrls,
  generateAiPersonImages,
  type PersonImage,
  type PersonAttributes
} from '$lib/server/people';
import { PLATFORM_KEYS } from '$lib/components/platform-meta';
import { isRasterImageSource } from '$lib/raster-image';
import { readUploadImage } from '$lib/server/raster-image';
// Le regole di pulizia dei campi Studio stanno in un modulo foglia perché le usa ANCHE la chat
// (chat/tools.ts): due copie della stessa validazione divergono, e la divergenza esce stampata.
import { normalizeHashtags, normalizeWebsite, sanitizeBrandColors } from '$lib/brand-fields';

// Ceiling on the brand's free-text video direction. The video prompt is a stack of structural
// clauses (clean-frame rule, motion brief, spoken line, fidelity) and the model weights what it
// reads: an unbounded paste would drown them and the clip stops obeying the parts that matter.
export const VIDEO_INSTRUCTIONS_MAX = 600;

// Postgres `text` columns reject NUL bytes (\x00) and choke on stray control chars — both of which
// PDF copy-paste / text extraction routinely produce. Strip them (keep \t \n \r) before storing.
function sanitizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase
    .from('brands')
    .select('id, zernio_profile_id, content_prefs')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withBrand<T>(supabase: any, slug: string | undefined, fn: (brand: any) => Promise<T>): Promise<T> {
  if (!slug) return fail(404, { error: 'Brand not found' }) as T;
  const brand = await brandBySlug(supabase, slug);
  if (!brand) return fail(404, { error: 'Brand not found' }) as T;
  return withBrandContext(brand.id, async () => {
    try {
      return await fn(brand);
    } finally {
      invalidateBrandNav(slug);
    }
  });
}

/**
 * Il logo quando ad aggiornarlo è la CHAT, non il form. Sta in questo file di proposito: bucket,
 * nome del file e forma della riga in `brand_kit.logos` devono restare UNA cosa sola, o le due
 * strade divergono al primo cambio e nessuno se ne accorge finché un render non esce senza logo.
 *
 * Un tool che salvasse l'URL remoto così com'è scriverebbe in `logos` un link che scade (una CDN
 * social, un signed URL, un allegato di chat): il renderer se lo va a prendere ogni volta, quindi
 * il giorno che muore le immagini escono senza logo — e non fallisce niente, quindi non lo segnala
 * nessuno. Per questo l'immagine viene COPIATA nel bucket pubblico, esattamente come fa l'upload.
 *
 * L'unica differenza col form è inevitabile: lì l'ingresso è un File e passa da `readUploadImage`
 * (che converte anche gli HEIC), qui è un URL, quindi c'è un fetch con guardia SSRF. Il tetto di
 * byte, il path e la riga sono gli stessi.
 *
 * L'URL lo sceglie un MODELLO (`set_brand_logo`), quindi è testo che un contenuto ostile può
 * dettare: la guardia deve risolvere l'indirizzo, non leggere l'hostname, e deve ricontrollarlo
 * su ogni redirect. `safeFetchBytes` fa entrambe le cose ed è l'unica copia di quel controllo.
 */
const LOGO_MAX_BYTES = 4_000_000;
const LOGO_TIMEOUT_MS = 15_000;

// http resta ammesso: il logo di onboarding arriva dal sito del brand, e un sito ancora in chiaro
// è comune abbastanza che rifiutarlo romperebbe l'onboarding per chiudere un buco che si chiude
// comunque risolvendo l'indirizzo.
const LOGO_ERROR_BY_REASON: Record<SafeFetchReason, string> = {
  not_public: 'That image URL is not fetchable (blocked or not http/https).',
  too_large: 'Too large — the logo must be under 4MB.',
  fetch_failed: 'Could not download the image.'
};

export async function storeBrandLogoFromUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { userId: string; imageUrl: string }
): Promise<{ url: string } | { error: string }> {
  const src = String(opts.imageUrl ?? '').trim();
  if (!src) return { error: 'No image URL' };

  let fetched;
  try {
    fetched = await safeFetchBytes(src, { maxBytes: LOGO_MAX_BYTES, timeoutMs: LOGO_TIMEOUT_MS });
  } catch (e) {
    if (e instanceof SafeFetchError) return { error: LOGO_ERROR_BY_REASON[e.reason] };
    return { error: 'Could not download the image.' };
  }

  if (!fetched.ok) return { error: `Could not download the image (HTTP ${fetched.status}).` };
  if (!fetched.mime.startsWith('image/')) return { error: 'That URL is not an image.' };
  if (!fetched.bytes.length) return { error: 'The image is empty.' };

  const { mime, bytes } = fetched;

  // Stessa mappa del form: tutto ciò che non è png/gif/webp finisce come jpg.
  const ext = mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `${opts.userId}/studio/logo-${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from('media').upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { error: String(up.error.message ?? 'Upload failed') };
  const url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  if (!url) return { error: 'Upload succeeded but produced no public URL.' };
  return { url };
}

// Bare host (no scheme/www) used to dedupe competitors by domain regardless of how it was typed.
function hostOf(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

export const studioActions: Actions = {

  updateBrandKit: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const website = normalizeWebsite(String(fd.get('website') ?? ''));
      const patch = {
        about: String(fd.get('about') ?? '').trim() || null,
        category: String(fd.get('category') ?? '').trim() || null,
        target_audience: String(fd.get('target_audience') ?? '').trim() || null,
        brand_style: String(fd.get('brand_style') ?? '').trim() || null,
        source_url: website,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('brand_kit').update(patch).eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });

      // Post language lives on brands.content_prefs (shared with the planner). Merge, don't clobber.
      const language = String(fd.get('language') ?? '').trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      if (language) prefs.language = language;
      else delete prefs.language;
      await supabase.from('brands').update({ content_prefs: prefs, website }).eq('id', brand.id);

      await rebuildBrandContext(supabase, brand.id);
      return { saved: true };
    });
  },

  // Per-platform copy instructions live on brands.content_prefs.platformInstructions, keyed by the
  // internal platform key. The form posts one field per platform named `pg_<key>` (e.g. pg_linkedin);
  // we merge non-empty values in and drop blanks, so clearing a box removes that override. This does
  // NOT touch the brand context (it only steers caption generation), so no rebuild is needed.
  updatePlatformGuidance: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      const instructions: Record<string, string> = {};
      for (const [key, value] of fd.entries()) {
        if (!key.startsWith('pg_')) continue;
        const platform = key.slice(3).toLowerCase().trim();
        const text = String(value ?? '').trim();
        if (platform && text) instructions[platform] = text;
      }
      if (Object.keys(instructions).length) prefs.platformInstructions = instructions;
      else delete prefs.platformInstructions;
      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Which social platforms the brand operates on (brands.target_platforms) — drives the whole planner
  // (platform playbook, aspect ratios, cross-post targets). Posts `platforms` as a JSON array of keys.
  // We keep only the known keys so a bad value can't poison generation; empty → null (no restriction).
  updateTargetPlatforms: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const KNOWN = new Set<string>(PLATFORM_KEYS);
      const fd = await request.formData();
      let platforms: string[] = [];
      try {
        const parsed = JSON.parse(String(fd.get('platforms') ?? '[]'));
        if (Array.isArray(parsed)) {
          platforms = [...new Set(
            parsed.map((p) => { const k = String(p).toLowerCase().trim(); return k === 'twitter' ? 'x' : k; }).filter((k) => KNOWN.has(k))
          )];
        }
      } catch {
        return fail(400, { error: 'Invalid platforms' });
      }
      const { error } = await supabase.from('brands')
        .update({ target_platforms: platforms.length ? platforms : null }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Preferred hashtags per platform live on brands.content_prefs.platformHashtags, keyed by internal
  // platform key. The form posts one field per platform named `ph_<key>`; each value is a free-typed
  // list we normalise to clean tags. When set, the planner/regenerator use ONLY these (guidanceFor),
  // so the AI never invents new hashtags. Dedicated action — it must NOT touch platformInstructions.
  updatePlatformHashtags: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      const map: Record<string, string[]> = {};
      for (const [key, value] of fd.entries()) {
        if (!key.startsWith('ph_')) continue;
        const platform = key.slice(3).toLowerCase().trim();
        const tags = normalizeHashtags(String(value ?? ''));
        if (platform && tags.length) map[platform] = tags;
      }
      if (Object.keys(map).length) prefs.platformHashtags = map;
      else delete prefs.platformHashtags;
      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Voice examples: real past social posts (one per line) the AI uses to match the brand's writing
  // style. Split by newline, trim each, drop empties, and store into content_prefs.voiceExamples.
  updateVoiceExamples: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      const raw = String(fd.get('voiceExamples') ?? '').trim();
      const examples = raw
        .split('\n')
        .map((line) => String(line ?? '').trim())
        .filter(Boolean);
      if (examples.length) prefs.voiceExamples = examples;
      else delete prefs.voiceExamples;
      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Clip length for generated videos (Settings → Video). Stored on content_prefs.videoDuration so
  // it needs no migration and travels with the other generation preferences. Clamped against the
  // brand's chosen (or env-default) model — the ceiling is that model's maxDuration, never a
  // global constant.
  updateVideoDuration: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const { clampVideoDuration, isKnownVideoModel } = await import('$lib/server/video');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      const raw = String(fd.get('videoDuration') ?? '').trim();
      const model = isKnownVideoModel(prefs.videoModel) ? prefs.videoModel : null;
      // Empty = "use the default" — delete rather than store a zero, so the default can move later
      // without every brand being pinned to today's number.
      if (!raw) delete prefs.videoDuration;
      else prefs.videoDuration = clampVideoDuration(raw, model);
      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Quale modello serve quale mestiere (Settings -> Images & video). Una sola azione per tutti e
  // sei gli slot: la regola che un modello deve saper fare il lavoro in cui viene salvato vale
  // ovunque, e scritta sei volte divergerebbe al primo cambio.
  updateMediaModel: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const { mediaModelSlot } = await import('$lib/media-model-slots');
      const slot = mediaModelSlot(fd.get('slot'));
      if (!slot) return fail(400, { error: 'Unknown model slot' });

      // La regola sta in `chooseMediaModel`, non qui: il browser e i tool dell'API la chiamano
      // entrambi, e scritta due volte divergerebbe al primo modello nuovo.
      const { chooseMediaModel } = await import('$lib/server/media-model-prefs');
      const { prefs } = chooseMediaModel(
        brand.content_prefs as Record<string, unknown> | null,
        slot,
        String(fd.get('model') ?? '').trim() || null
      );
      if (!prefs) return fail(400, { error: 'Unknown model for this slot' });

      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Shipping resolution for generated videos (Settings → Video). 720p costs exactly DOUBLE per
  // second, and every draft is paid for whether or not it ever ships — which is why 480p is the
  // recommended default and this is an explicit opt-in rather than a quality ladder we climb for
  // the brand. Same storage shape as videoDuration: on content_prefs, no migration.
  updateVideoResolution: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const { clampVideoResolution } = await import('$lib/server/video');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      const raw = String(fd.get('videoResolution') ?? '').trim();
      // Empty = "use the default" — deleted rather than pinned, so the default can move later.
      if (!raw) delete prefs.videoResolution;
      else prefs.videoResolution = clampVideoResolution(raw);
      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Free-text video direction (Settings → Video). Steers the CLIP — spoken delivery, energy,
  // what the person on camera must never do — as opposed to platformInstructions, which steers the
  // caption. Capped so a pasted essay can't crowd out the structural parts of the video prompt;
  // blank clears the override rather than storing an empty string.
  updateVideoInstructions: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs: Record<string, any> = { ...(brand.content_prefs ?? {}) };
      const text = String(fd.get('videoInstructions') ?? '').trim().slice(0, VIDEO_INSTRUCTIONS_MAX);
      if (text) prefs.videoInstructions = text;
      else delete prefs.videoInstructions;
      const { error } = await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Brand colours: the swatch editor posts the full list as JSON. They steer every image render
  // (brandVisualDirective), so no context rebuild is needed â the renderer reads them live.
  updateColors: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      let colors: string[] = [];
      try {
        const parsed = JSON.parse(String(fd.get('colors') ?? '[]'));
        if (Array.isArray(parsed)) {
          colors = sanitizeBrandColors(parsed);
        }
      } catch {
        return fail(400, { error: 'Invalid colours' });
      }
      const { error } = await supabase
        .from('brand_kit')
        .update({ brand_colors: colors, updated_at: new Date().toISOString() })
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Logo: ONE slot. Upload replaces whatever was detected (public media bucket â brand_kit.logos
  // stores plain long-lived URLs the renderer fetches); `remove` empties the slot.
  updateLogo: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();

      if (String(fd.get('remove') ?? '') === '1') {
        const { error } = await supabase
          .from('brand_kit')
          .update({ logos: [], updated_at: new Date().toISOString() })
          .eq('brand_id', brand.id);
        if (error) return fail(400, { error: error.message });
        return { saved: true };
      }

      const file = fd.get('file');
      if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'No file' });
      const img = await readUploadImage(file, { maxOutBytes: 4_000_000 });
      if (!img.ok) {
        return fail(400, {
          error:
            img.error === 'too_large'
              ? 'Too large'
              : img.error === 'not_image'
                ? 'Not an image'
                : 'Could not convert image'
        });
      }
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Unauthorized' });

      const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/gif' ? 'gif' : img.mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `${user.id}/studio/logo-${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage
        .from('media')
        .upload(path, img.bytes, { contentType: img.mime, upsert: false });
      if (up.error) return fail(400, { error: up.error.message });
      const url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;

      const { error } = await supabase
        .from('brand_kit')
        .update({ logos: [{ url, type: 'uploaded' }], updated_at: new Date().toISOString() })
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Products: rename / reprice in place. The planner reads the products table live on every
  // batch, so edits apply to the next generation immediately.
  updateProduct: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      const title = String(fd.get('title') ?? '').trim();
      if (!id || !title) return fail(400, { error: 'Title is required' });
      const { error } = await supabase
        .from('products')
        .update({ title, pricing: String(fd.get('pricing') ?? '').trim() || null })
        .eq('id', id)
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  deleteProduct: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      const { error } = await supabase.from('products').delete().eq('id', id).eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  addNote: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const title = sanitizeText(String(fd.get('title') ?? '')).trim() || 'Note';
      // Pasting from a PDF often drags in NUL bytes / control chars that Postgres text columns reject
      // and that can choke the downstream model call — strip them before storing.
      const body = sanitizeText(String(fd.get('content_text') ?? '')).trim();
      if (!body) return fail(400, { error: 'Note is empty' });
      const { error } = await supabase
        .from('brand_documents')
        .insert({ brand_id: brand.id, kind: 'note', title, content_text: body });
      if (error) return fail(400, { error: error.message });
      // The note is saved; rebuilding the AI context is a best-effort side effect, so never let it
      // turn a successful save into a 500.
      try {
        await rebuildBrandContext(supabase, brand.id);
      } catch (e) {
        console.error('rebuildBrandContext after addNote failed:', e);
      }
      return { saved: true };
    });
  },

  // The browser uploads the file straight to Storage (Vercel caps action request bodies at ~4.5MB,
  // which most PDFs/images blow past), then posts only the resulting path + metadata here. We
  // re-download server-side to extract the text that becomes the brand's AI memory.
  uploadDocument: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const path = String(fd.get('path') ?? '');
      const fileName = String(fd.get('file_name') ?? '');
      const mimeType = String(fd.get('mime_type') ?? '');
      // The client picks the path, so confirm it lives under this user+brand before trusting it —
      // otherwise a forged path could attach someone else's file or land outside the brand's folder.
      if (!path.startsWith(`${user.id}/${brand.id}/`)) return fail(400, { error: 'Invalid file path' });
      if (!fileName || !isSupportedDoc(mimeType, fileName))
        return fail(400, { error: 'Unsupported file. Use PDF, TXT or Markdown.' });
      const dl = await supabase.storage.from('brand-knowledge').download(path);
      if (dl.error || !dl.data) return fail(400, { error: dl.error?.message ?? 'File not found' });
      let content_text = '';
      try {
        content_text = sanitizeText(await extractText(await dl.data.arrayBuffer(), mimeType, fileName));
      } catch {
        content_text = '';
      }
      const { error } = await supabase.from('brand_documents').insert({
        brand_id: brand.id, kind: 'document', title: fileName,
        content_text, file_url: path, file_name: fileName, mime_type: mimeType
      });
      if (error) return fail(400, { error: error.message });
      try {
        await rebuildBrandContext(supabase, brand.id);
      } catch (e) {
        console.error('rebuildBrandContext after uploadDocument failed:', e);
      }
      return { saved: true };
    });
  },

  uploadImage: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      // The images form posts one path/file_name/mime_type per picked image (it can be several at
      // once). Older single-file callers still work since getAll() returns a one-element list.
      const paths = fd.getAll('path').map(String);
      const fileNames = fd.getAll('file_name').map(String);
      const mimeTypes = fd.getAll('mime_type').map(String);
      if (!paths.length) return fail(400, { error: 'No image uploaded' });
      const title = String(fd.get('title') ?? '').trim();

      // Mood references cap at 3 (the renderer only attaches the 3 newest — MOOD_REF_IMAGES). Clamp so
      // an upload can never push the brand past the cap the UI advertises.
      const { count } = await supabase
        .from('brand_documents').select('id', { count: 'exact', head: true })
        .eq('brand_id', brand.id).eq('kind', 'image');
      const remaining = 3 - (count ?? 0);
      if (remaining <= 0) return fail(400, { error: 'Max 3 reference images — remove one first' });
      if (paths.length > remaining) paths.length = remaining;

      const rows = [];
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const fileName = fileNames[i] ?? '';
        const mimeType = mimeTypes[i] ?? '';
        if (!path.startsWith(`${user.id}/${brand.id}/`)) return fail(400, { error: 'Invalid file path' });
        if (!fileName || !mimeType.startsWith('image/')) return fail(400, { error: 'Not an image' });
        rows.push({
          brand_id: brand.id, kind: 'image',
          // A single title only makes sense for one image; with several, each keeps its file name.
          title: (paths.length === 1 && title) || fileName,
          file_url: path, file_name: fileName, mime_type: mimeType
        });
      }
      const { error } = await supabase.from('brand_documents').insert(rows);
      if (error) return fail(400, { error: error.message });
      // No context rebuild: mood references are read straight from brand_documents at render time
      // (loadBrandMoodImageUrls), so they take effect immediately — rebuilding the whole brief here is
      // a slow multimodal LLM call that would block the UI for minutes for no benefit.
      return { saved: true };
    });
  },

  // Add one of the brand's OWN past posts as a style reference: copy its (already-archived, or live
  // CDN) thumbnail into a dedicated mood file so deleting the reference never touches the history
  // row. Same shape as an image upload, so the renderer picks it up with zero extra wiring.
  addMoodFromHistory: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const id = String(fd.get('history_id') ?? '');
      if (!id) return fail(400, { error: 'Missing post' });

      const { count } = await supabase
        .from('brand_documents').select('id', { count: 'exact', head: true })
        .eq('brand_id', brand.id).eq('kind', 'image');
      if ((count ?? 0) >= 3) return fail(400, { error: 'Max 3 reference images — remove one first' });

      const { data: h } = await supabase
        .from('social_post_history').select('thumbnail_path, thumbnail_url')
        .eq('id', id).eq('brand_id', brand.id).maybeSingle();
      if (!h) return fail(404, { error: 'Post not found' });
      // Prefer the archived copy (a live, signable path); fall back to the scraped CDN URL.
      let url = String(h.thumbnail_url ?? '');
      if (h.thumbnail_path) {
        const m = await signKnowledgePaths(supabase, [String(h.thumbnail_path)]);
        url = m.get(String(h.thumbnail_path)) ?? url;
      }
      if (!url) return fail(400, { error: 'This post has no usable image' });

      const path = `${user.id}/${brand.id}/mood/${crypto.randomUUID()}.jpg`;
      const stored = await archiveImageToBucket(supabase, path, url);
      if (!stored) return fail(400, { error: 'Could not save the image — try another post' });
      const { error } = await supabase.from('brand_documents').insert({
        brand_id: brand.id, kind: 'image', title: 'Post style reference',
        file_url: stored, file_name: 'post-style-reference.jpg', mime_type: 'image/jpeg'
      });
      if (error) return fail(400, { error: error.message });
      // No context rebuild — same as uploadImage: the reference is live immediately, and the slow
      // multimodal rebuild is what was freezing the page for minutes on each pick.
      return { saved: true };
    });
  },

  // Add reference images pulled from ANOTHER social account (e.g. a competitor), picked via
  // SocialThumbPicker on the client. Same archive-then-insert mechanism as addMoodFromHistory —
  // download each picked CDN thumbnail into our own bucket before it expires — just sourced from
  // arbitrary URLs instead of a history row, so the result is indistinguishable from any other
  // mood image in the grid.
  addMoodFromUrls: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      let urls: string[] = [];
      try {
        const parsed = JSON.parse(String(fd.get('urls') ?? '[]'));
        if (Array.isArray(parsed)) urls = parsed.map(String).filter(Boolean);
      } catch {
        return fail(400, { error: 'Invalid urls' });
      }
      if (!urls.length) return fail(400, { error: 'No images selected' });

      const { count } = await supabase
        .from('brand_documents').select('id', { count: 'exact', head: true })
        .eq('brand_id', brand.id).eq('kind', 'image');
      let remaining = 3 - (count ?? 0);
      if (remaining <= 0) return fail(400, { error: 'Max 3 reference images — remove one first' });

      const rows = [];
      for (const url of urls) {
        if (remaining <= 0) break;
        const path = `${user.id}/${brand.id}/mood/${crypto.randomUUID()}.jpg`;
        const stored = await archiveImageToBucket(supabase, path, url);
        if (!stored) continue;
        rows.push({
          brand_id: brand.id, kind: 'image', title: 'Social reference',
          file_url: stored, file_name: 'social-reference.jpg', mime_type: 'image/jpeg'
        });
        remaining--;
      }
      if (!rows.length) return fail(400, { error: 'Could not save the selected images' });
      const { error } = await supabase.from('brand_documents').insert(rows);
      if (error) return fail(400, { error: error.message });
      // No context rebuild — same as uploadImage/addMoodFromHistory: mood references are read
      // straight from brand_documents at render time.
      return { saved: true };
    });
  },

  deleteSource: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });
      const { data: doc } = await supabase
        .from('brand_documents').select('file_url, kind').eq('id', id).eq('brand_id', brand.id).maybeSingle();
      if (doc?.file_url) await supabase.storage.from('brand-knowledge').remove([doc.file_url]);
      const { error } = await supabase
        .from('brand_documents').delete().eq('id', id).eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      // Only notes/documents feed the text brief, so only they need a rebuild. Deleting an image
      // (a mood reference) takes effect at render time — skip the slow multimodal rebuild that was
      // freezing the page for minutes.
      if (doc?.kind !== 'image') await rebuildBrandContext(supabase, brand.id);
      return { saved: true };
    });
  },

  // Real person: upload 1..N photos to the private bucket and store the refs on a people row.
  addPersonReal: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const name = String(fd.get('name') ?? '').trim();
      if (!name) return fail(400, { error: 'Name is required' });

      const files = fd.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
      if (!files.length) return fail(400, { error: 'Add at least one photo' });

      const images: PersonImage[] = [];
      for (const file of files.slice(0, 6)) {
        if (!isRasterImageSource({ mime: file.type, filename: file.name })) continue;
        const ref = await uploadPersonFile(
          supabase,
          user.id,
          brand.id,
          { buffer: await file.arrayBuffer(), name: file.name, type: file.type }
        );
        if (ref) images.push(ref);
      }
      if (!images.length) return fail(400, { error: 'No valid images uploaded' });

      const consent = personConsentColumns(
        'real',
        String(fd.get('consent') ?? '') === 'on' ? 'owner_attested' : 'none'
      );
      if (!consent) return fail(400, { error: CONSENT_NOT_ATTESTED });

      const { error } = await supabase.from('people').insert({
        brand_id: brand.id,
        name,
        role: String(fd.get('role') ?? '').trim() || null,
        kind: 'real',
        description: String(fd.get('description') ?? '').trim() || null,
        images,
        ...consent
      });
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // AI person: generate a base portrait + a couple of consistent poses, then store the refs.
  generatePersonAI: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const name = String(fd.get('name') ?? '').trim();
      if (!name) return fail(400, { error: 'Name is required' });

      const attributes: PersonAttributes = {
        gender: String(fd.get('gender') ?? '').trim() || undefined,
        ageRange: String(fd.get('ageRange') ?? '').trim() || undefined,
        ethnicity: String(fd.get('ethnicity') ?? '').trim() || undefined,
        vibe: String(fd.get('vibe') ?? '').trim() || undefined
      };
      const description = String(fd.get('description') ?? '').trim();

      let dataUrls: string[] = [];
      try {
        dataUrls = await generateAiPersonImages({ attributes, description });
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : 'Generation failed' });
      }
      if (!dataUrls.length) return fail(400, { error: 'Could not generate the person — try again' });

      const images = await uploadPersonDataUrls(supabase, user.id, brand.id, dataUrls);
      if (!images.length) return fail(400, { error: 'Could not save the generated images' });

      const { error } = await supabase.from('people').insert({
        brand_id: brand.id,
        name,
        role: String(fd.get('role') ?? '').trim() || null,
        kind: 'ai',
        description: description || null,
        attributes,
        images,
        ...personConsentColumns('ai', 'none')
      });
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Unblock a real person whose consent was never actually attested — imported from the website or
  // a social profile during onboarding, or created before migration 0187. The owner states it here;
  // until they do, resolvePeopleVisualRefs withholds that face from every generator.
  attestPersonConsent: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '').trim();
      if (!id) return fail(400, { error: 'Missing person' });
      const { error } = await supabase
        .from('people')
        .update({
          consent: true,
          consent_at: new Date().toISOString(),
          consent_source: 'owner_attested'
        })
        .eq('id', id)
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  deletePerson: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });
      const { data: person } = await supabase
        .from('people').select('images').eq('id', id).eq('brand_id', brand.id).maybeSingle();
      const paths = ((person?.images ?? []) as PersonImage[]).map((i) => i.path).filter(Boolean);
      if (paths.length) await supabase.storage.from('brand-knowledge').remove(paths);
      const { error } = await supabase.from('people').delete().eq('id', id).eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Competitors: user-managed CRUD. New rows are tagged source 'user' so they're distinguishable
  // from the ones Anomalia discovered; the strategy/benchmark snapshots are left untouched here.
  addCompetitor: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const name = String(fd.get('name') ?? '').trim();
      if (!name) return fail(400, { error: 'Name is required' });
      const kind = String(fd.get('kind') ?? 'direct').trim() === 'indirect' ? 'indirect' : 'direct';
      const { error } = await supabase.from('competitors').insert({
        brand_id: brand.id,
        name,
        website: normalizeWebsite(String(fd.get('website') ?? '')),
        kind,
        rationale: String(fd.get('rationale') ?? '').trim() || null,
        source: 'user'
      });
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  updateCompetitor: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });
      const name = String(fd.get('name') ?? '').trim();
      if (!name) return fail(400, { error: 'Name is required' });
      const kind = String(fd.get('kind') ?? 'direct').trim() === 'indirect' ? 'indirect' : 'direct';
      const { error } = await supabase
        .from('competitors')
        .update({
          name,
          website: normalizeWebsite(String(fd.get('website') ?? '')),
          kind,
          rationale: String(fd.get('rationale') ?? '').trim() || null
        })
        .eq('id', id)
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  // Re-run the onboarding's web-grounded competitor discovery (Stage A) on demand. Rebuilds the
  // brand profile from its stored kit, then inserts only competitors we don't already have —
  // deduped by name and by website host so a rerun never piles up duplicates. Also resolves
  // social handles (needed for Formati di mercato scrape + Monday cron).
  researchCompetitors: async ({ params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {

      const [{ data: brandRow }, { data: kit }, { data: products }, { data: existing }] = await Promise.all([
        supabase.from('brands').select('name, website, target_platforms').eq('id', brand.id).maybeSingle(),
        supabase.from('brand_kit').select('category, about, target_audience, ai_context, source_url').eq('brand_id', brand.id).maybeSingle(),
        supabase.from('products').select('title').eq('brand_id', brand.id).limit(8),
        supabase.from('competitors').select('name, website').eq('brand_id', brand.id)
      ]);

      const profile = {
        name: brandRow?.name ?? '',
        url: kit?.source_url ?? brandRow?.website ?? '',
        category: kit?.category ?? '',
        about: kit?.about ?? '',
        target_audience: kit?.target_audience ?? '',
        ai_context: kit?.ai_context ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        language: ((brand.content_prefs as any)?.language as string) ?? '',
        products: (products ?? []).map((p) => ({ name: p.title }))
      };

      let discovered;
      try {
        ({ competitors: discovered } = await discoverCompetitors(profile, localeLanguageName(locale)));
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : 'Competitor research failed' });
      }

      // Dedupe against what's already saved (and within the discovered batch itself).
      const seenNames = new Set((existing ?? []).map((c) => c.name.trim().toLowerCase()));
      const seenHosts = new Set((existing ?? []).map((c) => hostOf(c.website)).filter(Boolean));
      const fresh = discovered.filter((c) => {
        const name = c.name.trim().toLowerCase();
        if (!name || seenNames.has(name)) return false;
        const h = hostOf(c.website);
        if (h && seenHosts.has(h)) return false;
        seenNames.add(name);
        if (h) seenHosts.add(h);
        return true;
      });

      if (fresh.length) {
        const platforms = Array.isArray(brandRow?.target_platforms)
          ? (brandRow.target_platforms as string[]).filter(Boolean)
          : ['instagram', 'tiktok'];
        const { resolveCompetitorHandles } = await import('$lib/server/research');
        const handleMap = await resolveCompetitorHandles(fresh, platforms).catch((error) => { swallow('resolve competitor handles', error); return new Map(); });

        const rows = fresh.map((c) => ({
          brand_id: brand.id,
          name: c.name,
          website: normalizeWebsite(c.website),
          kind: c.kind === 'indirect' ? 'indirect' : 'direct',
          rationale: c.rationale || null,
          handles: handleMap.get(c.name) ?? [],
          source: 'ai' as const
        }));
        const { error } = await supabase.from('competitors').insert(rows);
        if (error) return fail(400, { error: error.message });
      }

      return { researched: true, added: fresh.length, found: discovered.length };
    });
  },

  deleteCompetitor: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });
      const { error } = await supabase
        .from('competitors')
        .delete()
        .eq('id', id)
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  syncHistory: async ({ params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      let result: ScrapeSyncResult;
      try {
        result = await syncBrandPostHistoryFromSocials(supabase, { id: brand.id });
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : 'Sync failed' });
      }
      if (result.accounts === 0) return { synced: 0, noAccounts: true };
      if (result.synced > 0) await rebuildBrandContext(supabase, brand.id);
      return { synced: result.synced, errors: result.errors };
    });
  },

  /**
   * Typography for composed graphics. The families are VALIDATED against the renderer before they
   * are saved: a name Google Fonts will not serve renders as Inter with nothing said, which is the
   * exact confusion this feature exists to end. Better to refuse the save and say why.
   */
  updateGraphicStyle: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const display = String(fd.get('display_font') ?? '').trim();
      const body = String(fd.get('body_font') ?? '').trim();
      const instructions = String(fd.get('instructions') ?? '').trim().slice(0, 1200);
      if (!display || !body) return fail(400, { error: 'Scegli un font per i titoli e uno per il testo.' });

      const { fontIsAvailable } = await import('$lib/server/design-typography');
      const [okDisplay, okBody] = await Promise.all([fontIsAvailable(display), fontIsAvailable(body)]);
      const missing = [!okDisplay ? display : null, !okBody ? body : null].filter(Boolean);
      if (missing.length) {
        return fail(400, {
          error: `Google Fonts non serve ${missing.join(' e ')}. Scegli un altro font, o le grafiche uscirebbero comunque in Inter.`
        });
      }

      const { error } = await supabase
        .from('brand_kit')
        .update({ graphic_style: { display_font: display, body_font: body, instructions } })
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  /** Let the AI pick the pairing and write the art direction from what the brand kit knows. */
  proposeGraphicStyle: async ({ params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      try {
        const { ensureGraphicStyle } = await import('$lib/server/design-typography');
        const style = await ensureGraphicStyle(supabase, brand.id, { force: true });
        if (!style) return fail(500, { error: 'Proposta non riuscita.' });
        return { proposed: true, graphic_style: style };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'Proposta non riuscita.' });
      }
    });
  },

  updateVisualStyle: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const text = String(fd.get('visual_style') ?? '').trim();
      if (text.length < 20) return fail(400, { error: 'Brief troppo corto (min 20 caratteri).' });
      if (text.length > 2000) return fail(400, { error: 'Brief troppo lungo (max 2000 caratteri).' });
      const { error } = await supabase.from('brand_kit').update({ visual_style: text, visual_style_locked: true }).eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  regenerateVisualStyle: async ({ params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      // Unlock so rebuildBrandContext can write the new visual_style.
      await supabase.from('brand_kit').update({ visual_style_locked: false }).eq('brand_id', brand.id);
      try {
        await rebuildBrandContext(supabase, brand.id);
      } catch (e) {
        // Re-lock on failure so the user's previous brief isn't left in a half-rebuilt state.
        await supabase.from('brand_kit').update({ visual_style_locked: true }).eq('brand_id', brand.id);
        return fail(500, { error: e instanceof Error ? e.message : 'Regeneration failed' });
      }
      // Re-read to confirm the visual_style was actually written (synthesizeVisualStyle returns ''
      // when the brand has no post images, leaving visual_style null).
      const { data: refreshed } = await supabase.from('brand_kit').select('visual_style').eq('brand_id', brand.id).maybeSingle();
      if (!refreshed?.visual_style) {
        return fail(422, { error: 'Impossibile generare il brief visivo: carica prima alcune immagini o post di riferimento nello Studio.' });
      }
      return { regenerated: true };
    });
  },

  refreshMarketReferences: async ({ params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { count } = await supabase
        .from('competitors')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brand.id);
      if (!count) {
        return fail(400, { error: 'Add competitors first.' });
      }
      try {
        const { refreshMarketReferences } = await import('$lib/server/market-references');
        const row = await withBrandContext(brand.id, () =>
          refreshMarketReferences(supabase, brand.id, { force: true })
        );
        if (!row) return fail(400, { error: 'Could not refresh market references.' });
        return {
          marketRefreshed: true,
          formats: row.catalog.formats.length,
          references: row.references.length,
          ads: row.ads?.length ?? 0
        };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'Refresh failed' });
      }
    });
  },

  // Field watch: scopre chi ottiene attenzione NEL CAMPO del brand, lo smonta e distilla il
  // playbook. Non richiede competitor: è il ramo che serve proprio quando non sai chi guardare.
  refreshField: async ({ params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      try {
        const { runFieldWatch } = await import('$lib/server/market-field');
        const { createAdminClient } = await import('$lib/server/supabase-admin');
        const out = await withBrandContext(brand.id, () =>
          runFieldWatch(createAdminClient(), { id: brand.id, name: brand.name })
        );
        return {
          fieldRefreshed: true,
          linked: out.harvest.linked,
          teardowns: out.teardowns,
          playbook: out.playbook
        };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'Field watch failed' });
      }
    });
  }
};
