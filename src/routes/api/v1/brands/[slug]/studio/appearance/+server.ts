import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { SET_APPEARANCE, statusForFailure } from '@anomalia/api-contracts';
import { storeBrandLogoFromUrl } from '$lib/server/studio-actions';
import { fontIsAvailable } from '$lib/server/design-typography';

// Il look del brand vive tutto in `brand_kit`. Qui si legge e si scrive quella riga sola: il logo
// passando per la guardia SSRF che il form gia' usa, i font passando per la stessa verifica Google
// Fonts del form. Nessun modello, nessun credito.

type Kit = Record<string, unknown>;

const KIT_COLUMNS = 'logos, favicon_url, brand_colors, graphic_style, visual_style, visual_style_locked';

/** Un'og-image e' il logo che abbiamo indovinato dal sito, non quello che il brand ha scelto. */
function chosenLogo(logos: unknown): string | null {
  if (!Array.isArray(logos)) return null;
  const hit = logos.find((l) => l?.url && l?.type !== 'og-image');
  return hit?.url ?? null;
}

function view(kit: Kit) {
  const style = (kit.graphic_style ?? null) as Record<string, unknown> | null;
  return {
    logo_url: chosenLogo(kit.logos),
    favicon_url: (kit.favicon_url as string) ?? null,
    colors: Array.isArray(kit.brand_colors) ? (kit.brand_colors as string[]) : [],
    graphic_style: style
      ? {
          display_font: (style.display_font as string) ?? null,
          body_font: (style.body_font as string) ?? null,
          instructions: (style.instructions as string) ?? null
        }
      : null,
    visual_style: (kit.visual_style as string) ?? null,
    visual_style_locked: kit.visual_style_locked === true
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readKit(supabase: any, brandId: string): Promise<Kit> {
  const { data } = await supabase.from('brand_kit').select(KIT_COLUMNS).eq('brand_id', brandId).maybeSingle();
  return (data ?? {}) as Kit;
}

const fail = (error: string, extra?: Record<string, unknown>) =>
  json({ error, ...extra }, { status: statusForFailure(SET_APPEARANCE, error) });

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  return json({ brand: brand.slug, appearance: view(await readKit(supabase, brand.id)) });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SET_APPEARANCE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const input = parsed.data;
  if (Object.keys(input).length === 0) return fail('no_fields');

  // Mettere e togliere nella stessa richiesta non ha un ordine giusto: indovinarlo lascerebbe
  // l'agente convinto di aver fatto l'altra cosa.
  if (input.remove_logo && input.logo_url) return fail('logo_conflict');

  // I font si verificano PRIMA di toccare qualunque cosa: un nome che Google Fonts non serve esce
  // in Inter senza dire niente, ed e' la confusione che questa verifica esiste per chiudere.
  const wantsFonts = input.display_font !== undefined || input.body_font !== undefined;
  if (wantsFonts && (input.display_font === undefined || input.body_font === undefined)) {
    return fail('font_pair_incomplete');
  }
  if (wantsFonts) {
    const pair = [input.display_font as string, input.body_font as string];
    const checked = await Promise.all(pair.map(fontIsAvailable));
    const missing = pair.filter((_, i) => !checked[i]);
    if (missing.length) return fail('font_not_available', { missing });
  }

  const patch: Kit = {};

  for (const [field, kind] of [
    ['logo_url', 'logo'],
    ['favicon_url', 'favicon']
  ] as const) {
    const src = input[field];
    if (src === undefined) continue;
    const { data } = await supabase.auth.getUser();
    const stored = await storeBrandLogoFromUrl(supabase, { userId: data.user?.id ?? '', imageUrl: src });
    if ('error' in stored) return fail('image_rejected', { detail: stored.error, url: src });
    if (kind === 'logo') patch.logos = [{ url: stored.url, type: 'uploaded' }];
    else patch.favicon_url = stored.url;
  }

  if (input.remove_logo) patch.logos = [];

  if (wantsFonts || input.graphic_instructions !== undefined) {
    const current = ((await readKit(supabase, brand.id)).graphic_style ?? {}) as Record<string, unknown>;
    patch.graphic_style = {
      display_font: input.display_font ?? current.display_font ?? null,
      body_font: input.body_font ?? current.body_font ?? null,
      instructions: input.graphic_instructions ?? current.instructions ?? ''
    };
  }

  // Scrivere il brief lo BLOCCA: senza il lock la ricostruzione notturna lo riscrive, e chi
  // l'aveva scritto lo ritroverebbe cambiato senza che nessuno glielo abbia detto.
  if (input.visual_style !== undefined) {
    patch.visual_style = input.visual_style;
    patch.visual_style_locked = true;
  }

  patch.updated_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('brand_kit')
    .upsert({ brand_id: brand.id, ...patch }, { onConflict: 'brand_id' });
  if (updateError) return fail('update_failed', { detail: updateError.message });

  return json({ ok: true, appearance: view(await readKit(supabase, brand.id)) });
};
