import { swallow } from '$lib/server/swallow';
/**
 * URL con il permesso attaccato.
 *
 * Un URL passato al modello senza dire cosa può farci è un invito a indovinare, e indovinando
 * l'agente fa la cosa peggiore: prende l'mp4 di un competitor e lo infila come reference in una
 * generazione. Il permesso quindi non sta nella descrizione del tool (che il modello legge una
 * volta e dimentica) ma NEL DATO: ogni URL viaggia con `use`, `owner` e i tool che lo accettano.
 *
 * Tre categorie, e sono esaustive:
 *  - `inspect_only` — roba di terzi. Si può ANALIZZARE (`breakdown_reference_video`) e
 *    nient'altro. Mai generare, mai ri-hostare. Da un video altrui esce solo testo, e quel testo
 *    è il brief. (`review_video` stava qui fino al 23/8/2026: smontato dalla chat, vedi
 *    CHAT_REVIEW_VIDEO_ENABLED in chat/agents.ts. Un nome in questa lista è una PROMESSA — l'URL
 *    viaggia dicendo quali tool lo accettano — quindi un tool non montato qui è una bugia.)
 *  - `reference`   — roba del CLIENTE. Si può passare come reference a una generazione.
 *  - `open`        — si apre in un browser, per l'utente. Non è un input di nessun tool.
 */

export type AgentUrlUse = 'inspect_only' | 'reference' | 'open';

export type AgentUrl = {
  url: string;
  /** Cosa se ne può fare. È il campo che decide, non `owner`. */
  use: AgentUrlUse;
  kind: 'video' | 'image' | 'page';
  owner: 'competitor' | 'brand';
  /** Che cos'è, in due parole ("competitor ad video", "product photo — Capy60"). */
  label: string;
  /** I tool che accettano davvero questo URL. Vuoto per `open`. */
  tools: string[];
};

/** La regola in una riga, allegata a ogni payload che contiene URL misti. */
export const AGENT_URL_POLICY =
  'Every url comes with `use`. inspect_only = someone else’s media: analyze it (breakdown_reference_video) and nothing else — never pass it to a generation, never re-host it. reference = this brand’s own media: safe to pass as a reference to generate_image / create_post / design_graphic / a video generation. open = for the human, open it in a browser. Path: inspect a competitor clip → get the shot brief → generate with `reference` urls. Never mix the two.';

const INSPECT_VIDEO_TOOLS = ['breakdown_reference_video'];
const REFERENCE_IMAGE_TOOLS = ['generate_image', 'create_post', 'design_graphic'];

export function inspectOnlyUrl(
  url: string,
  kind: 'video' | 'image',
  label: string
): AgentUrl {
  return {
    url,
    use: 'inspect_only',
    kind,
    owner: 'competitor',
    label,
    // Un'immagine di terzi non ha nemmeno un tool di ispezione dedicato: si guarda e basta.
    tools: kind === 'video' ? INSPECT_VIDEO_TOOLS : []
  };
}

export function brandReferenceUrl(
  url: string,
  kind: 'video' | 'image',
  label: string
): AgentUrl {
  return {
    url,
    use: 'reference',
    kind,
    owner: 'brand',
    label,
    tools: kind === 'image' ? REFERENCE_IMAGE_TOOLS : ['generate_video']
  };
}

export function openUrl(url: string, label: string): AgentUrl {
  return { url, use: 'open', kind: 'page', owner: 'competitor', label, tools: [] };
}

/**
 * Il materiale del CLIENTE riutilizzabile come reference: foto prodotto, persone del brand, media
 * library. È la metà che rende l'agente autonomo — senza, dopo aver smontato un annuncio deve
 * chiedere all'utente di incollare qualcosa.
 *
 * Cappato di proposito: sei prodotti / quattro persone / sei media sono un menù, non un catalogo.
 */
export async function listBrandReferenceUrls(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  brandId: string
): Promise<AgentUrl[]> {
  const out: AgentUrl[] = [];
  try {
    const { normalizeImageUrls } = await import('$lib/server/brand-design-doc');
    const [{ data: products }, { data: people }] = await Promise.all([
      supabase
        .from('products')
        .select('title, images, featured')
        .eq('brand_id', brandId)
        .order('featured', { ascending: false })
        .limit(6),
      supabase.from('people').select('name, images').eq('brand_id', brandId).limit(4)
    ]);

    for (const p of products ?? []) {
      const urls = normalizeImageUrls((p as { images?: unknown }).images).slice(0, 2);
      for (const u of urls) {
        out.push(brandReferenceUrl(u, 'image', `product photo — ${(p as { title?: string }).title ?? 'product'}`));
      }
    }

    const { signPersonImages } = await import('$lib/server/people');
    for (const person of people ?? []) {
      const imgs = (person as { images?: unknown }).images;
      if (!Array.isArray(imgs) || !imgs.length) continue;
      const signed = await signPersonImages(supabase, imgs.slice(0, 1) as { path: string }[]).catch((error) => { swallow('sign brand image urls', error); return [] as string[]; });
      for (const u of signed) {
        out.push(brandReferenceUrl(u, 'image', `brand person — ${(person as { name?: string }).name ?? 'person'}`));
      }
    }

    const { listBrandMedia } = await import('$lib/server/brand-media');
    const media = await listBrandMedia(supabase, brandId, { limit: 20 }).catch((error) => { swallow('list brand media', error); return []; });
    for (const m of media.slice(0, 6)) {
      if (!m.signed_url) continue;
      const isVideo = m.media_kind === 'video' || m.kind === 'video';
      out.push(
        brandReferenceUrl(
          m.signed_url,
          isVideo ? 'video' : 'image',
          `media library — ${m.title ?? m.file_name ?? 'asset'}`
        )
      );
    }
  } catch (e) {
    console.error('[agent-urls] brand references', e instanceof Error ? e.message : String(e));
  }
  return out;
}
