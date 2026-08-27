import type { SupabaseClient } from '@supabase/supabase-js';
import { parseGraphic, type Graphic, type GraphicAspect } from '$lib/design/blocks';
import { graphicToHtml } from '$lib/design/html-from-blocks';
import {
  detectGraphicSourceKind,
  isGraphicHtmlMeta,
  type GraphicHtmlMeta,
  type GraphicSourceKind
} from '$lib/design/graphic-source';

/**
 * The version log for composed graphics (migration 0139 + source column in 0167).
 *
 * A generated photo is a dead end: to change one word you re-roll the whole image and get a
 * different picture. A composed graphic isn't — it's source (HTML/TSX, or a legacy block spec),
 * so keeping it turns "make the headline shorter" into an edit instead of a fresh composition.
 * Every render appends a version rather than overwriting, so a bad edit is always one insert
 * away from being undone.
 */

export type GraphicTargetKind = 'post' | 'media_item';

export type GraphicTarget = {
  kind: GraphicTargetKind;
  id: string;
  /** Carousels address a slot; omit for a single cover. */
  slideIndex?: number | null;
};

export type GraphicVersion = {
  id: string;
  version: number;
  /** Legacy block spec. Null when this version is HTML/TSX-native. */
  spec: Graphic | null;
  /** HTML or React TSX. Generated from `spec` on read when an old row has none stored. */
  source: string | null;
  sourceKind: GraphicSourceKind;
  aspect: GraphicAspect;
  mediaUrl: string;
  brief: string | null;
  createdAt: string;
};

// `source` è una colonna vera in produzione (0167). Le letture non hanno più un ripiego che la
// omette: degradava in silenzio ogni riga HTML v2 a "grafica senza sorgente", che `parseGraphicRow`
// scarta — cioè faceva sparire la cronologia invece di dire che mancava una migration.
const SELECT = 'id, version, spec, source, media_url, brief, created_at';

export function parseGraphicRow(row: Record<string, unknown>): GraphicVersion | null {
  try {
    const specRaw = row.spec;
    const storedSource = typeof row.source === 'string' && row.source.trim() ? row.source : null;

    if (isGraphicHtmlMeta(specRaw)) {
      if (!storedSource) return null;
      return {
        id: String(row.id),
        version: Number(row.version),
        spec: null,
        source: storedSource,
        sourceKind: specRaw.kind,
        aspect: specRaw.aspect,
        mediaUrl: String(row.media_url),
        brief: typeof row.brief === 'string' ? row.brief : null,
        createdAt: String(row.created_at)
      };
    }

    const spec = parseGraphic(specRaw);
    return {
      id: String(row.id),
      version: Number(row.version),
      spec,
      source: storedSource,
      sourceKind: storedSource ? detectGraphicSourceKind(storedSource) : 'html',
      aspect: spec.aspect,
      mediaUrl: String(row.media_url),
      brief: typeof row.brief === 'string' ? row.brief : null,
      createdAt: String(row.created_at)
    };
  } catch {
    return null;
  }
}

/** HTML/TSX to edit — stored source, or a projection of the legacy block spec. */
export function versionSource(
  v: GraphicVersion,
  opts?: { brandColors?: string[] | null; fonts?: { display: string; body: string } }
): string {
  if (v.source?.trim()) return v.source;
  if (v.spec) return graphicToHtml(v.spec, opts);
  throw new Error('Graphic has no source');
}

function scope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  target: GraphicTarget
) {
  const scoped = q.eq('target_kind', target.kind).eq('target_id', target.id);
  return target.slideIndex == null
    ? scoped.is('slide_index', null)
    : scoped.eq('slide_index', target.slideIndex);
}

/** The current spec for a graphic, or null when the target was never composed. */
export async function latestGraphic(
  supabase: SupabaseClient,
  target: GraphicTarget
): Promise<GraphicVersion | null> {
  const { data, error } = await scope(supabase.from('graphic_designs').select(SELECT), target)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error('[design-store] latestGraphic:', error.message);
  return data ? parseGraphicRow(data as Record<string, unknown>) : null;
}

/** Full history, newest first — what an "undo" or a version picker reads. */
export async function graphicHistory(
  supabase: SupabaseClient,
  target: GraphicTarget,
  limit = 20
): Promise<GraphicVersion[]> {
  const { data, error } = await scope(supabase.from('graphic_designs').select(SELECT), target)
    .order('version', { ascending: false })
    .limit(limit);
  if (error) console.error('[design-store] graphicHistory:', error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map(parseGraphicRow).filter((v): v is GraphicVersion => !!v);
}

/**
 * Append a version. Best-effort: a graphic that rendered and reached storage must still ship if the
 * history write fails — losing the edit trail is worse than nothing, but losing the post is worse
 * than that. Returns the version number actually written, or null.
 */
export async function saveGraphicVersion(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    userId?: string | null;
    target: GraphicTarget;
    spec: Graphic | GraphicHtmlMeta;
    source?: string | null;
    mediaUrl: string;
    brief?: string | null;
  }
): Promise<number | null> {
  try {
    const current = await latestGraphic(supabase, input.target);
    const version = (current?.version ?? 0) + 1;
    const { error } = await supabase.from('graphic_designs').insert({
      brand_id: input.brandId,
      user_id: input.userId ?? null,
      target_kind: input.target.kind,
      target_id: input.target.id,
      slide_index: input.target.slideIndex ?? null,
      version,
      spec: input.spec,
      source: input.source ?? null,
      media_url: input.mediaUrl,
      brief: input.brief?.slice(0, 2000) ?? null
    });
    // Il ripiego che c'era qui reinseriva la riga SENZA `source` quando l'insert falliva con un
    // errore che conteneva la parola "source", e tornava `version` come se fosse andata bene. Il
    // risultato è misurato: 18 righe su 18 con `source` NULL, e due grafiche HTML v2 con uno
    // `spec` di 41 caratteri e nessun sorgente — che `parseGraphicRow` restituisce come `null`,
    // cioè illeggibili per il codice che le ha appena scritte. Un salvataggio che riesce a metà e
    // non lo dice è peggio di un salvataggio che fallisce: chi lo chiama continua come se la
    // cronologia esistesse. La colonna esiste in produzione (0167, applicata a mano); se un
    // domani manca di nuovo, questo deve gridare e restituire null, non inventare un successo.
    if (error) {
      console.error('[design-store] version insert failed:', error.message);
      return null;
    }
    return version;
  } catch (e) {
    console.error('[design-store] version insert threw:', e);
    return null;
  }
}
