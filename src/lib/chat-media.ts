/**
 * Il payload del blocco "guarda questo" (tool `show_media`): foto e video che l'agente mostra
 * DELIBERATAMENTE, e che non sono post.
 *
 * Client-safe e con UN normalizzatore, per la stessa ragione di chat-team / chat-connect: lo
 * leggono la persistenza (che arricchisce la tool-call part, perché la compattazione dei turni
 * lunghi butta gli output), la ChatColumn e la chat a pagina piena.
 *
 * DA DOVE PUÒ VENIRE UN URL, che è tutta la sostanza di questo file. Un agente che ha appena
 * letto una pagina web, o ricevuto l'output di un tool esterno, ha in mano stringhe che non ha
 * scelto lui: incorporarle significa far caricare al browser dell'utente una risorsa scelta da
 * terzi — nel caso benigno un pixel di tracciamento con IP e referrer. Quindi si mostra solo
 * quello che è NOSTRO: lo storage del progetto, `/storage/v1/object/...` sull'host di questo
 * progetto Supabase (pubblico o firmato, è lo stesso host). Tutto il resto si rifiuta, e
 * all'agente si dice cosa fare invece — pubblicarlo come artefatto, che scarica i byte da noi.
 *
 * E non ci si fida dell'estensione per decidere se una cosa è sicura: l'estensione decide solo
 * `<img>` o `<video>` DOPO che l'host è già stato riconosciuto (stessa scelta che PostCard fa da
 * sempre con `isVideoUrl`). SVG e HTML non sono nell'elenco: sono markup eseguibile travestito da
 * contenuto, esattamente per cui `inferArtifactKind` li degrada a `code`.
 */
import { env as publicEnv } from '$env/dynamic/public';
import { isVideoUrl, isImageUrl } from '$lib/content-formats';

export type ChatMediaItem = {
  url: string;
  /** Perché sto guardando questa cosa. Facoltativa: senza, la conversazione non lo spiega. */
  caption?: string;
  kind: 'image' | 'video';
};

/** Oltre questo un blocco non è più "guarda questo", è una galleria: il posto è la libreria. */
export const MAX_CHAT_MEDIA = 8;

const OWN_HOST = (() => {
  try {
    return new URL(publicEnv.PUBLIC_SUPABASE_URL).host;
  } catch {
    return '';
  }
})();

/** Viene da noi? Host dello storage del progetto + un percorso di storage, e nient'altro. */
export function isOwnMediaUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (!OWN_HOST || u.host !== OWN_HOST) return false;
    return u.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false;
  }
}

/** Mostrabile: nostro E riconoscibile come foto o video (un PDF non si incorpora, si scarica). */
export function isShowableMediaUrl(url: unknown): boolean {
  return isOwnMediaUrl(url) && (isVideoUrl(String(url)) || isImageUrl(String(url)));
}

export function mediaItem(url: string, caption?: string | null): ChatMediaItem {
  return {
    url,
    kind: isVideoUrl(url) ? 'video' : 'image',
    ...(caption?.trim() ? { caption: caption.trim().slice(0, 300) } : {})
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    const v = JSON.parse(t) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parti `{ type:'text', text }` — il payload vero sta nel JSON, non nella lista. */
function recordFromContentParts(parts: unknown[]): Record<string, unknown> | null {
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (typeof p.text === 'string' && (p.type === 'text' || p.type === undefined)) {
      const parsed = parseJsonObject(p.text);
      if (parsed) return parsed;
    }
  }
  return null;
}

/**
 * L'output di un tool in chat può arrivare in tre involucri: l'oggetto piano (`{ media }`),
 * il wrapper SDK `{ type, value }` (`toModelOutput` mette `type:'content'` e un array di parti),
 * o il `ToolResult` del kit (`{ content: [{ type:'text', text }] }`).
 * Senza srotolare, `motion_stills` pubblica gli URL e la UI non li vede mai.
 */
function unwrapToolRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') return parseJsonObject(raw);
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw)) {
    return recordFromContentParts(raw) ?? { media: raw };
  }
  const rec = raw as Record<string, unknown>;
  if ('type' in rec && 'value' in rec && rec.value !== undefined) {
    const inner = unwrapToolRecord(rec.value);
    if (inner) return inner;
  }
  if (Array.isArray(rec.content)) {
    const fromParts = recordFromContentParts(rec.content);
    if (fromParts) return fromParts;
  }
  return rec;
}

function rowsFromRecord(src: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(src.media)) return src.media;
  if (Array.isArray(src.artifacts)) return src.artifacts;
  return null;
}

/** Accetta sia la part arricchita dalla persistenza sia l'output grezzo del turno live. */
export function normalizeMediaPayload(raw: unknown): ChatMediaItem[] | null {
  const src = unwrapToolRecord(raw);
  if (!src) return null;
  const list = rowsFromRecord(src) ?? (Array.isArray(raw) ? raw : null);
  if (!list) return null;
  const out: ChatMediaItem[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const r = (row ?? {}) as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url : '';
    const caption = typeof r.caption === 'string' ? r.caption : typeof r.title === 'string' ? r.title : null;
    // Ricontrollato QUI e non solo nel tool: la part la rilegge il browser mesi dopo, e una
    // guardia che sta in un posto solo è una guardia che un percorso nuovo si dimentica.
    if (!isShowableMediaUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(mediaItem(url, caption));
    if (out.length >= MAX_CHAT_MEDIA) break;
  }
  return out.length ? out : null;
}

/** Media già sulla part (`part.media`) o ancora solo nell'output del tool (turno live / kit). */
export function mediaFromToolCall(tc: { media?: unknown; output?: unknown } | null | undefined): ChatMediaItem[] | null {
  if (!tc) return null;
  return normalizeMediaPayload(tc.media ? { media: tc.media } : tc.output);
}

/**
 * Un indirizzo del NOSTRO storage, da solo su una riga, è una consegna: l'agente sta dicendo
 * "guarda questo", solo che l'ha scritto invece di mostrarlo. Lo si toglie dal testo e lo si
 * rende come media, fuori dalla bolla — è la stessa promozione che `splitGoalStatus` fa con il
 * notice del goal, e vale per foto e video allo stesso modo.
 *
 * DA SOLO SU UNA RIGA, e non altrove: un link dentro un periodo ("l'ho salvato qui: X, poi ho
 * fatto Y") è una frase, non una consegna, e strapparlo via lascerebbe un buco nel discorso.
 * La riga che lo introduce ("Link del trailer:") resta dov'è: è la didascalia.
 *
 * `skip` sono gli URL che il turno mostra già con `show_media`: se l'agente ha fatto entrambe le
 * cose, il media compare una volta sola, e vince la chiamata al tool.
 */
export function splitTextMedia(
  text: string,
  skip?: ReadonlySet<string>
): { text: string; media: ChatMediaItem[] | null } {
  if (!text || !text.includes('http')) return { text, media: null };
  const media: ChatMediaItem[] = [];
  const seen = new Set<string>();
  const kept = text.split('\n').filter((line) => {
    const url = line.trim();
    if (!isShowableMediaUrl(url) || seen.has(url)) return true;
    seen.add(url);
    // Già mostrato da show_media: la riga sparisce comunque, la card è di là.
    if (!skip?.has(url) && media.length < MAX_CHAT_MEDIA) media.push(mediaItem(url));
    return false;
  });
  if (!seen.size) return { text, media: null };
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), media: media.length ? media : null };
}

/** Gli URL che questo turno mostra già come blocco media — per non farli comparire due volte. */
export function showMediaUrls(blocks: ReadonlyArray<ChatBlockLike>): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type !== 'tools' || !Array.isArray(b.calls)) continue;
    for (const tc of b.calls) {
      const items = mediaFromToolCall(tc);
      for (const m of items ?? []) out.add(m.url);
    }
  }
  return out;
}

/** Quel poco che serve dei blocchi di chat-parts, senza importarli (e senza ciclo). */
type ChatBlockLike = { type: string; calls?: Array<{ toolName?: string; media?: unknown; output?: unknown }> };
